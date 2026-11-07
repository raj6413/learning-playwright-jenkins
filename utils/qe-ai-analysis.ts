
// It reads Playwright’s JSON report and collects failed, timed-out, or interrupted tests.
// For each failure, it gathers the error, test details, logs, and artifact paths.
// It uses deterministic triage rules and asks a local Ollama model for possible causes and debugging steps.
// It writes the evidence and analysis to a Markdown report; the AI suggestions are advisory, not confirmed root causes.
// If Ollama is unavailable, it keeps the failure evidence and triage in the report and notes that AI analysis couldn’t run.

import fs from 'node:fs';
import path from 'node:path';
import { triageFailure } from './qe-failure-triage';

const inputPath = path.resolve(
  process.argv[2] ?? 'ai-utils/agent-results.json'
);

const outputPath = path.resolve(
  process.argv[3] ?? 'qe-ai-failure-report.md'
);

const model = process.env.OLLAMA_MODEL ?? 'qwen3:4b';
const ollamaUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';

type JsonObject = Record<string, any>;


export type FailureEvidence = {
  title: string;
  file: string;
  line?: number;
  status: string;
  durationMs: number;
  error: string;
  artifacts: string[];

  // Additional execution context
  project?: string;
  expectedStatus?: string;
  retry?: number;
  errors?: string[];
  stdout?: string;
  stderr?: string;
};


function errorText(result: JsonObject): string {
  const errors = Array.isArray(result.errors) ? result.errors : [];

  return errors
    .map((e: JsonObject) => String(e?.message ?? 'Unknown error'))
    .join('\n')
    .slice(0, 6000);
}

function collectFailures(report: JsonObject): FailureEvidence[] {
  const found: FailureEvidence[] = [];

  function visit(suite: JsonObject, parents: string[] = []): void {
    const titles = suite.title
      ? [...parents, String(suite.title)]
      : parents;

    for (const spec of suite.specs ?? []) {
      const title = [...titles, String(spec.title ?? 'Untitled test')]
        .filter(Boolean)
        .join(' › ');

      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          const status = String(result.status ?? 'unknown');

          if (!['failed', 'timedOut', 'interrupted'].includes(status)) {
            continue;
          }

          const attachments = (result.attachments ?? [])
            .filter((a: JsonObject) => typeof a.path === 'string')
            .map(
              (a: JsonObject) =>
                `${a.name ?? 'attachment'} (${a.contentType ?? 'unknown type'}): ${a.path}`
            );

          const errors: string[] = [];

          // Capture individual error messages and stack traces.
          if (Array.isArray(result.errors)) {
            for (const err of result.errors) {
              if (err && typeof err === 'object') {
                const parts = [
                  typeof err.message === 'string' ? err.message : '',
                  typeof err.stack === 'string' ? err.stack : ''
                ].filter(Boolean);

                if (parts.length) {
                  errors.push(parts.join('\n'));
                }
              } else if (typeof err === 'string') {
                errors.push(err);
              }
            }
          }

          const stdout = Array.isArray(result.stdout)
            ? result.stdout
                .map((item: unknown) =>
                  typeof item === 'string'
                    ? item
                    : item && typeof item === 'object' &&
                        'text' in item &&
                        typeof item.text === 'string'
                      ? item.text
                      : ''
                )
                .filter(Boolean)
                .join('\n')
            : '';

          const stderr = Array.isArray(result.stderr)
            ? result.stderr
                .map((item: unknown) =>
                  typeof item === 'string'
                    ? item
                    : item && typeof item === 'object' &&
                        'text' in item &&
                        typeof item.text === 'string'
                      ? item.text
                      : ''
                )
                .filter(Boolean)
                .join('\n')
            : '';

          found.push({
            title,
            file: String(spec.file ?? suite.file ?? 'Unknown file'),
            line: typeof spec.line === 'number' ? spec.line : undefined,
            status,
            durationMs: Number(result.duration ?? 0),
            error: errorText(result) || `Status: ${status}`,
            artifacts: attachments,

            project:
              typeof test.projectName === 'string'
                ? test.projectName
                : undefined,

            expectedStatus:
              typeof test.expectedStatus === 'string'
                ? test.expectedStatus
                : undefined,

            retry:
              typeof result.retry === 'number'
                ? result.retry
                : undefined,

            errors,
            stdout: stdout || undefined,
            stderr: stderr || undefined
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

  return found;
}

function cleanLlmOutput(raw: string): string {
  let text = raw.trim();

  // Remove Qwen thinking blocks if they appear in the response.
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // If the model includes a Draft: section, prefer the final
  // structured answer that follows it.
  const draftIndex = text.search(/^\s*Draft:\s*$/im);

  if (draftIndex >= 0) {
    text = text.slice(draftIndex).replace(/^\s*Draft:\s*/i, '').trim();
  }

  // Remove introductory or concluding narration before/after
  // the five required Markdown headings.
  const firstHeading = text.search(
    /^#{1,6}\s*(?:\d+[.)]\s*)?Observed facts\b/im
  );

  if (firstHeading >= 0) {
    text = text.slice(firstHeading);
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;

  // Do not silently truncate an otherwise valid report.
  if (wordCount > 250) {
    console.warn(
      `LLM output contains ${wordCount} words; review for repetition.`
    );
  }

  return text.trim();
}

async function askLocalModel(
  evidence: FailureEvidence | string,
  numPredict = 500
): Promise<string> {

const evidenceText =
  typeof evidence === 'string'
    ? evidence
    : [
        `Test: ${evidence.title}`,
        `File: ${evidence.file}${evidence.line ? `:${evidence.line}` : ''}`,
        `Status: ${evidence.status}`,
        `Expected status: ${evidence.expectedStatus ?? 'Not recorded'}`,
        `Browser project: ${evidence.project ?? 'Not recorded'}`,
        `Retry number: ${evidence.retry ?? 'Not recorded'}`,
        `Duration: ${evidence.durationMs} ms`,
        '',
        'Primary error:',
        evidence.error,
        '',
        'Additional errors and stack traces:',
        ...(evidence.errors?.length
          ? evidence.errors.map((err, i) => `${i + 1}. ${err}`)
          : ['None recorded']),
        '',
        'Standard output:',
        evidence.stdout ?? 'Not recorded',
        '',
        'Standard error:',
        evidence.stderr ?? 'Not recorded',
        '',
        'Recorded artifacts:',
        ...(evidence.artifacts.length
          ? evidence.artifacts
          : ['None recorded'])
      ].join('\n');

const prompt = `
Analyze this Playwright failure.

Return ONLY the following Markdown sections:

## 1. Observed facts
- Two short facts from the evidence.

## 2. Two most likely causes
1. One likely cause with a brief explanation.
2. One alternative cause with a brief explanation.

## 3. Three debugging steps
1. First action.
2. Second action.
3. Third action.

## 4. Missing evidence
- One or two important missing items.

## 5. Confidence
Low, Medium, or High — one short reason.

Rules:
- Maximum 150 words.
- No introduction.
- No repeated analysis.
- No reasoning narration.
- No additional sections.
- Do not claim a root cause is confirmed without proof.

Evidence:
${evidenceText}
`;

  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },

body: JSON.stringify({
  model,
  stream: false,
  think: false,
  keep_alive: '10m',
  messages: [
    {
      role: 'system',
      content: `
You are a Playwright QA failure analysis assistant.

Produce only the final Markdown report.
Do not narrate your reasoning process.
Do not repeat facts or hypotheses.
Do not include introductory or concluding commentary.
Use the five requested headings exactly.
Keep each section short.
If evidence is insufficient, state that clearly.
`
    },
    {
      role: 'user',
      content: `${prompt}

Keep the response concise. Use only the supplied evidence.`
    }
  ],
  options: {
    temperature: 0.1,
    num_predict: numPredict
  }
}),
signal: AbortSignal.timeout(180_000)

  });

  if (!response.ok) {
    throw new Error(
      `Ollama returned HTTP ${response.status}: ${await response.text()}`
    );
  }

  const data = await response.json() as JsonObject;

const content = data.message?.content;

if (typeof content !== 'string' || !content.trim()) {
  throw new Error(
    `Ollama returned no final answer. Response: ${
      JSON.stringify(data).slice(0, 2000)
    }`
  );
}

return cleanLlmOutput(content);
}


const REQUIRED_SECTIONS = [
  'Observed facts',
  'Two most likely causes',
  'Three debugging steps',
  'Missing evidence',
  'Confidence',
];

function getMissingSections(report: string): string[] {
  return REQUIRED_SECTIONS.filter((section) => {
    const normalizedSection = section.toLowerCase();

    const found = report.split('\n').some((line) => {
      const normalizedLine = line
        .trim()
        .replace(/^\*{1,2}/, '')
        .replace(/^#{1,6}\s*/, '')
        .replace(/^\d+[.)]\s*/, '')
        .replace(/\*{1,2}$/, '')
        .trim()
        .toLowerCase();

      return (
        normalizedLine === normalizedSection ||
        normalizedLine.startsWith(`${normalizedSection} (`) ||
        normalizedLine.startsWith(`${normalizedSection}:`)
      );
    });

    return !found;
  });
}

async function askLocalModelWithRetry(
  prompt: FailureEvidence | string
): Promise<string> {
  console.log('Requesting AI analysis...');

  const response = await askLocalModel(prompt, 700);
  const missing = getMissingSections(response);

  if (missing.length === 0) {
    console.log('AI report validation passed.');
    return response;
  }

  console.warn(
    `AI report has missing sections: ${missing.join(', ')}`
  );

  return [
    response,
    '',
    '---',
    '## AI Analysis Validation Warning',
    '',
    `Missing sections: ${missing.join(', ')}.`
  ].join('\n');
}

async function main(): Promise<void> {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Playwright JSON report not found: ${inputPath}`);
  }

  const report = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const failures = collectFailures(report);

  const sections: string[] = [
    '# AI Playwright Failure Analysis',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Model: ${model}`,
    `Input: ${inputPath}`,
    '',
    '> AI analysis is advisory. Validate hypotheses against the application, logs and trace artifacts.',
    ''
  ];

  if (failures.length === 0) {
    sections.push(
      'No failed, timed-out, or interrupted test results were found.',
      'Review the original execution summary and skipped tests separately.'
    );
  }

  for (let i = 0; i < failures.length; i++) {
    const failure = failures[i];

    sections.push(
      `## ${i + 1}. ${failure.title}`,
      '',
      `- **File:** ${failure.file}${failure.line ? `:${failure.line}` : ''}`,
      `- **Status:** ${failure.status}`,
      `- **Duration:** ${failure.durationMs} ms`,
      '',
      '### Observed error',
      '',
      '```text',
      failure.error.replace(/```/g, "'''"),
      '```',
      '',
      '### Artifacts recorded by Playwright',
      '',
      ...(failure.artifacts.length
        ? failure.artifacts.map(a => `- ${a}`)
        : ['- No artifact paths were recorded in this result.']),
      '',
      '### Local LLM analysis',
      ''
    );

const triage = triageFailure(failure);

sections.push(
  '### Deterministic Failure Triage',
  '',
  `- **Category:** ${triage.category}`,
  `- **Priority:** ${triage.priority}`,
  '',
  '**Observed evidence**',
  ...triage.observedEvidence.map(item => `- ${item}`),
  '',
  '**Possible explanations**',
  ...triage.hypotheses.map(item => `- ${item}`),
  '',
  '**Recommended actions**',
  ...triage.nextActions.map((item, index) => `${index + 1}. ${item}`),
  ''
);


    console.log(`Analyzing ${i + 1}/${failures.length}: ${failure.title}`);

    try {
      sections.push(await askLocalModelWithRetry(failure));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sections.push(
        `AI analysis unavailable: ${message}`,
        '',
        'The original error evidence is retained above. Check that Ollama is running and the model is available.'
      );
    }

    sections.push('', '---', '');
  }

  fs.writeFileSync(outputPath, sections.join('\n'), 'utf8');

  console.log(`Failure results found: ${failures.length}`);
  console.log(`AI report written: ${outputPath}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
