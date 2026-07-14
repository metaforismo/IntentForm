# Native Simulator evidence

IntentForm keeps native rendering claims separate from compiler and build claims. The SwiftUI evidence adapter reads a real foreground Simulator app rather than inferring geometry from generated source.

## Workflow

1. Generate and build the Swift package:

   ```bash
   pnpm verify:swiftui
   ```

2. Boot an iPhone Simulator and launch `IntentFormPreviewRoot` from `examples/preview-ios` using Xcode previews or a SwiftUI preview host.

3. Start `serve-sim` for that exact Simulator UDID. It supplies the framebuffer stream and `/ax` accessibility endpoint:

   ```bash
   npx --yes serve-sim@latest <UDID>
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

## Current boundary

The macOS CI job compiles generated SwiftUI with `xcodebuild`. Native screenshot and accessibility capture are currently a reproducible local gate because hosted preview-host launch is not yet automated. A build pass must not be presented as native render evidence, and a local native capture must not be presented as a hosted-CI result.
