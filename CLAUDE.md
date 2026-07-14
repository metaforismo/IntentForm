# IntentForm — agent guide

IntentForm compiles product intent into platform-native, runnable and verified interfaces. The source of truth is a validated **Semantic Interface Graph** (`packages/semantic-schema`); deterministic compilers lower it to React and SwiftUI; a verifier checks the result against intent rules before any claim is made.

## Editing the design like an agent (preferred)

This repo ships an MCP server (`.mcp.json`, auto-discovered by Claude Code) that operates on the local project in `.intentform/`:

- `intentform_describe_project` — discover screens, stable node IDs, tokens, flows, findings. Call first.
- `intentform_apply_patch` — smallest typed edit (labels, placement, purpose, emphasis, spacing tokens). Preferred over rewriting files.
- `intentform_replace_graph` — structural edits (new screens/nodes), fully validated.
- `intentform_verify` / `intentform_compile` — deterministic verification and codegen (`.intentform/output/<target>/`).
- `intentform_diff` / `intentform_list_revisions` / `intentform_revert` — every mutation is revisioned and reversible.

The Studio (`pnpm dev`) opens/saves the same `.intentform/graph.json` via the project menu, so your MCP edits appear on the design board.

Never edit files under `.intentform/output/` or `apps/react-preview/src/generated/` by hand — they are compiler output.

## Commands

- `pnpm verify` — typecheck + vitest + production build (run before claiming done)
- `pnpm smoke:studio` — Playwright suite against the built studio (requires `pnpm build` first)
- `pnpm verify:swiftui` — xcodebuild of the generated SwiftUI (run when compiler output changes)
- `pnpm generate:demo` — refresh local demo artifacts in `generated/`
- `pnpm dev` — studio on localhost

## Contracts to respect

- `scripts/smoke-studio.ts` pins dozens of aria-labels and data-testids in the studio UI. Changing UI text or structure requires updating that suite in the same change — run it, don't assume.
- Compilers must stay deterministic: same graph + same compiler ⇒ byte-identical output. No timestamps, randomness or environment reads in generated files.
- All graph mutations go through `parseGraph`/`graphPatchSchema` validation; invalid input must be rejected without side effects.
- UI and typed contracts are in scope; business logic, backends and runtimes are permanently out of scope.

## Conventions

- Conventional-commit style subjects (`feat:`, `fix:`, `ci:`, `docs:`).
- Do not add `Co-Authored-By` or tool-attribution trailers to commits.
- UI quality bar is Penpot/Canva-grade: pointer-anchored zoom, realistic mobile proportions in frames, no stepped interactions.
