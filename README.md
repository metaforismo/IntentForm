# IntentForm

**Compile product intent into platform-native, runnable, verified interfaces.**

IntentForm is an agent-native interface compiler. A product brief becomes a validated Semantic Interface Graph; deterministic backends lower that graph into normal React and SwiftUI; evidence-based checks identify intent violations and accept a repair only after an independent rerun.

> Manipulate it like a design. Compile it like software.

This repository is the OpenAI Build Week vertical slice. It intentionally proves the compiler model with React and SwiftUI before adding the broader Expo-first product surface.

## What works today

- GPT-5.6 brief interpreter and scoped semantic editor through the Responses API with structured output and one corrective retry.
- Deterministic offline replay, including typed adaptive-placement and primary-action rename edits, requiring no login or API key.
- Versioned and runtime-validated Semantic Interface Graph.
- Stable node IDs, restricted expression AST, typed UI contracts and fixtures.
- Infinite multi-frame semantic board with flow edges, live finding badges, pointer-anchored zoom, pan, fit commands and adaptive workspace panels.
- State-aware previews that expose idle, loading, failed and completed fixtures without rendering state-bound nodes at the wrong time.
- Compact and regular device profiles; direct manipulation changes the active semantic breakpoint rather than storing coordinates.
- Fit-to-canvas, trackpad zoom, middle-mouse panning, preview mode and contextual keyboard shortcuts for selection, panels and revision history.
- Searchable layers and commands, human editing for labels, stack axis, width, spacing tokens, emphasis, ordering, duplication and component insertion, with undo/redo.
- Project launcher with guided blank application/prototype/library starters, validated imports, copy-only examples, browser recovery diagnostics and an optional local-agent workspace bridge.
- Versioned browser project recovery carrying project type, source, timestamp and local conflict fingerprint; invalid recovery remains inspectable instead of silently replacing a project.
- Deterministic React and SwiftUI compiler backends.
- Active React preview embedded in Studio: it validates the current graph, verifies the exact compiler fingerprint, lowers the shared IR into an isolated runtime, and executes typed navigation events without evaluating arbitrary generated source.
- Playwright screenshot, computed-style and layout-bounds verification for compact and regular viewports.
- Typed repair proposal, semantic diff and independent verification rerun.
- Hosted-studio-ready Next.js experience across Brief, Graph, Outputs, Verification and Proof Report.
- Native SwiftUI build harness validated with `xcodebuild` for iOS Simulator.
- Native Simulator evidence adapter for screenshots, accessibility identifiers and point-accurate action bounds.
- Responsive, keyboard-accessible Studio coverage at phone, tablet, adaptive desktop, wide desktop and short-landscape sizes.
- Release browser gates for console/page/request failures, direct routes, refresh, invalid input, request recovery and reduced motion.
- Production CSP and browser security headers that preserve the same-origin preview sandbox while blocking external framing.

## The proof

The included Verdant Pay sample contains one controlled violation: the confirmation action is inline on a compact viewport, despite the intent requiring it to remain reachable. IntentForm:

1. validates the graph;
2. compiles React and SwiftUI;
3. reports the exact violated intent and evidence;
4. proposes a minimal typed graph patch;
5. recompiles both targets;
6. reruns the same check;
7. marks the finding verified only when the rerun passes.

React lowers the repaired relation to a persistent responsive action. SwiftUI lowers it to `.safeAreaInset(edge: .bottom)`. The graph never stores device-specific coordinates.

## Run locally

Requirements: Node.js 22+, pnpm 10+, and Xcode 16+ only for native validation.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000` to choose a blank project, recover browser work, import a graph, copy an example, or open the local `.intentform` workspace. The editor itself lives at `/studio`; direct access remains available for existing links and opens the verified example only when no browser project was selected. Without `OPENAI_API_KEY`, the editor clearly reports **Deterministic replay** and exercises safe typed edits. With a server-side key, it uses the `gpt-5.6` alias; the key is never included in the client bundle. Model traces expose only a request ID, deterministic fingerprint, attempt count and token totals—never prompts, secrets or reasoning chains.

For the replay-first Vercel configuration and the clean-browser remote gate, see [Deployment](docs/DEPLOYMENT.md).

Core checks:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:studio
pnpm generate:demo
pnpm verify:react-preview
pnpm verify:swiftui
pnpm verify:swiftui-render
```

With the generated SwiftUI preview running in a booted Simulator and `serve-sim` exposing its accessibility endpoint:

```bash
INTENTFORM_SIMULATOR_UDID=<UDID> pnpm capture:swiftui-evidence
```

This writes a native screenshot and `evidence.json` under `artifacts/swiftui/`. `verify:swiftui-render` automates device selection, boot, host build, install, launch, AX capture and cleanup; macOS CI uploads the result as `swiftui-native-evidence`. See [docs/NATIVE_EVIDENCE.md](docs/NATIVE_EVIDENCE.md).

Generated evidence is written to `generated/` and excluded from Git because it is reproducible from the canonical graph.

## Judge path

The intended zero-setup judge path is the replay-only deployment at [intentform-metaforismos-projects.vercel.app](https://intentform-metaforismos-projects.vercel.app). It requires no account, test credentials, OpenAI key or paid action. The current deployment is still behind Vercel team SSO; it is not judge-ready until the owner explicitly removes protection for this project and the remote smoke suite passes.

Once public, the shortest product path is:

1. open the **Adaptive payment flow** example as a working copy;
2. inspect the three-screen semantic flow and switch compact/regular devices;
3. edit the request action label or compact placement and observe the semantic diff;
4. open **Native outputs**, confirm the source fingerprint and interact with the active React preview;
5. inspect **Verification** and **Proof report**, which say `not run` until graph-specific build evidence is actually supplied.

For a local judge run, use the setup above and then `pnpm smoke:studio`. Supported judge platforms are modern Chromium on Node.js 22+; Xcode 16+ on macOS is needed only to reproduce native SwiftUI evidence.

## Agent-native workflows (Claude Code, Codex, any MCP client)

IntentForm is designed to be **driven by coding agents**, not just humans. The repository ships an MCP server (auto-discovered by Claude Code through [`.mcp.json`](.mcp.json)) that operates on the local project in `.intentform/`:

```text
intentform_preview_migration inspect schema status without writing
intentform_apply_migration   checkpoint and migrate a previewed old graph
intentform_describe_project   inspect screens, stable node IDs, tokens, flows, findings
intentform_apply_patch        smallest typed semantic edit, validated and revisioned
intentform_replace_graph      structural edits with full schema validation
intentform_verify             deterministic intent rules per device scenario
intentform_compile            byte-stable React or SwiftUI into .intentform/output/
intentform_diff / revert      semantic history — every agent edit is reversible
```

In the intended MCP workflow an agent edits validated intent rather than generated UI files, and deterministic compilers produce the target code. The Studio opens and saves the same `.intentform/graph.json` (project menu → *Open/Save local project*), so agent edits land on the design board and human edits are visible to agents. Writes use atomic replacement and expected fingerprints; if an agent changes the graph after Studio opens it, Studio refuses the stale save and asks you to reopen instead of overwriting the agent revision. See [docs/AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md) for the full loop, and [CLAUDE.md](CLAUDE.md) for in-repo agent conventions.

## How Codex and GPT-5.6 shaped the build

The human product decisions were to keep semantic intent as the source of truth, use deterministic compilers instead of model-written application code, make replay the public default, keep build status fail-closed, and defer authentication, cloud collaboration and a production API key. Codex accelerated repository architecture, schema and compiler implementation, editor UX, native harnesses, test generation, CI, security review and repeated browser/native verification. The commit history and [build log](docs/BUILD_LOG.md) preserve that implementation trail.

GPT-5.6 has a narrower product role: it converts a brief into a graph, proposes scoped semantic edits and classifies repair actions. Every response is schema-validated and bounded; deterministic code owns lowering, source generation and diagnostics. In replay-only judging, those same three operations remain demonstrable without presenting deterministic output as a live model call. See [Codex and GPT-5.6 usage](docs/CODEX_USAGE.md) for the detailed boundary.

## Architecture

```text
Brief or semantic edit
  -> GPT-5.6 intent interpreter
  -> validated Semantic Interface Graph
  -> shared Platform IR
     -> React compiler -> runnable web UI
     -> SwiftUI compiler -> native iOS UI
  -> deterministic verifier + evidence
  -> GPT-5.6 or deterministic repair planner
  -> validated patch -> rebuild -> independent rerun
```

The model interprets and judges. It does not emit application code. Code generation remains deterministic: the same graph and compiler version produce byte-equivalent files.

See [architecture](docs/ARCHITECTURE.md), [hackathon scope](docs/HACKATHON_SCOPE.md), [Codex usage](docs/CODEX_USAGE.md), [build log](docs/BUILD_LOG.md), and the [submission checklist](docs/SUBMISSION_CHECKLIST.md).

## Repository map

```text
apps/studio-web/            Next.js product experience and server routes
apps/react-preview/         Vite harness executing generated React output
packages/semantic-schema/   graph, validation, canonical serialization, patches
packages/compiler-core/     shared lowering and compiler contracts
packages/compiler-react/    accessible responsive React output
packages/compiler-swiftui/  native SwiftUI output
packages/verifier/          deterministic findings and evidence
packages/repair-planner/    typed deterministic and GPT-5.6 repairs
packages/intent-interpreter GPT-5.6 structured graph creation and typed semantic edits
packages/proof-report/      end-to-end proof orchestration and golden sample
examples/preview-ios/       buildable iOS Swift package harness
```

## Build Week

Submission closes **July 21, 2026 at 5:00 PM PT**. IntentForm is entered in Developer Tools. The repository is Apache-2.0 and provides a free replay path for judges. The required package includes a working project, category, English description, public YouTube demo under three minutes with audio explaining Codex and GPT-5.6, testable repository, and the primary Codex task's `/feedback` Session ID. The Devpost Hackathons plugin is optional; the official rules, FAQ and submission requirements remain the authority.

- [Build Week](https://openai.devpost.com/)
- [Official rules](https://openai.devpost.com/rules)
- [Request the official $100 Codex credit grant](https://forms.gle/rP8WJgk4D2zQEu1A6) by July 17 at 12:00 PM PT

## Product direction

The full product is local-first and Expo Adaptive-first, with SwiftUI as the reference native renderer. Planned layers include direct semantic manipulation, native preview daemons, Expo iOS/Android, standalone Compose and web, MCP, operation-log-based Git workflows, repository adoption through managed zones, and optional collaboration cloud. No production app requires an IntentForm runtime.

## License

Apache-2.0. See [LICENSE](LICENSE).
