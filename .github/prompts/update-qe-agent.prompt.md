---
name: "Update QE Agent"
description: "Add or modify a QE agent while preserving this project's input, report, validation, and orchestration conventions."
argument-hint: "Describe the agent behavior to add or change, including required inputs and expected report."
agent: "agent"
---

Implement the QE agent change I describe.

1. Inspect the nearest existing agent, its `package.json` script, relevant JSON inputs/outputs, orchestrator config, and [README.md](../../README.md).
2. Preserve established report schemas unless the request requires a change; if a schema changes, update downstream consumers and documentation in the same change.
3. Keep deterministic results distinct from AI-generated recommendations. Ground AI output in supplied evidence and never claim an unverified root cause.
4. Validate required inputs and model responses explicitly. Do not silently substitute empty or success-shaped results for missing or invalid data.
5. Avoid adding dependencies unless needed. If an agent is registered with the orchestrator, verify its command, enablement, required status, report path, and execution order.
6. Run focused validation and report exact commands, outputs, and remaining prerequisites. Do not claim the model or an external service was tested unless it was actually available and called.

Requested change:

${input:change:Describe the QE agent change}
