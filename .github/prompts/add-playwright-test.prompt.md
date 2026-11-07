---
name: "Add Playwright Test"
description: "Create or extend a repository-style Playwright UI or API test for a described scenario."
argument-hint: "Describe the scenario, UI or API suite, expected behavior, and requirement ID if available."
agent: "agent"
---

Add a Playwright test for the scenario I provide.

1. Inspect the relevant tests, fixtures, clients, environment configuration, and [README.testing.md](../../README.testing.md) before choosing a location or pattern.
2. Reuse existing fixtures and API clients where appropriate. Keep the test isolated, use resilient locators and web-first assertions, and avoid arbitrary waits.
3. Do not invent application-specific URLs, selectors, credentials, contracts, or test data. If a necessary detail is unknown, ask for it or leave an explicit TODO and explain the gap.
4. If I provide a requirement ID, preserve it using the repository's existing title/annotation pattern.
5. Add only the requested test and tightly related support code. Do not change global test configuration just to make a test appear to pass.
6. Inspect the effective Playwright config before running validation. Run the smallest safe command and state exactly what ran; if test discovery/config prevents validation, explain that instead of claiming success.
7. Summarize the files changed, behavior covered, and any remaining setup needed.

Scenario:

${input:scenario:Describe the behavior and expected result}
