import fs from "fs";
import path from "path";

type FieldRule = {
  type: "string" | "number" | "boolean";
  required?: boolean;
  unique?: boolean;
  sensitive?: boolean;
  format?: "email" | "phone";
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  allowedValues?: (string | number | boolean)[];
};

type Schema = {
  entity: string;
  fields: Record<string, FieldRule>;
};

type Scenario = {
  id: string;
  name: string;
  field: string;
  condition:
    | "valid"
    | "below_min"
    | "above_max"
    | "invalid_format"
    | "duplicate"
    | "missing"
    | "specific_value";
  expected?: string;
  value?: string | number | boolean;
};

type Finding = {
  severity: "HIGH" | "MEDIUM" | "LOW";
  category: string;
  record: number | string;
  field: string;
  message: string;
};

const ROOT = process.cwd();

const INPUT_DIR = path.join(
  ROOT,
  "ai-test-data-management-agent",
  "test-data",
);

const OUTPUT_DIR = path.join(ROOT, "ai-test-data-management-agent");

const SCHEMA_FILE = path.join(INPUT_DIR, "schema.json");
const DATA_FILE = path.join(INPUT_DIR, "source-data.json");
const SCENARIO_FILE = path.join(INPUT_DIR, "scenarios.json");

const REPORT_MD = path.join(
  OUTPUT_DIR,
  "test-results/qe-test-data-intelligence.md"
);

const REPORT_JSON = path.join(
  OUTPUT_DIR,
  "test-results/qe-test-data-intelligence.json"
);

const GENERATED_DATA = path.join(
  OUTPUT_DIR,
  "test-results/generated-synthetic-customers.json"
);

const OLLAMA_URL =
  process.env.OLLAMA_URL ?? "http://localhost:11434";

const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL ?? "qwen3:4b";

const findings: Finding[] = [];

function readJson<T>(file: string): T {
  if (!fs.existsSync(file)) {
    throw new Error(`Required input file not found: ${file}`);
  }

  return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

function addFinding(
  severity: Finding["severity"],
  category: string,
  record: number | string,
  field: string,
  message: string
) {
  findings.push({
    severity,
    category,
    record,
    field,
    message
  });
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === ""
  );
}

function matchesFormat(
  value: string,
  format: FieldRule["format"]
): boolean {
  if (format === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  if (format === "phone") {
    return /^\+?[0-9\s()-]{7,20}$/.test(value);
  }

  return true;
}

function validateRecords(
  records: Record<string, unknown>[],
  schema: Schema
) {
  const uniqueValues = new Map<string, Map<string, number>>();

  for (const [field, rule] of Object.entries(schema.fields)) {
    if (rule.unique) {
      uniqueValues.set(field, new Map<string, number>());
    }
  }

  records.forEach((record, index) => {
    const recordNumber = index + 1;

    for (const [field, rule] of Object.entries(schema.fields)) {
      const value = record[field];

      // Required field validation
      if (rule.required && isEmpty(value)) {
        addFinding(
          "HIGH",
          "MISSING_REQUIRED_FIELD",
          recordNumber,
          field,
          `Required field '${field}' is missing or empty.`
        );

        continue;
      }

      if (isEmpty(value)) {
        continue;
      }

      // Data type validation
      const actualType =
        typeof value === "number"
          ? "number"
          : typeof value;

      if (actualType !== rule.type) {
        addFinding(
          "HIGH",
          "INVALID_DATA_TYPE",
          recordNumber,
          field,
          `Expected ${rule.type}, received ${actualType}.`
        );

        continue;
      }

      // String length validation
      if (typeof value === "string") {
        if (
          rule.minLength !== undefined &&
          value.length < rule.minLength
        ) {
          addFinding(
            "MEDIUM",
            "BOUNDARY_VIOLATION",
            recordNumber,
            field,
            `Length ${value.length} is below minimum ${rule.minLength}.`
          );
        }

        if (
          rule.maxLength !== undefined &&
          value.length > rule.maxLength
        ) {
          addFinding(
            "MEDIUM",
            "BOUNDARY_VIOLATION",
            recordNumber,
            field,
            `Length ${value.length} exceeds maximum ${rule.maxLength}.`
          );
        }
      }

      // Numeric boundary validation
      if (typeof value === "number") {
        if (rule.min !== undefined && value < rule.min) {
          addFinding(
            "HIGH",
            "BOUNDARY_VIOLATION",
            recordNumber,
            field,
            `Value ${value} is below minimum ${rule.min}.`
          );
        }

        if (rule.max !== undefined && value > rule.max) {
          addFinding(
            "HIGH",
            "BOUNDARY_VIOLATION",
            recordNumber,
            field,
            `Value ${value} exceeds maximum ${rule.max}.`
          );
        }
      }

      // Allowed values validation
      if (
        rule.allowedValues &&
        !rule.allowedValues.includes(value as string | number | boolean)
      ) {
        addFinding(
          "HIGH",
          "INVALID_ALLOWED_VALUE",
          recordNumber,
          field,
          `Value '${String(value)}' is not in the allowed values: ${rule.allowedValues.join(", ")}.`
        );
      }

      // Format validation
      if (
        rule.format &&
        typeof value === "string" &&
        !matchesFormat(value, rule.format)
      ) {
        addFinding(
          "HIGH",
          "INVALID_FORMAT",
          recordNumber,
          field,
          `Value does not match the expected ${rule.format} format.`
        );
      }

      // Unique field validation
      if (rule.unique) {
        const normalized = String(value).trim().toLowerCase();
        const seen = uniqueValues.get(field)!;

        if (seen.has(normalized)) {
          addFinding(
            "HIGH",
            "DUPLICATE_UNIQUE_VALUE",
            recordNumber,
            field,
            `Duplicate value detected. First occurrence: record ${seen.get(normalized)}.`
          );
        } else {
          seen.set(normalized, recordNumber);
        }
      }
    }
  });

  // Full duplicate record detection
  const serializedRecords = new Map<string, number>();

  records.forEach((record, index) => {
    const normalized = JSON.stringify(
      Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((result, key) => {
          result[key] = record[key];
          return result;
        }, {})
    );

    if (serializedRecords.has(normalized)) {
      addFinding(
        "MEDIUM",
        "DUPLICATE_RECORD",
        index + 1,
        "*",
        `Entire record duplicates record ${serializedRecords.get(normalized)}.`
      );
    } else {
      serializedRecords.set(normalized, index + 1);
    }
  });
}

function analyzeSensitiveFields(schema: Schema) {
  for (const [field, rule] of Object.entries(schema.fields)) {
    const nameSuggestsSensitive =
      /(password|token|secret|email|phone|mobile|card|ssn|account|address)/i.test(
        field
      );

    if (rule.sensitive || nameSuggestsSensitive) {
      addFinding(
        "MEDIUM",
        "SENSITIVE_FIELD",
        "SCHEMA",
        field,
        "This field may contain sensitive or personal data. Use synthetic or properly masked values in non-production environments."
      );
    }
  }
}

function analyzeScenarioCoverage(
  records: Record<string, unknown>[],
  scenarios: Scenario[],
  schema: Schema
) {
  const coverage: {
    id: string;
    name: string;
    field: string;
    condition: string;
    covered: boolean;
    evidence: string;
  }[] = [];

  for (const scenario of scenarios) {
    const rule = schema.fields[scenario.field];

    if (!rule) {
      coverage.push({
        id: scenario.id,
        name: scenario.name,
        field: scenario.field,
        condition: scenario.condition,
        covered: false,
        evidence: "Field not found in schema."
      });

      continue;
    }

    let matchingRecord:
      | Record<string, unknown>
      | undefined;

    switch (scenario.condition) {
      case "valid":
        matchingRecord = records.find(record => {
          const value = record[scenario.field];

          if (isEmpty(value)) return false;

          if (rule.type === "number") {
            return (
              typeof value === "number" &&
              (rule.min === undefined || value >= rule.min) &&
              (rule.max === undefined || value <= rule.max)
            );
          }

          if (rule.allowedValues) {
            return rule.allowedValues.includes(
              value as string | number | boolean
            );
          }

          if (rule.format && typeof value === "string") {
            return matchesFormat(value, rule.format);
          }

          return true;
        });
        break;

      case "below_min":
        matchingRecord = records.find(record => {
          const value = record[scenario.field];

          return (
            typeof value === "number" &&
            rule.min !== undefined &&
            value < rule.min
          );
        });
        break;

      case "above_max":
        matchingRecord = records.find(record => {
          const value = record[scenario.field];

          return (
            typeof value === "number" &&
            rule.max !== undefined &&
            value > rule.max
          );
        });
        break;

      case "invalid_format":
        matchingRecord = records.find(record => {
          const value = record[scenario.field];

          return (
            typeof value === "string" &&
            rule.format !== undefined &&
            !matchesFormat(value, rule.format)
          );
        });
        break;

      case "duplicate": {
        const seen = new Set<string>();

        matchingRecord = records.find(record => {
          const value = record[scenario.field];

          if (isEmpty(value)) return false;

          const normalized = String(value).toLowerCase();

          if (seen.has(normalized)) return true;

          seen.add(normalized);
          return false;
        });

        break;
      }

      case "missing":
        matchingRecord = records.find(record =>
          isEmpty(record[scenario.field])
        );
        break;

      case "specific_value":
        matchingRecord = records.find(
          record => record[scenario.field] === scenario.value
        );
        break;
    }

    coverage.push({
      id: scenario.id,
      name: scenario.name,
      field: scenario.field,
      condition: scenario.condition,
      covered: Boolean(matchingRecord),
      evidence: matchingRecord
        ? "Matching test data found."
        : "No matching test data found."
    });
  }

  return coverage;
}

// Generate synthetic data without using real customer records.
// This generator uses schema metadata, not source-data values.
function generateSyntheticRecords(
  schema: Schema,
  count: number
): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];

  const firstNames = [
    "Aarav", "Maya", "Noah", "Isha", "Liam",
    "Sara", "Arjun", "Emma", "Kabir", "Zoya"
  ];

  const lastNames = [
    "Shah", "Mehta", "Patel", "Wilson", "Khan",
    "Brown", "Rao", "Thomas", "Gupta", "Lee"
  ];

  for (let i = 0; i < count; i++) {
    const record: Record<string, unknown> = {};

    for (const [field, rule] of Object.entries(schema.fields)) {
      const lowerField = field.toLowerCase();

      if (lowerField.includes("customerid") || lowerField === "id") {
        record[field] = `SYN-${String(i + 1).padStart(4, "0")}`;
        continue;
      }

      if (lowerField.includes("firstname")) {
        record[field] = firstNames[i % firstNames.length];
        continue;
      }

      if (lowerField.includes("lastname")) {
        record[field] = lastNames[i % lastNames.length];
        continue;
      }

      if (lowerField.includes("email")) {
        record[field] = `synthetic.user${i + 1}@example.test`;
        continue;
      }

      if (lowerField.includes("phone") || lowerField.includes("mobile")) {
        record[field] = `900000${String(i + 1).padStart(4, "0")}`;
        continue;
      }

      if (lowerField.includes("password")) {
        record[field] = `SyntheticPass${i + 1}!`;
        continue;
      }

      if (rule.allowedValues?.length) {
        record[field] = rule.allowedValues[i % rule.allowedValues.length];
        continue;
      }

      if (rule.type === "number") {
        const min = rule.min ?? 1;
        const max = rule.max ?? min + 100;

        record[field] = Math.min(
          max,
          Math.max(min, Math.floor(min + ((max - min) / 2)))
        );

        continue;
      }

      if (rule.type === "boolean") {
        record[field] = i % 2 === 0;
        continue;
      }

      if (rule.type === "string") {
        record[field] = `${field}_synthetic_${i + 1}`;
      }
    }

    records.push(record);
  }

  return records;
}

async function getAIRecommendations(
  summary: string
): Promise<string> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 60000);

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
          prompt: `
You are an experienced enterprise QA Test Data Architect.

Analyze the deterministic test data findings below.

Provide:
1. Top data quality risks.
2. Missing test data combinations.
3. Recommended additional positive and negative datasets.
4. Data masking and privacy recommendations.
5. Practical next steps for the QA team.

Rules:
- Do not invent findings or claim validation that was not performed.
- Clearly distinguish observed findings from recommendations.
- Do not reproduce actual sensitive values.
- Be concise and practical.

Findings:
${summary}
          `,
          stream: false
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}`);
    }

    const result = await response.json() as {
      response?: string;
    };

    return result.response?.trim() ||
      "Ollama returned an empty recommendation.";
  } catch (error) {
    return `AI recommendations unavailable: ${
      error instanceof Error ? error.message : String(error)
    }. Deterministic analysis is still available.`;
  } finally {
    clearTimeout(timeout);
  }
}

function buildMarkdownReport(
  schema: Schema,
  records: Record<string, unknown>[],
  coverage: ReturnType<typeof analyzeScenarioCoverage>,
  syntheticRecords: Record<string, unknown>[],
  aiRecommendations: string
): string {
  const high = findings.filter(f => f.severity === "HIGH").length;
  const medium = findings.filter(f => f.severity === "MEDIUM").length;
  const low = findings.filter(f => f.severity === "LOW").length;

  const covered = coverage.filter(item => item.covered).length;
  const uncovered = coverage.length - covered;

  const lines: string[] = [
    `# QE Test Data Intelligence Report`,
    ``,
    `## Overview`,
    ``,
    `- Entity: ${schema.entity}`,
    `- Records analyzed: ${records.length}`,
    `- Schema fields: ${Object.keys(schema.fields).length}`,
    `- Total findings: ${findings.length}`,
    `- High severity: ${high}`,
    `- Medium severity: ${medium}`,
    `- Low severity: ${low}`,
    `- Scenario coverage: ${covered}/${coverage.length}`,
    `- Uncovered scenarios: ${uncovered}`,
    `- Synthetic records generated: ${syntheticRecords.length}`,
    ``,
    `## Data Quality Findings`,
    ``
  ];

  if (findings.length === 0) {
    lines.push("No data quality or sensitive-field findings detected.");
  } else {
    lines.push(
      "| Severity | Category | Record | Field | Finding |",
      "|---|---|---:|---|---|"
    );

    for (const finding of findings) {
      const safeMessage = finding.message.replace(/\|/g, "\\|");

      lines.push(
        `| ${finding.severity} | ${finding.category} | ${finding.record} | ${finding.field} | ${safeMessage} |`
      );
    }
  }

  lines.push(
    ``,
    `## Test Scenario Coverage`,
    ``,
    `| Test ID | Scenario | Field | Condition | Status | Evidence |`,
    `|---|---|---|---|---|`
  );

  for (const item of coverage) {
    lines.push(
      `| ${item.id} | ${item.name} | ${item.field} | ${item.condition} | ${item.covered ? "COVERED" : "GAP"} | ${item.evidence} |`
    );
  }

  lines.push(
    ``,
    `## Synthetic Data Generation`,
    ``,
    `Generated ${syntheticRecords.length} synthetic records.`,
    ``,
    `Output: test-results/generated-synthetic-customers.json`,
    ``,
    `These records are generated from schema metadata and do not copy source customer records.`,
    ``,
    `## AI Recommendations`,
    ``,
    aiRecommendations,
    ``,
    `## Important Limitations`,
    ``,
    `- Sensitive-field detection is a schema/name-based heuristic, not a formal privacy or compliance audit.`,
    `- Synthetic values are generated from simple rules and must be validated against application-specific business rules.`,
    `- Scenario coverage checks whether matching data exists; it does not prove that the associated test executed or passed.`,
    `- This agent does not connect to or modify production databases.`
  );

  return lines.join("\n");
}

async function main() {
  console.log("\n========================================");
  console.log(" QE AI TEST DATA INTELLIGENCE AGENT");
  console.log("========================================\n");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const schema = readJson<Schema>(SCHEMA_FILE);

  const records = readJson<Record<string, unknown>[]>(DATA_FILE);

  const scenarioFile = readJson<{ scenarios: Scenario[] }>(
    SCENARIO_FILE
  );

  if (!Array.isArray(records)) {
    throw new Error("source-data.json must contain a JSON array.");
  }

  if (!Array.isArray(scenarioFile.scenarios)) {
    throw new Error("scenarios.json must contain a scenarios array.");
  }

  console.log(`[1/6] Loaded ${records.length} source records.`);
  console.log(`[2/6] Validating schema and data quality...`);

  validateRecords(records, schema);

  console.log(`[3/6] Checking sensitive fields...`);

  analyzeSensitiveFields(schema);

  console.log(`[4/6] Analyzing scenario coverage...`);

  const coverage = analyzeScenarioCoverage(
    records,
    scenarioFile.scenarios,
    schema
  );

  console.log(`[5/6] Generating synthetic test data...`);

  const syntheticRecords = generateSyntheticRecords(schema, 20);

  fs.writeFileSync(
    GENERATED_DATA,
    JSON.stringify(syntheticRecords, null, 2)
  );

  const deterministicSummary = JSON.stringify(
    {
      entity: schema.entity,
      recordsAnalyzed: records.length,
      findings,
      scenarioCoverage: coverage
    },
    null,
    2
  );

  console.log(`[6/6] Requesting AI recommendations from Ollama...`);

  const aiRecommendations =
    await getAIRecommendations(deterministicSummary);

  const report = {
    generatedAt: new Date().toISOString(),
    entity: schema.entity,
    summary: {
      recordsAnalyzed: records.length,
      totalFindings: findings.length,
      high: findings.filter(f => f.severity === "HIGH").length,
      medium: findings.filter(f => f.severity === "MEDIUM").length,
      low: findings.filter(f => f.severity === "LOW").length,
      scenariosCovered: coverage.filter(c => c.covered).length,
      scenariosUncovered: coverage.filter(c => !c.covered).length,
      syntheticRecordsGenerated: syntheticRecords.length
    },
    findings,
    scenarioCoverage: coverage,
    syntheticDataFile: GENERATED_DATA,
    aiRecommendations
  };

  fs.writeFileSync(
    REPORT_JSON,
    JSON.stringify(report, null, 2)
  );

  fs.writeFileSync(
    REPORT_MD,
    buildMarkdownReport(
      schema,
      records,
      coverage,
      syntheticRecords,
      aiRecommendations
    )
  );

  console.log("\n========================================");
  console.log(" TEST DATA INTELLIGENCE SUMMARY");
  console.log("========================================");
  console.log(`Records analyzed: ${records.length}`);
  console.log(`Total findings: ${findings.length}`);
  console.log(
    `High: ${report.summary.high} | Medium: ${report.summary.medium} | Low: ${report.summary.low}`
  );
  console.log(
    `Scenario coverage: ${report.summary.scenariosCovered}/${coverage.length}`
  );
  console.log(
    `Uncovered scenarios: ${report.summary.scenariosUncovered}`
  );
  console.log(`Synthetic records: ${syntheticRecords.length}`);
  console.log("\nGenerated files:");
  console.log(`- ${REPORT_MD}`);
  console.log(`- ${REPORT_JSON}`);
  console.log(`- ${GENERATED_DATA}`);
  console.log("\nAgent execution completed.\n");
}

main().catch(error => {
  console.error("\nTest Data Intelligence Agent failed:");
  console.error(error);
  process.exitCode = 1;
});