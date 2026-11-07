---
name: "Triage Playwright Failure"
description: "Investigate a Playwright failure from its error, JSON report, trace, or test file using evidence from this repository."
argument-hint: "Provide the test name and error, or a path to the Playwright report/trace."
agent: "agent"
---

Investigate the Playwright failure I provide.

1. Inspect the relevant test, its fixtures/configuration, and the supplied report or trace evidence where available.
2. Report **Observed evidence**, **Likely explanations** (ranked, explicitly hypotheses), **Missing evidence**, and **Next checks**.
3. Do not claim a root cause without evidence, recommend arbitrary sleeps, or change code unless I explicitly ask for a fix.
4. If asked to fix it, make the smallest evidence-supported change and run the focused test using the correct config. State any discovery or environment limitation.

Failure details or artifact path:

${input:failure:Paste the error or give a report/trace path}
