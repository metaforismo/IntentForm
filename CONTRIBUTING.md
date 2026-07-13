# Contributing

IntentForm is in an evidence-first Build Week phase. Keep changes small, deterministic and tied to a graph invariant or verified product behavior.

1. Create a `codex/` or descriptive feature branch.
2. Run `pnpm typecheck`, `pnpm test` and `pnpm build`.
3. If code generation changes, run `pnpm generate:demo` and `pnpm verify:swiftui` on macOS.
4. Document new schema versions and migrations.
5. Do not commit generated output, credentials, DerivedData or simulated evidence presented as real.

Pull requests should explain the intent preserved, affected compiler targets, validation performed and any honest limitations.
