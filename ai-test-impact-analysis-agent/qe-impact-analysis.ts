import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

type ImpactMapping = {
  source: string;
  tests: string[];
  requirements?: string[];
  reason: string;
};

type ImpactConfig = {
  mappings: ImpactMapping[];
};

type ImpactedTest = {
  test: string;
  requirements: string[];
  reasons: string[];
  changedFiles: string[];
};

const ROOT = process.cwd();

const CONFIG_PATH = "ai-test-impact-analysis-agent/test-data/test-impact-map.json";
const OUTPUT_DIR = "ai-test-impact-analysis-agent/test-results";

const REPORT_PATH = path.join(
  OUTPUT_DIR,
  "qe-impact-report.md"
);

const JSON_PATH = path.join(
  OUTPUT_DIR,
  "qe-impact-report.json"
);

const SELECTED_TESTS_PATH = path.join(
  OUTPUT_DIR,
  "qe-selected-tests.txt"
);

const BASE_REF = process.env.QE_BASE_REF ?? "origin/main";

const OLLAMA_URL =
  process.env.OLLAMA_URL ?? "http://localhost:11434";

const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL ?? "qwen3:4b";


function runGit(args: string[]): string {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
}


function unique(values: string[]): string[] {
  return [...new Set(values)];
}


function normalize(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\/+/, "");
}


function getChangedFiles(): {
  files: string[];
  warnings: string[];
} {
  const changed = new Set<string>();
  const warnings: string[] = [];

  // Compare committed changes against the configured base branch.
  try {
    const output = runGit([
      "diff",
      "--name-only",
      `${BASE_REF}...HEAD`
    ]);

    output.split("\n").filter(Boolean).forEach(file => {
      changed.add(normalize(file));
    });
  } catch {
    warnings.push(
      `Could not compare against ${BASE_REF}. Check whether the base branch exists locally.`
    );
  }

  // Include staged and unstaged changes.
  try {
    const output = runGit([
      "diff",
      "--name-only",
      "HEAD"
    ]);

    output.split("\n").filter(Boolean).forEach(file => {
      changed.add(normalize(file));
    });
  } catch {
    warnings.push("Could not read working-tree changes.");
  }

  // Include untracked files.
  try {
    const output = runGit([
      "ls-files",
      "--others",
      "--exclude-standard"
    ]);

    output.split("\n").filter(Boolean).forEach(file => {
      changed.add(normalize(file));
    });
  } catch {
    warnings.push("Could not read untracked files.");
  }

  return {
    files: [...changed].sort(),
    warnings
  };
}


function loadConfig(): ImpactConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `Impact mapping not found: ${CONFIG_PATH}`
    );
  }

  const config = JSON.parse(
    fs.readFileSync(CONFIG_PATH, "utf8")
  ) as ImpactConfig;

  if (!Array.isArray(config.mappings)) {
    throw new Error(
      "Invalid impact map: expected a mappings array."
    );
  }

  return config;
}


function selectImpactedTests(
  changedFiles: string[],
  config: ImpactConfig
): ImpactedTest[] {
  const results = new Map<string, ImpactedTest>();

  for (const changedFile of changedFiles) {
    const normalizedChangedFile = normalize(changedFile);

    // If a Playwright spec itself changed, include it directly.
    if (
      normalizedChangedFile.endsWith(".spec.ts") ||
      normalizedChangedFile.endsWith(".spec.js")
    ) {
      results.set(normalizedChangedFile, {
        test: normalizedChangedFile,
        requirements: [],
        reasons: ["Playwright test file was directly modified."],
        changedFiles: [normalizedChangedFile]
      });
    }

    for (const mapping of config.mappings) {
      const source = normalize(mapping.source);

      if (
        !normalizedChangedFile
          .toLowerCase()
          .includes(source.toLowerCase())
      ) {
        continue;
      }

      for (const testPath of mapping.tests) {
        const normalizedTest = normalize(testPath);

        const existing = results.get(normalizedTest) ?? {
          test: normalizedTest,
          requirements: [],
          reasons: [],
          changedFiles: []
        };

        existing.requirements.push(
          ...(mapping.requirements ?? [])
        );

        existing.reasons.push(mapping.reason);

        existing.changedFiles.push(normalizedChangedFile);

        results.set(normalizedTest, existing);
      }
    }
  }

  return [...results.values()].map(item => ({
    ...item,
    requirements: unique(item.requirements),
    reasons: unique(item.reasons),
    changedFiles: unique(item.changedFiles)
  }));
}


async function getAIAnalysis(
  changedFiles: string[],
  impactedTests: ImpactedTest[]
): Promise<string> {
  const prompt = `
You are a senior Test Architect reviewing code changes.

Analyze the supplied evidence and explain the regression impact.

Changed files:
${JSON.stringify(changedFiles, null, 2)}

Deterministically selected tests:
${JSON.stringify(impactedTests, null, 2)}

Rules:
1. Do not invent dependencies or test files.
2. Explain why the mapped tests should run.
3. Identify possible regression risks.
4. Mention missing mappings or insufficient evidence.
5. Do not claim that unselected tests are safe to skip.
6. If no tests are mapped, recommend a full regression run.

Return these sections:
- Change impact summary
- Regression risks
- Why selected tests matter
- Missing evidence
- Execution recommendation
`;

  try {
    const response = await fetch(
      `${OLLAMA_URL}/api/generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt,
          stream: false
        }),
        signal: AbortSignal.timeout(60000)
      }
    );

    if (!response.ok) {
      throw new Error(
        `Ollama returned HTTP ${response.status}`
      );
    }

    const data = await response.json() as {
      response?: string;
    };

    return data.response?.trim() ??
      "AI returned an empty response.";
  } catch (error) {
    return [
      "AI analysis unavailable.",
      "",
      `Reason: ${error instanceof Error ? error.message : String(error)}`,
      "",
      "The deterministic impact selection is still available."
    ].join("\n");
  }
}


async function main(): Promise<void> {
  console.log("\n=== QE AI Test Impact Analysis ===\n");

  const config = loadConfig();

  const {
    files: changedFiles,
    warnings
  } = getChangedFiles();

  console.log("Changed files:");

  if (changedFiles.length === 0) {
    console.log("No changes detected.");
  } else {
    changedFiles.forEach(file => console.log(`- ${file}`));
  }

  const impactedTests = selectImpactedTests(
    changedFiles,
    config
  );

  // Verify that selected test files actually exist.
  const existingTests = impactedTests.filter(item => {
    const exists = fs.existsSync(
      path.resolve(ROOT, item.test)
    );

    if (!exists) {
      warnings.push(
        `Mapped test does not exist: ${item.test}`
      );
    }

    return exists;
  });

  const missingMappings = changedFiles.filter(file => {
    const isTestFile =
      file.endsWith(".spec.ts") ||
      file.endsWith(".spec.js");

    const hasMapping = config.mappings.some(mapping =>
      file.toLowerCase().includes(
        normalize(mapping.source).toLowerCase()
      )
    );

    return !isTestFile && !hasMapping;
  });

  const fullSuiteRequired =
    changedFiles.length === 0 ||
    existingTests.length === 0 ||
    missingMappings.length > 0;

  const aiAnalysis = await getAIAnalysis(
    changedFiles,
    existingTests
  );

  const recommendation = fullSuiteRequired
    ? "FULL_SUITE_REQUIRED"
    : "RUN_SELECTED_TESTS";

  const result = {
    generatedAt: new Date().toISOString(),
    baseRef: BASE_REF,
    changedFiles,
    impactedTests: existingTests,
    missingMappings,
    warnings,
    recommendation,
    aiAnalysis
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  fs.writeFileSync(
    JSON_PATH,
    JSON.stringify(result, null, 2),
    "utf8"
  );

  const markdown: string[] = [
    "# QE AI Test Impact Analysis",
    "",
    `- Generated: ${result.generatedAt}`,
    `- Base reference: ${BASE_REF}`,
    `- Recommendation: **${recommendation}**`,
    "",
    "## Changed Files",
    "",
    ...(changedFiles.length
      ? changedFiles.map(file => `- ${file}`)
      : ["- No changes detected"]),
    "",
    "## Selected Regression Tests",
    "",
    "| Test | Requirements | Changed Files | Reason |",
    "|---|---|---|---|"
  ];

  for (const test of existingTests) {
    markdown.push(
      `| ${test.test} | ${test.requirements.join(", ") || "Not mapped"} | ${test.changedFiles.join(", ")} | ${test.reasons.join("; ")} |`
    );
  }

  if (existingTests.length === 0) {
    markdown.push("| None | None | None | No reliable test mapping |");
  }

  markdown.push(
    "",
    "## Missing Mappings",
    "",
    ...(missingMappings.length
      ? missingMappings.map(file => `- ${file}`)
      : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(warnings.length
      ? warnings.map(warning => `- ${warning}`)
      : ["- None"]),
    "",
    "## AI Impact Analysis",
    "",
    aiAnalysis,
    "",
    "## Final Recommendation",
    "",
    fullSuiteRequired
      ? "Run the full Playwright regression suite. Impact mapping is incomplete or insufficient."
      : "Run the selected tests. This is a targeted recommendation, not proof that all other tests are safe to skip.",
    ""
  );

  fs.writeFileSync(
    REPORT_PATH,
    markdown.join("\n"),
    "utf8"
  );

  // Output only verified existing tests.
  fs.writeFileSync(
    SELECTED_TESTS_PATH,
    existingTests.map(test => test.test).join("\n"),
    "utf8"
  );

  console.log("\n=== Impact Analysis Summary ===");
  console.log(`Changed files: ${changedFiles.length}`);
  console.log(`Selected tests: ${existingTests.length}`);
  console.log(`Missing mappings: ${missingMappings.length}`);
  console.log(`Recommendation: ${recommendation}`);

  console.log("\nReports generated:");
  console.log(`- ${REPORT_PATH}`);
  console.log(`- ${JSON_PATH}`);
  console.log(`- ${SELECTED_TESTS_PATH}`);
}

main().catch(error => {
  console.error(
    "\nQE Impact Analysis failed:",
    error instanceof Error ? error.message : String(error)
  );

  process.exitCode = 1;
});