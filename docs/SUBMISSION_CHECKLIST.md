# Submission Checklist

## Project

- [x] Public working name: IntentForm.
- [x] Developer Tools category.
- [x] Original sample and no third-party branding.
- [x] Apache-2.0 repository.
- [x] Free deterministic judge path.
- [x] GPT-5.6 and Codex roles documented.
- [ ] Professional trademark, domain and package-name check before commercial launch.

## Technical proof

- [x] Valid graph accepted and invalid reference rejected.
- [x] React and SwiftUI output deterministic.
- [x] Controlled failure has structured evidence.
- [x] Typed repair changes only the expected semantic relation.
- [x] Independent rerun resolves the original error.
- [x] SwiftUI generated output builds for iOS Simulator.
- [x] React screenshot and bounds capture.
- [x] Manual semantic edit updates graph and generated React code.
- [x] GPT structured-output failure receives one corrective retry.
- [x] Two identical replay edits produce byte-equivalent typed patches and narrow semantic diffs.
- [x] Semantic patches with unknown stable targets are rejected before persistence.
- [x] Direct action drag creates an explicit safe-area relationship.
- [x] SwiftUI Simulator screenshot and accessibility bounds capture locally.
- [x] Automate native render capture on hosted macOS CI.
- [x] Active Studio preview matches the current React compiler fingerprint.
- [x] Build status fails closed when graph-specific evidence was not run.
- [x] Seven isolated browser scenarios pass three consecutive local runs.
- [x] Production CSP/security headers pass local `next start` runtime assertions.
- [x] Local secret-pattern scan finds no credential/private-key material.
- [ ] External production-dependency advisory audit (requires explicit approval to disclose the private dependency manifest to npm).
- [ ] Public deployment smoke test from a clean browser.
- [ ] Verify deployed CSP/security headers and no unexpected browser errors.
- [ ] Freeze and record the exact tested Git revision.

## Devpost

- [x] Register participation.
- [x] Create and continuously update the Devpost draft.
- [x] Add public repository URL.
- [x] Add free replay testing instructions to the repository and draft.
- [ ] Record public video under three minutes.
- [ ] Include voiceover explaining Codex and GPT-5.6 usage.
- [ ] Label any native-build time cuts.
- [ ] Upload the video publicly to YouTube.
- [ ] Confirm video contains no unlicensed music, third-party trademarks or private data.
- [ ] Confirm all submission materials and testing instructions are in English.
- [ ] Keep the demo free and unrestricted through the judging period ending August 5, 2026 at 5:00 PM PT.
- [ ] Confirm README documents supported platforms, installation, Codex collaboration, human decisions, GPT-5.6 use and a no-rebuild judge path.
- [ ] Confirm the repository is public with relevant licensing, or share a private repository with both official testing addresses.
- [ ] Run `/feedback` in the primary Codex task.
- [ ] Record Codex Session ID: `pending`.
- [ ] Recheck official rules on July 21.
- [ ] Submit by internal deadline: July 21, 18:00 CEST.

Official submission deadline: July 21, 2026, 5:00 PM PT (July 22, 02:00 CEST).

Requirements last cross-checked on July 14, 2026 against the [Build Week overview](https://openai.devpost.com/) and [Official Rules](https://openai.devpost.com/rules). Recheck both before submission because the official sources control.

Owner-reported draft: `https://devpost.com/software/intentform` (project `1328078`, not submitted yet). Do not submit or make an irreversible submission change without explicit owner approval.

## Draft submission copy

### Tagline

Compile product intent into platform-native interfaces—and prove the result still honors that intent.

### What it does

IntentForm is an agent-native interface compiler for product teams and developers. A brief becomes a runtime-validated Semantic Interface Graph containing screens, typed contracts, fixtures, states, flows, design tokens and adaptive relationships. Humans and coding agents can edit that intent on a semantic canvas. Deterministic backends then generate readable React and SwiftUI from the same graph.

The core demo is a three-screen fictional payment-request flow. Its compact primary action must remain reachable. IntentForm can expose the violated relationship, propose a minimal typed repair, regenerate both targets and rerun the same check. It distinguishes source generation, validation, build and rendered evidence instead of calling generated code “verified.”

### How it was built

The repository is a TypeScript/pnpm monorepo with Next.js 16 and React 19 for Studio, Zod for graph and API validation, deterministic React and SwiftUI compilers, Playwright browser evidence, and an iOS Simulator accessibility/screenshot adapter. The public deployment is replay-only, requires no account or API key, and keeps hosted project-file writes disabled. A local MCP server lets coding agents inspect, patch, compile, diff and revert the same `.intentform/graph.json` used by Studio.

### Codex and GPT-5.6

Codex accelerated architecture, schema/compiler implementation, editor UX, test generation, CI, native evidence automation, security review and repeated release verification. The human retained product and risk decisions: semantic intent is canonical, compilers are deterministic, proof fails closed, public judging is replay-only, and submission/protection changes require explicit approval.

GPT-5.6 is used through the Responses API for three bounded operations: graph creation from a brief, scoped semantic edits and repair classification. Structured outputs are schema-validated and receive at most one corrective retry. GPT-5.6 never writes the React or SwiftUI application code; deterministic compilers do.

### Judge instructions

Open the public demo with no login, keep the visible Replay mode, edit a semantic label or compact placement in Design, then open Native outputs and interact with the active React preview. The preview must show the current compiler fingerprint. Verification and Proof report remain honestly `not-run` unless graph-specific build evidence is supplied. To reproduce locally, use Node.js 22+, pnpm 10+, `pnpm install`, `pnpm build` and `pnpm smoke:studio`; Xcode 16+ is optional for native evidence.

### Honest boundaries

The Studio runtime safely renders validated shared IR after confirming the generated React fingerprint; the separate Vite harness supplies browser build evidence. Native evidence comes from a real Simulator build, screenshot and accessibility bounds. Studio does not yet ingest fresh CI/Simulator artifacts, and live production model access stays disabled until quotas are durable across instances.

## Media selection

Use current-revision captures only; regenerate them after the final revision is frozen.

- Hero/editor: `output/playwright/studio-redesign-wide.png`
- Active output/fingerprint: `output/playwright/studio-active-preview.png`
- Compact product quality: `output/playwright/studio-compact-375.png`
- React compact evidence: `artifacts/react/after-375x667.png`
- Native regular evidence: `artifacts/swiftui/payment-request-regular.png`
- Native compact evidence: `artifacts/swiftui/payment-request-compact.png`
