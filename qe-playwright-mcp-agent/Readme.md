# QE Playwright MCP Exploration Agent

The QE Playwright MCP Exploration Agent performs bounded, AI-assisted exploratory testing against a running web application. It connects a local Ollama model to a restricted set of browser tools exposed by the Playwright MCP server. The model chooses actions based on browser observations; unlike a conventional Playwright suite, the exploration path is not a fixed sequence of test steps.

This agent is advisory: its findings are hypotheses based on one exploratory run, not confirmed defects or a replacement for deterministic regression tests.

## What it does

1. Starts the Playwright MCP server as a child process over stdio.
2. Connects using the MCP Client SDK and discovers the server's tools.
3. Exposes only an explicit allowlist of browser tools to Ollama.
4. Asks the model to inspect the target, explore useful interactive areas, and gather evidence within a configured action limit.
5. Writes a Markdown report, JSON report, potential-findings list, execution trace, and any screenshots returned by the browser tools.

```text
QE runner -> Ollama model -> MCP client -> Playwright MCP -> headless browser
     ^                                                           |
     +---------------------- browser observations ----------------+
     |
     +--> reports and evidence
```

## Files

| Path | Purpose |
|---|---|
| `utils/qe-playwright-mcp-agent.ts` | Runner, Ollama requests, MCP tool filtering, safety checks, and report writing |
| `test-data/exploration-policy.json` | Default target, action limit, Ollama settings, and exploration goal |
| `test-data/exploration-scenarios.json` | Scenario data in the folder; the current runner does not read this file |
| `test-results/exploration-report.md` | Human-readable exploration summary and potential findings |
| `test-results/exploration-report.json` | Machine-readable target, model, action count, screenshots, findings, limitations, and trace |
| `test-results/potential-defects.json` | The model's potential findings as a JSON array |
| `test-results/execution-trace.json` | MCP actions, arguments, outcomes, and timestamps |
| `test-results/screenshots/` | Images returned by screenshot-capable MCP responses |

The runner creates the output directory when it starts. Reports from a later run overwrite the previous report files; screenshot filenames also restart from `evidence-001`, so earlier screenshots may be overwritten.

## Prerequisites

- Node.js 20 or newer and npm.
- The repository dependencies installed from the repository root.
- [Ollama](https://ollama.com/) installed and running locally, with the configured model available.
- The application running at a URL reachable from this machine.
- Network access on the first run so `npx` can obtain `@playwright/mcp@latest` if it is not already cached.

The default model is `qwen3:4b`. Pull it once if needed:

```sh
ollama pull qwen3:4b
```

Run Ollama in a separate terminal if it is not already running as a service:

```sh
ollama serve
```

The default Ollama endpoint is `http://localhost:11434`.

## Install and run

From the repository root:

```sh
npm ci
```

Start your application in a local or dedicated QA environment. Then run the agent with the application's actual URL:

```sh
QE_MCP_TARGET_URL="http://localhost:3000" npm run qe:mcp:playwright
```

The `qe:mcp:playwright` script and MCP client dependency are already defined in the repository's root `package.json`; there is no need to add another script or install the client separately.

The browser runs headlessly and in an isolated context. When the run completes, review the files under `qe-playwright-mcp-agent/test-results/`.

### Optional authenticated exploration

If the application requires login, provide a Playwright-compatible storage-state file:

```sh
QE_MCP_TARGET_URL="http://localhost:3000" \
QE_MCP_STORAGE_STATE="/absolute/path/to/qa-storage-state.json" \
npm run qe:mcp:playwright
```

Use a dedicated non-production account. Keep the storage-state file outside source control; it can contain session credentials.

## Configuration

Default values are in `test-data/exploration-policy.json`:

```json
{
  "targetUrl": "",
  "maxSteps": 10,
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "qwen3:4b",
    "timeoutMs": 300000
  },
  "explorationGoal": "Explore the application like a senior QA engineer. Inspect the initial page, identify important interactive elements, explore navigation and forms, try safe invalid and boundary inputs, observe validation messages, inspect console errors and network failures where available. Do not perform purchases, payments, deletions, account changes, or irreversible actions. Report only issues supported by observed evidence."
}
```

Target URL resolution uses the first non-empty value in this order:

1. `QE_MCP_TARGET_URL`
2. `targetUrl` in `test-data/exploration-policy.json`
3. `baseUrl` from the selected environment file
4. `BASE_URL` from the selected environment file

The runner loads `config/${ENV ?? "qa"}.env` and then `.env`. Existing process environment variables take precedence over values loaded from those files. Only `http:` and `https:` target URLs are accepted.

| Setting | Source | Default / behavior |
|---|---|---|
| Target URL | `QE_MCP_TARGET_URL`, policy `targetUrl`, `baseUrl`, or `BASE_URL` | Required; see precedence above |
| Environment file | `ENV` | `qa`, resulting in `config/qa.env` |
| Maximum actions | `QE_MCP_MAX_STEPS` or policy `maxSteps` | `10` |
| Ollama endpoint | `OLLAMA_BASE_URL` or policy `ollama.baseUrl` | `http://localhost:11434` |
| Ollama model | `OLLAMA_MODEL` or policy `ollama.model` | `qwen3:4b` |
| Ollama request timeout | Policy `ollama.timeoutMs` | `300000` ms |
| Browser request origins | `QE_MCP_ALLOWED_ORIGINS` | Target origin |
| Authenticated browser state | `QE_MCP_STORAGE_STATE` | Not set; optional file path |
| Exploration instructions | Policy `explorationGoal` | See the policy file |

`QE_MCP_ALLOWED_ORIGINS` is a semicolon-separated list, for example:

```sh
QE_MCP_TARGET_URL="http://localhost:3000" \
QE_MCP_ALLOWED_ORIGINS="http://localhost:3000;http://localhost:4000" \
npm run qe:mcp:playwright
```

This configures the MCP browser's allowed request origins. The runner separately restricts model-requested direct navigation to the configured target's origin; adding another allowed origin does not permit direct navigation to it.

## Browser tools and safety limits

Only these discovered tools may be passed to the model:

- `browser_navigate`
- `browser_snapshot`
- `browser_click`
- `browser_type`
- `browser_fill_form`
- `browser_press_key`
- `browser_take_screenshot`
- `browser_console_messages`
- `browser_network_requests`

The runner does not expose `browser_run_code_unsafe`. It also checks direct navigation origins, blocks tool arguments containing selected financial or destructive action terms, and stops after the configured action limit. Safety-blocked actions count toward that limit and are recorded in the trace.

These are safeguards, not a complete security boundary. Do not use a production site, real customer data, or production credentials. Pages and tool output are treated as untrusted input by the model instructions, but that does not make exploration risk-free. Review the target and test account before running.

## What to verify

After running, check:

1. **Connection and target:** The console identifies the intended target and model, connects to the Playwright MCP server, and reports discovered and exposed tools.
2. **Run outcome:** The process completes without an Ollama, MCP startup, or target reachability error. Confirm the action count does not exceed `QE_MCP_MAX_STEPS` or `maxSteps`.
3. **Expected outputs:** The Markdown and JSON reports, potential-findings JSON, execution trace, and any screenshots are present under `test-results/`.
4. **Evidence quality:** Compare each reported finding with the trace and screenshots. Check whether reproduction steps, expected behavior, and observed behavior are actually supported by the recorded evidence.
5. **Safety:** Check the trace for blocked actions, unexpected navigation, errors, or actions inappropriate for the selected test account.
6. **Repeatability:** Exploratory paths and findings can vary between runs. Reproduce any useful finding manually and convert confirmed behavior into a deterministic Playwright test.

A clean run or an empty findings list does not prove that the application is defect-free. The agent explores only a limited set of actions, and its coverage depends on the target, available tools, model, and action budget.

## Understanding the reports

- **`exploration-report.md`**: Target, model, action and screenshot counts, summary, potential findings, limitations, and evidence file references.
- **`exploration-report.json`**: Structured report metadata, findings, limitations, screenshot paths, and execution trace.
- **`potential-defects.json`**: The findings proposed by the model. These remain unverified hypotheses.
- **`execution-trace.json`**: Parsed MCP actions, arguments, status (`SUCCESS`, `ERROR`, or `BLOCKED`), output or reason, and timestamp.
- **`screenshots/`**: Screenshots only when the MCP response includes image evidence.

The trace can include page text, tool arguments, and tool output. Reports and screenshots may therefore contain personal information, tokens, or other sensitive application data. Inspect them before sharing, archiving, or attaching them to an issue.

## Troubleshooting

| Symptom | Checks |
|---|---|
| Target URL missing | Set `QE_MCP_TARGET_URL`, or configure `targetUrl`, `baseUrl`, or `BASE_URL` using the precedence above. |
| Ollama connection or HTTP error | Confirm `ollama serve` is running at `OLLAMA_BASE_URL` and the selected model is available (`ollama list`). |
| Playwright MCP startup or tool discovery error | Check network access for the initial `npx` package download and review the MCP startup error in the terminal. |
| Navigation was blocked | Ensure the URL is on the configured target origin. The `QE_MCP_ALLOWED_ORIGINS` setting does not relax the direct-navigation restriction. |
| Authenticated pages redirect to login | Provide a valid, current `QE_MCP_STORAGE_STATE` file for a dedicated QA account. |
| No screenshot files | The MCP server may not have returned image content during that run; screenshots are saved only when returned. |
| No findings or very short exploration | This is not a pass/fail test result. Review the summary and trace; increase the action limit only when safe and useful. |

## How it fits with the QE toolkit

The MCP agent explores a running application and can surface workflows or behaviors worth checking. Other tools have distinct roles: AI Test Design creates candidate scenarios from requirements; Test-to-Code creates candidate Playwright specs; Failure Intelligence analyzes test-run results; and the QE Orchestrator coordinates configured QE agents. Treat MCP findings as leads for human investigation and deterministic coverage, not as replacements for these workflows.

## Limitations

- Exploration is nondeterministic and bounded by the action limit.
- Model-generated findings may be false positives or miss real defects.
- The agent does not automatically create Jira issues or deterministic Playwright tests.
- Tool availability and behavior may change with the `@playwright/mcp@latest` package version.
- `test-data/exploration-scenarios.json` is not currently consumed by the runner.
- The current workflow generates reports locally; it does not register with the QE orchestrator.
