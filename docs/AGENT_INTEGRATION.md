# Agent integration

IntentForm treats coding agents as first-class users of the design surface. Agents do not generate UI code — they edit **validated product intent**, and the deterministic compilers turn that intent into React and SwiftUI. This document describes the local integration shipped in the Build Week slice.

## The shared project

`.intentform/` at the repository root is the canonical on-disk project:

```text
.intentform/
├── graph.json          canonical Semantic Interface Graph (stable serialization)
├── revisions/          snapshot before every mutation, newest 50 kept
└── output/             compiler output emitted by intentform_compile
    ├── react/
    └── swiftui/
```

Three clients operate on the same file with the same validation:

- the **MCP server** (`packages/mcp-server`) used by Claude Code, Codex or any MCP client;
- the **Studio** (`pnpm dev`), through the project menu (*Open local project* / *Save to local project*) and `/api/project`;
- **you**, since the graph is plain, diffable JSON.

The project is seeded from the verified sample on first access. The directory is gitignored: it is a workspace, not source.

## The MCP server

Claude Code discovers the server automatically through [`.mcp.json`](../.mcp.json). Other clients can launch it directly:

```bash
node --experimental-strip-types packages/mcp-server/src/index.ts
```

It is a dependency-free stdio JSON-RPC server. Point it at a different project with `INTENTFORM_PROJECT_DIR`.

### Tools

| Tool | Purpose |
| --- | --- |
| `intentform_describe_project` | Product, screens with stable node IDs, tokens, flows, contracts, current findings, compiler fingerprints. Call first. |
| `intentform_get_graph` | Full canonical graph JSON. |
| `intentform_apply_patch` | Typed `GraphPatch` (`set-label`, `set-placement`, `set-purpose`, `set-emphasis`, `set-gap-token`, `set-padding-token`). Atomic: an invalid operation rejects the whole patch. |
| `intentform_replace_graph` | Full-graph replacement for structural edits; schema-validated before anything is written. |
| `intentform_verify` | Deterministic intent rules for a `compact` (375×667) or `regular` (402×874) scenario. |
| `intentform_compile` | Deterministic React/SwiftUI codegen; `write: true` emits files under `.intentform/output/<target>/`. |
| `intentform_list_revisions` | Revision history with reasons and fingerprints. |
| `intentform_diff` | Semantic diff against a revision (tokens, labels, placement, states, interactions). |
| `intentform_revert` | Restore a revision; the current graph is snapshotted first, so reverts are reversible. |

Every mutation returns the semantic diff, the new graph fingerprint and fresh compact-scenario verification findings, so an agent immediately sees whether its edit violated intent.

## The loop, end to end

1. `intentform_describe_project` → the agent learns that `payment-request.confirm` renders inline and the compact scenario fails verification.
2. `intentform_apply_patch` with `set-placement` → the mutation result shows the diff and that verification now passes.
3. `intentform_compile` for both targets → byte-stable code appears under `.intentform/output/`.
4. In the Studio, *Open local project* → the board shows the anchored action and green verification badges.

The reverse direction works the same way: edit visually in the Studio, *Save to local project*, and the agent's next `intentform_diff` reports exactly what changed, by stable node ID.

## Guarantees

- **Validation before persistence.** Invalid patches and graphs are rejected without side effects.
- **Determinism.** Same graph + same compiler ⇒ byte-identical output and identical fingerprints, wherever it runs.
- **Reversibility.** Every mutation snapshots the previous graph; `intentform_revert` restores it.
- **No hidden authority.** The MCP server exposes exactly the operations the Studio uses — there is no privileged agent path around schema validation.
