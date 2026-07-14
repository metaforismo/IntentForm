# Codex and GPT-5.6 Usage

## Codex

Codex was used as the implementation environment for repository initialization, architecture, TypeScript and SwiftUI code, schema and compiler tests, CI, documentation and repeated local validation. It accelerated the mechanical and investigative work: closing graph invariants, keeping React and SwiftUI lowering aligned, building the semantic editor, creating native/browser evidence harnesses, finding responsive and CORS regressions, and turning smoke coverage into isolated release gates. The development process preserves the evidence trail in Git commits and this build log.

The human retained the key product and risk decisions: use semantic intent as canonical data; make compilers deterministic; keep model output out of generated application code; require real evidence before a pass; expose a no-login replay path; defer authentication/cloud scope; keep the public deployment keyless; and require explicit approval before changing Vercel protection or submitting to Devpost.

Before submission, the primary Codex task will run `/feedback`; its Session ID will be recorded in the private Devpost draft and in `docs/SUBMISSION_CHECKLIST.md`, not fabricated in advance.

## GPT-5.6

The application uses the `gpt-5.6` alias via the Responses API in three product-visible operations:

1. **Intent interpreter:** brief plus capability boundary to a schema-valid Semantic Interface Graph.
2. **Semantic editor:** current graph, selected screen and a natural-language change to the smallest typed graph patch.
3. **Repair planner:** graph, deterministic finding and available build/screenshot/bounds evidence to a layer classification, typed patch and concise rationale.

The model does not generate React or SwiftUI. Deterministic compiler backends do that work. Every output is schema validated, patch targets are resolved against stable IDs, one corrective retry is allowed, requests are cancelled after 45 seconds, and replay remains available without credentials.

Defaults:

- `reasoning.effort: medium`
- low response verbosity
- structured output through Zod
- bounded output token budget
- server-only API key
- `store: false`
- redacted trace metadata only: request ID, deterministic input fingerprint, attempts and token totals

The UI always distinguishes `Live model` from `Deterministic replay`; hovering the mode badge reveals bounded trace metadata. No chain of thought is requested, displayed or stored.

Implementation references: [GPT-5.6 model](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [Responses API structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), and [reasoning model guidance](https://developers.openai.com/api/docs/guides/reasoning).
