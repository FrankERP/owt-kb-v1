import Foundation

/// Where the app signs in and which redirect it presents (ADR-0091, `app/appAuth/clients.ts`).
///
/// The server accepts exactly ONE redirect per client on a deployed origin, the verified
/// `https` callback `<origin>/app/callback/ios`, and the private-use scheme only on the local
/// origin (`next dev`). The origin comes from the build configuration (`BackstageOrigin` in
/// Info.plist): Debug talks to localhost, Release to production.
struct AppConfig: Sendable, Equatable {
    static let clientID = "backstage-ios"
    static let localScheme = "app.vercel.owt-backstage"
    static let localOrigin = "http://localhost:3000"
    static let productionOrigin = "https://owt-backstage.vercel.app"

    /// The origin without a trailing slash, exactly as the server spells its own.
    let origin: String

    init(origin: String) {
        var trimmed = origin
        while trimmed.hasSuffix("/") { trimmed.removeLast() }
        self.origin = trimmed
    }

    static let current: AppConfig = {
        let configured = Bundle.main.object(forInfoDictionaryKey: "BackstageOrigin") as? String
        return AppConfig(origin: configured.flatMap { $0.isEmpty ? nil : $0 } ?? productionOrigin)
    }()

    var isLocal: Bool { origin == Self.localOrigin }

    /// The exact string the server compares, both at `/app/authorize` and at the token exchange.
    var redirectURI: String {
        isLocal ? "\(Self.localScheme):/oauth/callback/ios" : "\(origin)/app/callback/ios"
    }

    /// The host of the verified callback (Release), or nil on the local origin.
    var callbackHost: String? { isLocal ? nil : URL(string: origin)?.host() }

    /// The `iss` the server puts on every authorization response (RFC 9207): its own origin.
    var issuer: String { origin }

    func url(_ path: String) -> URL {
        // `path` is always a literal under our control ("/api/app/v1/me"), so a failure here is a
        // programming error, not a runtime condition.
        guard let url = URL(string: origin + path) else { preconditionFailure("bad path \(path)") }
        return url
    }

    var authorizePath: String { "/app/authorize" }
    var tokenURL: URL { url("/api/app/v1/auth/token") }
    var revokeURL: URL { url("/api/app/v1/auth/revoke") }
}
