// Config.json is the central configuration. It tells the orchestrator which agents to run and where their reports are located.
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

type AgentConfig = {
  name: string;
  script: string;
  enabled: boolean;
  required: boolean;
  reports: string[];
  timeoutMs?: number;
};

type OrchestratorConfig = {
  version: string;
  stopOnRequiredAgentFailure: boolean;
  agents: AgentConfig[];
};

type AgentExecution = {
  name: string;
  script: string;
  required: boolean;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  exitCode: number | null;
  durationSeconds: number;
  error?: string;
  reports: {
    path: string;
    exists: boolean;
    parsed: boolean;
    data?: unknown;
    error?: string;
  }[];
};

type NormalizedFinding = {
  agent: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  category: string;
  title: string;
  evidence: string;
};

const ROOT = process.cwd();

const CONFIG_FILE = path.join(
  ROOT,
  "qe-intelligence-orchestrator",
  "test-data",
  "qe-orchestrator",
  "config.json"
);

const OUTPUT_DIR = path.join(
  ROOT,
  "qe-intelligence-orchestrator",
  "test-results",
  "qe-orchestrator"
);

const REPORT_MD = path.join(
  OUTPUT_DIR,
  "qe-unified-intelligence-report.md"
);

const REPORT_JSON = path.join(
  OUTPUT_DIR,
  "qe-unified-intelligence-report.json"
);

const LOG_DIR = path.join(OUTPUT_DIR, "logs");

const EXECUTION_TIMEOUT_MS = 5 * 60 * 1000;

const executions: AgentExecution[] = [];
const normalizedFindings: NormalizedFinding[] = [];

function readJson<T>(file: string): T {
  if (!fs.existsSync(file)) {
    throw new Error(`Configuration not found: ${file}`);
  }

  return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

function safeString(value: unknown): string {
  if (typeof value === "string") return value;

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  return "";
}

function normalizeSeverity(
  value: unknown
): NormalizedFinding["severity"] | null {
  const severity = safeString(value).toUpperCase();

  if (
    ["CRITICAL", "BLOCKER", "FATAL"].includes(severity)
  ) {
    return "CRITICAL";
  }

  if (
    ["HIGH", "BREAKING", "FAIL", "FAILED"].includes(severity)
  ) {
    return "HIGH";
  }

  if (
    ["MEDIUM", "WARNING", "WARN"].includes(severity)
  ) {
    return "MEDIUM";
  }

  if (
    ["LOW", "MINOR"].includes(severity)
  ) {
    return "LOW";
  }

  if (
    ["INFO", "INFORMATIONAL"].includes(severity)
  ) {
    return "INFO";
  }

  return null;
}

function normalizeFinding(
  agent: string,
  raw: Record<string, unknown>
): NormalizedFinding | null {
  const severity =
    normalizeSeverity(raw.severity) ??
    normalizeSeverity(raw.priority) ??
    normalizeSeverity(raw.level);

  if (!severity) return null;

  const title =
    safeString(raw.title) ||
    safeString(raw.message) ||
    safeString(raw.description) ||
    safeString(raw.category) ||
    "Finding reported by agent";

  const evidence =
    safeString(raw.message) ||
    safeString(raw.description) ||
    safeString(raw.details) ||
    safeString(raw.observed) ||
    title;

  return {
    agent,
    severity,
    category:
      safeString(raw.category) ||
      safeString(raw.type) ||
      "GENERAL",
    title,
    evidence
  };
}

function collectFindings(
  agentName: string,
  data: unknown
) {
  if (!data || typeof data !== "object") return;

  const root = data as Record<string, unknown>;

  function visit(value: unknown, depth: number) {
    if (depth > 8 || !value || typeof value !== "object") {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }

      return;
    }

    const object = value as Record<string, unknown>;

    // Only arrays explicitly named "findings" are treated
    // as individual findings.
    for (const [key, child] of Object.entries(object)) {
      if (
        key.toLowerCase() === "findings" &&
        Array.isArray(child)
      ) {
        for (const item of child) {
          if (item && typeof item === "object") {
            const finding = normalizeFinding(
              agentName,
              item as Record<string, unknown>
            );

            if (finding) {
              normalizedFindings.push(finding);
            }
          }
        }
      } else if (
        child &&
        typeof child === "object"
      ) {
        visit(child, depth + 1);
      }
    }
  }

  visit(root, 0);
}

function isExplicitlyFailingGate(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;

  const root = data as Record<string, unknown>;

  const candidates = [
    root.decision,
    root.recommendation,
    root.gateStatus,
    root.gate,
    root.releaseDecision,
    root.status
  ];

  return candidates.some(value =>
    ["FAIL", "FAILED", "BLOCK", "BLOCKED", "REJECTED"]
      .includes(safeString(value).toUpperCase())
  );
}

function calculateRisk(
  agentRuns: AgentExecution[],
  reports: unknown[]
) {
  const critical = normalizedFindings.filter(
    f => f.severity === "CRITICAL"
  ).length;

  const high = normalizedFindings.filter(
    f => f.severity === "HIGH"
  ).length;

  const medium = normalizedFindings.filter(
    f => f.severity === "MEDIUM"
  ).length;

  const low = normalizedFindings.filter(
    f => f.severity === "LOW"
  ).length;

  const failedRequiredAgents = agentRuns.filter(
    run => run.required && run.status === "FAILED"
  ).length;

  const failingGate = reports.some(
    isExplicitlyFailingGate
  );

  let score = 0;

  score += critical * 30;
  score += high * 15;
  score += medium * 5;
  score += low * 1;
  score += failedRequiredAgents * 20;

  if (failingGate) {
    score += 30;
  }

  score = Math.min(score, 100);

  let risk: string;

  if (critical > 0 || failingGate) {
    risk = "CRITICAL";
  } else if (score >= 40 || failedRequiredAgents > 0) {
    risk = "HIGH";
  } else if (score >= 15 || high > 0) {
    risk = "ELEVATED";
  } else if (score > 0 || medium > 0) {
    risk = "MODERATE";
  } else {
    risk = "LOW";
  }

  return {
    score,
    risk,
    critical,
    high,
    medium,
    low,
    failedRequiredAgents,
    failingGate
  };
}

function executeAgent(
  agent: AgentConfig
): Promise<{
  exitCode: number;
  durationSeconds: number;
  error?: string;
}> {
  return new Promise(resolve => {
    const start = Date.now();

    const logFile = path.join(
      LOG_DIR,
      `${agent.script.replace(/[^a-zA-Z0-9_-]/g, "_")}.log`
    );

    const logStream = fs.createWriteStream(logFile);

    const child = spawn(
      "npm",
      ["run", agent.script],
      {
        cwd: ROOT,
        shell: process.platform === "win32"
      }
    );

    let finished = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");

      setTimeout(() => {
        if (!finished) {
          child.kill("SIGKILL");
        }
      }, 5000);
    }, agent.timeoutMs ?? EXECUTION_TIMEOUT_MS);

    child.stdout.on("data", chunk => {
      const output = chunk.toString();

      process.stdout.write(output);
      logStream.write(output);
    });

    child.stderr.on("data", chunk => {
      const output = chunk.toString();

      process.stderr.write(output);
      logStream.write(output);
    });

    child.on("error", error => {
      if (finished) return;

      finished = true;
      clearTimeout(timeout);
      logStream.end();

      resolve({
        exitCode: 1,
        durationSeconds: (Date.now() - start) / 1000,
        error: error.message
      });
    });

    child.on("close", code => {
      if (finished) return;

      finished = true;
      clearTimeout(timeout);
      logStream.end();

      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        durationSeconds: (Date.now() - start) / 1000,
        error: timedOut
          ? `Agent exceeded timeout of ${agent.timeoutMs ?? EXECUTION_TIMEOUT_MS} ms.`
          : undefined
      });
    });
  });
}

function collectAgentReports(
  agent: AgentConfig
): AgentExecution["reports"] {
  return agent.reports.map(relativePath => {
    const absolutePath = path.resolve(ROOT, relativePath);

    // Prevent report paths escaping the project directory.
    if (
      absolutePath !== ROOT &&
      !absolutePath.startsWith(ROOT + path.sep)
    ) {
      return {
        path: relativePath,
        exists: false,
        parsed: false,
        error: "Report path is outside the project directory."
      };
    }

    if (!fs.existsSync(absolutePath)) {
      return {
        path: relativePath,
        exists: false,
        parsed: false
      };
    }

    try {
      const content = JSON.parse(
        fs.readFileSync(absolutePath, "utf-8")
      );

      return {
        path: relativePath,
        exists: true,
        parsed: true,
        data: content
      };
    } catch (error) {
      return {
        path: relativePath,
        exists: true,
        parsed: false,
        error:
          error instanceof Error
            ? error.message
            : String(error)
      };
    }
  });
}

function summarizeAgent(
  agent: AgentExecution
): string {
  const reportCount = agent.reports.filter(
    r => r.exists && r.parsed
  ).length;

  return [
    `| ${agent.name} | ${agent.status} | ${agent.durationSeconds.toFixed(1)}s | ${reportCount}/${agent.reports.length} |`
  ].join("");
}

function buildMarkdownReport(
  risk: ReturnType<typeof calculateRisk>,
  report: {
    generatedAt: string;
    executions: AgentExecution[];
    findings: NormalizedFinding[];
  }
): string {
  const lines = [
    "# Unified QE Intelligence Report",
    "",
    "## Executive Summary",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Overall risk: **${risk.risk}**`,
    `- QE risk score: ${risk.score}/100`,
    `- Total normalized findings: ${report.findings.length}`,
    `- Critical findings: ${risk.critical}`,
    `- High findings: ${risk.high}`,
    `- Medium findings: ${risk.medium}`,
    `- Low findings: ${risk.low}`,
    `- Failed required agents: ${risk.failedRequiredAgents}`,
    `- Quality gate explicitly failed: ${risk.failingGate ? "YES" : "NO"}`,
    "",
    "## Agent Execution Summary",
    "",
    "| Agent | Status | Duration | Reports collected |",
    "|---|---|---:|---:|",
    ...report.executions.map(summarizeAgent),
    "",
    "## Consolidated Findings",
    ""
  ];

  if (report.findings.length === 0) {
    lines.push(
      "No structured findings were collected. This is not proof that the release is safe; verify that the agents produced fresh reports."
    );
  } else {
    lines.push(
      "| Severity | Agent | Category | Finding | Evidence |",
      "|---|---|---|---|---|"
    );

    for (const finding of report.findings) {
      const clean = (value: string) =>
        value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

      lines.push(
        `| ${finding.severity} | ${clean(finding.agent)} | ${clean(finding.category)} | ${clean(finding.title)} | ${clean(finding.evidence)} |`
      );
    }
  }

  lines.push(
    "",
    "## Release Recommendation",
    ""
  );

  if (risk.risk === "CRITICAL") {
    lines.push(
      "**DO NOT RELEASE without investigation and resolution of critical findings or a formally approved exception.**"
    );
  } else if (risk.risk === "HIGH") {
    lines.push(
      "**Release is not recommended until high-risk findings and required-agent failures are reviewed.**"
    );
  } else if (risk.risk === "ELEVATED") {
    lines.push(
      "**Release requires engineering review and explicit risk acceptance.**"
    );
  } else if (risk.risk === "MODERATE") {
    lines.push(
      "**Review outstanding findings before release.**"
    );
  } else {
    lines.push(
      "**No configured high-risk signals were detected in the collected reports. This is not a guarantee of defect-free software.**"
    );
  }

  lines.push(
    "",
    "## Agent Report References",
    ""
  );

  for (const agent of report.executions) {
    lines.push(`### ${agent.name}`);

    for (const artifact of agent.reports) {
      lines.push(
        `- ${artifact.path}: ${
          artifact.parsed
            ? "Collected"
            : artifact.exists
              ? "Invalid JSON"
              : "Not found"
        }`
      );
    }

    if (agent.error) {
      lines.push(`- Execution error: ${agent.error}`);
    }

    lines.push("");
  }

  lines.push(
    "## Architecture Notes",
    "",
    "- Agents execute independently through their existing npm scripts.",
    "- JSON reports form the shared communication contract.",
    "- The orchestrator normalizes structured findings without changing individual agent outputs.",
    "- The risk score is a configurable heuristic, not a calibrated probability of release failure.",
    "- A missing or stale report must not be interpreted as a successful agent result.",
    "- AI recommendations remain advisory; deterministic findings and approved release policy remain authoritative."
  );

  return lines.join("\n");
}

async function main() {
  console.log("\n==========================================");
  console.log(" QE UNIFIED INTELLIGENCE ORCHESTRATOR");
  console.log("==========================================\n");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });

  const config = readJson<OrchestratorConfig>(CONFIG_FILE);

  if (!Array.isArray(config.agents)) {
    throw new Error("Invalid orchestrator config: agents must be an array.");
  }

  // Clear prior run findings so only current-run data is aggregated.
  normalizedFindings.length = 0;

  const packageJson = readJson<{
    scripts?: Record<string, string>;
  }>(path.join(ROOT, "package.json"));

  const enabledAgents = config.agents.filter(a => a.enabled);

  if (enabledAgents.length === 0) {
    throw new Error("No agents are enabled in orchestrator config.");
  }

  console.log(`Enabled agents: ${enabledAgents.length}\n`);

  for (const agent of enabledAgents) {
    console.log("\n------------------------------------------");
    console.log(`Running: ${agent.name}`);
    console.log(`Command: npm run ${agent.script}`);
    console.log("------------------------------------------\n");

    if (!packageJson.scripts?.[agent.script]) {
      const execution: AgentExecution = {
        name: agent.name,
        script: agent.script,
        required: agent.required,
        status: "FAILED",
        exitCode: 1,
        durationSeconds: 0,
        error: `npm script '${agent.script}' is not defined in package.json.`,
        reports: collectAgentReports(agent)
      };

      executions.push(execution);

      console.error(execution.error);

      if (
        agent.required &&
        config.stopOnRequiredAgentFailure
      ) {
        break;
      }

      continue;
    }

    // Remove old reports before execution to prevent stale data
    // from being mistaken for a fresh result.
    for (const reportPath of agent.reports) {
      const absolutePath = path.resolve(ROOT, reportPath);

      if (
        absolutePath.startsWith(ROOT + path.sep) &&
        fs.existsSync(absolutePath)
      ) {
        fs.rmSync(absolutePath, { force: true });
      }
    }

    const result = await executeAgent(agent);

    const reports = collectAgentReports(agent);

    const execution: AgentExecution = {
      name: agent.name,
      script: agent.script,
      required: agent.required,
      status: result.exitCode === 0 ? "SUCCESS" : "FAILED",
      exitCode: result.exitCode,
      durationSeconds: result.durationSeconds,
      error: result.error,
      reports
    };

    executions.push(execution);

    for (const artifact of reports) {
      if (artifact.parsed) {
        collectFindings(agent.name, artifact.data);
      }
    }

    const missingReports = reports.filter(
      r => !r.exists || !r.parsed
    );

    if (missingReports.length > 0) {
      console.warn(
        `Warning: ${missingReports.length} report(s) missing or invalid for ${agent.name}.`
      );
    }

    console.log(
      `\n${agent.name}: ${execution.status} (${result.durationSeconds.toFixed(1)}s)`
    );

    if (
      execution.status === "FAILED" &&
      agent.required &&
      config.stopOnRequiredAgentFailure
    ) {
      console.error(
        "Stopping because a required agent failed."
      );
      break;
    }
  }

  const collectedReports = executions.flatMap(agent =>
    agent.reports
      .filter(r => r.parsed)
      .map(r => r.data)
  );

  const risk = calculateRisk(
    executions,
    collectedReports
  );

  const output = {
    generatedAt: new Date().toISOString(),
    risk,
    executions,
    findings: normalizedFindings
  };

  fs.writeFileSync(
    REPORT_JSON,
    JSON.stringify(output, null, 2)
  );

  fs.writeFileSync(
    REPORT_MD,
    buildMarkdownReport(risk, output)
  );

  console.log("\n==========================================");
  console.log(" UNIFIED QE INTELLIGENCE SUMMARY");
  console.log("==========================================");
  console.log(`Overall risk: ${risk.risk}`);
  console.log(`Risk score: ${risk.score}/100`);
  console.log(`Findings: ${normalizedFindings.length}`);
  console.log(`Critical: ${risk.critical}`);
  console.log(`High: ${risk.high}`);
  console.log(`Medium: ${risk.medium}`);
  console.log(`Low: ${risk.low}`);

  console.log("\nAgent execution:");

  for (const agent of executions) {
    console.log(
      `- ${agent.name}: ${agent.status}`
    );
  }

  console.log("\nGenerated files:");
  console.log(`- ${REPORT_MD}`);
  console.log(`- ${REPORT_JSON}`);
  console.log(`- ${LOG_DIR}`);

  console.log("\nOrchestration completed.\n");

  // The orchestrator generates a risk assessment.
  // It does not yet enforce a Jenkins release gate.
}

main().catch(error => {
  console.error("\nQE Orchestrator failed:");
  console.error(error);
  process.exitCode = 1;
});