# Playwright and Non-AI Testing Guide

This guide covers the project's browser, API, accessibility, visual, database, and Pact examples. AI/QE agents are documented separately in [README.md](./README.md).

## Setup and environment

1. Install Node dependencies from the repository root with `npm ci` (or `npm install` for local development).
2. Select an environment with `ENV=qa` (default), `ENV=dev`, or `ENV=prod`. `config/envConfig.ts` loads `config/<ENV>.env`.
3. Configure `UI_BASE_URL`, `API_URL`, and `API_TYPICODE_URL` in the selected environment file; the config loader requires them to be present.
4. For database checks, configure `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in the environment. Keep real credentials out of source control and use a test database.
5. Install the Playwright browser binaries for the browser project you plan to use with `npx playwright install`.

Do not treat the sample environment files or sample test data as production configuration. Confirm each URL and credential points only to an approved test environment.

## Important configuration notes

- The root [playwright.config.ts](./playwright.config.ts) currently sets `testDir` to `./ai-utils`, not `./tests`; therefore the standard `npm test` command does **not** discover the UI/API/DB examples under `tests/`.
- The root config currently enables only the `chromium` project. Firefox and WebKit project definitions are commented out, so browser-specific scripts for those projects need configuration before they can run.
- The root config uses the configured UI base URL, retains traces on failure, records video, and takes screenshots on failure. In CI it selects the `blob` reporter; locally it configures line/list, JSON, HTML, and Allure reporters.
- To make the test examples below part of the ordinary suite, update `testDir` or add a dedicated Playwright config for `tests/`, then confirm discovery with `npx playwright test --list`.
- `npm run test:spec:webkit` currently has a misspelled `--plroject` option and references a WebKit project that is not enabled. Correct both before relying on that command.

## UI browser tests

The UI examples in `tests/UI-Test/` cover user flows such as login, product search, cart and checkout, using Playwright locators and assertions. `pom-test.spec.ts` uses a page-object class from `pages/paymentPage.ts`; data-driven examples load test values from `fixtures/data/`.

After configuring a Playwright test directory that includes `tests/`, typical commands are:

```sh
npx playwright test tests/UI-Test --project=chromium
npx playwright test tests/UI-Test/pom-test.spec.ts --project=chromium
npx playwright test tests/UI-Test --grep @smoke
```

Tests using remote demo applications require network access and valid test-environment URLs. Review test data and application state before parallel execution; do not put production credentials in test files.

## API tests

API coverage is under `tests/API-Test/`:

- `api.product.spec.ts` and `api.product.serial.spec.ts` exercise HTTP GET/login requests against the practice API; the latter runs serially.
- `general.api.test.spec.ts` demonstrates response status, headers, body assertions, query parameters, CRUD flows, pagination, and invalid-token behavior.
- `schema.validation.spec.ts` validates a users API response against a JSON schema using AJV.
- `api.mocking.spec.ts` demonstrates browser route interception and checking an API request triggered by a UI action.
- Shared API fixtures in `fixtures/test.ts` construct `UsersApi` and `PraacticesApi` clients using URLs loaded by `config/envConfig.ts`.

These are examples, not a fully isolated API test environment: some target public demo services, and mutations or fixed credentials may depend on their availability and state. Use owned test services and disposable test data for repeatable CI runs.

## Accessibility and visual checks

- `tests/UI-Test/accessibilty.spec.ts` runs axe checks tagged for WCAG 2/2.1 A/AA and includes keyboard-focus checks. Automated axe checks catch some issues, not all accessibility defects; include manual assistive-technology review where required.
- `tests/Visual-Test/home.screenshot.spec.ts` compares a page screenshot to a stored Playwright snapshot and checks responsive layouts at mobile, tablet, and desktop viewport sizes.
- Review screenshot differences before updating baselines; update snapshots only when the visual change is intentional and approved.

Run these examples with a config that includes `tests/`, for example:

```sh
npx playwright test tests/Visual-Test
npx playwright test tests/UI-Test/accessibilty.spec.ts
```

## Fixtures, page objects, and authentication

- `fixtures/test.ts` extends Playwright's `test` with API-client fixtures and disposes their request contexts after use.
- `pages/` contains page-object examples that group locators and actions, keeping test intent separate from interaction details.
- `tests/custom-fixture*.spec.ts` and `tests/scope-fixture.spec.ts` demonstrate Playwright fixture extension and fixture scope.
- `tests/auth.setup.ts` is an authentication setup example, but the root config does not currently register it as a project dependency; the current file saves state to `.json`, so configure a deliberate storage-state path before using it.

## Database checks

`utils/db.ts` exports a PostgreSQL `pg.Pool` helper (`queryDB` and `closeDB`). `tests/DB-Test/db-test-spec.ts` illustrates the idea of checking persisted data after a UI action, but it uses `https://example.com` and should be treated as a template, not a ready-to-run application integration test.

Before using database tests:

- Point the DB environment variables at a dedicated test database and confirm the installed driver and database engine agree. The active helper uses PostgreSQL; commented examples in the file mention MySQL but are not active.
- Replace placeholder UI URLs/selectors with the real test application and ensure it writes to that same test database.
- Use parameterized queries (as `queryDB` supports), create unique test records, and clean them up in `finally`/teardown code.
- Close the pool after the tests. Do not run destructive cleanup against shared or production databases.

## Pact consumer/provider contract example

Pact is a separate contract-test workflow using `playwright.pact.config.ts`, which discovers `pact-demo/*.pact.spec.ts` independently from the root Playwright test configuration.

1. The consumer test defines a provider state, expected request, and response, then calls the consumer client against Pact's mock server.
2. Pact writes the consumer contract to `pacts/BookingService-LocationService.json`.
3. The provider test starts the demo LocationService locally and verifies that it satisfies the generated contract.
4. The provider state handler is empty because this demo provider has static data; a database-backed provider would arrange the requested state there.

Run the complete example with:

```sh
npm run pact:demo
```

The consumer step must generate the contract before provider verification. This demonstrates contract compatibility; it does not test a deployed external service.

## Reports and CI

- Playwright's configured reporters produce local JSON/HTML/Allure outputs and failure artifacts; `npm run report` opens the Playwright HTML report, and `npm run allure` serves Allure results.
- The Jenkinsfile runs a selected UI spec and archives reports, but its suite command, browser project choices, and expected JSON report paths should be kept aligned with the Playwright config before relying on the pipeline.
- CI and local report formats are not identical: the root config uses `blob` in CI and JSON locally. Utilities that require `agent-results.json` need an explicit JSON reporter in CI or a compatible report-generation step.
- Test result artifacts can include traces, screenshots, videos, and response data; review them for credentials or personal information before sharing or archiving.
