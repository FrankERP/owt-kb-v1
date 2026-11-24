import CryptoKit
import Foundation
import Security

/// PKCE (RFC 7636, S256 only — the server refuses any other method) and the `state` value.
enum PKCE {
    /// 32 random bytes as base64url: 43 characters from the unreserved set RFC 7636 allows.
    static func makeVerifier() -> String { randomToken(byteCount: 32) }

    /// `BASE64URL(SHA256(ASCII(verifier)))`, no padding.
    static func challenge(for verifier: String) -> String {
        Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncoded
    }

    /// The `state` round-tripped through the browser: 43 visible ASCII characters, inside the
    /// server's 16–256 range (`STATE_RE` in `app/appAuth/authorizeRequest.ts`).
    static func makeState() -> String { randomToken(byteCount: 32) }

    static func randomToken(byteCount: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes)
        // A failing system RNG is not something to work around: a guessable verifier or state
        // would defeat the very checks they exist for.
        precondition(status == errSecSuccess, "SecRandomCopyBytes failed: \(status)")
        return Data(bytes).base64URLEncoded
    }
}

extension Data {
    var base64URLEncoded: String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
