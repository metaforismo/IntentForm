// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "IntentFormPreview",
    platforms: [.iOS(.v17)],
    products: [.library(name: "IntentFormPreview", targets: ["IntentFormPreview"])],
    targets: [.target(name: "IntentFormPreview")]
)
