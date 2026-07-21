# IntentForm submission video

Use this as the recording script for the OpenAI Build Week submission. The goal is a clear product walkthrough, not a general launch trailer: show what IntentForm is, what it does, how it works, and how Codex with GPT-5.6 contributed.

## Recording target

- Aim for **2:35–2:45**; the hard limit is three minutes.
- Use Francesco's real voice throughout. Show full camera for the opening 6–8 seconds and, optionally, the final 3 seconds.
- Record the product at 1440 × 960 or 1920 × 1080 with browser zoom at 100%.
- Keep the pointer calm, hide notifications and unrelated tabs, and avoid scrolling while speaking.
- Use captions and restrained zooms or callouts only when they make the demonstrated state easier to see.
- Start from [Judge Mode](https://intentform-amber.vercel.app/studio?judge=1&step=design), then use **Examples → Aster Sound** for the richer multi-device sequence.

## Run of show and voiceover

### 0:00–0:08 — What this is

**Picture:** Francesco on camera. Cut directly to Aster Sound on the final word.

**Say:**

> One product decision shouldn't become four platform rewrites. I built IntentForm so product intent—not generated code—stays the source of truth.

### 0:08–0:42 — What it does

**Picture:** Show Aster Sound across desktop, tablet, and phone. Select a semantic container, make one layout change, and show the projections update together.

**Say:**

> IntentForm is a local-first product design and verification environment. I describe a product once as a semantic graph: its screens, components, tokens, layout relationships, states, and interactions. Here, the same Aster Sound intent drives desktop, tablet, and phone projections. When I change a semantic layout relationship, every projection updates from the same underlying decision.

### 0:42–1:13 — How it produces multiple targets

**Picture:** Switch to Code. Show the target picker, briefly reveal Web, React, Expo, and SwiftUI, then pause on readable React output and its running preview. Keep the fingerprint or diagnostics visible.

**Say:**

> That graph—not a screenshot—is compiled into deterministic Web, React, Expo, and SwiftUI outputs. The generated files remain readable, and every target links back to the semantic node that produced it. Platform differences stay explicit, while shared product intent remains synchronized.

### 1:13–1:43 — How evidence works

**Picture:** Switch to Verify. Show Runtime Parity, accessibility evidence, a fingerprint, and one stale or not-run state. Open one finding with its exact node and property path.

**Say:**

> IntentForm also separates a plausible preview from current evidence. Runtime parity, accessibility checks, target builds, and responsive findings are bound to fingerprints. If the graph changes, old proof becomes stale instead of silently passing. A finding identifies the exact node, property, viewport, and expected relationship.

### 1:43–2:05 — How agent review stays bounded

**Picture:** Preview one repair. Show its semantic diff and scope, approve it, then rerun the affected verification. Do not wait on screen for a model call; use the deterministic Judge Mode replay.

**Say:**

> Agent changes use the same contract. A repair arrives as a bounded semantic transaction, with an exact diff and fingerprint. I can approve, reject, revert, or replay it. After approval, IntentForm independently reruns the affected check, so the agent never grades its own work.

### 2:05–2:31 — How Codex and GPT-5.6 were used

**Picture:** Keep the proof/result visible. Overlay four short labels as they are mentioned: architecture, tests, verification, constrained judgment.

**Say:**

> I used Codex with GPT-5.6 for architecture, implementation, test authoring, browser and native verification, and release audits. Inside IntentForm, GPT-5.6 handles ambiguous brief interpretation and constrained repair judgment, while schemas, compilers, fingerprints, history, and rollback remain deterministic. Codex helped me challenge those boundaries across the repository and build the evidence paths you just saw.

### 2:31–2:41 — Close

**Picture:** Return to the synchronized Aster Sound frames or a minimal branded end card. Optionally return to camera for the final sentence.

**Say:**

> One intent, multiple native outputs, current evidence. IntentForm doesn't translate pixels. It preserves product intent.

## Capture checklist

Before recording:

- Close private projects and unrelated tabs; enable Do Not Disturb.
- Confirm Judge Mode works in a logged-out browser and requires no credential.
- Reset the replay, preload Aster Sound, and rehearse the exact selections once.
- Confirm the microphone is clear, the pointer is visible, and text remains legible at the final export size.
- Record the camera hook separately so a product-demo mistake does not require repeating it.
- Capture one clean product pass and one safety pass.

Before submission:

- Export at 1080p, H.264, with normalized and clearly audible speech.
- Add accurate burned-in or platform captions; check technical terms such as SwiftUI, Expo, fingerprints, and GPT-5.6.
- Remove pauses, loading waits, accidental hover states, and repeated claims.
- Keep the final runtime below three minutes, including any title or end card.
- Upload as public or unlisted, then verify video and audio in a logged-out window.
- Paste the final URL into Devpost and the README only after the owner approves the cut.

## Editing rule

Prefer evidence over spectacle. Motion design should clarify a feature already on screen—such as a short zoom on a fingerprint or a label over a compiler target—not replace the walkthrough. Avoid an AI avatar, synthetic presenter, long logo animation, music that competes with the voice, or claims that are not visible in the captured build.
