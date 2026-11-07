import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

type JsonObject = Record<string, unknown>;

const projectRoot = process.cwd();

const reportFiles = {
  'release-readiness': 'ai-utils/qe-release-readiness.json',
  'unified-qe': 'qe-intelligence-orchestrator/test-results/qe-orchestrator/qe-unified-intelligence-report.json',
  'test-impact': 'ai-test-impact-analysis-agent/test-results/qe-impact-report.json',
  'api-contract': 'api-contract-analysis-agent/test-results/qe-api-contract-report.json',
  'test-data': 'ai-test-data-management-agent/test-results/qe-test-data-intelligence.json',
  performance: 'perf-eng-intelligence-agent/test-results/qe-performance-intelligence.json',
  'ai-evaluation': 'qe-ai-agent-evaluation/test-results/qe-ai-evaluation/qe-ai-evaluation-report.json',
} as const;

type ReportName = keyof typeof reportFiles;

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readReport(name: ReportName): JsonObject {
  const reportPath = path.resolve(projectRoot, reportFiles[name]);

  if (!reportPath.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Report path is outside the project: ${reportFiles[name]}`);
  }

  if (!fs.existsSync(reportPath)) {
    throw new Error(
      `Report "${name}" is not available yet. Run the corresponding QE agent first. Expected: ${reportFiles[name]}`
    );
  }

  const parsed: unknown = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Report "${name}" must contain a JSON object.`);
  }

  return parsed as JsonObject;
}

function summarizeReport(name: ReportName, report: JsonObject): JsonObject {
  if (name === 'release-readiness') {
    return {
      generatedAt: report.generatedAt,
      decision: report.decision,
      mode: report.mode,
      requirementPassCoveragePercent: report.requirementPassCoveragePercent,
      summary: {
        total: report.requirementsTotal,
        passing: report.requirementsPassing,
        failed: report.requirementsFailed,
        notExecuted: report.requirementsNotExecuted,
        executionRecords: report.executionRecordsTotal,
      },
      blockingReasons: report.blockingReasons,
      warnings: report.warnings,
      requirements: asArray(report.requirements).map((item) => {
        const requirement = asObject(item);
        return {
          id: requirement.id,
          risk: requirement.risk,
          status: requirement.status,
          coverageState: requirement.coverageState,
        };
      }),
    };
  }

  if (name === 'unified-qe') {
    const risk = asObject(report.risk);
    return {
      generatedAt: report.generatedAt,
      risk: {
        level: risk.risk,
        score: risk.score,
        critical: risk.critical,
        high: risk.high,
        medium: risk.medium,
        low: risk.low,
      },
      agents: asArray(report.executions).map((item) => {
        const execution = asObject(item);
        return {
          name: execution.name,
          status: execution.status,
          required: execution.required,
          exitCode: execution.exitCode,
        };
      }),
      findings: asArray(report.findings).slice(0, 25).map((item) => {
        const finding = asObject(item);
        return {
          agent: finding.agent,
          severity: finding.severity,
          category: finding.category,
          title: finding.title,
        };
      }),
      findingsTruncated: asArray(report.findings).length > 25,
    };
  }

  if (name === 'test-impact') {
    const changedFiles = asArray(report.changedFiles);
    const tests = asArray(report.impactedTests);
    return {
      generatedAt: report.generatedAt,
      baseRef: report.baseRef,
      recommendation: report.recommendation,
      changedFileCount: changedFiles.length,
      changedFiles: changedFiles.slice(0, 50),
      selectedTestCount: tests.length,
      impactedTests: tests,
      missingMappings: report.missingMappings,
      warnings: report.warnings,
    };
  }

  if (name === 'api-contract') {
    return {
      generatedAt: report.generatedAt,
      baselineVersion: report.baselineVersion,
      currentVersion: report.currentVersion,
      recommendation: report.recommendation,
      summary: report.summary,
      changes: asArray(report.changes).slice(0, 30),
      changesTruncated: asArray(report.changes).length > 30,
      impactedTests: report.impactedTests,
      missingTests: report.missingTests,
      unmappedOperations: report.unmappedOperations,
    };
  }

  if (name === 'test-data') {
    return {
      generatedAt: report.generatedAt,
      entity: report.entity,
      summary: report.summary,
      findings: asArray(report.findings).slice(0, 30),
      findingsTruncated: asArray(report.findings).length > 30,
      scenarioCoverage: report.scenarioCoverage,
      syntheticDataFile: report.syntheticDataFile,
    };
  }

  if (name === 'performance') {
    return {
      generatedAt: report.generatedAt,
      releaseRisk: report.releaseRisk,
      summary: report.summary,
      findings: asArray(report.findings).slice(0, 30),
      findingsTruncated: asArray(report.findings).length > 30,
      k6: report.k6,
      baseline: report.baseline,
      jmeter: report.jmeter,
    };
  }

  const summary = asObject(report.summary);
  return {
    generatedAt: report.generatedAt,
    model: report.model,
    summary,
    results: asArray(report.results).map((item) => {
      const result = asObject(item);
      return {
        id: result.id,
        name: result.name,
        category: result.category,
        passed: result.passed,
        score: result.score,
        latencyMs: result.latencyMs,
        failedChecks: asArray(result.checks)
          .map(asObject)
          .filter((check) => check.passed === false)
          .map((check) => check.name),
        error: text(result.error),
      };
    }),
  };
}

const server = new McpServer({
  name: 'qe-report-server',
  version: '1.0.0',
});

server.registerTool(
  'list_qe_reports',
  {
    description: 'List known QE JSON reports and whether each report is available.',
    inputSchema: z.object({}),
  },
  async () => {
    const reports = Object.entries(reportFiles).map(([name, relativePath]) => {
      const absolutePath = path.resolve(projectRoot, relativePath);
      const exists = fs.existsSync(absolutePath);
      return {
        name,
        path: relativePath,
        available: exists,
        ...(exists
          ? { lastModified: fs.statSync(absolutePath).mtime.toISOString() }
          : {}),
      };
    });

    return {
      content: [{ type: 'text', text: JSON.stringify(reports, null, 2) }],
    };
  }
);

server.registerTool(
  'get_qe_report_summary',
  {
    description:
      'Read a concise summary from a known QE JSON report. Reports are read-only and must already exist.',
    inputSchema: z.object({
      report: z.enum([
        'release-readiness',
        'unified-qe',
        'test-impact',
        'api-contract',
        'test-data',
        'performance',
        'ai-evaluation',
      ]),
    }),
  },
  async ({ report: name }) => {
    const summary = summarizeReport(name, readReport(name));
    return {
      content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
    };
  }
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(
    'QE report MCP server failed:',
    error instanceof Error ? error.message : String(error)
  );
  process.exitCode = 1;
});
