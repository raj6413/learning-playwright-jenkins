
// It reads Playwright’s JSON test report at agent-results.json and finds failed, timed-out, or interrupted results.
// It classifies each failure using error-message patterns, such as timeout or network issues.
// It assigns a priority and suggests likely causes and investigation steps.
// It includes test details and execution totals in a Markdown report qe-failure-report.md
// The diagnosis is rule-based guidance—not a confirmed root cause.
import fs from 'node:fs';
import path from 'node:path';

type JsonObject = Record<string, any>;

type Failure = {
  title: string;
  file: string;
  line?: number;
  status: string;
  retry: number;
  durationMs: number;
  errorMessage: string;
  classification: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  likelyCauses: string[];
  recommendedChecks: string[];
};

const inputPath = path.resolve(
  process.argv[2] ?? 'ai-utils/agent-results.json'
);

const outputPath = path.resolve(
  process.argv[3] ?? 'ai-utils/qe-failure-report.md'
);

function readText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function collectErrorMessages(result: JsonObject): string {
  const messages: string[] = [];

  if (Array.isArray(result.errors)) {
    for (const error of result.errors) {
      const message = readText(error?.message ?? error);
      if (message) messages.push(message);
    }
  }

  if (result.error?.message) {
    messages.push(readText(result.error.message));
  }

  return [...new Set(messages)].join('\n');
}

function classifyFailure(message: string): Pick<
  Failure,
  'classification' | 'priority' | 'likelyCauses' | 'recommendedChecks'
> {
  const text = message.toLowerCase();

  if (/timeout|timed out|waiting for .* to be visible/.test(text)) {
    return {
      classification: 'Timeout / readiness',
      priority: 'HIGH',
      likelyCauses: [
        'The element or response did not become ready within the timeout.',
        'The application may be slow, blocked, or in an unexpected state.',
        'The locator may target an element that is absent or not actionable.'
      ],
      recommendedChecks: [
        'Inspect the error call log and screenshot or trace, if available.',
        'Verify the locator and expected page state.',
        'Check network/API delays and application console errors.',
        'Avoid adding arbitrary sleeps before confirming the cause.'
      ]
    };
  }

  if (/strict mode violation|resolved to .* elements|locator.*matches/.test(text)) {
    return {
      classification: 'Ambiguous locator',
      priority: 'HIGH',
      likelyCauses: [
        'The locator matched multiple elements instead of one.',
        'The page may contain duplicate labels or repeated components.'
      ],
      recommendedChecks: [
        'Inspect all elements matched by the locator.',
        'Prefer a unique role, label, or test ID.',
        'Scope the locator to the correct component when appropriate.'
      ]
    };
  }

  if (/expect\s*\(|assertion|toequal|tobevisible|tobe\(|expected:|received:/.test(text)) {
    return {
      classification: 'Assertion failure',
      priority: 'HIGH',
      likelyCauses: [
        'The actual result differed from the expected result.',
        'The test expectation, test data, or application behavior may have changed.'
      ],
      recommendedChecks: [
        'Compare expected and received values in the error.',
        'Check the test data and application state.',
        'Confirm whether the requirement or UI/API contract changed.'
      ]
    };
  }

  if (/econnrefused|enotfound|econnreset|network|fetch failed|socket hang up/.test(text)) {
    return {
      classification: 'Network / service connectivity',
      priority: 'HIGH',
      likelyCauses: [
        'The target service may be unavailable or unreachable.',
        'The configured URL, DNS, container networking, or port may be incorrect.'
      ],
      recommendedChecks: [
        'Verify the base URL and environment configuration.',
        'Check service health, DNS, ports, and container networking.',
        'Inspect response status and service logs where available.'
      ]
    };
  }

  if (/401|unauthorized|403|forbidden|token expired|invalid token/.test(text)) {
    return {
      classification: 'Authentication / authorization',
      priority: 'HIGH',
      likelyCauses: [
        'Credentials or tokens may be missing, expired, or invalid.',
        'The test identity may not have permission for the requested action.'
      ],
      recommendedChecks: [
        'Verify the authentication setup and token expiry.',
        "Check the test user's roles and permissions.",
        'Confirm secrets are configured without printing them in logs.'
      ]
    };
  }

  if (/cannot find module|module not found|enoent|no such file/.test(text)) {
    return {
      classification: 'Configuration / missing resource',
      priority: 'MEDIUM',
      likelyCauses: [
        'A dependency, file, artifact, or configured path may be missing.',
        'The test may be running from a different working directory.'
      ],
      recommendedChecks: [
        'Verify the file path and working directory.',
        'Check dependency installation and package scripts.',
        'Confirm required artifacts exist in the CI environment.'
      ]
    };
  }

  return {
    classification: 'Unclassified failure',
    priority: 'MEDIUM',
    likelyCauses: [
      'The error does not match the current deterministic rules.',
      'More context may be needed to identify the cause.'
    ],
    recommendedChecks: [
      'Read the complete error and stack trace.',
      'Inspect the related screenshot, trace, logs, and test data.',
      'Reproduce the failure before changing the test or application.'
    ]
  };
}

function analyzeReport(report: JsonObject): Failure[] {
  const failures: Failure[] = [];

  function visitSuite(suite: JsonObject, parentTitles: string[] = []): void {
    const currentTitles = suite.title
      ? [...parentTitles, String(suite.title)]
      : parentTitles;

    for (const spec of suite.specs ?? []) {
      const specTitle = String(spec.title ?? 'Untitled test');
      const fullTitle = [...currentTitles, specTitle]
        .filter(Boolean)
        .join(' › ');

      for (const test of spec.tests ?? []) {
        const results = Array.isArray(test.results) ? test.results : [];

        for (const result of results) {
          const status = String(result.status ?? 'unknown');

          if (!['failed', 'timedOut', 'interrupted'].includes(status)) {
            continue;
          }

          const errorMessage = collectErrorMessages(result) ||
            `Test result status: ${status}`;

          const diagnosis = classifyFailure(errorMessage);

          failures.push({
            title: fullTitle,
            file: String(spec.file ?? suite.file ?? 'Unknown file'),
            line: typeof spec.line === 'number' ? spec.line : undefined,
            status,
            retry: Number(result.retry ?? 0),
            durationMs: Number(result.duration ?? 0),
            errorMessage,
            ...diagnosis
          });
        }
      }
    }

    for (const child of suite.suites ?? []) {
      visitSuite(child, currentTitles);
    }
  }

  for (const suite of report.suites ?? []) {
    visitSuite(suite);
  }

  return failures;
}

function markdownEscape(value: string): string {
  return value.replace(/\|/g, '\\|');
}

function buildMarkdown(report: JsonObject, failures: Failure[]): string {
  const stats = report.stats ?? {};
  const total = Number(stats.expected ?? 0) +
    Number(stats.unexpected ?? 0) +
    Number(stats.flaky ?? 0) +
    Number(stats.skipped ?? 0);

  const lines: string[] = [
    '# Playwright Failure Analysis Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Execution summary',
    '',
    `- **Total tests (from available stats):** ${total || 'Not provided'}`,
    `- **Passed:** ${Number(stats.expected ?? 0)}`,
    `- **Failed / unexpected:** ${Number(stats.unexpected ?? 0)}`,
    `- **Flaky:** ${Number(stats.flaky ?? 0)}`,
    `- **Skipped:** ${Number(stats.skipped ?? 0)}`,
    `- **Failure results analyzed:** ${failures.length}`,
    '',
    '> Diagnoses are rule-based hypotheses. Confirm them against traces, logs, and application behavior.',
    ''
  ];

  if (failures.length === 0) {
    lines.push(
      '## Result',
      '',
      'No failed, timed-out, or interrupted test results were found in the report.',
      'This does not automatically mean the whole test run was healthy; review skipped tests and the execution summary too.',
      ''
    );
    return lines.join('\n');
  }

  const high = failures.filter(f => f.priority === 'HIGH').length;
  const medium = failures.filter(f => f.priority === 'MEDIUM').length;
  const low = failures.filter(f => f.priority === 'LOW').length;

  lines.push(
    '## Triage overview',
    '',
    `- **High priority:** ${high}`,
    `- **Medium priority:** ${medium}`,
    `- **Low priority:** ${low}`,
    ''
  );

  failures.forEach((failure, index) => {
    lines.push(
      `## ${index + 1}. ${failure.title}`,
      '',
      `- **Priority:** ${failure.priority}`,
      `- **Classification:** ${failure.classification}`,
      `- **Status:** ${failure.status}`,
      `- **File:** ${failure.file}${failure.line ? `:${failure.line}` : ''}`,
      `- **Retry index:** ${failure.retry}`,
      `- **Duration:** ${failure.durationMs} ms`,
      '',
      '### Error evidence',
      '',
      '```text',
      failure.errorMessage.slice(0, 5000),
      '```',
      '',
      '### Possible causes',
      '',
      ...failure.likelyCauses.map(cause => `- ${markdownEscape(cause)}`),
      '',
      '### Recommended investigation',
      '',
      ...failure.recommendedChecks.map(check => `- ${markdownEscape(check)}`),
      '',
      '---',
      ''
    );
  });

  lines.push(
    '## Next steps',
    '',
    '1. Start with high-priority failures and inspect the original error evidence.',
    '2. Review Playwright traces, screenshots, browser console output, and service logs.',
    '3. Separate test defects, product defects, and environment issues only after collecting evidence.',
    '4. Re-run the affected test after addressing the confirmed cause.',
    ''
  );

  return lines.join('\n');
}

function main(): void {
  if (!fs.existsSync(inputPath)) {
    console.error(`Input report not found: ${inputPath}`);
    console.error(
      'Run Playwright first, then pass the correct JSON report path.'
    );
    process.exitCode = 1;
    return;
  }

  try {
    const raw = fs.readFileSync(inputPath, 'utf8');
    const report = JSON.parse(raw) as JsonObject;
    const failures = analyzeReport(report);
    const markdown = buildMarkdown(report, failures);

    fs.writeFileSync(outputPath, markdown, 'utf8');

    console.log(`Input report: ${inputPath}`);
    console.log(`Failure results analyzed: ${failures.length}`);
    console.log(`Markdown report written: ${outputPath}`);

    for (const failure of failures) {
      console.log(
        `[${failure.priority}] ${failure.classification}: ${failure.title}`
      );
    }
  } catch (error) {
    console.error('Could not analyze the Playwright JSON report.');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

main();
