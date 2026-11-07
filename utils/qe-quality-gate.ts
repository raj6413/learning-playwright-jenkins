// It checks Playwright results, test designs, requirements, risk levels, and failure-intelligence findings.
// It maps tests and designed scenarios to requirements such as REQ-001.
// It identifies missing coverage, failed/flaky tests, and unpassed high-risk requirements.
// It decides whether the result is PASS, REVIEW, or BLOCK, based on configured rules.
// It writes release-readiness reports in JSON and Markdown.

import fs from "node:fs";
import path from "node:path";

type PriorityFinding = {
  title?: string;
  priority?: string;
  score?: number;
};

type Scenario = {
  scenarioId?: string;
  requirementId?: string;
  scenario?: string;
  risk?: string;
  automationCandidate?: boolean | string;
};

type TestDesign = {
  scenarios: Scenario[];
  coverageGaps?: string[];
  clarificationQuestions?: string[];
};

type ExecutionRecord = {
  title: string;
  file: string;
  project: string;
  requirementIds: string[];
  status: string;
  outcome: string;
  retries: number;
};

type RiskLevel = "Critical" | "High" | "Medium" | "Low" | "Unknown";

type CoverageState =
  | "NO_SCENARIO_DESIGNED"
  | "SCENARIO_DESIGNED_NOT_EXECUTED"
  | "EXECUTED_PASS"
  | "EXECUTED_FAIL"
  | "EXECUTED_UNKNOWN";

type RequirementResult = {
  id: string;
  description: string;
  risk: RiskLevel;
  scenarioIds: string[];
  tests: ExecutionRecord[];
  status: "PASS" | "FAIL" | "NOT_EXECUTED";
  coverageState: CoverageState;
};

const root = process.cwd();

const intelligencePath =
  process.argv[2] ??
  "ai-utils/qe-failure-intelligence.md";

const designPath =
  process.env.QE_GATE_DESIGN ??
  "ai-utils/qe-test-design.json";

const resultsPath =
  process.env.QE_GATE_RESULTS ??
  "ai-utils/agent-results.json";

const requirementsPath =
  process.env.QE_GATE_REQUIREMENTS ??
  "ai-utils/checkout-requirements.md";

const riskConfigPath =
  process.env.QE_GATE_RISK_CONFIG ??
  "ai-utils/requirement-risks.json";

const outputJsonPath = "ai-utils/qe-release-readiness.json";
const outputMarkdownPath = "ai-utils/qe-release-readiness.md";

const mode = (process.env.QE_GATE_MODE ?? "warn").toLowerCase();
const minimumPriority = process.env.QE_GATE_MIN_PRIORITY ?? "High";

const priorityRank: Record<string, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
};

const requirementPattern = /\bREQ-\d{3,}\b/gi;

function readText(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;

  const content = fs.readFileSync(filePath, "utf8").trim();
  return content || undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeRequirementId(value: string): string {
  return value.trim().toUpperCase();
}

function extractRequirementIds(value: unknown): string[] {
  if (typeof value !== "string") return [];

  return unique(
    (value.match(requirementPattern) ?? []).map(normalizeRequirementId)
  );
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function normalizeRisk(value: unknown): RiskLevel {
  if (typeof value !== "string") return "Unknown";

  const normalized = value.trim().toLowerCase();

  if (normalized === "critical") return "Critical";
  if (normalized === "high") return "High";
  if (normalized === "medium") return "Medium";
  if (normalized === "low") return "Low";

  return "Unknown";
}

/**
 * HTML-commented requirements are intentionally out of scope.
 * Remove comments before extracting active requirement IDs.
 */
function stripHtmlComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "");
}

function parseActiveRequirements(
  markdown: string
): Map<string, string> {
  const activeMarkdown = stripHtmlComments(markdown);
  const requirements = new Map<string, string>();

  for (const line of activeMarkdown.split(/\r?\n/)) {
    const ids = extractRequirementIds(line);

    for (const id of ids) {
      const description = line
        .replace(requirementPattern, "")
        .replace(/^[-*#\s]+/, "")
        .replace(/[*`]/g, "")
        .trim()
        .replace(/^:\s*/, "");

      if (!requirements.has(id)) {
        requirements.set(
          id,
          description || "Description not provided"
        );
      }
    }
  }

  return requirements;
}

function getRequirementsFromTestDesign(
  testDesign: TestDesign
): Map<string, string> {
  const requirements = new Map<string, string>();

  for (const scenario of testDesign.scenarios) {
    const id = normalizeRequirementId(
      safeString(scenario.requirementId)
    );

    if (/^REQ-\d{3,}$/.test(id) && !requirements.has(id)) {
      requirements.set(
        id,
        safeString(scenario.scenario) || "Description not provided"
      );
    }
  }

  return requirements;
}

function parsePriorityFindings(report: string): PriorityFinding[] {
  const findings: PriorityFinding[] = [];
  const sections = report.split(/^## /m).slice(1);

  for (const section of sections) {
    const title = section.split("\n")[0]?.trim() ?? "Unknown test";

    const match = section.match(
      /^\s*-\s*\*\*Investigation priority:\*\*\s*(Critical|High|Medium|Low)\s*$/im
    );

    if (!match) continue;

    const scoreMatch = section.match(
      /^\s*-\s*\*\*Priority score:\*\*\s*(\d+)\s*$/im
    );

    findings.push({
      title,
      priority: match[1],
      score: scoreMatch ? Number(scoreMatch[1]) : undefined,
    });
  }

  return findings;
}

function annotationText(value: unknown): string {
  if (!Array.isArray(value)) return "";

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return "";

      const annotation = item as Record<string, unknown>;

      return [
        safeString(annotation.type),
        safeString(annotation.description),
      ].join(" ");
    })
    .join(" ");
}

function classifyExecution(
  results: Record<string, unknown>[],
  outcome: string
): { status: string; retries: number } {
  const lastResult = results[results.length - 1];
  const finalStatus = safeString(lastResult?.status).toLowerCase();

  const retries = results.reduce((count, result) => {
    const retry = Number(result.retry);

    return Number.isFinite(retry)
      ? Math.max(count, retry)
      : count;
  }, 0);

  if (outcome.toLowerCase() === "flaky") {
    return { status: "flaky", retries };
  }

  if (finalStatus === "passed" && retries > 0) {
    return { status: "flaky", retries };
  }

  if (
    ["failed", "timedout", "interrupted"].includes(finalStatus) ||
    outcome.toLowerCase() === "unexpected"
  ) {
    return { status: "failed", retries };
  }

  if (
    finalStatus === "passed" ||
    outcome.toLowerCase() === "expected"
  ) {
    return { status: "passed", retries };
  }

  if (finalStatus === "skipped") {
    return { status: "skipped", retries };
  }

  return { status: finalStatus || "unknown", retries };
}

/**
 * Reads Playwright JSON reporter output:
 * suites -> specs -> tests -> results.
 */
function parseExecutionRecords(json: unknown): ExecutionRecord[] {
  const records: ExecutionRecord[] = [];

  function visitSuite(
    suite: unknown,
    inheritedFile = "",
    inheritedProject = ""
  ): void {
    if (!suite || typeof suite !== "object") return;

    const current = suite as Record<string, unknown>;
    const file = safeString(current.file) || inheritedFile;
    const project =
      safeString(current.projectName) || inheritedProject;

    if (Array.isArray(current.specs)) {
      for (const rawSpec of current.specs) {
        if (!rawSpec || typeof rawSpec !== "object") continue;

        const spec = rawSpec as Record<string, unknown>;
        const specTitle = safeString(spec.title);
        const specFile = safeString(spec.file) || file;
        const tests = Array.isArray(spec.tests) ? spec.tests : [];

        for (const rawTest of tests) {
          if (!rawTest || typeof rawTest !== "object") continue;

          const test = rawTest as Record<string, unknown>;
          const testTitle = safeString(test.title);
          const results = Array.isArray(test.results)
            ? (test.results as Record<string, unknown>[])
            : [];

          const outcome = safeString(test.outcome);
          const classified = classifyExecution(results, outcome);

          // IDs are extracted from titles and annotations, then normalized
          // to uppercase before deduplication.
          const sourceText = [
            specTitle,
            testTitle,
            annotationText(test.annotations),
          ].join(" ");

          records.push({
            title: [specTitle, testTitle].filter(Boolean).join(" > "),
            file: specFile,
            project:
              safeString(test.projectName) || project,
            requirementIds: extractRequirementIds(sourceText),
            status: classified.status,
            outcome: outcome || classified.status,
            retries: classified.retries,
          });
        }
      }
    }

    if (Array.isArray(current.suites)) {
      for (const child of current.suites) {
        visitSuite(child, file, project);
      }
    }
  }

  if (!json || typeof json !== "object") {
    throw new Error("Playwright report is not a JSON object.");
  }

  const report = json as Record<string, unknown>;

  if (!Array.isArray(report.suites)) {
    throw new Error(
      "Unrecognized Playwright JSON report: expected a top-level suites array."
    );
  }

  for (const suite of report.suites) {
    visitSuite(suite);
  }

  return records;
}

function determineStatus(
  tests: ExecutionRecord[]
): RequirementResult["status"] {
  if (tests.length === 0) return "NOT_EXECUTED";

  if (
    tests.some((test) =>
      ["failed", "flaky", "timedout", "interrupted"].includes(
        test.status
      )
    )
  ) {
    return "FAIL";
  }

  if (tests.some((test) => test.status === "passed")) {
    return "PASS";
  }

  return "NOT_EXECUTED";
}

function determineCoverageState(
  scenarioCount: number,
  tests: ExecutionRecord[],
  status: RequirementResult["status"]
): CoverageState {
  if (scenarioCount === 0) {
    return "NO_SCENARIO_DESIGNED";
  }

  if (tests.length === 0) {
    return "SCENARIO_DESIGNED_NOT_EXECUTED";
  }

  if (status === "PASS") return "EXECUTED_PASS";
  if (status === "FAIL") return "EXECUTED_FAIL";

  return "EXECUTED_UNKNOWN";
}

function loadRiskConfig(): Map<string, RiskLevel> {
  const risks = new Map<string, RiskLevel>();
  const content = readText(riskConfigPath);

  if (!content) return risks;

  const parsed = JSON.parse(content) as Record<string, unknown>;

  for (const [id, risk] of Object.entries(parsed)) {
    if (/^REQ-\d{3,}$/i.test(id)) {
      risks.set(normalizeRequirementId(id), normalizeRisk(risk));
    }
  }

  return risks;
}

function main(): void {
  if (!["warn", "fail"].includes(mode)) {
    throw new Error(`Invalid QE_GATE_MODE: ${mode}. Use "warn" or "fail".`);
  }

  const threshold = priorityRank[minimumPriority];

  if (threshold === undefined) {
    throw new Error(
      `Invalid QE_GATE_MIN_PRIORITY: ${minimumPriority}`
    );
  }

  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  const intelligenceText = readText(intelligencePath);
  const designText = readText(designPath);
  const resultsText = readText(resultsPath);
  const requirementsFileExists = fs.existsSync(requirementsPath);

  let priorityFindings: PriorityFinding[] = [];

  if (!intelligenceText) {
    warnings.push(
      `Failure-intelligence report missing or empty: ${intelligencePath}`
    );
  } else {
    priorityFindings = parsePriorityFindings(intelligenceText);
  }

  const blockingPriorityFindings = priorityFindings.filter(
    (finding) =>
      priorityRank[finding.priority ?? "Low"] >= threshold
  );

  let design: TestDesign = { scenarios: [] };

  if (!designText) {
    blockingReasons.push(
      `Test-design JSON missing or empty: ${designPath}`
    );
  } else {
    try {
      const parsed = JSON.parse(designText) as TestDesign;

      if (!Array.isArray(parsed.scenarios)) {
        throw new Error("Missing scenarios array.");
      }

      design = parsed;
    } catch (error) {
      blockingReasons.push(
        `Invalid test-design JSON: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  let requirements = requirementsFileExists
    ? parseActiveRequirements(
        fs.readFileSync(requirementsPath, "utf8")
      )
    : new Map<string, string>();

  // Only use test-design IDs when the requirements file is absent.
  if (!requirementsFileExists) {
    blockingReasons.push(
      `Requirements file missing: ${requirementsPath}`
    );
    requirements = getRequirementsFromTestDesign(design);
  }

  if (requirements.size === 0) {
    blockingReasons.push(
      "No active requirement IDs found. Ensure active requirements use IDs such as REQ-001 outside HTML comments."
    );
  }

  let riskConfig = new Map<string, RiskLevel>();

  try {
    riskConfig = loadRiskConfig();
  } catch (error) {
    blockingReasons.push(
      `Invalid risk configuration JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  let executionRecords: ExecutionRecord[] = [];

  if (!resultsText) {
    blockingReasons.push(
      `Playwright JSON report missing or empty: ${resultsPath}`
    );
  } else {
    try {
      executionRecords = parseExecutionRecords(
        JSON.parse(resultsText)
      );

      if (executionRecords.length === 0) {
        blockingReasons.push(
          "No test execution records found in the Playwright JSON report."
        );
      }
    } catch (error) {
      blockingReasons.push(
        `Unable to parse Playwright JSON report: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const requirementResults: RequirementResult[] = [];

  for (const [id, description] of requirements) {
    const scenarios = design.scenarios.filter(
      (scenario) =>
        normalizeRequirementId(
          safeString(scenario.requirementId)
        ) === id
    );

    const tests = executionRecords.filter((test) =>
      test.requirementIds.includes(id)
    );

    // Explicit configuration wins. If not configured, use risk from
    // available scenarios. Missing scenarios never imply Low risk.
    const configuredRisk = riskConfig.get(id);

    const scenarioRisks = scenarios
      .map((scenario) => normalizeRisk(scenario.risk))
      .filter((risk) => risk !== "Unknown");

    const risk: RiskLevel =
      configuredRisk && configuredRisk !== "Unknown"
        ? configuredRisk
        : scenarioRisks.includes("Critical")
          ? "Critical"
          : scenarioRisks.includes("High")
            ? "High"
            : scenarioRisks.includes("Medium")
              ? "Medium"
              : scenarioRisks.includes("Low")
                ? "Low"
                : "Unknown";

    const status = determineStatus(tests);

    const coverageState = determineCoverageState(
      scenarios.length,
      tests,
      status
    );

    if (coverageState === "NO_SCENARIO_DESIGNED") {
      warnings.push(
        `${id} has no scenario in the test-design JSON. Risk: ${risk}.`
      );
    } else if (coverageState === "SCENARIO_DESIGNED_NOT_EXECUTED") {
      warnings.push(
        `${id} has designed scenario(s) but no mapped Playwright execution result.`
      );
    }

    if (risk === "Unknown") {
      warnings.push(
        `${id} has no configured requirement risk and no usable scenario risk. Set it in ${riskConfigPath}.`
      );
    }

    if (
      ["Critical", "High"].includes(risk) &&
      status !== "PASS"
    ) {
      blockingReasons.push(
        `${risk}-risk requirement ${id} does not have passing execution evidence (status: ${status}, coverage: ${coverageState}).`
      );
    } else if (status === "FAIL") {
      warnings.push(
        `${id} has a failed or flaky test and requires investigation.`
      );
    }

    requirementResults.push({
      id,
      description,
      risk,
      scenarioIds: scenarios.map(
        (scenario) => scenario.scenarioId || "ID unavailable"
      ),
      tests,
      status,
      coverageState,
    });
  }

  const unmappedTests = executionRecords.filter(
    (test) => test.requirementIds.length === 0
  );

  if (unmappedTests.length > 0) {
    warnings.push(
      `${unmappedTests.length} executed test(s) have no REQ-xxx ID in their title or annotations.`
    );
  }

  if (blockingPriorityFindings.length > 0) {
    const message =
      `${blockingPriorityFindings.length} failure-intelligence finding(s) ` +
      `meet or exceed the ${minimumPriority} priority threshold.`;

    if (mode === "fail") {
      blockingReasons.push(message);
    } else {
      warnings.push(message);
    }
  }

  const passingRequirements = requirementResults.filter(
    (requirement) => requirement.status === "PASS"
  ).length;

  const failedRequirements = requirementResults.filter(
    (requirement) => requirement.status === "FAIL"
  ).length;

  const notExecutedRequirements = requirementResults.filter(
    (requirement) => requirement.status === "NOT_EXECUTED"
  ).length;

  const requirementPassCoveragePercent =
    requirementResults.length === 0
      ? 0
      : Math.round(
          (passingRequirements / requirementResults.length) * 100
        );

  const decision: "PASS" | "BLOCK" | "REVIEW" =
    blockingReasons.length > 0
      ? "BLOCK"
      : failedRequirements > 0 ||
          notExecutedRequirements > 0 ||
          warnings.length > 0
        ? "REVIEW"
        : "PASS";

  const summary = {
    generatedAt: new Date().toISOString(),
    mode,
    minimumPriority,
    decision,
    requirementsTotal: requirementResults.length,
    requirementsPassing: passingRequirements,
    requirementsFailed: failedRequirements,
    requirementsNotExecuted: notExecutedRequirements,
    requirementPassCoveragePercent,
    executionRecordsTotal: executionRecords.length,
    executionRecordsUnmapped: unmappedTests.length,
    priorityFindingsTotal: priorityFindings.length,
    priorityFindingsAtThreshold: blockingPriorityFindings.length,
    blockingReasons,
    warnings,
    requirements: requirementResults.map((requirement) => ({
      id: requirement.id,
      description: requirement.description,
      risk: requirement.risk,
      scenarioIds: requirement.scenarioIds,
      status: requirement.status,
      coverageState: requirement.coverageState,
      tests: requirement.tests.map((test) => ({
        title: test.title,
        file: test.file,
        project: test.project,
        requirementIds: test.requirementIds,
        status: test.status,
        outcome: test.outcome,
        retries: test.retries,
      })),
    })),
  };

  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });

  fs.writeFileSync(
    outputJsonPath,
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  const markdown: string[] = [
    "# QE Release Readiness Report",
    "",
    `- Generated: ${summary.generatedAt}`,
    `- Gate mode: **${mode.toUpperCase()}**`,
    `- Minimum failure priority: **${minimumPriority}**`,
    `- Release recommendation: **${decision}**`,
    "",
    "## Summary",
    "",
    `- Active requirements: ${summary.requirementsTotal}`,
    `- Requirements with passing evidence: ${passingRequirements}`,
    `- Requirements with failed/flaky tests: ${failedRequirements}`,
    `- Requirements without passing execution evidence: ${notExecutedRequirements}`,
    `- Requirement pass coverage: ${requirementPassCoveragePercent}%`,
    `- Executed tests without requirement mapping: ${unmappedTests.length}`,
    `- Failure-intelligence findings at threshold: ${blockingPriorityFindings.length}`,
    "",
    "> HTML-commented requirements are excluded from active scope. Requirement pass coverage means a requirement has mapped passing execution evidence; it does not prove complete functional coverage.",
    "",
    "## Requirement Traceability Matrix",
    "",
    "| Requirement | Risk | Scenario IDs | Executed tests | Result | Coverage state |",
    "|---|---|---|---|---|---|",
  ];

  for (const requirement of requirementResults) {
    markdown.push(
      `| ${requirement.id} — ${markdownCell(requirement.description)} | ${requirement.risk} | ${requirement.scenarioIds.join(", ") || "None"} | ${requirement.tests.length} | ${requirement.status} | ${requirement.coverageState} |`
    );
  }

  markdown.push("", "## Blocking Reasons", "");

  if (blockingReasons.length === 0) {
    markdown.push("- None");
  } else {
    blockingReasons.forEach((reason) => markdown.push(`- ${reason}`));
  }

  markdown.push("", "## Warnings", "");

  if (warnings.length === 0) {
    markdown.push("- None");
  } else {
    warnings.forEach((warning) => markdown.push(`- ${warning}`));
  }

  markdown.push(
    "",
    "## Failure-Intelligence Priority Findings",
    "",
    "| Priority | Test / Finding | Score |",
    "|---|---|---|"
  );

  for (const finding of priorityFindings) {
    markdown.push(
      `| ${finding.priority ?? "Unknown"} | ${markdownCell(finding.title ?? "Unknown test")} | ${finding.score ?? "N/A"} |`
    );
  }

  markdown.push(
    "",
    "## Execution Evidence",
    "",
    "| Test | Requirement IDs | Status | Outcome | Project | Retries |",
    "|---|---|---|---|---|---|"
  );

  for (const test of executionRecords) {
    markdown.push(
      `| ${markdownCell(test.title)} | ${test.requirementIds.join(", ") || "UNMAPPED"} | ${test.status} | ${test.outcome} | ${markdownCell(test.project)} | ${test.retries} |`
    );
  }

  markdown.push(
    "",
    "## Coverage State Definitions",
    "",
    "- `NO_SCENARIO_DESIGNED`: active requirement exists, but the test-design JSON has no linked scenario.",
    "- `SCENARIO_DESIGNED_NOT_EXECUTED`: linked scenarios exist, but no execution result is mapped to the requirement.",
    "- `EXECUTED_PASS`: mapped execution evidence passed.",
    "- `EXECUTED_FAIL`: mapped execution evidence failed or was flaky.",
    "- `EXECUTED_UNKNOWN`: execution results exist, but no passing or failing status could be established.",
    "",
    "## Decision Rules",
    "",
    "- PASS: all active requirements have mapped passing evidence and there are no warnings or blocking reasons.",
    "- REVIEW: failed or unexecuted requirements, unmapped tests, unknown risk, or other warnings need investigation.",
    "- BLOCK: required inputs are missing/invalid, a Critical/High-risk requirement lacks passing evidence, or (in fail mode) failure-intelligence findings meet the configured priority threshold.",
    "- This gate is deterministic; the AI failure report cannot override these rules.",
    ""
  );

  fs.writeFileSync(
    outputMarkdownPath,
    markdown.join("\n"),
    "utf8"
  );

  console.log("\n=== QE Quality Gate ===");
  console.log(`Mode: ${mode}`);
  console.log(`Minimum priority: ${minimumPriority}`);
  console.log(`Release recommendation: ${decision}`);
  console.log(`Active requirements: ${requirementResults.length}`);
  console.log(`Passing requirements: ${passingRequirements}`);
  console.log(`Failed requirements: ${failedRequirements}`);
  console.log(`Not executed: ${notExecutedRequirements}`);
  console.log(`Requirement pass coverage: ${requirementPassCoveragePercent}%`);
  console.log(`Priority findings at threshold: ${blockingPriorityFindings.length}`);
  console.log(`Blocking reasons: ${blockingReasons.length}`);
  console.log(`Warnings: ${warnings.length}`);
  console.log(`JSON report: ${outputJsonPath}`);
  console.log(`Markdown report: ${outputMarkdownPath}`);

  for (const reason of blockingReasons) {
    console.error(`BLOCK: ${reason}`);
  }

  for (const warning of warnings) {
    console.warn(`WARN: ${warning}`);
  }

  if (mode === "fail" && decision !== "PASS") {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(
    "QE Quality Gate failed to execute:",
    error instanceof Error ? error.message : String(error)
  );
  process.exitCode = 1;
}
