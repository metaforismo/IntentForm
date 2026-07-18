<p align="center">
  <img src="apps/studio-web/public/brand/intentform-mark.png" width="104" alt="IntentForm mark: freeform intent resolving into structured interface rows" />
</p>

<h1 align="center">IntentForm</h1>

<p align="center"><strong>Intent becomes structured interface.</strong></p>

<p align="center">
  <a href="https://github.com/metaforismo/IntentForm/actions/workflows/ci.yml"><img src="https://github.com/metaforismo/IntentForm/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache-2.0 license" /></a>
  <img src="https://img.shields.io/badge/local--first-no%20account-58bd88" alt="Local-first, no account required" />
</p>

IntentForm is an open-source, local-first design environment where people and coding agents edit the same validated Semantic Interface Graph. It compiles that graph into readable React, responsive Web, Expo, and SwiftUI, then verifies each target against current evidence instead of treating generation as proof.

![IntentForm showing the Aster Sound semantic source across synchronized desktop, tablet, and phone frames](docs/assets/readme/aster-showcase.png)

**One-minute version:** edit intent directly on the canvas, let an agent propose a bounded semantic transaction, review the exact diff, compile the accepted graph into Web, React, Expo, or SwiftUI, and verify each target against evidence bound to the current fingerprint.

## Why IntentForm exists

Prompt-to-code tools usually bury design intent inside generated files. Traditional design tools usually stop before implementation. IntentForm keeps product intent as canonical, typed data between both worlds:

```text
Human canvas edits ─┐
                    ├─> validated Semantic Interface Graph
Agent transactions ─┘              │
                                    ├─> React compiler ─> runnable app
                                    ├─> Web compiler ───> DOM/CSS runtime
                                    ├─> Expo compiler ──> iOS/Android export
                                    └─> SwiftUI compiler > native build/render
```

Generated files are integration artifacts, not the source of truth. Every accepted mutation is schema-validated, fingerprint-bound, attributable, reversible, and represented as a semantic diff.

![IntentForm project launcher with local projects, agent status, and working examples](docs/assets/readme/launcher.png)

## Product today

| Area | Available now |
| --- | --- |
| Projects | Durable IndexedDB catalog, typed loading/error/no-project boot, six preserved project types, create/import/open, visual previews, search, grid/list views, folders, tags, rename, archive, last-saved recovery, migrations, multi-document tabs, dirty-close flows, and cross-window revision protection |
| Canvas | Infinite board, recursive layers, mixed selection, eight resize handles, rotation, snapping, keyboard movement, grouping, duplication, nested reparenting, conflict-safe inline text editing with IME/RTL support, context menus, clipboard and style clipboard, comments, flow preview, device chrome, and synchronized multi-device comparison |
| Layout | Stack, frame, list, grid tracks and span, wrap, overlay, split, scroll, safe area, adaptive, and freeform relations with deterministic layout indexes |
| Design systems | Components, instances, variants, states, slots, overrides, detach/reset, DTCG token modes, searchable token binding, licensed assets with integrity recovery, image placement, and SVG paint editing |
| Web workflows | Responsive frames and breakpoints, generated DOM/CSS runtime, sandboxed HTML/CSS import through computed styles, explicit unsupported-property diagnostics, and source-to-canvas navigation |
| Native output | Deterministic React, Web, Expo Router, and SwiftUI compilers with readable generated files and target capability diagnostics |
| Agents | Local setup center for Codex, Claude Code, OpenCode, Pi, and generic MCP; dry-run configuration plans, local capability status, read-only default, exact file/page/selection scope, preview/commit/reject/revert transactions, semantic diffs, comments, history, checkpoints, and rollback |
| Evidence | Stable-ID Runtime Parity for generated Web output, stale-result rejection, unit and integration tests, accessibility profiles, Playwright production smoke, responsive runtime checks, Expo iOS/Android exports, SwiftUI builds and Simulator accessibility/screenshots, desktop packaging, and a 10,000-node benchmark |

## Design, Code, Verify

The product has three primary workspaces instead of a generation wizard:

- **Design** keeps the semantic canvas, recursive layers, direct manipulation, properties, responsive projections, comments, and prototype flows in one editor.
- **Code** shows deterministic target files beside the running projection, with exact node links and fresh build evidence.
- **Verify** keeps semantic, responsive, accessibility, browser, Expo, SwiftUI, and desktop evidence separate by target and fingerprint.

Code’s **Parity** evidence view compares canonical semantic nodes with the actual generated Web DOM through compiler-authored stable IDs. It measures visibility, accessible names, semantic order, target size, clipping, and active-device placement without pixel matching or adding an IntentForm runtime to production output. Results become stale as soon as the graph, compiler output, target, or profile changes. React is explicitly labeled as an instant projection; Expo and SwiftUI never show runtime parity without real runtime/native evidence.

![IntentForm Design workspace with semantic layers, direct selection, prototype flow, and inspector](docs/assets/readme/design-workspace.png)

The editor chrome is deliberately neutral. Blue is reserved for selection and editing, green for connected or verified state, and the authored project keeps its own visual identity.

## Judge demo

[Judge Mode](https://intentform-amber.vercel.app/studio?judge=1&path=overview&step=design) is an isolated, deterministic replay with no login, API key, account, or model call. It now offers two explicit paths:

- **90-second overview** — compare Aster Sound across three devices, inspect a bounded agent transaction, follow generated Web code back to semantic nodes, collect live runtime parity evidence, and finish on reproducible proof.
- **4-minute hands-on** — edit the validated Verdant Pay graph, review an agent transaction, compile target output, preview and apply a bounded repair, verify again, and reset.

Both paths tell the same product story: intent is canonical; the agent proposes a transaction; the compiler generates code; runtime evidence verifies the result. Deep links, refreshes, path switching, and reset remain deterministic, and Judge Mode never changes the durable project catalog.

![Judge Mode 90-second overview showing Aster Sound generated Web code and current runtime parity evidence](docs/assets/readme/judge-overview.png)

For the richer product tour, open **Examples → Aster Sound**. It includes original graph-native artwork, desktop/tablet/phone frames, components, token modes, prototype navigation, loading/empty/error/success states, and a comment linked to an agent transaction.

![Aster Sound review thread with a fingerprint-bound Codex transaction linked to the selected playback flow](docs/assets/readme/agent-review.png)

## Quick start

Requirements:

- Node.js 22 or newer
- pnpm 10.28.0
- Chromium for browser smoke tests
- Xcode command-line tools for SwiftUI and macOS verification

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:3000`, create a project or copy an example, then enter Studio. Core editing, compilation, deterministic replay, and local agent workflows require no account, hosted service, model call, or paid MCP allowance.

Focused checks:

```bash
pnpm typecheck
pnpm test
pnpm benchmark:large-doc
pnpm build
pnpm smoke:studio
pnpm verify:web-preview
pnpm verify:expo-preview
pnpm verify:swiftui
pnpm verify:swiftui-render
pnpm verify:desktop
```

The complete portable gate is `pnpm verify`; native and desktop gates run separately where their platform toolchains are available.

## The project format

An `.intentform` project is canonical JSON validated by the versioned semantic schema. It includes:

- product intent and principles;
- tokens, modes, aliases, and deprecations;
- assets with explicit export and license policy;
- component definitions, variants, slots, instances, and overrides;
- screens, recursive semantic nodes, layout relations, states, contracts, fixtures, and flows;
- platform, breakpoint, device, and preview profiles;
- optional ecosystem, history, review, and collaboration metadata.

Serialized size, graph depth, child count, stable IDs, expressions, components, assets, frames, breakpoints, and patch operations are bounded and fail closed. Migrations are explicit and fixture-backed. Stable serialization produces canonical fingerprints used by compilers, evidence, history, and agent transactions.

## Agent-native workflow

IntentForm does not give agents a privileged path around the editor. Studio and MCP use the same graph validation, project revisions, semantic diff, compilation, and verification operations.

Print an MCP configuration plan without modifying a client:

```bash
pnpm mcp:install --client codex
pnpm mcp:install --client claude
pnpm mcp:install --client opencode
pnpm mcp:install --client pi
```

Use `--project /absolute/path/to/project` when necessary. Add `--apply` only after reviewing the plan. Existing client configuration is not replaced without confirmation and a timestamped backup.

New connections are read-only. Semantic writes require the explicit `INTENTFORM_MCP_PERMISSION=write` environment setting. Tools cover project inspection, graph search, typed patches, components, tokens, assets, branches, history, compile, verify, preview, accessibility, packages, review, checkpoint, diff, revert, and transactions. Successful operations report project, file, tab, page, device, visual state, selection, affected node paths, and fingerprints.

![IntentForm Code workspace with a running projection, generated source, and exact build evidence](docs/assets/readme/code-and-evidence.png)

## Compilation and verification

IntentForm separates these states:

1. Graph accepted by the schema.
2. Target source generated deterministically.
3. Generated project built successfully.
4. Runtime or native frame inspected against exact fingerprints.
5. Evidence verdict produced for the active target and profile.

The Studio Code workspace provides a virtualized, syntax-aware source viewer with search, exact node links, copy context, and source-to-canvas navigation. Verify groups semantic, responsive, accessibility, browser, Expo, SwiftUI, and desktop evidence without pretending that one target proves another.

![Runtime Parity comparing Aster Sound's canonical semantic nodes with the generated Web runtime](docs/assets/readme/runtime-parity.png)

CI runs typecheck, the complete test suite, the 10,000-node benchmark, production builds, Web runtime smoke, Expo exports for iOS and Android, the full Studio browser matrix, checked-in preview drift checks, SwiftUI native build/render evidence, and the hardened macOS desktop package. GitHub Actions are pinned to immutable commits.

The large-document gate measures serialization, open/index/edit/diff/layout/codegen work, pan and zoom queries, bounded cache retention, and a deterministic simulated 60-minute session. Browser smoke also covers interrupted catalog recovery, multi-window conflicts, reload restoration, reduced motion, RTL, forced colors, 200% text, compact and tablet layouts, and request races.

## Architecture

```text
apps/
  studio-web/          launcher, editor, isolated previews, local APIs
  studio-desktop/      hardened Electron shell and local services
  react-preview/       generated React evidence harness
  web-preview/         generated responsive DOM/CSS harness
  expo-preview/        generated Expo Router export harness
packages/
  semantic-schema/     canonical graph, migrations, patches, diffs
  layout-engine/       deterministic neutral layout relations
  compiler-*/          React, Web, Expo, and SwiftUI backends
  device-registry/     logical and checksummed precision profiles
  mcp-server/          scoped resources, tools, transactions, transports
  verifier/            semantic and target evidence rules
scripts/               smoke, benchmark, native render, sync, installer gates
```

IntentForm owns interface structure, tokens, navigation intent, visual state, typed data and event contracts, accessibility, compilation, and verification. It does not own backend behavior, authentication, payments, deployment, or arbitrary application logic.

Compilers remain deterministic: the same graph and compiler version produce byte-identical files. Restricted expressions cannot contain arbitrary JavaScript. Platform backends lower shared intent to native primitives and disclose unsupported relations rather than silently inventing them.

## Security and local-first boundaries

- Project and revision state stays local by default.
- Browser projects use IndexedDB, atomic revisions, project-scoped locks, recovery checkpoints, and explicit conflict errors.
- HTTP MCP binds to loopback and requires a private token.
- New agent clients receive read-only tools unless write access is explicitly granted.
- Graph patches are bounded, validated, fingerprint-checked, atomic, and reversible.
- Generated previews are isolated; imported HTML/CSS runs in a sandboxed browser document.
- Asset, package, bezel, plugin, review, and collaboration inputs are path-, checksum-, signature-, and size-checked.
- Logs exclude authored content, credentials, tokens, generated output, and machine-specific paths.
- The semantic MCP surface exposes no arbitrary shell, filesystem, or network operation.
- Production responses enforce content security, framing, permission, referrer, and content-type policies.
- The desktop package includes the project Apache license and NOTICE beside Electron/Chromium legal material.

Optional live-model operations are server-side, bounded, schema-validated, cancelled on deadline, and redacted to request metadata. Deterministic replay remains available without credentials. Public deployments should remain replay-first until quotas are durable across instances.

Report security issues privately through [GitHub Security Advisories](https://github.com/metaforismo/IntentForm/security/advisories/new). Do not open a public issue for credential exposure, code execution, quota bypass, or supply-chain findings. IntentForm is pre-release software and should not process production financial or personal data.

## Deployment

The repository deploys from the monorepo root. `vercel.json` uses the frozen lockfile and the same production build used locally.

```bash
vercel deploy
vercel deploy --prod
```

Run the browser matrix against a deployed revision with:

```bash
STUDIO_ORIGIN=https://your-deployment.example pnpm smoke:studio
```

A deployment is not considered public merely because its build is ready; verify from a clean browser that team SSO or deployment protection does not intercept the product. Keep `OPENAI_API_KEY` unset for the replay-first public baseline unless a durable shared quota and provider spend limit are configured.

## Honest boundaries and roadmap

IntentForm is not a Figma clone, a screenshot-to-code service, or a promise of pixel-identical output across platforms. Native UI has platform-specific navigation, accessibility, text scaling, keyboard, safe-area, and control behavior. The product preserves shared intent while allowing explicit platform expressions.

Current high-value work still includes:

- directory-backed catalog sync and richer filesystem workflows;
- multi-range rich-text authoring, deeper bidirectional layout controls, and variable-font axis editing;
- destructive crop, vector-pen, and SVG geometry workflows beyond the current non-destructive image framing and SVG paint controls;
- broader CSS compatibility and editable HTML/CSS round-trip coverage;
- code-component registration and library update review;
- a deterministic Compose backend;
- multi-user presence and hosted verification workers;
- continuing canvas-to-output layout fidelity work across font metrics and platform-native measurement.

## OpenAI Build Week

IntentForm was developed for the 2026 OpenAI Build Week Developer Tools track. The work is intentionally split between probabilistic judgment and deterministic product infrastructure:

- **Codex** accelerated implementation, repository-wide audits, focused refactors, test authoring, browser/native verification, failure diagnosis, and release review.
- **GPT-5.6** is used only where ambiguity is useful: interpreting a brief or proposing a constrained repair. Its output must satisfy the typed schema and graph invariants before it can become a reviewable transaction.
- **Deterministic code** owns migrations, fingerprints, diffs, compilers, evidence binding, history, and rollback. GPT-5.6 does not emit the production source files.
- **Human decisions** retained authority over product scope, interaction and visual direction, architecture boundaries, acceptance criteria, transaction approval, and every external publication step.

The dated Git history preserves the build sequence from the canonical graph and compilers through the professional editor, durable catalog, Judge Mode, exact Code/Verify journeys, and Aster showcase. The public demo video is **not published yet**; it will be linked here after the owner records and approves the final sub-three-minute walkthrough. No Devpost submission or release is performed by repository automation.

## Contributing

Keep changes narrow, deterministic, reversible, and test-backed.

1. Create a focused branch and use a conventional commit subject.
2. Add schema changes through explicit migrations and fixture coverage.
3. Never edit generated output as the canonical source.
4. Run targeted tests first, then the applicable release gates.
5. Explain the preserved intent, affected compiler targets, verification, and honest limitations in the pull request.
6. Never commit secrets, machine-specific paths, local output, private notes, DerivedData, or simulated evidence presented as real.

Changing UI labels, roles, or test IDs requires updating the production smoke matrix in the same change. Compiler output must not depend on timestamps, randomness, or ambient environment state.

## License

IntentForm is licensed under [Apache-2.0](LICENSE). See [NOTICE](NOTICE) for attribution details.
