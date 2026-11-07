---
description: "Use when creating or changing Playwright UI, API, accessibility, visual, fixture, or database tests in this repository."
name: "Playwright Test Conventions"
applyTo: "tests/**/*.ts"
---

# Playwright Test Conventions

- Follow the existing Playwright Test and fixture patterns. Reuse API clients from `fixtures/test.ts` when they fit the test.
- Prefer role, label, text, and configured test-id locators; use web-first `expect` assertions and avoid arbitrary sleeps.
- Keep tests isolated and repeatable: use unique test data, avoid depending on execution order, and clean up records created by a test.
- Do not invent URLs, selectors, credentials, response contracts, or database state. Use configured environment values and existing schemas; identify unknown application details instead of guessing.
- For API mutations or database tests, use a dedicated test environment and safe, parameterized operations. Never target production or shared data for destructive cleanup.
- Before validating, inspect the Playwright config and scripts: this repository's configured test directory, browser projects, and CI reporter can differ from the examples under `tests/`.
- If a test maps to a supplied requirement ID, preserve it in the project's existing test title or annotation convention so QE traceability can find it.
