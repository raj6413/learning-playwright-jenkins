
// It examines a test failure’s error message and status using predefined rules.
// It categorizes common failures, such as timeouts, assertion errors, accessibility issues, and locator problems.
// It assigns a priority and records relevant evidence from the failure.
// It suggests possible explanations and practical next steps for investigation.
// It provides rule-based guidance—not a confirmed diagnosis—and is used by qe-ai-analysis.ts.

import type { FailureEvidence } from './qe-ai-analysis';

export type TriageFinding = {
  category: string;
  priority: 'High' | 'Medium' | 'Low';
  observedEvidence: string[];
  hypotheses: string[];
  nextActions: string[];
};

function cleanText(value: string): string {
  // Remove ANSI terminal formatting.
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function triageFailure(
  failure: FailureEvidence
): TriageFinding {
  const error = cleanText(failure.error);
  const lower = error.toLowerCase();

  const observedEvidence: string[] = [
    `Test status: ${failure.status}`,
    `Test: ${failure.title}`
  ];

  const hypotheses: string[] = [];
  const nextActions: string[] = [];

  let category = 'Unclassified failure';
  let priority: TriageFinding['priority'] = 'Medium';

  if (
    /test timeout|timed out|timeout of \d+ms exceeded/i.test(error)
  ) {
    category = 'Timeout';
    priority = 'High';

    observedEvidence.push(
      'The error contains a timeout indication.'
    );

    const disabledButton =
      /locator resolved to .*<button[^>]*disabled/i.test(error);

    if (disabledButton) {
      observedEvidence.push(
        'The call log indicates that the matched button was disabled.'
      );

      hypotheses.push(
        'A prerequisite for enabling the button may not have been satisfied.'
      );

      nextActions.push(
        'Inspect the preceding checkout step and identify the conditions that enable the button.',
        'Use the Playwright trace to inspect application state and actions immediately before the timeout.'
      );
    } else {
      hypotheses.push(
        'The awaited action or condition may not have completed within the configured timeout.'
      );

      nextActions.push(
        'Inspect the trace and call log to identify the exact action that was waiting.',
        'Check relevant application or API logs for the same time window.'
      );
    }
  } else if (
    /toEqual|toBe|toContain|expect\(.*\)\.to/i.test(error)
  ) {
    category = 'Assertion failure';
    priority = 'Medium';

    observedEvidence.push(
      'The error appears to originate from an assertion.'
    );

    hypotheses.push(
      'The actual application output may differ from the expected test value.'
    );

    nextActions.push(
      'Compare the expected and received values in the complete assertion output.',
      'Check whether the expected value matches the current requirement and test data.'
    );
  } else if (
    /accessibility|wcag|violations|toHaveNoViolations/i.test(error)
  ) {
    category = 'Accessibility assertion';
    priority = 'High';

    observedEvidence.push(
      'The error contains accessibility-related terms.'
    );

    hypotheses.push(
      'The accessibility check may have detected rule violations; inspect the complete structured results to confirm.'
    );

    nextActions.push(
      'Extract the rule ID, impact, description, and affected nodes from the accessibility results.',
      'Verify the reported findings against the accessibility rule details before prioritizing remediation.'
    );
  } else if (
    /element\(s\) not found|strict mode violation|no element matches/i.test(error)
  ) {
    category = 'Locator failure';
    priority = 'Medium';

    observedEvidence.push(
      'The error indicates that the locator could not identify the expected element, or matched elements ambiguously.'
    );

    hypotheses.push(
      'The locator may not match the current DOM, or the expected UI state may not have been reached.'
    );

    nextActions.push(
      'Inspect the trace DOM snapshot at the point of failure.',
      'Verify the locator against the rendered page and the expected application state.'
    );
  } else {
    observedEvidence.push(
      'No specific failure signature matched the current triage rules.'
    );

    hypotheses.push(
      'The available error evidence is insufficient for a more specific classification.'
    );

    nextActions.push(
      'Inspect the complete error, stack trace, and Playwright trace before classifying the failure.'
    );
  }

  return {
    category,
    priority,
    observedEvidence,
    hypotheses,
    nextActions
  };
}
