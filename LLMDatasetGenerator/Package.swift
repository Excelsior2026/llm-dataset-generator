// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "LLMDatasetGenerator",
    defaultLocalization: "en",
    platforms: [
        .macOS(.v12)
    ],
    products: [
        .executable(
            name: "LLMDatasetGenerator",
            targets: ["LLMDatasetGenerator"]
        ),
        .library(
            name: "LLMDatasetGeneratorCore",
            targets: ["LLMDatasetGeneratorCore"]
        )
    ],
    dependencies: [
        // Vapor for web backend (replacing Express.js)
        .package(url: "https://github.com/Vapor/Vapor.git", from: "4.0.0"),
        .package(url: "https://github.com/Vapor/RoutableRoutes.git", from: "0.5.0"),
        // SwiftNIO for async networking
        .package(url: "https://github.com/apple/swift-nio.git", from: "2020.12.0"),
        // JSON parsing
        .package(url: "https://github.com/VeniceX/SwiftyJSON.git", from: "6.0.0"),
        // API client for Gemini
        .package(url: "https://github.com/Moya/Moya.git", from: "15.0.0"),
        // Combine for reactive programming
        .package(url: "https://github.com/apple/swift-combined.git", from: "1.0.0"),
        // Custom URLSession wrapper
        .package(url: "https://github.com/onemykho/swift-urlsession.git", from: "1.0.0"),
    ],
    targets: [
        // MARK: - Application Target
        .executableTarget(
            name: "LLMDatasetGenerator",
            dependencies: [
                "LLMDatasetGeneratorCore",
                .product(name: "Vapor", package: "vapor"),
                .product(name: "RoutableRoutes", package: "routable-routes"),
                .product(name: "SwiftyJSON", package: "swiftyjson"),
                .product(name: "Moya", package: "moya"),
                "URLSessionWrapper",
            ],
            path: "Sources/LLMDatasetGenerator"
        ),
        
        // MARK: - Core Framework
        .target(
            name: "LLMDatasetGeneratorCore",
            dependencies: [
                "SwiftyJSON",
                "URLSessionWrapper",
                .product(name: "CombineFoundation", package: "swift-combined"),
            ],
            path: "Sources/LLMDatasetGeneratorCore"
        ),
        
        // MARK: - URLSession Wrapper
        .target(
            name: "URLSessionWrapper",
            dependencies: [
                .product(name: "NIOFoundation", package: "swift-nio"),
                .product(name: "NIOWebSocket", package: "swift-nio"),
            ],
            path: "Sources/Support/URLSessionWrapper"
        ),
        
        // MARK: - Testing
        .testTarget(
            name: "LLMDatasetGeneratorTests",
            dependencies: [
                "LLMDatasetGeneratorCore",
                .product(name: "XCTest", package: "swift-foundation"),
            ],
            path: "Tests/LLMDatasetGeneratorTests"
        ),
    ],
    // Swift compiler settings
    swiftLanguageVersions: [.v5]
)