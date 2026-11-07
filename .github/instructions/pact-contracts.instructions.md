---
description: "Use when adding or changing Pact consumer/provider contract tests, interactions, provider states, or Pact configuration."
name: "Pact Contract Conventions"
applyTo:
  - "pact-demo/**/*.ts"
  - "playwright.pact.config.ts"
---

# Pact Contract Conventions

- Keep the consumer contract test and provider verification aligned: the consumer defines the request/expected response, and the provider must satisfy the generated contract.
- Treat `given(...)` as a named provider precondition, not an endpoint. Define HTTP method, path, headers, and body in the request interaction.
- Add or change provider state handlers when verification needs state setup; an empty handler is appropriate only when the provider data is already available, such as this demo's static response.
- Run the consumer step before provider verification so the contract file exists. Do not hand-edit generated Pact files as a substitute for updating the consumer interaction.
- Use the dedicated Pact config and scripts, and report clearly if the local provider or contract artifact is unavailable.
