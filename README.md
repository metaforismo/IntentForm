# IntentForm

**Compile product intent into platform-native, runnable, verified interfaces.**

IntentForm is an agent-native interface compiler. A product brief becomes a validated Semantic Interface Graph; deterministic backends lower that graph into normal React and SwiftUI; evidence-based checks identify intent violations and accept a repair only after an independent rerun.

> Manipulate it like a design. Compile it like software.

This repository is the OpenAI Build Week vertical slice. It intentionally proves the compiler model with React and SwiftUI before adding the broader Expo-first product surface.

## What works today

- GPT-5.6 brief interpreter through the Responses API with structured output.
- Deterministic offline replay, requiring no login or API key.
- Versioned and runtime-validated Semantic Interface Graph.
- Stable node IDs, restricted expression AST, typed UI contracts and fixtures.
- Manual semantic canvas with pages, layers, selection handles and contextual inspector.
- Direct manipulation that converts vertical action dragging into compact safe-area placement.
- Human editing for labels, stack axis, width, spacing tokens, emphasis, ordering and component insertion, with undo/redo.
- Deterministic React and SwiftUI compiler backends.
- Runnable generated React application embedded in Studio, with typed navigation events.
- Playwright screenshot, computed-style and layout-bounds verification for compact and regular viewports.
- Typed repair proposal, semantic diff and independent verification rerun.
- Hosted-studio-ready Next.js experience across Brief, Graph, Outputs, Verification and Proof Report.
- Native SwiftUI build harness validated with `xcodebuild` for iOS Simulator.

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

Open `http://localhost:3000`. Without `OPENAI_API_KEY`, the app clearly reports **Deterministic replay** and exercises the complete sample. With a server-side key, it uses `gpt-5.6`; the key is never included in the client bundle.

Core checks:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm generate:demo
pnpm verify:react-preview
pnpm verify:swiftui
```

Generated evidence is written to `generated/` and excluded from Git because it is reproducible from the canonical graph.

## Architecture

```text
Brief
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
packages/intent-interpreter GPT-5.6 structured brief interpretation
packages/proof-report/      end-to-end proof orchestration and golden sample
examples/preview-ios/       buildable iOS Swift package harness
```

## Build Week

Submission closes **July 21, 2026 at 5:00 PM PT**. IntentForm is entered in Developer Tools. The repository is Apache-2.0 and provides a free replay path for judges. The Devpost Hackathons plugin is optional; the official rules, FAQ and submission requirements remain the authority.

- [Build Week](https://openai.devpost.com/)
- [Official rules](https://openai.devpost.com/rules)
- [Request the official $100 Codex credit grant](https://forms.gle/rP8WJgk4D2zQEu1A6) by July 17 at 12:00 PM PT

## Product direction

The full product is local-first and Expo Adaptive-first, with SwiftUI as the reference native renderer. Planned layers include direct semantic manipulation, native preview daemons, Expo iOS/Android, standalone Compose and web, MCP, operation-log-based Git workflows, repository adoption through managed zones, and optional collaboration cloud. No production app requires an IntentForm runtime.

## License

Apache-2.0. See [LICENSE](LICENSE).
