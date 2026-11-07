import fs from "fs";
import path from "path";
import { spawn, execFileSync } from "child_process";

type AgentConfig = {
  name: string;
  script: string;
  enabled: boolean;
  required: boolean;
  reports: string[];
  timeoutMs?: number;
};

type Policy = {
  triggers: string[];
  allowAISelection?: boolean;
  allowDisabled?: boolean;
};

type AgenticConfig = {
  enabled?: boolean;
  planner?: {
    provider?: "ollama";
    baseUrl?: string;
    model?: string;
    timeoutMs?: number;
  };
  maxConditionalRuns?: number;
  maxRetries?: number;
  alwaysRun?: string[];
  finalAgents?: string[];
  noChangeFallback?: string[];
  policies?: Record<string, Policy>;
  humanApproval?: {
    requireForRisk?: string[];
  };
};

type OrchestratorConfig = {
  version: string;
  stopOnRequiredAgentFailure: boolean;
  agents: AgentConfig[];
  agentic?: AgenticConfig;
};

type AgentRun = {
  name: string;
  script: string;
  required: boolean;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  exitCode: number | null;
  durationSeconds: number;
  attempts: number;
  reason: string;
  error?: string;
  reports: Array<{
    path: string;
    exists: boolean;
    parsed: boolean;
    fresh: boolean;
    summary?: string;
    error?: string;
  }>;
};

type PlannerDecision = {
  nextAgent: string | null;
  reason: string;
};

type WorkflowEvent = {
  timestamp: string;
  type: string;
  [key: string]: unknown;
};

const ROOT = process.cwd();
const ORCHESTRATOR_DIR = path.join(ROOT, "qe-intelligence-orchestrator");
const CONFIG_FILE = path.join(
  ORCHESTRATOR_DIR,
  "test-data",
  "qe-orchestrator",
  "config.json"
);
const OUTPUT_DIR = path.join(
  ORCHESTRATOR_DIR,
  "test-results",
  "qe-agentic-orchestrator"
);
const LOG_DIR = path.join(OUTPUT_DIR, "logs");
const EVENTS_FILE = path.join(OUTPUT_DIR, "events.jsonl");
const REPORT_JSON = path.join(OUTPUT_DIR, "qe-agentic-workflow.json");
const REPORT_MD = path.join(OUTPUT_DIR, "qe-agentic-workflow.md");

const DEFAULT_PLANNER = {
  baseUrl: "http://127.0.0.1:11434",
  model: "qwen3:4b",
  timeoutMs: 45_000
};

const runs: AgentRun[] = [];
const events: WorkflowEvent[] = [];

function logEvent(type: string, details: Record<string, unknown> = {}) {
  const event = { timestamp: new Date().toISOString(), type, ...details };
  events.push(event);
  fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + "\n");
}

function readJson<T>(file: string): T {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function safeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (prefix: string) => args.find(a => a.startsWith(prefix))?.slice(prefix.length);
  const files = get("--files=");
  const summary = get("--summary=");
  const base = get("--base=");
  return {
    files: (files ?? process.env.QE_CHANGED_FILES ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean),
    summary: summary ?? process.env.QE_CHANGE_SUMMARY ?? "",
    base: base ?? process.env.QE_BASE_REF ?? "",
    dryRun: args.includes("--dry-run")
  };
}

function validateRelativePath(relativePath: string): string {
  const absolute = path.resolve(ROOT, relativePath);
  if (absolute !== ROOT && !absolute.startsWith(ROOT + path.sep)) {
    throw new Error(`Configured report path escapes project root: ${relativePath}`);
  }
  return absolute;
}

function clearConfiguredJsonReports(agents: AgentConfig[]) {
  // JSONL history files can be inputs to agents. Never delete them here.
  for (const agent of agents) {
    for (const reportPath of agent.reports) {
      if (path.extname(reportPath).toLowerCase() !== ".json") continue;
      const absolute = validateRelativePath(reportPath);
      if (fs.existsSync(absolute)) fs.rmSync(absolute, { force: true });
    }
  }
}

function readChangeContext(input: ReturnType<typeof parseArgs>) {
  let files = [...input.files];
  let source = files.length ? "CLI/environment" : "none";

  if (!files.length && input.base) {
    try {
      const output = execFileSync(
        "git",
        ["diff", "--name-only", `${input.base}...HEAD`],
        { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      );
      files = output.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      source = `git diff ${input.base}...HEAD`;
    } catch {
      source = `git diff unavailable for base '${input.base}'`;
    }
  }

  return { files, summary: input.summary, source };
}

function policyFor(config: OrchestratorConfig, name: string): Policy {
  return config.agentic?.policies?.[name] ?? { triggers: [], allowAISelection: false };
}

function matchesTrigger(agent: AgentConfig, policy: Policy, files: string[], summary: string) {
  const haystack = `${files.join(" ")} ${summary}`.toLowerCase();
  return policy.triggers.some(trigger => haystack.includes(trigger.toLowerCase()));
}

function reportSummary(agent: AgentConfig): AgentRun["reports"] {
  return agent.reports.map(relativePath => {
    const absolute = validateRelativePath(relativePath);
    if (!fs.existsSync(absolute)) {
      return { path: relativePath, exists: false, parsed: false, fresh: false };
    }

    try {
      const raw = fs.readFileSync(absolute, "utf8");
      if (path.extname(relativePath).toLowerCase() === ".jsonl") {
        const lines = raw.split(/\r?\n/).filter(Boolean);
        return {
          path: relativePath,
          exists: true,
          parsed: true,
          fresh: true,
          summary: `JSONL history file; ${lines.length} records (content not sent to planner).`
        };
      }

      const data: unknown = JSON.parse(raw);
      const compact = JSON.stringify(data);
      return {
        path: relativePath,
        exists: true,
        parsed: true,
        fresh: true,
        summary: compact.slice(0, 2200)
      };
    } catch (error) {
      return {
        path: relativePath,
        exists: true,
        parsed: false,
        fresh: true,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
}

function runNpmScript(
  agent: AgentConfig,
  timeoutMs: number
): Promise<{ exitCode: number; durationSeconds: number; error?: string }> {
  return new Promise(resolve => {
    const started = Date.now();
    const safeName = agent.script.replace(/[^a-zA-Z0-9_-]/g, "_");
    const logPath = path.join(LOG_DIR, `${safeName}.log`);
    const stream = fs.createWriteStream(logPath, { flags: "a" });
    const child = spawn("npm", ["run", agent.script], {
      cwd: ROOT,
      shell: process.platform === "win32"
    });

    let finished = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!finished) child.kill("SIGKILL");
      }, 4000);
    }, timeoutMs);

    child.stdout.on("data", chunk => {
      const value = chunk.toString();
      process.stdout.write(value);
      stream.write(value);
    });
    child.stderr.on("data", chunk => {
      const value = chunk.toString();
      process.stderr.write(value);
      stream.write(value);
    });

    const finish = (exitCode: number, error?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      stream.end();
      resolve({
        exitCode,
        durationSeconds: (Date.now() - started) / 1000,
        error
      });
    };

    child.on("error", error => finish(1, error.message));
    child.on("close", code => {
      finish(
        timedOut ? 124 : (code ?? 1),
        timedOut ? `Timed out after ${timeoutMs} ms.` : undefined
      );
    });
  });
}

async function executeAgent(
  agent: AgentConfig,
  reason: string,
  maxRetries: number,
  scripts: Record<string, string>
): Promise<AgentRun> {
  if (!scripts[agent.script]) {
    return {
      name: agent.name,
      script: agent.script,
      required: agent.required,
      status: "FAILED",
      exitCode: 1,
      durationSeconds: 0,
      attempts: 0,
      reason,
      error: `npm script '${agent.script}' is not defined in package.json.`,
      reports: reportSummary(agent)
    };
  }

  let attempt = 0;
  let totalDuration = 0;
  let lastError: string | undefined;
  let lastExitCode = 1;

  while (attempt <= maxRetries) {
    attempt++;
    logEvent("agent_started", { agent: agent.name, attempt, reason });
    const result = await runNpmScript(agent, agent.timeoutMs ?? 5 * 60 * 1000);
    totalDuration += result.durationSeconds;
    lastExitCode = result.exitCode;
    lastError = result.error;

    logEvent("agent_finished", {
      agent: agent.name,
      attempt,
      exitCode: result.exitCode,
      durationSeconds: result.durationSeconds,
      error: result.error ?? null
    });

    if (result.exitCode === 0) break;
    if (attempt <= maxRetries) {
      logEvent("agent_retry", { agent: agent.name, nextAttempt: attempt + 1 });
    }
  }

  const reports = reportSummary(agent);
  const status = lastExitCode === 0 ? "SUCCESS" : "FAILED";

  return {
    name: agent.name,
    script: agent.script,
    required: agent.required,
    status,
    exitCode: lastExitCode,
    durationSeconds: Number(totalDuration.toFixed(2)),
    attempts: attempt,
    reason,
    error: lastError,
    reports
  };
}

function extractDecision(raw: string): PlannerDecision | null {
  try {
    const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const next = parsed.nextAgent;
    return {
      nextAgent: typeof next === "string" && next.trim() ? next.trim() : null,
      reason: safeText(parsed.reason) || "No reason supplied."
    };
  } catch {
    return null;
  }
}

async function askPlanner(
  config: AgenticConfig,
  context: {
    changedFiles: string[];
    changeSummary: string;
    completed: Array<{ name: string; status: string; reason: string; reportSummaries: string[] }>;
    candidates: string[];
  }
): Promise<PlannerDecision | null> {
  const planner = { ...DEFAULT_PLANNER, ...(config.planner ?? {}) };
  const prompt = [
    "You are a cautious Quality Engineering workflow planner.",
    "Choose at most ONE next agent from the supplied candidate list.",
    "Do not invent agents. Do not choose an agent outside the candidate list.",
    "Choose null when no further agent adds meaningful evidence.",
    "Use only evidence in the context. Do not claim tests passed unless a report says so.",
    "Return JSON only with exactly these keys: nextAgent (string or null), reason (string).",
    "",
    `Changed files: ${JSON.stringify(context.changedFiles)}`,
    `Change summary: ${context.changeSummary || "Not supplied"}`,
    `Completed agents and evidence: ${JSON.stringify(context.completed)}`,
    `Allowed next-agent candidates: ${JSON.stringify(context.candidates)}`,
    "",
    "Select the most relevant next agent, prioritizing risk reduction and avoiding redundant work."
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), planner.timeoutMs);

  try {
    const response = await fetch(`${planner.baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: planner.model,
        prompt,
        stream: false,
        format: "json",
        think: false,
        keep_alive: "10m",
        options: { temperature: 0.1, num_predict: 300, num_ctx: 4096 }
      })
    });

    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
    const payload = await response.json() as { response?: string };
    if (!payload.response) throw new Error("Ollama returned an empty planner response.");

    const decision = extractDecision(payload.response);
    if (!decision) throw new Error("Planner response was not valid JSON.");

    logEvent("planner_decision", {
      model: planner.model,
      nextAgent: decision.nextAgent,
      reason: decision.reason
    });
    return decision;
  } catch (error) {
    logEvent("planner_unavailable", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function compactCompleted() {
  return runs.map(run => ({
    name: run.name,
    status: run.status,
    reason: run.reason,
    reportSummaries: run.reports
      .filter(r => r.parsed && r.summary)
      .map(r => `${r.path}: ${r.summary}`.slice(0, 1800))
  }));
}

function writeReports(
  context: { files: string[]; summary: string; source: string },
  decision: { risk: string; gateDecision: string; approvalRequired: boolean },
  config: OrchestratorConfig
) {
  const output = {
    generatedAt: new Date().toISOString(),
    mode: "AGENTIC",
    changeContext: context,
    planner: {
      model: config.agentic?.planner?.model ?? DEFAULT_PLANNER.model,
      provider: "ollama"
    },
    executions: runs,
    releaseAssessment: decision,
    eventsFile: path.relative(ROOT, EVENTS_FILE)
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(output, null, 2));

  const lines = [
    "# Agentic QE Workflow Report",
    "",
    `- Generated: ${output.generatedAt}`,
    `- Mode: ${output.mode}`,
    `- Changed files: ${context.files.length ? context.files.join(", ") : "Not supplied"}`,
    `- Change context source: ${context.source}`,
    `- Planner: ${output.planner.provider}/${output.planner.model}`,
    `- Release gate decision: ${decision.gateDecision}`,
    `- Human approval required: ${decision.approvalRequired ? "YES" : "NO FLAG RAISED"}`,
    "",
    "## Execution Plan and Results",
    "",
    "| Agent | Status | Attempts | Duration | Why it ran |",
    "|---|---|---:|---:|---|",
    ...runs.map(r =>
      `| ${r.name.replace(/\|/g, "\\|")} | ${r.status} | ${r.attempts} | ${r.durationSeconds}s | ${r.reason.replace(/\|/g, "\\|")} |`
    ),
    "",
    "## Report Evidence",
    ""
  ];

  for (const run of runs) {
    lines.push(`### ${run.name}`);
    for (const report of run.reports) {
      lines.push(
        `- ${report.path}: ${report.parsed ? "parsed" : report.exists ? "invalid/unreadable" : "not found"}`
      );
      if (report.summary) lines.push(`  - Summary: ${report.summary.replace(/\r?\n/g, " ").slice(0, 1000)}`);
      if (report.error) lines.push(`  - Error: ${report.error}`);
    }
    if (run.error) lines.push(`- Execution error: ${run.error}`);
    lines.push("");
  }

  lines.push(
    "## Safety and Governance",
    "",
    "- The planner can select only agents already present in the orchestrator configuration.",
    "- Deterministic policy controls always-run agents, final agents, disabled-agent eligibility, retries, and maximum conditional runs.",
    "- The planner recommends workflow steps; it does not modify source code or deploy/release software.",
    "- Human approval is a recorded requirement, not an automated approval or deployment action.",
    "- Risk and release decisions must be based on the configured Release Readiness Quality Gate report.",
    "- If Ollama is unavailable or returns invalid output, the controller uses deterministic trigger-based fallback.",
    "- A skipped agent is not evidence that its quality dimension passed."
  );

  fs.writeFileSync(REPORT_MD, lines.join("\n"));
}

function readGateDecision(gateAgent?: AgentConfig) {
  if (!gateAgent) return { gateDecision: "UNKNOWN", risk: "UNKNOWN", approvalRequired: true };

  for (const reportPath of gateAgent.reports) {
    const absolute = validateRelativePath(reportPath);
    if (!fs.existsSync(absolute) || path.extname(absolute).toLowerCase() !== ".json") continue;

    try {
      const data = JSON.parse(fs.readFileSync(absolute, "utf8")) as Record<string, unknown>;
      const values = [
        data.decision, data.recommendation, data.gateStatus,
        data.gate, data.releaseDecision, data.status, data.risk
      ].map(v => safeText(v).toUpperCase()).filter(Boolean);
      const gateDecision = values[0] ?? "UNKNOWN";
      const risk = safeText(data.risk).toUpperCase() || gateDecision;
      const fail = values.some(v => ["FAIL", "FAILED", "BLOCK", "BLOCKED", "REJECTED", "CRITICAL", "HIGH"].includes(v));
      return { gateDecision, risk, approvalRequired: fail };
    } catch {
      // Continue to the next configured report.
    }
  }

  return { gateDecision: "UNKNOWN", risk: "UNKNOWN", approvalRequired: true };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(EVENTS_FILE, "");

  console.log("\n==========================================");
  console.log(" AGENTIC QE WORKFLOW CONTROLLER");
  console.log("==========================================\n");

  const config = readJson<OrchestratorConfig>(CONFIG_FILE);
  const packageJson = readJson<{ scripts?: Record<string, string> }>(
    path.join(ROOT, "package.json")
  );
  const agentic = config.agentic ?? {};
  const input = parseArgs();
  const changeContext = readChangeContext(input);

  if (!Array.isArray(config.agents) || config.agents.length === 0) {
    throw new Error("No agents found in orchestrator config.");
  }

  const alwaysNames = agentic.alwaysRun ?? ["Test Impact Analysis"];
  const finalNames = agentic.finalAgents ?? ["Release Readiness Quality Gate"];
  const noChangeFallback = agentic.noChangeFallback ?? [
    "API Contract Intelligence",
    "Test Data Intelligence"
  ];
  const maxConditionalRuns = agentic.maxConditionalRuns ?? 4;
  const maxRetries = agentic.maxRetries ?? 1;

  const byName = new Map(config.agents.map(agent => [agent.name, agent]));
  const alwaysAgents = alwaysNames.map(name => byName.get(name)).filter(Boolean) as AgentConfig[];
  const finalAgents = finalNames.map(name => byName.get(name)).filter(Boolean) as AgentConfig[];

  if (!alwaysAgents.length) throw new Error(`No configured always-run agent found: ${alwaysNames.join(", ")}`);
  if (!finalAgents.length) throw new Error(`No configured final agent found: ${finalNames.join(", ")}`);

  const conditionalAgents = config.agents.filter(agent =>
    !alwaysNames.includes(agent.name) && !finalNames.includes(agent.name)
  );

  const allowed = conditionalAgents.filter(agent => {
    const policy = policyFor(config, agent.name);
    return agent.enabled || policy.allowDisabled === true;
  });

  console.log(`Change files supplied: ${changeContext.files.length}`);
  console.log(`Always-run agents: ${alwaysAgents.map(a => a.name).join(", ")}`);
  console.log(`Conditional candidates: ${allowed.map(a => a.name).join(", ") || "none"}`);
  console.log(`Final agents: ${finalAgents.map(a => a.name).join(", ")}\n`);

  logEvent("workflow_started", {
    changedFiles: changeContext.files,
    changeSummary: changeContext.summary,
    changeSource: changeContext.source,
    model: agentic.planner?.model ?? DEFAULT_PLANNER.model
  });

  // Remove stale JSON outputs from all configured agents. Preserve JSONL history inputs.
  clearConfiguredJsonReports(config.agents);

  const alreadyRun = new Set<string>();
  let stopConditional = false;

  for (const agent of alwaysAgents) {
    if (!agent.enabled) throw new Error(`Always-run agent '${agent.name}' is disabled in config.`);
    if (input.dryRun) {
      runs.push({
        name: agent.name, script: agent.script, required: agent.required,
        status: "SKIPPED", exitCode: null, durationSeconds: 0, attempts: 0,
        reason: "Dry-run: would execute as an always-run agent.", reports: reportSummary(agent)
      });
    } else {
      const result = await executeAgent(
        agent, "Mandatory workflow entry point.", maxRetries,
        packageJson.scripts ?? {}
      );
      runs.push(result);
      if (result.status === "FAILED" && result.required && config.stopOnRequiredAgentFailure) {
        stopConditional = true;
      }
    }
    alreadyRun.add(agent.name);
  }

  let conditionalCount = 0;
  while (!stopConditional && conditionalCount < maxConditionalRuns) {
    const remaining = allowed.filter(agent => !alreadyRun.has(agent.name));
    if (!remaining.length) break;

    // With no change context, run the explicitly configured conservative
    // baseline agents before offering optional agents to the planner.
    const pendingNoChangeFallback = changeContext.files.length === 0
      ? remaining.filter(agent => noChangeFallback.includes(agent.name))
      : [];
    const plannerPool = pendingNoChangeFallback.length > 0
      ? pendingNoChangeFallback
      : remaining;

    const eligible = plannerPool.filter(agent => {
      const policy = policyFor(config, agent.name);
      const triggerMatch = matchesTrigger(agent, policy, changeContext.files, changeContext.summary);
      const fallback = changeContext.files.length === 0 && noChangeFallback.includes(agent.name);
      return triggerMatch || fallback || policy.allowAISelection === true;
    });

    if (!eligible.length) break;

    const decision = await askPlanner(agentic, {
      changedFiles: changeContext.files,
      changeSummary: changeContext.summary,
      completed: compactCompleted(),
      candidates: eligible.map(a => a.name)
    });

    let selected = decision?.nextAgent
      ? eligible.find(a => a.name === decision.nextAgent)
      : undefined;

    // A valid null means the planner sees no further value. In no-change mode,
    // still run the explicitly configured conservative fallback agents.
    if (!selected && (!decision || decision.nextAgent !== null)) {
      selected = eligible.find(agent =>
        matchesTrigger(agent, policyFor(config, agent.name), changeContext.files, changeContext.summary) ||
        (changeContext.files.length === 0 && noChangeFallback.includes(agent.name))
      );
    }
    if (!selected && decision?.nextAgent === null && changeContext.files.length === 0) {
      selected = eligible.find(agent => noChangeFallback.includes(agent.name));
    }
    if (!selected) break;

    const reason = decision?.nextAgent === selected.name
      ? `Planner selected: ${decision.reason}`
      : "Deterministic fallback: change-path trigger or conservative no-change policy.";

    if (input.dryRun) {
      runs.push({
        name: selected.name, script: selected.script, required: selected.required,
        status: "SKIPPED", exitCode: null, durationSeconds: 0, attempts: 0,
        reason: `Dry-run: ${reason}`, reports: reportSummary(selected)
      });
    } else {
      const result = await executeAgent(
        selected, reason, maxRetries,
        packageJson.scripts ?? {}
      );
      runs.push(result);
      if (result.status === "FAILED" && result.required && config.stopOnRequiredAgentFailure) {
        stopConditional = true;
      }
    }

    alreadyRun.add(selected.name);
    conditionalCount++;
  }

  // The release gate is always last, even when a preceding required agent fails.
  for (const agent of finalAgents) {
    if (!agent.enabled) throw new Error(`Final agent '${agent.name}' is disabled in config.`);
    if (input.dryRun) {
      runs.push({
        name: agent.name, script: agent.script, required: agent.required,
        status: "SKIPPED", exitCode: null, durationSeconds: 0, attempts: 0,
        reason: "Dry-run: final gate would execute after evidence collection.", reports: reportSummary(agent)
      });
    } else {
      const result = await executeAgent(
        agent, "Final assessment after selected evidence-gathering agents.", maxRetries,
        packageJson.scripts ?? {}
      );
      runs.push(result);
    }
  }

  const gate = input.dryRun
    ? { gateDecision: "DRY_RUN", risk: "UNKNOWN", approvalRequired: false }
    : readGateDecision(finalAgents[finalAgents.length - 1]);

  const configuredApprovalRisks = agentic.humanApproval?.requireForRisk ?? ["CRITICAL", "HIGH"];
  const approvalRequired =
    gate.approvalRequired ||
    configuredApprovalRisks.includes(gate.risk.toUpperCase()) ||
    runs.some(r => r.required && r.status === "FAILED");

  const assessment = {
    gateDecision: gate.gateDecision,
    risk: gate.risk,
    approvalRequired
  };

  writeReports(changeContext, assessment, config);

  if (approvalRequired) {
    const approvalFile = path.join(OUTPUT_DIR, "human-approval-required.json");
    fs.writeFileSync(approvalFile, JSON.stringify({
      status: "PENDING_HUMAN_REVIEW",
      generatedAt: new Date().toISOString(),
      reason: "Release gate risk/failure or required-agent failure requires human review.",
      gateDecision: gate.gateDecision,
      risk: gate.risk,
      note: "This controller does not approve or deploy releases."
    }, null, 2));
  }

  logEvent("workflow_completed", {
    gateDecision: gate.gateDecision,
    risk: gate.risk,
    approvalRequired,
    executedAgents: runs.map(r => ({ name: r.name, status: r.status }))
  });

  console.log("\n==========================================");
  console.log(" AGENTIC QE WORKFLOW SUMMARY");
  console.log("==========================================");
  for (const run of runs) {
    console.log(`- ${run.name}: ${run.status} (${run.reason})`);
  }
  console.log(`\nGate decision: ${gate.gateDecision}`);
  console.log(`Risk: ${gate.risk}`);
  console.log(`Human approval required: ${approvalRequired ? "YES" : "NO FLAG RAISED"}`);
  console.log(`\nMarkdown: ${REPORT_MD}`);
  console.log(`JSON: ${REPORT_JSON}`);
  console.log(`Events: ${EVENTS_FILE}\n`);
}

main().catch(error => {
  console.error("\nAgentic QE controller failed:");
  console.error(error);
  process.exitCode = 1;
});
