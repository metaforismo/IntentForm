import SwiftUI

public struct IntentFormPreviewRoot: View {
    public init() {}

    public var body: some View {
        NavigationStack {
            PaymentRequestScreen(
                data: PaymentRequestScreenData(),
                events: PaymentRequestScreenEvents()
            )
        }
    }
}

#Preview("Payment request · compact") {
    IntentFormPreviewRoot()
}
