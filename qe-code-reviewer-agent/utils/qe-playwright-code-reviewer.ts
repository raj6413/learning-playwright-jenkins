
import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const MODEL = process.env.OLLAMA_MODEL || "qwen3:4b";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

const OUTPUT_DIR = path.join(ROOT, "qe-code-reviewer-agent", "test-results", "qe-code-review");

const SCAN_DIRS = [
    "code-review-test"
//   "tests",
//   "pages",
//   "page-objects",
//   "fixtures",
//   "utils",
//   "src"
];

const ROOT_FILES = [
  "playwright.config.ts",
  "playwright.config.js"
];

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  "test-results",
  "playwright-report",
  "allure-results",
  "RAG"
]);

const MAX_FILES = 60;
const MAX_FILE_SIZE = 35_000;
const MAX_TOTAL_CHARS = 20_000;

type Severity = "Critical" | "High" | "Medium" | "Low";

interface Finding {
  id: string;
  source: "STATIC" | "AI";
  severity: Severity;
  category: string;
  file: string;
  line: number;
  title: string;
  description: string;
  recommendation: string;
  evidence: string;
}

interface ReviewFile {
  absolutePath: string;
  relativePath: string;
  content: string;
  lines: string[];
}

interface ReviewResult {
  generatedAt: string;
  model: string;
  filesReviewed: number;
  totalFindings: number;
  score: number;
  summary: string;
  findings: Finding[];
}

function ensureOutputDirectory(): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function isIgnoredDirectory(name: string): boolean {
  return (
    IGNORE_DIRS.has(name) ||
    name.startsWith(".")
  );
}

function collectFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];

  const results: string[] = [];

  for (const entry of fs.readdirSync(directory, {
    withFileTypes: true
  })) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!isIgnoredDirectory(entry.name)) {
        results.push(...collectFiles(fullPath));
      }
      continue;
    }

    if (
      entry.isFile() &&
      EXTENSIONS.includes(path.extname(entry.name))
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

function getReviewFiles(): ReviewFile[] {
  const discovered = new Set<string>();

  for (const directory of SCAN_DIRS) {
    const fullDirectory = path.join(ROOT, directory);

    for (const file of collectFiles(fullDirectory)) {
      discovered.add(file);
    }
  }

  for (const file of ROOT_FILES) {
    const fullPath = path.join(ROOT, file);

    if (fs.existsSync(fullPath)) {
      discovered.add(fullPath);
    }
  }

  const files: ReviewFile[] = [];
  let totalChars = 0;

  for (const absolutePath of [...discovered].sort()) {
    if (files.length >= MAX_FILES) break;

    const stats = fs.statSync(absolutePath);

    if (stats.size > MAX_FILE_SIZE) {
      console.log(`[SKIPPED - TOO LARGE] ${path.relative(ROOT, absolutePath)}`);
      continue;
    }

    const content = fs.readFileSync(absolutePath, "utf8");

    if (totalChars + content.length > MAX_TOTAL_CHARS) {
      console.log(`[SKIPPED - REVIEW LIMIT] ${path.relative(ROOT, absolutePath)}`);
      continue;
    }

    totalChars += content.length;

    files.push({
      absolutePath,
      relativePath: path.relative(ROOT, absolutePath),
      content,
      lines: content.split(/\r?\n/)
    });
  }

  return files;
}

function createFinding(
  source: Finding["source"],
  severity: Severity,
  category: string,
  file: ReviewFile,
  line: number,
  title: string,
  description: string,
  recommendation: string,
  evidence: string
): Finding {
  return {
    id: "",
    source,
    severity,
    category,
    file: file.relativePath,
    line,
    title,
    description,
    recommendation,
    evidence
  };
}

/**
 * Deterministic checks.
 * These do not depend on the LLM.
 */
function runStaticChecks(files: ReviewFile[]): Finding[] {
  const findings: Finding[] = [];

  for (const file of files) {
    file.lines.forEach((rawLine, index) => {
      const line = rawLine.trim();

      if (!line || line.startsWith("//")) return;

      const lineNumber = index + 1;

      if (/waitForTimeout\s*\(/.test(line)) {
        findings.push(createFinding(
          "STATIC",
          "High",
          "Synchronization",
          file,
          lineNumber,
          "Hard wait detected",
          "waitForTimeout() introduces fixed delays and can make tests slow or flaky.",
          "Prefer auto-waiting locators, expect assertions, or a condition-based wait.",
          line
        ));
      }

      if (/test\.only\s*\(/.test(line)) {
        findings.push(createFinding(
          "STATIC",
          "Critical",
          "Test Isolation",
          file,
          lineNumber,
          "Focused test detected",
          "test.only() can cause other tests to be excluded from execution.",
          "Remove test.only() before committing the test suite.",
          line
        ));
      }

      if (/\.toBeTruthy\s*\(\)/.test(line)) {
        findings.push(createFinding(
          "STATIC",
          "Low",
          "Assertions",
          file,
          lineNumber,
          "Generic truthiness assertion",
          "A generic truthiness assertion may not clearly express the expected business result.",
          "Use a more specific assertion where possible, such as toBe(), toHaveText(), or toBeVisible().",
          line
        ));
      }

      if (/page\.\$\s*\(/.test(line) || /page\.\$\$\s*\(/.test(line)) {
        findings.push(createFinding(
          "STATIC",
          "Medium",
          "Locator Strategy",
          file,
          lineNumber,
          "Low-level selector API detected",
          "page.$() or page.$$() bypasses the recommended Locator API and its auto-waiting behaviour.",
          "Prefer page.locator(), getByRole(), getByLabel(), or another user-facing locator.",
          line
        ));
      }

      if (/xpath\s*=|\/\/[a-zA-Z]+\[/.test(line)) {
        findings.push(createFinding(
          "STATIC",
          "Medium",
          "Locator Strategy",
          file,
          lineNumber,
          "Potential XPath usage",
          "XPath selectors can be tightly coupled to DOM structure.",
          "Prefer role, label, placeholder, test ID, or stable CSS locators.",
          line
        ));
      }

      if (/force\s*:\s*true/.test(line)) {
        findings.push(createFinding(
          "STATIC",
          "Medium",
          "Interaction Reliability",
          file,
          lineNumber,
          "Forced interaction detected",
          "Force actions bypass normal actionability checks and may hide genuine UI problems.",
          "Investigate why the element is not actionable before using force.",
          line
        ));
      }

      if (/test\.skip\s*\(/.test(line)) {
        findings.push(createFinding(
          "STATIC",
          "Medium",
          "Test Governance",
          file,
          lineNumber,
          "Skipped test detected",
          "Skipped tests can hide coverage gaps if they remain unexplained.",
          "Document the reason and link the relevant defect or tracking item.",
          line
        ));
      }

      if (/console\.log\s*\(/.test(line)) {
        findings.push(createFinding(
          "STATIC",
          "Low",
          "Logging",
          file,
          lineNumber,
          "Console logging in test code",
          "Unstructured console output can make CI logs noisy.",
          "Use structured reporting or remove temporary debugging logs.",
          line
        ));
      }

      if (/\.toBe\s*\(\s*true\s*\)/.test(line)) {
        findings.push(createFinding(
          "STATIC",
          "Low",
          "Assertions",
          file,
          lineNumber,
          "Boolean assertion could be clearer",
          "Boolean assertions sometimes hide the actual behaviour being verified.",
          "Consider using a more expressive assertion such as toBeVisible() or toBeEnabled().",
          line
        ));
      }
    });
  }

  return findings;
}

function buildReviewPrompt(files: ReviewFile[]): string {
  const source = files.map(file => {
    return `
FILE: ${file.relativePath}
${file.lines.map((line, index) =>
  `${index + 1}: ${line}`
).join("\n")}
`;
  }).join("\n");

  return `
You are a senior Playwright TypeScript automation architect.

Review the supplied source code for engineering quality.

Review only real issues supported by the supplied code.

Look for:
1. Fragile locator strategies.
2. Missing meaningful assertions.
3. Poor test isolation.
4. Shared mutable state.
5. Weak Page Object Model design.
6. Duplicate code and unnecessary complexity.
7. Missing API response validation.
8. Hardcoded environment or test data.
9. Poor async/await usage.
10. Maintainability and readability problems.
11. Accessibility-related testing gaps where relevant.
12. Inappropriate retry or timeout usage.

Rules:
- Do not invent files, line numbers, methods or code.
- Do not report a concern merely because a preferred pattern is absent.
- Do not report an issue already obvious from the same code unless it adds a different insight.
- Do not assume that every test needs a Page Object Model.
- Do not recommend arbitrary waits.
- Do not claim that code was executed.
- Only report findings with concrete evidence.
- Keep recommendations practical.
- Use the exact relative file path.
- Line numbers must refer to the supplied numbered source.
- Evidence must be an exact, short snippet from that line.
- Return no more than 5 important findings per file.
- If there are no valid issues, return an empty findings array.

Severity:
Critical = likely to compromise execution or test suite integrity.
High = substantial reliability or correctness risk.
Medium = maintainability or test design concern.
Low = minor improvement.

Return ONLY valid JSON in this structure:

{
  "summary": "Short overall review summary",
  "findings": [
    {
      "severity": "High",
      "category": "Test Reliability",
      "file": "tests/example.spec.ts",
      "line": 10,
      "title": "Short issue title",
      "description": "What is wrong and why it matters",
      "recommendation": "Specific practical improvement",
      "evidence": "Exact source snippet"
    }
  ]
}

SOURCE CODE:

${source}
`;
}

function parseJsonResponse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .trim();

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start < 0 || end <= start) {
      throw new Error("Ollama did not return valid JSON.");
    }

    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

async function callOllama(prompt: string): Promise<any> {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      format: "json",
      think: false,
      keep_alive: "10m",
      options: {
        temperature: 0.1,
        num_predict: 2500,
        num_ctx: 8192
      }
    })
  });

  if (!response.ok) {
    throw new Error(
      `Ollama request failed: ${response.status} ${response.statusText}`
    );
  }

  const result = await response.json() as {
    response?: string;
  };

  if (!result.response) {
    throw new Error("Ollama returned an empty response.");
  }

  return parseJsonResponse(result.response);
}

function validateAiFindings(
  rawFindings: any[],
  files: ReviewFile[]
): Finding[] {
  const fileMap = new Map(
    files.map(file => [file.relativePath, file])
  );

  const validSeverities: Severity[] = [
    "Critical",
    "High",
    "Medium",
    "Low"
  ];

  const findings: Finding[] = [];

  for (const item of rawFindings || []) {
    if (!item || typeof item !== "object") continue;

    const file = fileMap.get(item.file);
    const lineNumber = Number(item.line);

    if (!file || !Number.isInteger(lineNumber)) continue;
    if (lineNumber < 1 || lineNumber > file.lines.length) continue;

    const actualLine = file.lines[lineNumber - 1].trim();
    const evidence = String(item.evidence || "").trim();

    // Reject invented or mismatched evidence.
    if (!evidence || !actualLine.includes(evidence)) continue;

    const severity = validSeverities.includes(item.severity)
      ? item.severity
      : "Low";

    findings.push({
      id: "",
      source: "AI",
      severity,
      category: String(item.category || "General").slice(0, 80),
      file: file.relativePath,
      line: lineNumber,
      title: String(item.title || "Code quality concern").slice(0, 160),
      description: String(item.description || "").slice(0, 600),
      recommendation: String(item.recommendation || "").slice(0, 600),
      evidence
    });
  }

  return findings;
}

function calculateScore(findings: Finding[]): number {
  const weights: Record<Severity, number> = {
    Critical: 20,
    High: 10,
    Medium: 4,
    Low: 1
  };

  const deductions = findings.reduce(
    (total, finding) => total + weights[finding.severity],
    0
  );

  return Math.max(0, 100 - deductions);
}

function assignFindingIds(findings: Finding[]): Finding[] {
  return findings.map((finding, index) => ({
    ...finding,
    id: `PW-REV-${String(index + 1).padStart(3, "0")}`
  }));
}

function createMarkdownReport(result: ReviewResult): string {
  const counts = {
    Critical: result.findings.filter(f => f.severity === "Critical").length,
    High: result.findings.filter(f => f.severity === "High").length,
    Medium: result.findings.filter(f => f.severity === "Medium").length,
    Low: result.findings.filter(f => f.severity === "Low").length
  };

  const findingSections = result.findings.map(finding => `
### ${finding.id} — ${finding.title}

- **Severity:** ${finding.severity}
- **Source:** ${finding.source}
- **Category:** ${finding.category}
- **File:** \`${finding.file}\`
- **Line:** ${finding.line}
- **Evidence:** \`${finding.evidence.replace(/`/g, "'")}\`

**Issue:** ${finding.description}

**Recommendation:** ${finding.recommendation}
`).join("\n");

  return `# Playwright Code Review Report

## Review Summary

- **Generated:** ${result.generatedAt}
- **Model:** ${result.model}
- **Files reviewed:** ${result.filesReviewed}
- **Total findings:** ${result.totalFindings}
- **Code quality score:** ${result.score}/100

## Severity Summary

| Severity | Findings |
|---|---:|
| Critical | ${counts.Critical} |
| High | ${counts.High} |
| Medium | ${counts.Medium} |
| Low | ${counts.Low} |

## AI Review Summary

${result.summary}

## Findings

${findingSections || "No findings detected."}

## Review Notes

- This report is based on static source inspection.
- Findings are recommendations, not proof of runtime defects.
- Review AI-generated findings before changing production test code.
- The quality score is a simple heuristic, not a calibrated engineering metric.
`;
}

async function main(): Promise<void> {
  const start = Date.now();

  console.log("\n======================================");
  console.log("   PLAYWRIGHT AI CODE REVIEWER");
  console.log("======================================\n");

  console.log(`Project: ${ROOT}`);
  console.log(`Model: ${MODEL}`);

  ensureOutputDirectory();

  const files = getReviewFiles();

  if (files.length === 0) {
    throw new Error(
      "No source files found. Check SCAN_DIRS in qe-playwright-code-reviewer.ts."
    );
  }

  console.log(`\nFiles discovered: ${files.length}`);

  files.forEach(file => {
    console.log(`[REVIEW] ${file.relativePath}`);
  });

  console.log("\nRunning deterministic code checks...");

  const staticFindings = runStaticChecks(files);

  console.log(`Static findings: ${staticFindings.length}`);

  console.log("\nCalling Ollama for AI code review...");

  const aiResponse = await callOllama(buildReviewPrompt(files));

  const aiFindings = validateAiFindings(
    aiResponse.findings || [],
    files
  );

  console.log(`Validated AI findings: ${aiFindings.length}`);

  const findings = assignFindingIds([
    ...staticFindings,
    ...aiFindings
  ]);

  const result: ReviewResult = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    filesReviewed: files.length,
    totalFindings: findings.length,
    score: calculateScore(findings),
    summary: String(
      aiResponse.summary || "Code review completed."
    ),
    findings
  };

  const jsonPath = path.join(
    OUTPUT_DIR,
    "qe-playwright-code-review.json"
  );

  const markdownPath = path.join(
    OUTPUT_DIR,
    "qe-playwright-code-review.md"
  );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(result, null, 2),
    "utf8"
  );

  fs.writeFileSync(
    markdownPath,
    createMarkdownReport(result),
    "utf8"
  );

  const duration = ((Date.now() - start) / 1000).toFixed(1);

  console.log("\n======================================");
  console.log("       CODE REVIEW COMPLETED");
  console.log("======================================");

  console.log(`Files reviewed : ${result.filesReviewed}`);
  console.log(`Total findings : ${result.totalFindings}`);
  console.log(`Quality score  : ${result.score}/100`);
  console.log(`Time taken     : ${duration}s`);

  console.log("\nReports generated:");

  console.log(markdownPath);
  console.log(jsonPath);

  console.log("\n======================================\n");
}

main().catch(error => {
  console.error("\nCODE REVIEW FAILED:");
  console.error(error);
  process.exitCode = 1;
});