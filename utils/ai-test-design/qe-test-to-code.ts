
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

type TestScenario = {
  scenarioId: string;
  requirementId: string;
  scenario: string;
  testType: string;
  risk: "High" | "Medium" | "Low";
  preconditions: string[];
  steps: string[];
  expectedResult: string;
  automationCandidate?: boolean | string;
};

type TestDesign = {
  scenarios: TestScenario[];
  coverageGaps?: string[];
  clarificationQuestions?: string[];
};

type GeneratedBody = {
  testBody: string;
  missingDetails: string[];
  implementationNotes: string[];
};

const rootDir = process.cwd();

const inputFile = path.join(
  rootDir,
  "ai-utils",
  "qe-test-design.json"
);

const outputDir = path.join(
  rootDir,
  "ai-utils",
  "generated-tests"
);

const reportFile = path.join(
  rootDir,
  "ai-utils",
  "qe-test-generation-report.md"
);

const ollamaUrl = (
  process.env.OLLAMA_URL ?? "http://localhost:11434"
).replace(/\/$/, "");

const model = process.env.OLLAMA_MODEL ?? "qwen3:4b";

function isAutomationCandidate(value: unknown): boolean {
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    return ["true", "yes"].includes(value.trim().toLowerCase());
  }

  return false;
}

function safeFileName(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 70);
}

function extractJson(content: string): string {
  const cleaned = content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Ollama did not return a valid JSON object.");
  }

  return cleaned.slice(start, end + 1);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateBodyResult(value: unknown): GeneratedBody {
  if (!value || typeof value !== "object") {
    throw new Error("Generated response is not an object.");
  }

  const result = value as Record<string, unknown>;

  if (
    typeof result.testBody !== "string" ||
    result.testBody.trim().length === 0
  ) {
    throw new Error("The AI did not return a testBody.");
  }

  const testBody = result.testBody.trim();

  // The agent generates the callback body only.
  // The wrapper and test title are created by this script.
  if (/\b(?:test|it|describe)\s*\(/.test(testBody)) {
    throw new Error(
      "AI returned a test declaration instead of a callback body."
    );
  }

  if (/^\s*(?:import|export)\s/m.test(testBody)) {
    throw new Error(
      "AI returned import/export statements instead of a callback body."
    );
  }

  return {
    testBody,
    missingDetails: normalizeStringArray(result.missingDetails),
    implementationNotes: normalizeStringArray(
      result.implementationNotes
    ),
  };
}

async function generateTestBody(
  scenario: TestScenario
): Promise<GeneratedBody> {
  const prompt = `
Generate a Playwright TypeScript test callback BODY for this scenario.

SCENARIO:
${JSON.stringify(scenario, null, 2)}

STRICT RULES:
1. Return JSON only, matching this schema:
{
  "testBody": "TypeScript statements placed inside async ({ page }) => { ... }",
  "missingDetails": ["missing application-specific information"],
  "implementationNotes": ["short notes for the developer"]
}
2. Generate the callback body only. Do not include imports, test(), test.describe(), or outer braces.
3. Use the Playwright page fixture, for example: page.goto(...), page.getByRole(...), expect(...).
4. Do not invent real URLs, locators, test IDs, credentials, APIs, or test data.
5. If an actual locator, URL, or test fixture is unknown, use an explicit TODO comment and record the missing information in missingDetails.
6. Do not use arbitrary waits such as page.waitForTimeout().
7. Use expect() assertions for the expected result where possible.
8. Do not claim a test is complete if key application details are unknown.
9. Keep the code concise and readable.
10. Do not create helper functions, imports, or classes.
11. Use only APIs supported by Playwright Test.
12. Do not include Markdown fences.
`;

  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      keep_alive: "10m",
      format: "json",
      options: {
        temperature: 0.1,
        num_predict: 1200,
      },
      messages: [
        {
          role: "system",
          content:
            "You generate cautious Playwright test callback bodies. Return valid JSON only. Never invent application details.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Ollama HTTP ${response.status}: ${await response.text()}`
    );
  }

  const data = (await response.json()) as {
    message?: { content?: string };
  };

  const content = data.message?.content;

  if (!content) {
    throw new Error("Ollama returned an empty response.");
  }

  return validateBodyResult(JSON.parse(extractJson(content)));
}

function buildSpec(
  scenario: TestScenario,
  generated: GeneratedBody
): string {
  const title = `${scenario.scenarioId} | ${scenario.requirementId} | ${scenario.scenario}`;

  const safeTitle = title.replace(/[\r\n]/g, " ").replace(/'/g, "\\'");

  const body = generated.testBody
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

  return `import { test, expect } from "@playwright/test";

// AI-generated candidate. Review and adapt before execution.
// Scenario: ${scenario.scenarioId}
// Requirement: ${scenario.requirementId}
// Risk: ${scenario.risk}
// Test type: ${scenario.testType}

test('${safeTitle}', async ({ page }) => {
  test.info().annotations.push(
    { type: "requirement", description: "${scenario.requirementId}" },
    { type: "scenario", description: "${scenario.scenarioId}" },
    { type: "risk", description: "${scenario.risk}" },
    { type: "ai-generated", description: "Requires human review" }
  );

${body}
});
`;
}

function checkTypeScriptSyntax(
  source: string,
  fileName: string
): string[] {
  const result = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      strict: true,
    },
  });

  return (result.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
    );
}

async function main(): Promise<void> {
  console.log(`AI Test-to-Automation Agent`);
  console.log(`Model: ${model}`);
  console.log(`Input: ${inputFile}`);

  const raw = await fs.readFile(inputFile, "utf8");
  const design = JSON.parse(raw) as TestDesign;

  if (!Array.isArray(design.scenarios)) {
    throw new Error(
      `No scenarios array found in ${inputFile}. Run the test-design agent first.`
    );
  }

  const candidates = design.scenarios.filter((scenario) =>
    isAutomationCandidate(scenario.automationCandidate)
  );

  if (candidates.length === 0) {
    throw new Error(
      "No automation candidates found. Check automationCandidate values in qe-test-design.json."
    );
  }

  // Use a fresh output folder so stale files are not mistaken for new output.
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(path.dirname(reportFile), { recursive: true });

  const report: string[] = [
    "# AI Test-to-Automation Report",
    "",
    `- Model: \`${model}\``,
    `- Input: \`${path.relative(rootDir, inputFile)}\``,
    `- Candidate scenarios: ${candidates.length}`,
    "",
    "> Generated files are candidates, not production-ready tests. Review them before running.",
    "",
  ];

  let generatedCount = 0;
  let failedCount = 0;

  for (const scenario of candidates) {
    console.log(
      `Generating ${scenario.scenarioId} (${scenario.requirementId})...`
    );

    try {
      const generated = await generateTestBody(scenario);
      const fileName = `${safeFileName(scenario.scenarioId)}-${safeFileName(
        scenario.requirementId
      )}.spec.ts`;

      const destination = path.join(outputDir, fileName);
      const source = buildSpec(scenario, generated);
      const syntaxErrors = checkTypeScriptSyntax(source, destination);

      await fs.writeFile(destination, source, "utf8");
      generatedCount++;

      report.push(`## ${scenario.scenarioId}: ${scenario.scenario}`);
      report.push("");
      report.push(`- Requirement: \`${scenario.requirementId}\``);
      report.push(`- Risk: **${scenario.risk}**`);
      report.push(`- File: \`${path.relative(rootDir, destination)}\``);
      report.push(
        `- TypeScript syntax: ${syntaxErrors.length === 0 ? "PASS" : "ERROR"}`
      );

      if (syntaxErrors.length > 0) {
        report.push("- Syntax errors:");
        syntaxErrors.forEach((error) => report.push(`  - ${error}`));
      }

      if (generated.missingDetails.length > 0) {
        report.push("- Missing application details:");
        generated.missingDetails.forEach((item) =>
          report.push(`  - ${item}`)
        );
      }

      if (generated.implementationNotes.length > 0) {
        report.push("- Implementation notes:");
        generated.implementationNotes.forEach((item) =>
          report.push(`  - ${item}`)
        );
      }

      if (
        generated.testBody.includes("TODO") ||
        generated.missingDetails.length > 0
      ) {
        report.push("- Review status: **Needs implementation**");
      } else {
        report.push("- Review status: **Human review required**");
      }

      report.push("");
      console.log(`  Saved: ${fileName}`);

      if (syntaxErrors.length > 0) {
        console.warn(`  Warning: syntax diagnostics found in ${fileName}`);
      }
    } catch (error) {
      failedCount++;
      const message =
        error instanceof Error ? error.message : String(error);

      console.error(`  Failed ${scenario.scenarioId}: ${message}`);

      report.push(`## ${scenario.scenarioId}: GENERATION FAILED`);
      report.push("");
      report.push(`- Requirement: \`${scenario.requirementId}\``);
      report.push(`- Error: ${message}`);
      report.push("");
    }
  }

  report.push("---");
  report.push("");
  report.push("## Summary");
  report.push("");
  report.push(`- Generated: ${generatedCount}`);
  report.push(`- Failed: ${failedCount}`);
  report.push(`- Output directory: \`${path.relative(rootDir, outputDir)}\``);
  report.push("");
  report.push(
    "A TypeScript syntax check does not prove that locators, fixtures, URLs, assertions, or application behavior are correct."
  );

  await fs.writeFile(reportFile, report.join("\n"), "utf8");

  console.log("");
  console.log(`Generated: ${generatedCount}`);
  console.log(`Failed: ${failedCount}`);
  console.log(`Output: ${outputDir}`);
  console.log(`Report: ${reportFile}`);

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(
    "Test-to-automation agent failed:",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});