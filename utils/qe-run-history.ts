// It reads Playwright’s test results from agent-results.json and saves each completed result as a JSON line.
// Walks through the report’s suites, tests, and results, recording completed outcomes such as passed, failed, timedOut, and skipped.
// It appends them to a history file so results from multiple runs are kept.
// That history helps identify tests that fail repeatedly or behave inconsistently.
import fs from 'node:fs';
import path from 'node:path';

type JsonObject = Record<string, any>;

type TestRunRecord = {
  runId: string;
  timestamp: string;
  commitSha: string;
  testId: string;
  title: string;
  file: string;
  project: string;
  status: string;
  expectedStatus: string;
  durationMs: number;
  retry: number;
  error: string;
  errorSignature: string;
};

const inputPath =
  process.argv[2] ?? 'ai-utils/agent-results.json';

const historyPath =
  process.argv[3] ?? 'ai-utils/qe-run-history.jsonl';

function normalizeError(error: string): string {
  return error
    .replace(/https?:\/\/\S+/g, '<URL>')
    .replace(/\b\d{2,}\b/g, '<NUMBER>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function collectRunRecords(report: JsonObject): TestRunRecord[] {
  const records: TestRunRecord[] = [];

  const runId =
    process.env.BUILD_NUMBER ??
    process.env.GITHUB_RUN_ID ??
    `local-${Date.now()}`;

  const commitSha =
    process.env.GIT_COMMIT ??
    process.env.GITHUB_SHA ??
    'unknown';

  const timestamp = new Date().toISOString();

  function visit(suite: JsonObject, parents: string[] = []): void {
    const titles = suite.title
      ? [...parents, String(suite.title)]
      : parents;

    for (const spec of suite.specs ?? []) {
      const title = [
        ...titles,
        String(spec.title ?? 'Untitled test')
      ].filter(Boolean).join(' › ');

      const file = String(
        spec.file ?? suite.file ?? 'Unknown file'
      );

      for (const test of spec.tests ?? []) {
        const project = String(
          test.projectName ?? 'unknown'
        );

        for (const result of test.results ?? []) {
          const status = String(
            result.status ?? 'unknown'
          );

          // Ignore results that do not represent a completed outcome.
          if (
            ![
              'passed',
              'failed',
              'timedOut',
              'interrupted',
              'skipped'
            ].includes(status)
          ) {
            continue;
          }

          const errorParts: string[] = [];

          if (typeof result.error?.message === 'string') {
            errorParts.push(result.error.message);
          }

          if (typeof result.error?.stack === 'string') {
            errorParts.push(result.error.stack);
          }

          if (Array.isArray(result.errors)) {
            for (const error of result.errors) {
              if (typeof error?.message === 'string') {
                errorParts.push(error.message);
              }
            }
          }

          const error = errorParts.join('\n').trim();
          const errorSignature = normalizeError(error);

          // Include project and file to reduce accidental test collisions.
          const testId = [
            project,
            file,
            String(spec.line ?? ''),
            title
          ].join('::');

          records.push({
            runId,
            timestamp,
            commitSha,
            testId,
            title,
            file,
            project,
            status,
            expectedStatus: String(
              test.expectedStatus ?? 'unknown'
            ),
            durationMs: Number(result.duration ?? 0),
            retry: Number(result.retry ?? 0),
            error,
            errorSignature
          });
        }
      }
    }

    for (const child of suite.suites ?? []) {
      visit(child, titles);
    }
  }

  for (const suite of report.suites ?? []) {
    visit(suite);
  }

  return records;
}

function main(): void {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Playwright JSON not found: ${inputPath}`);
  }

  const report = JSON.parse(
    fs.readFileSync(inputPath, 'utf8')
  ) as JsonObject;

  const records = collectRunRecords(report);

  if (records.length === 0) {
    console.log('No completed test results found.');
    return;
  }

  fs.mkdirSync(path.dirname(historyPath), {
    recursive: true
  });

  const lines = records
    .map(record => JSON.stringify(record))
    .join('\n');

  fs.appendFileSync(
    historyPath,
    `${lines}\n`,
    'utf8'
  );

  console.log(`Run ID: ${records[0].runId}`);
  console.log(`Test results recorded: ${records.length}`);
  console.log(`History file: ${historyPath}`);
}

main();
