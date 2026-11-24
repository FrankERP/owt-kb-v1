import Foundation

/// What the browser handed back on the redirect (`/app/authorize/submit` → 303).
enum AuthCallbackResult: Equatable {
    /// The person tapped «Entrar a la app»: exchange this code now (it lives 60 s).
    case code(String)
    /// The person tapped «Cancelar» (`error=access_denied`).
    case denied
    /// Anything else. Never exchanged: a callback we did not start, a state or issuer mismatch,
    /// or a server-side refusal (`invalid_request`, …).
    case invalid
}

enum AuthCallback {
    /// Reads the redirect against the ONE pending sign-in (MOBILE.md: «ignore any callback
    /// without a matching pending state and verifier»). The issuer is checked too (RFC 9207), so a
    /// response minted by another origin is never redeemed here.
    static func parse(_ url: URL, expectedState: String, expectedIssuer: String) -> AuthCallbackResult {
        guard let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else {
            return .invalid
        }
        func single(_ name: String) -> String? {
            let values = items.filter { $0.name == name }.compactMap(\.value)
            return values.count == 1 ? values[0] : nil
        }
        guard single("state") == expectedState, single("iss") == expectedIssuer else { return .invalid }
        if let error = single("error") {
            return error == "access_denied" ? .denied : .invalid
        }
        guard let code = single("code"), !code.isEmpty else { return .invalid }
        return .code(code)
    }
}
