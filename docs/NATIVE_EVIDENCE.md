# Native Simulator evidence

IntentForm keeps native rendering claims separate from compiler and build claims. The SwiftUI evidence adapter reads a real foreground Simulator app rather than inferring geometry from generated source.

## Workflow

1. Generate and build the Swift package:

   ```bash
   pnpm verify:swiftui
   ```

2. Run the fully automated adapter:

   ```bash
   pnpm verify:swiftui-render
   ```

   It selects an available iPhone Simulator, boots it when necessary, builds the versioned host under `examples/native-preview-app`, installs and launches the app, starts the pinned `serve-sim` helper, captures evidence and cleans up every process and device it started.

For targeted local inspection, boot a specific Simulator and launch `IntentFormPreviewRoot` from `examples/preview-ios` using Xcode previews or a SwiftUI preview host.

3. Start `serve-sim` for that exact Simulator UDID. It supplies the framebuffer stream and `/ax` accessibility endpoint:

   ```bash
   pnpm exec serve-sim <UDID>
   ```

4. Capture and verify the foreground native frame:

   ```bash
   INTENTFORM_SIMULATOR_UDID=<UDID> pnpm capture:swiftui-evidence
   ```

The command fails unless the accessibility tree contains an enabled native button with identifier `intentform.payment-request.confirm`. It records:

- native application viewport in points;
- primary-action bounds in points;
- accessibility label, type, enabled state and stable identifier;
- Simulator screenshot path, pixel dimensions and SHA-256;
- rendered reachability findings and final verdict.

Artifacts are written to `artifacts/swiftui/` and intentionally ignored by Git. CI artifacts, not source control, are the intended durable evidence channel.

## CI contract

The macOS job first performs the generic Swift package build, then runs `verify:swiftui-render` on a clean available iPhone Simulator. The job fails if the host cannot build or launch, the semantic action is absent from accessibility, its native target is too small or outside the viewport, the screenshot is invalid, or cleanup does not complete normally. GitHub uploads `artifacts/swiftui/` as `swiftui-native-evidence`.

Pixel-level React-to-SwiftUI comparison remains out of scope: the current verifier compares semantic reachability, native bounds and accessibility rather than demanding identical pixels across platforms.
