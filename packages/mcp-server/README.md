# @intentform/mcp-server

The local MCP (Model Context Protocol) server that lets coding agents edit an
IntentForm project through the same validated path the Studio editor uses.
Agents never get a privileged shortcut: every write is schema-validated,
fingerprint-bound, revisioned, reversible, and reviewable by a human.

## Connect a client

From the repository root, print a configuration plan without modifying the
client, review it, then re-run with `--apply`:

```bash
pnpm mcp:install --client codex --print
pnpm mcp:install --client claude --print
pnpm mcp:install --client opencode --print
pnpm mcp:install --client pi --print
```

Use `--project /absolute/path/to/project` to target a specific `.intentform`
project; otherwise the server resolves `INTENTFORM_PROJECT_DIR` or the nearest
workspace root. Existing client configuration is never replaced without
confirmation and a timestamped backup.

For generic MCP clients, an authenticated loopback HTTP transport is
available:

```bash
INTENTFORM_MCP_TOKEN=<32-512 chars> pnpm mcp:http
```

It binds to `127.0.0.1` only, requires the token as a bearer credential, and
validates `Origin`/`Host` against loopback.

## Access model

- **Read-only by default.** New connections can inspect the project, search
  the graph, compile, verify, and diff — but not write.
- **Writes are opt-in.** Set `INTENTFORM_MCP_PERMISSION=write` in the client
  environment to enable semantic writes.
- **Every write is fingerprint-bound.** Mutating tools require the caller's
  base fingerprint (`expectedFingerprint`); a stale value is rejected as a
  conflict instead of silently overwriting concurrent edits. Reviewed
  transaction commits additionally verify a full sha256 digest of the base
  graph.
- **No ambient authority.** The server exposes no shell, no arbitrary
  filesystem access, and no outbound network operation. Asset and file paths
  are containment-, symlink-, and digest-checked.

## Tool surface

The server registers 46 `intentform_*` tools covering project inspection,
graph search, typed patches, components, tokens, assets, branches, history,
compile, verify, preview, accessibility, packages, review threads,
checkpoints, diffs, reverts, and the transaction lifecycle. The recommended
editing flow is:

```text
intentform_describe_project        → read the current fingerprint
intentform_begin_transaction       → open a bounded transaction
intentform_preview_transaction     → validate a typed patch, get the exact diff
(human reviews in Studio)          → commit or reject
intentform_verify                  → fresh findings for the accepted graph
```

`intentform_apply_patch` exists for direct edits and also requires
`expectedFingerprint`. A safe read-only connection test is
`intentform_describe_project`: it reports the project, outputs, and
fingerprint without changing anything.

## Development

```bash
pnpm --filter @intentform/mcp-server typecheck
pnpm vitest run packages/mcp-server
```

Tests cover the protocol handshake, read-only enforcement, fingerprint and
digest conflicts, transaction reviews, history branches and merges, and the
HTTP transport's authentication boundaries.
