
// It reads the saved QE test history from qe-run-history.jsonl.
// It groups results by test and compares outcomes across runs.
// It highlights recurring failures and tests with mixed pass/fail results.
// It calculates a priority for each test based on its failure history.
// It writes the findings to qe-failure-intelligence.md for review.
import fs from 'node:fs';

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

type TestHistory = {
  testId: string;
  title: string;
  project: string;
  records: TestRunRecord[];
};

const historyPath =
  process.argv[2] ?? 'ai-utils/qe-run-history.jsonl';

const outputPath =
  process.argv[3] ?? 'ai-utils/qe-failure-intelligence.md';

const FAILURE_STATUSES = new Set([
  'failed',
  'timedOut',
  'interrupted'
]);

function cleanErrorText(error: string): string {
  return error
    // Remove ANSI terminal color/control sequences.
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    // Normalize whitespace.
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 500);
}

function isFailure(status: string): boolean {
  return FAILURE_STATUSES.has(status);
}

function loadHistory(filePath: string): TestRunRecord[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`History file not found: ${filePath}`);
  }

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as TestRunRecord;
      } catch {
        throw new Error(
          `Invalid JSON on history line ${index + 1}`
        );
      }
    });
}

function groupByTest(records: TestRunRecord[]): TestHistory[] {
  const groups = new Map<string, TestHistory>();

  for (const record of records) {
    const existing = groups.get(record.testId);

    if (existing) {
      existing.records.push(record);
    } else {
      groups.set(record.testId, {
        testId: record.testId,
        title: record.title,
        project: record.project,
        records: [record]
      });
    }
  }

  for (const group of groups.values()) {
    group.records.sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp)
    );
  }

  return [...groups.values()];
}

function analyzeTest(history: TestHistory): string[] {
  const records = history.records;

  // A test may have multiple attempts within one run.
  // Keep only the final attempt for each run.
  const latestByRun = new Map<string, TestRunRecord>();

  for (const record of records) {
    const current = latestByRun.get(record.runId);

    if (!current || record.retry >= current.retry) {
      latestByRun.set(record.runId, record);
    }
  }

  const runs = [...latestByRun.values()].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp)
  );

  const outcomes = runs.filter(
    record => record.status !== 'skipped'
  );

  if (outcomes.length === 0) {
    return [];
  }

  const latest = outcomes[outcomes.length - 1];
  const previous = outcomes.slice(0, -1);
  const previousFailures = previous.filter(
    record => isFailure(record.status)
  );

  const failures = outcomes.filter(
    record => isFailure(record.status)
  );

  const passes = outcomes.filter(
    record => record.status === 'passed'
  );

  const findings: string[] = [];

  if (
    isFailure(latest.status) &&
    previous.length > 0 &&
    previous.every(record => record.status === 'passed')
  ) {
    findings.push(
      `**New failure:** Latest run failed after ${previous.length} previous passing run(s).`
    );
  }

  if (
    isFailure(latest.status) &&
    previousFailures.length > 0
  ) {
    findings.push(
      `**Recurring failure:** Failed in ${failures.length} of ${outcomes.length} recorded run(s).`
    );
  }

  if (
    latest.status === 'passed' &&
    previousFailures.length > 0
  ) {
    findings.push(
      '**Recovered:** Latest run passed after at least one earlier failed run.'
    );
  }

  if (failures.length > 0 && passes.length > 0) {
    findings.push(
      `**Intermittent outcomes:** ${passes.length} pass(es) and ${failures.length} failure(s) across recorded runs. This is a signal to investigate, not proof of flakiness.`
    );
  }

  if (findings.length === 0) {
    findings.push(
      `**No notable transition:** Latest recorded outcome is ${latest.status}.`
    );
  }

  findings.push(
    `Runs analyzed: ${outcomes.length}; latest run: ${latest.runId}; commit: ${latest.commitSha}.`
  );

  if (isFailure(latest.status) && latest.error) {
  const error = cleanErrorText(latest.error)
    .replace(/`/g, "'");

  findings.push(
    `Latest error: \`${error.slice(0, 300)}\``
  );
}

  return findings;
}

function calculatePriority(history: TestHistory): {
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  score: number;
  reason: string;
} {
  // Keep only the final attempt from each run.
  const latestByRun = new Map<string, TestRunRecord>();

  for (const record of history.records) {
    const current = latestByRun.get(record.runId);

    if (!current || record.retry >= current.retry) {
      latestByRun.set(record.runId, record);
    }
  }

  const runs = [...latestByRun.values()]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .filter(record => record.status !== 'skipped');

  if (runs.length === 0) {
    return {
      priority: 'Low',
      score: 0,
      reason: 'No completed outcomes available.'
    };
  }

  const latest = runs[runs.length - 1];
  const isFailure = (status: string) =>
    ['failed', 'timedOut', 'interrupted'].includes(status);

  if (!isFailure(latest.status)) {
    return {
      priority: 'Low',
      score: 0,
      reason: runs.some(run => isFailure(run.status))
        ? 'Latest run passed; earlier failures still warrant monitoring.'
        : 'Latest run passed; no recorded failures.'
    };
  }

  const previous = runs.slice(0, -1);
  const failureCount = runs.filter(
    run => isFailure(run.status)
  ).length;

  const consecutiveFailures = [...runs]
    .reverse()
    .findIndex(run => !isFailure(run.status));

  const trailingFailures =
    consecutiveFailures === -1
      ? runs.length
      : consecutiveFailures;

  let score = 2;
  const reasons: string[] = [];

  if (previous.length === 0) {
    reasons.push('First observed run; regression status is unknown');
  } else if (
    previous.every(run => run.status === 'passed')
  ) {
    score += 3;
    reasons.push('New failure after previously passing runs');
  }

  if (trailingFailures >= 3) {
    score += 3;
    reasons.push(`${trailingFailures} consecutive failing runs`);
  } else if (trailingFailures === 2) {
    score += 2;
    reasons.push('Two consecutive failing runs');
  }

  if (failureCount >= 3) {
    score += 1;
    reasons.push(`${failureCount} failing runs in history`);
  }

  if (latest.status === 'timedOut') {
    score += 1;
    reasons.push('Latest outcome timed out');
  }

  if (score >= 7) {
    return {
      priority: 'Critical',
      score,
      reason: reasons.join('; ')
    };
  }

  if (score >= 5) {
    return {
      priority: 'High',
      score,
      reason: reasons.join('; ')
    };
  }

  if (score >= 3) {
    return {
      priority: 'Medium',
      score,
      reason: reasons.join('; ')
    };
  }

  return {
    priority: 'Low',
    score,
    reason: reasons.join('; ') || 'Limited failure evidence'
  };
}

function main(): void {
  const records = loadHistory(historyPath);

  // Remove accidental duplicate records from the same test attempt.
  const unique = new Map<string, TestRunRecord>();

  for (const record of records) {
    const key = [
      record.runId,
      record.testId,
      record.retry,
      record.status
    ].join('::');

    unique.set(key, record);
  }

  const histories = groupByTest([...unique.values()]);

  const lines: string[] = [
    '# Cross-Run Failure Intelligence',
    '',
    `Generated: ${new Date().toISOString()}`,
    `History source: ${historyPath}`,
    `Unique test identities: ${histories.length}`,
    '',
    '> Findings are based on recorded outcomes. They indicate patterns, not confirmed root causes.',
    ''
  ];

for (const history of histories) {
  const priority = calculatePriority(history);

  lines.push(
    `## ${history.title}`,
    '',
    `- **Project:** ${history.project}`,
    `- **File:** ${history.records[0].file}`,
    `- **Investigation priority:** ${priority.priority}`,
    `- **Priority score:** ${priority.score}`,
    `- **Priority rationale:** ${priority.reason}`,
    '',
    ...analyzeTest(history),
    ''
  );
}

  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');

  console.log(`Tests analyzed: ${histories.length}`);
  console.log(`Intelligence report written: ${outputPath}`);
}

main();