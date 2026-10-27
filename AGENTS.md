# Agent Behavioral Guidelines

## Autonomous Operation
- Do NOT pause or interrupt the user with interactive question modals (`ask_question`).
- Make reasonable, best-practice engineering decisions autonomously and proceed directly with implementation.
- Execute terminal commands, builds, and test runs directly without waiting for manual confirmation or user prompts.
- Maintain high code quality, running typecheck and lint checks to verify all work.
