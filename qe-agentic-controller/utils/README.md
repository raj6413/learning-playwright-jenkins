# Agentic QE Controller — additive upgrade

This bundle adds a separate adaptive controller around your existing QE agents.
It does **not** replace or modify `utils/qe-orchestrator.ts`.

## 1. Add the controller

Copy `qe-agentic-controller.ts` into:

`utils/qe-agentic-controller.ts`

## 2. Extend the existing orchestrator config

Open the same config file used by your current orchestrator:

`qe-intelligence-orchestrator/test-data/qe-orchestrator/config.json`

Keep your existing `version` and `agents` entries unchanged. Add the top-level
`agentic` object from `agentic-config-addition.json` as a sibling of `agents`.

Important: the controller uses the paths already present in your current
`qe-orchestrator.ts`:
- config: `qe-intelligence-orchestrator/test-data/qe-orchestrator/config.json`
- output: `qe-intelligence-orchestrator/test-results/qe-agentic-orchestrator/`

If your actual project root does not contain the `qe-intelligence-orchestrator`
directory, update `ORCHESTRATOR_DIR` near the top of the new TypeScript file
to the directory that contains your existing `test-data` and `test-results`.

## 3. Add npm script

Add this entry to the root `package.json` scripts:

`"qe:agentic": "tsx utils/qe-agentic-controller.ts"`

Do not remove or rename your existing `qe:orchestrator` script.

## 4. Run

Make sure Ollama is running and `qwen3:4b` is available.

```bash
ollama list
npm run qe:agentic -- --files=src/api/checkout.ts,src/services/checkout-service.ts --summary="Checkout API validation and customer persistence changed"
```

If you want the controller to discover changed files from Git:

```bash
npm run qe:agentic -- --base=origin/main
```

If you omit `--files`, `--summary`, and `--base`, the controller uses a conservative
fallback: it runs Test Impact Analysis, then asks the planner to choose between
API Contract and Test Data Intelligence; the configured no-change fallback ensures API Contract and Test Data agents
are not silently omitted when no change context is supplied. Performance and Failure Intelligence
are selected only when the planner or deterministic triggers justify them.

Dry-run the plan without executing agents:

```bash
npm run qe:agentic -- --files=src/api/checkout.ts --dry-run
```

## 5. Outputs

`qe-intelligence-orchestrator/test-results/qe-agentic-orchestrator/`
- `qe-agentic-workflow.md` — plan, selected agents, results, release assessment
- `qe-agentic-workflow.json` — structured workflow state
- `events.jsonl` — planner decisions, agent starts/finishes, retries
- `logs/` — per-agent console logs
- `human-approval-required.json` — created when the final gate/required-agent result requires human review

## 6. What makes this agentic?

- It runs a mandatory entry-point agent first.
- It gives the planner only a validated list of candidate agents.
- It chooses one next agent at a time from the latest evidence.
- It loops with a configurable maximum number of conditional agent runs.
- It uses deterministic fallback when Ollama is unavailable or gives an invalid choice.
- It always runs the configured final release gate last.
- It records workflow decisions and requires human review for configured high-risk outcomes.

## 7. Safety notes

- The planner cannot execute arbitrary shell commands; it can only select configured npm scripts.
- The controller never edits source code, deploys, or approves a release.
- JSON report outputs are cleared before the workflow to avoid stale evidence. `.jsonl`
  history files are deliberately preserved.
- `required` continues to mean that failure of that agent is important to the workflow;
  it does not mean every conditional agent must run on every change.
- The risk/release verdict is taken from the final gate report where possible. If the
  gate report schema does not expose a recognized decision field, the result is `UNKNOWN`
  and human review is required.
- This is a bounded agentic workflow, not an unrestricted autonomous agent.
