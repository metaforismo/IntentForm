# Codex and GPT-5.6 Usage

## Codex

Codex was used as the implementation environment for repository initialization, architecture, TypeScript and SwiftUI code, schema and compiler tests, CI, documentation and repeated local validation. The development process preserves the evidence trail in Git commits and this build log.

Before submission, the primary Codex task will run `/feedback`; its Session ID will be recorded in the private Devpost draft and in `docs/SUBMISSION_CHECKLIST.md`, not fabricated in advance.

## GPT-5.6

The application uses `gpt-5.6` via the Responses API in two product-visible places:

1. **Intent interpreter:** brief plus capability boundary to a schema-valid Semantic Interface Graph.
2. **Repair planner:** graph plus deterministic finding to a typed patch and concise rationale.

The model does not generate React or SwiftUI. Deterministic compiler backends do that work. API output is validated before use, requests are cancelled after 45 seconds, and replay remains available without credentials.

Defaults:

- `reasoning.effort: medium`
- low response verbosity
- structured output through Zod
- bounded output token budget
- server-only API key

The UI always distinguishes `Live model` from `Deterministic replay`.
