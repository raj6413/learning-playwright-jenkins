---
description: "Use when creating or modifying QE agents, failure analysis, test design, quality gates, MCP report tools, or their JSON/Markdown report contracts."
name: "QE Agent Conventions"
applyTo:
  - "utils/**/*.ts"
  - "ai-test-data-management-agent/**/*.ts"
  - "ai-test-impact-analysis-agent/**/*.ts"
  - "api-contract-analysis-agent/**/*.ts"
  - "perf-eng-intelligence-agent/**/*.ts"
  - "qe-ai-agent-evaluation/**/*.ts"
  - "qe-intelligence-orchestrator/**/*.ts"
  - "mcp/**/*.ts"
---

# QE Agent Conventions

- Inspect the agent's inputs, defaults, output schema, package script, and orchestrator config before changing behavior. Keep consumers and documentation aligned with report-contract changes.
- Keep deterministic checks separate from AI recommendations. AI output is advisory; do not present a hypothesis as a proven defect or root cause.
- Validate external/model output and input files, and surface missing or invalid required inputs explicitly. Do not return success-shaped fallback reports.
- Keep model prompts grounded in supplied evidence. Do not send secrets or unnecessary personal data to an LLM; retain deterministic evidence if AI analysis is unavailable where the existing workflow allows it.
- Keep generated outputs within their configured project paths. For MCP tools, use fixed, narrowly scoped report access and never expose arbitrary file access or command execution without explicit need and safeguards.
- When changing an agent, update its `npm` script, orchestrator registration/configuration, and README only when those surfaces are relevant to the requested behavior.
