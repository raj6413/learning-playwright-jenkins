
// qe-triage-demo.ts is a small example of how the failure-triage function works.
// It defines two sample failures: a timed-out disabled button and an accessibility-related assertion.
// It passes each example to triageFailure from qe-failure-triage.ts.
// It prints the category, priority, evidence, possible causes, and suggested next steps to the console.
// It uses mock examples—it doesn’t run Playwright tests or analyze a real report.
import { triageFailure } from './qe-failure-triage';
import type { FailureEvidence } from './qe-ai-analysis';

const examples: FailureEvidence[] = [
  {
    title: 'Checkout should proceed',
    file: 'UI-Test/happpy-path.spec.ts',
    status: 'timedOut',
    durationMs: 30000,
    error: `
      Test timeout of 30000ms exceeded.
      locator.click: Test ended.
      waiting for getByTestId('proceed-3')
      locator resolved to <button disabled type="button">
    `,
    artifacts: ['trace: test-results/trace.zip']
  },
  {
    title: 'Login page accessibility',
    file: 'UI-Test/accessibilty.spec.ts',
    status: 'failed',
    durationMs: 1000,
    error: `
      expect(received).toEqual(expected)
      Ensure buttons have discernible text
      WCAG 2 A/AA
    `,
    artifacts: []
  }
];

for (const failure of examples) {
  console.log('\n===', failure.title, '===');
  console.log(JSON.stringify(triageFailure(failure), null, 2));
}
