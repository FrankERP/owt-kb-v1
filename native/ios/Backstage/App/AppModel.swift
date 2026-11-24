import AuthenticationServices
import Foundation
import Observation
import SwiftUI

/// The app's one piece of state: who is signed in, and what the screen should say.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case starting
        case signedOut(notice: String?)
        case signingIn
        case signedIn(Me)
        /// Could not reach the server at launch while holding a session: offer a retry, keep it.
        case offline
    }

    private(set) var phase: Phase = .starting
    /// A passing problem shown over the signed-in screen («No hay conexión»…).
    var banner: String?

    let config: AppConfig
    private let authority: SessionAuthority
    private let api: APIClient

    init(config: AppConfig, store: TokenStoring, transport: HTTPTransport) {
        self.config = config
        authority = SessionAuthority(config: config, store: store, transport: transport)
        api = APIClient(config: config, authority: authority, transport: transport)
    }

    static func live() -> AppModel {
        AppModel(config: .current, store: KeychainTokenStore(), transport: URLSessionTransport())
    }

    // MARK: Launch

    func start() async {
        let hasSession: Bool
        do {
            hasSession = try await authority.restore()
        } catch {
            // The Keychain could not answer (e.g. the phone was not unlocked yet): not signed out.
            phase = .offline
            banner = "No se pudo abrir tu sesión todavía. Intenta de nuevo."
            return
        }
        guard hasSession else {
            phase = .signedOut(notice: nil)
            return
        }
        await reload()
    }

    func reload() async {
        do {
            let me = try await api.me()
            banner = nil
            phase = .signedIn(me)
        } catch {
            show(error)
        }
    }

    // MARK: Sign-in

    /// One sign-in: a fresh verifier and state, the server's page in an ephemeral browser session
    /// (the person signs in and taps «Entrar a la app»), then the code exchange.
    func signIn(using session: WebAuthenticationSession) async {
        guard phase != .signingIn else { return }
        phase = .signingIn
        let verifier = PKCE.makeVerifier()
        let state = PKCE.makeState()
        do {
            let callbackURL = try await session.authenticate(
                using: authorizeURL(challenge: PKCE.challenge(for: verifier), state: state),
                callback: callback,
                preferredBrowserSession: .ephemeral,
                additionalHeaderFields: [:]
            )
            switch AuthCallback.parse(callbackURL, expectedState: state, expectedIssuer: config.issuer) {
            case .code(let code):
                try await authority.exchange(code: code, verifier: verifier)
                // Signed in from here on: a failure loading the profile is «try again», never the
                // sign-in screen (a second sign-in would leave this grant behind).
                phase = .starting
                await reload()
            case .denied:
                phase = .signedOut(notice: nil)
            case .invalid:
                phase = .signedOut(notice: "No se pudo terminar de entrar. Intenta de nuevo.")
            }
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            phase = .signedOut(notice: nil)
        } catch SessionError.signedOut {
            // The code was refused (it lives 60 s, and is good once).
            phase = .signedOut(notice: "No se pudo terminar de entrar. Intenta de nuevo.")
        } catch {
            show(error)
        }
    }

    func signOut() async {
        await authority.signOut()
        banner = nil
        phase = .signedOut(notice: nil)
    }

    // MARK: Helpers

    private var callback: ASWebAuthenticationSession.Callback {
        if let host = config.callbackHost {
            return .https(host: host, path: "/app/callback/ios")
        }
        return .customScheme(AppConfig.localScheme)
    }

    func authorizeURL(challenge: String, state: String) -> URL {
        var components = URLComponents(url: config.url(config.authorizePath), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: AppConfig.clientID),
            URLQueryItem(name: "redirect_uri", value: config.redirectURI),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
        ]
        return components.url!
    }

    private func show(_ error: Error) {
        let sessionError: SessionError
        if let e = error as? SessionError {
            sessionError = e
        } else if let api = error as? APIError {
            switch api {
            case .session(let e): sessionError = e
            case .forbidden: sessionError = .server(status: 403)
            case .decoding: sessionError = .server(status: 0)
            }
        } else {
            sessionError = .server(status: 0)
        }

        switch sessionError {
        case .signedOut:
            phase = .signedOut(notice: nil)
        case .accountDisabled:
            phase = .signedOut(notice: "Tu acceso está desactivado. Habla con un administrador.")
        case .network, .unavailable, .server:
            let message = sessionError == .network
                ? "No hay conexión. Revisa tu internet e intenta de nuevo."
                : "Backstage no responde en este momento. Intenta de nuevo en un rato."
            switch phase {
            case .signedIn:
                banner = message
            case .signingIn:
                phase = .signedOut(notice: message)
            default:
                phase = .offline
                banner = message
            }
        }
    }
}
