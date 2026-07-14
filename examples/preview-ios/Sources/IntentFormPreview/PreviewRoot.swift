import SwiftUI

public struct IntentFormPreviewRoot: View {
    public init() {}

    public var body: some View {
        GeneratedIntentFormApp(initialScreen: "payment-request")
    }
}

#Preview("Payment request · compact") {
    IntentFormPreviewRoot()
}
