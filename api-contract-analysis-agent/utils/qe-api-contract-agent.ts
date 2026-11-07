import fs from "node:fs";
import path from "node:path";

type JsonObject = Record<string, any>;

type Change = {
  severity: "BREAKING" | "WARNING" | "INFO";
  category: string;
  location: string;
  message: string;
  operationIds: string[];
};

type ApiMapping = {
  operationId: string;
  tests: string[];
  requirements?: string[];
};

const ROOT = process.cwd();

const BASELINE_PATH =
  "api-contract-analysis-agent/api-contracts/baseline/openapi.json";

const CURRENT_PATH =
  "api-contract-analysis-agent/api-contracts/current/openapi.json";

const MAPPING_PATH =
  "api-contract-analysis-agent/api-contracts/api-test-map.json";

const OUTPUT_DIR = "api-contract-analysis-agent/test-results";

const REPORT_PATH =
  path.join(OUTPUT_DIR, "qe-api-contract-report.md");

const JSON_PATH =
  path.join(OUTPUT_DIR, "qe-api-contract-report.json");

const OLLAMA_URL =
  process.env.OLLAMA_URL ?? "http://localhost:11434";

const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL ?? "qwen3:4b";

const HTTP_METHODS = [
  "get", "post", "put", "patch", "delete",
  "options", "head", "trace"
];

function readJson(file: string): JsonObject {
  const fullPath = path.resolve(ROOT, file);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Required file not found: ${file}`);
  }

  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function resolveRef(
  document: JsonObject,
  ref?: string
): JsonObject | undefined {
  if (!ref?.startsWith("#/")) return undefined;

  return ref
    .slice(2)
    .split("/")
    .map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<any>(
      (current, key) => current?.[key],
      document
    );
}

function resolveSchema(
  document: JsonObject,
  schema: JsonObject | undefined,
  depth = 0
): JsonObject | undefined {
  if (!schema || depth > 10) return schema;

  if (schema.$ref) {
    const resolved = resolveRef(document, schema.$ref);

    return resolved
      ? resolveSchema(document, resolved, depth + 1)
      : schema;
  }

  return schema;
}

function getSchema(
  document: JsonObject,
  operation: JsonObject,
  direction: "request" | "response"
): JsonObject | undefined {
  if (direction === "request") {
    const content =
      operation.requestBody?.content ?? {};

    const media = content["application/json"] ??
      Object.values(content)[0] as JsonObject | undefined;

    return resolveSchema(document, media?.schema);
  }

  const responses = operation.responses ?? {};

  const successResponse = Object.entries(responses)
    .find(([status]) => /^2\d\d$/.test(status));

  if (!successResponse) return undefined;

  const response = successResponse[1] as JsonObject;

  const content = response.content ?? {};

  const media = content["application/json"] ??
    Object.values(content)[0] as JsonObject | undefined;

  return resolveSchema(document, media?.schema);
}

function getOperations(document: JsonObject) {
  const operations = new Map<string, {
    path: string;
    method: string;
    operationId: string;
    operation: JsonObject;
  }>();

  for (const [apiPath, pathItem] of Object.entries(
    document.paths ?? {}
  )) {
    const item = pathItem as JsonObject;

    for (const method of HTTP_METHODS) {
      const operation = item[method];

      if (!operation) continue;

      const operationId =
        operation.operationId ??
        `${method.toUpperCase()} ${apiPath}`;

      operations.set(`${method}:${apiPath}`, {
        path: apiPath,
        method,
        operationId,
        operation
      });
    }
  }

  return operations;
}

function addChange(
  changes: Change[],
  severity: Change["severity"],
  category: string,
  location: string,
  message: string,
  operationIds: string[] = []
) {
  changes.push({
    severity,
    category,
    location,
    message,
    operationIds
  });
}

function compareSchemas(
  oldSchema: JsonObject | undefined,
  newSchema: JsonObject | undefined,
  location: string,
  changes: Change[],
  direction: "request" | "response",
  operationIds: string[]
): void {
  if (!oldSchema || !newSchema) return;

  if (oldSchema.type && newSchema.type &&
      oldSchema.type !== newSchema.type) {
    addChange(
      changes,
      "BREAKING",
      "SCHEMA_TYPE_CHANGED",
      location,
      `${direction} schema type changed from ${oldSchema.type} to ${newSchema.type}.`,
      operationIds
    );
  }

  const oldProperties = oldSchema.properties ?? {};
  const newProperties = newSchema.properties ?? {};

  for (const property of Object.keys(oldProperties)) {
    if (!(property in newProperties)) {
      addChange(
        changes,
        direction === "response" ? "BREAKING" : "WARNING",
        "PROPERTY_REMOVED",
        `${location}.${property}`,
        direction === "response"
          ? `Response property '${property}' was removed. Existing consumers may depend on it.`
          : `Request property '${property}' was removed. Existing clients may still send it.`,
        operationIds
      );

      continue;
    }

    const oldProperty = oldProperties[property] as JsonObject;
    const newProperty = newProperties[property] as JsonObject;

    if (
      oldProperty.type &&
      newProperty.type &&
      oldProperty.type !== newProperty.type
    ) {
      addChange(
        changes,
        "BREAKING",
        "PROPERTY_TYPE_CHANGED",
        `${location}.${property}`,
        `Property type changed from ${oldProperty.type} to ${newProperty.type}.`,
        operationIds
      );
    }

    if (oldProperty.enum && newProperty.enum) {
      const removedValues = oldProperty.enum.filter(
        (value: unknown) => !newProperty.enum.includes(value)
      );

      if (removedValues.length > 0) {
        addChange(
          changes,
          "WARNING",
          "ENUM_VALUES_REMOVED",
          `${location}.${property}`,
          `Enum values removed: ${removedValues.join(", ")}.`,
          operationIds
        );
      }
    }

    if (oldProperty.items || newProperty.items) {
      compareSchemas(
        oldProperty.items,
        newProperty.items,
        `${location}.${property}[]`,
        changes,
        direction,
        operationIds
      );
    }
  }

  const oldRequired: string[] = oldSchema.required ?? [];
  const newRequired: string[] = newSchema.required ?? [];

  for (const property of newRequired) {
    if (!oldRequired.includes(property)) {
      addChange(
        changes,
        direction === "request" ? "BREAKING" : "WARNING",
        "REQUIRED_PROPERTY_ADDED",
        `${location}.${property}`,
        direction === "request"
          ? `Request property '${property}' is now required. Older clients may fail.`
          : `Response property '${property}' is now required by the contract.`,
        operationIds
      );
    }
  }

  if (oldSchema.items && newSchema.items) {
    compareSchemas(
      oldSchema.items,
      newSchema.items,
      `${location}[]`,
      changes,
      direction,
      operationIds
    );
  }
}

function compareContracts(
  baseline: JsonObject,
  current: JsonObject
): Change[] {
  const changes: Change[] = [];

  const oldOperations = getOperations(baseline);
  const newOperations = getOperations(current);

  for (const [key, oldOperation] of oldOperations) {
    const newOperation = newOperations.get(key);

    if (!newOperation) {
      addChange(
        changes,
        "BREAKING",
        "ENDPOINT_REMOVED",
        `${oldOperation.method.toUpperCase()} ${oldOperation.path}`,
        "API endpoint or HTTP method was removed.",
        [oldOperation.operationId]
      );

      continue;
    }

    const oldRequest = getSchema(
      baseline,
      oldOperation.operation,
      "request"
    );

    const newRequest = getSchema(
      current,
      newOperation.operation,
      "request"
    );

    const oldResponse = getSchema(
      baseline,
      oldOperation.operation,
      "response"
    );

    const newResponse = getSchema(
      current,
      newOperation.operation,
      "response"
    );

    compareSchemas(
      oldRequest,
      newRequest,
      `${oldOperation.operationId}.request`,
      changes,
      "request",
      [oldOperation.operationId]
    );

    compareSchemas(
      oldResponse,
      newResponse,
      `${oldOperation.operationId}.response`,
      changes,
      "response",
      [oldOperation.operationId]
    );

    // Detect removal of successful response status codes.
    const oldSuccessCodes = Object.keys(
      oldOperation.operation.responses ?? {}
    ).filter(code => /^2\d\d$/.test(code));

    const newSuccessCodes = Object.keys(
      newOperation.operation.responses ?? {}
    );

    for (const code of oldSuccessCodes) {
      if (!newSuccessCodes.includes(code)) {
        addChange(
          changes,
          "BREAKING",
          "SUCCESS_RESPONSE_REMOVED",
          `${oldOperation.method.toUpperCase()} ${oldOperation.path}`,
          `Successful response status ${code} was removed.`,
          [oldOperation.operationId]
        );
      }
    }
  }

  return changes;
}

function mapImpactedTests(
  changes: Change[],
  mappings: ApiMapping[]
) {
  const impacted = new Map<string, {
    operationIds: string[];
    requirements: string[];
    changes: string[];
  }>();

  for (const change of changes) {
    for (const operationId of change.operationIds) {
      const mapping = mappings.find(
        item => item.operationId === operationId
      );

      if (!mapping) continue;

      for (const test of mapping.tests) {
        const existing = impacted.get(test) ?? {
          operationIds: [],
          requirements: [],
          changes: []
        };

        existing.operationIds.push(operationId);
        existing.requirements.push(
          ...(mapping.requirements ?? [])
        );
        existing.changes.push(change.message);

        impacted.set(test, existing);
      }
    }
  }

  return [...impacted.entries()].map(([test, data]) => ({
    test,
    operationIds: unique(data.operationIds),
    requirements: unique(data.requirements),
    changes: unique(data.changes),
    exists: fs.existsSync(path.resolve(ROOT, test))
  }));
}

async function getAIAnalysis(
  changes: Change[],
  impactedTests: ReturnType<typeof mapImpactedTests>
): Promise<string> {
  console.log("\n[AI] Analyzing API contract changes...");

  const prompt = `
You are an experienced API Test Architect.

Analyze these deterministic OpenAPI comparison findings.

Changes:
${JSON.stringify(changes, null, 2)}

Impacted tests:
${JSON.stringify(impactedTests, null, 2)}

Explain:
1. Most important compatibility risks.
2. Which consumers or tests need attention.
3. Additional API test scenarios worth creating.
4. Any limitations or uncertainty in the findings.

Rules:
- Do not invent endpoints or schema changes.
- Do not downgrade deterministic BREAKING findings.
- Distinguish confirmed structural differences from potential runtime impact.
- Keep the explanation concise.
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
          stream: false,
          options: {
            temperature: 0.2,
            num_predict: 400
          }
        }),
        signal: AbortSignal.timeout(60000)
      }
    );

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`);
    }

    const data = await response.json() as {
      response?: string;
    };

    return data.response?.trim() ??
      "Ollama returned an empty response.";
  } catch (error) {
    return `AI analysis unavailable: ${
      error instanceof Error ? error.message : String(error)
    }. Deterministic comparison is still valid.`;
  }
}

async function main() {
  console.log("\n=== QE API Contract Agent ===");

  const baseline = readJson(BASELINE_PATH);
  const current = readJson(CURRENT_PATH);
  const mappingFile = readJson(MAPPING_PATH);

  const mappings: ApiMapping[] =
    mappingFile.mappings ?? [];

  console.log("[1/4] Comparing OpenAPI contracts...");

  const changes = compareContracts(baseline, current);

  console.log(`[2/4] Changes detected: ${changes.length}`);

  const impactedTests = mapImpactedTests(
    changes,
    mappings
  );

  console.log(
    `[3/4] Impacted test files: ${impactedTests.length}`
  );

  // Write deterministic results before calling AI.
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const breakingCount = changes.filter(
    change => change.severity === "BREAKING"
  ).length;

  const warningCount = changes.filter(
    change => change.severity === "WARNING"
  ).length;

  const missingTests = impactedTests.filter(
    test => !test.exists
  );

  const unmappedOperations = unique(
    changes.flatMap(change => change.operationIds)
  ).filter(operationId =>
    !mappings.some(item => item.operationId === operationId)
  );

  const recommendation =
    breakingCount > 0 || missingTests.length > 0 ||
    unmappedOperations.length > 0
      ? "REVIEW_REQUIRED"
      : "NO_BREAKING_CHANGES_DETECTED";

  const deterministicResult = {
    generatedAt: new Date().toISOString(),
    baselineVersion: baseline.info?.version ?? "unknown",
    currentVersion: current.info?.version ?? "unknown",
    summary: {
      totalChanges: changes.length,
      breakingChanges: breakingCount,
      warnings: warningCount,
      impactedTests: impactedTests.length,
      missingTestFiles: missingTests.length,
      unmappedOperations: unmappedOperations.length
    },
    recommendation,
    changes,
    impactedTests,
    missingTests,
    unmappedOperations
  };

  fs.writeFileSync(
    JSON_PATH,
    JSON.stringify(deterministicResult, null, 2)
  );

  const markdown = [
    "# QE API Contract & Breaking Change Report",
    "",
    `- Generated: ${deterministicResult.generatedAt}`,
    `- Baseline version: ${deterministicResult.baselineVersion}`,
    `- Current version: ${deterministicResult.currentVersion}`,
    `- Recommendation: **${recommendation}**`,
    "",
    "## Summary",
    "",
    `- Total changes: ${changes.length}`,
    `- Breaking changes: ${breakingCount}`,
    `- Warnings: ${warningCount}`,
    `- Impacted test files: ${impactedTests.length}`,
    `- Missing test files: ${missingTests.length}`,
    `- Unmapped operations: ${unmappedOperations.length}`,
    "",
    "## Contract Changes",
    "",
    "| Severity | Category | Location | Finding |",
    "|---|---|---|---|",
    ...(changes.length
      ? changes.map(change =>
          `| ${change.severity} | ${change.category} | ${change.location} | ${change.message} |`
        )
      : ["| INFO | NONE | API | No breaking changes detected. |"]),
    "",
    "## Impacted Tests",
    "",
    "| Test | Operation IDs | Requirements | Exists |",
    "|---|---|---|---|",
    ...(impactedTests.length
      ? impactedTests.map(test =>
          `| ${test.test} | ${test.operationIds.join(", ")} | ${test.requirements.join(", ")} | ${test.exists ? "Yes" : "No"} |`
        )
      : ["| None | None | None | N/A |"]),
    "",
    "## Unmapped Operations",
    "",
    ...(unmappedOperations.length
      ? unmappedOperations.map(id => `- ${id}`)
      : ["- None"]),
    "",
    "## AI Analysis",
    "",
    "AI analysis is being generated..."
  ];

  fs.writeFileSync(REPORT_PATH, markdown.join("\n"));

  console.log("[4/4] Running AI explanation...");

  const aiAnalysis = await getAIAnalysis(
    changes,
    impactedTests
  );

  const finalMarkdown = [
    ...markdown.slice(0, -1),
    aiAnalysis,
    "",
    "## Decision Notes",
    "",
    "- Structural contract comparison is deterministic.",
    "- AI analysis is advisory and cannot override detected breaking changes.",
    "- No breaking changes detected does not guarantee runtime compatibility.",
    "- Review missing test mappings and run impacted API tests before release."
  ];

  fs.writeFileSync(
    REPORT_PATH,
    finalMarkdown.join("\n")
  );

  fs.writeFileSync(
    JSON_PATH,
    JSON.stringify({
      ...deterministicResult,
      aiAnalysis
    }, null, 2)
  );

  console.log("\n=== API Contract Analysis Complete ===");
  console.log(`Breaking changes: ${breakingCount}`);
  console.log(`Warnings: ${warningCount}`);
  console.log(`Impacted tests: ${impactedTests.length}`);
  console.log(`Recommendation: ${recommendation}`);
  console.log(`Report: ${REPORT_PATH}`);
  console.log(`JSON: ${JSON_PATH}`);
}

main().catch(error => {
  console.error("\nAPI Contract Agent failed:", error);
  process.exitCode = 1;
});