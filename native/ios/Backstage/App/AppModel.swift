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

    /// The «Próximos servicios» list on the home screen.
    enum Services: Equatable {
        case loading
        case loaded(today: String, services: [AppService])
        /// `403`: the person is not in Alabanza (a Jóvenes or Kids member): no list, no error.
        case notInWorship
        /// The first load failed; a later failure keeps the last list and shows the banner.
        case failed(String)
    }

    private(set) var phase: Phase = .starting
    private(set) var services: Services = .loading
    /// When the list last loaded, so coming back to the app refreshes a list left from another day.
    private var servicesLoadedAt: Date?
    /// The last `today` the server sent, so a service page left open keeps its countdown while
    /// the list reloads or fails.
    private(set) var lastToday = ""
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
            return
        }
        await loadServices()
    }

    /// Loads the upcoming services. A session that ended goes to the sign-in screen as anywhere
    /// else; a passing failure keeps the list already on screen and says so in the banner.
    func loadServices() async {
        do {
            let answer = try await api.services()
            services = .loaded(today: answer.today, services: answer.services)
            lastToday = answer.today
            servicesLoadedAt = Date()
        } catch APIError.forbidden {
            services = .notInWorship
        } catch {
            let cause = Self.sessionError(from: error)
            switch cause {
            case .signedOut, .accountDisabled:
                show(cause)
            case .network, .unavailable, .server:
                if case .loaded = services {
                    banner = Self.message(for: cause)
                } else {
                    services = .failed(Self.message(for: cause))
                }
            }
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

    /// The app came back to the foreground: reload a list older than ten minutes, so «Hoy» and
    /// the setlist never stay from the day the app was last opened.
    func refreshIfStale() async {
        guard case .signedIn = phase,
              let loadedAt = servicesLoadedAt,
              Date().timeIntervalSince(loadedAt) > 600
        else { return }
        await reload()
    }

    /// «Intentar de nuevo» after a failed first load: show the spinner while it tries.
    func retryServices() async {
        services = .loading
        await loadServices()
    }

    func signOut() async {
        await authority.signOut()
        banner = nil
        services = .loading
        servicesLoadedAt = nil
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

    private static func sessionError(from error: Error) -> SessionError {
        if let e = error as? SessionError { return e }
        if let api = error as? APIError {
            switch api {
            case .session(let e): return e
            case .forbidden: return .server(status: 403)
            case .decoding: return .server(status: 0)
            }
        }
        return .server(status: 0)
    }

    private static func message(for error: SessionError) -> String {
        error == .network
            ? "No hay conexión. Revisa tu internet e intenta de nuevo."
            : "Backstage no responde en este momento. Intenta de nuevo en un rato."
    }

    private func show(_ error: Error) {
        let sessionError = Self.sessionError(from: error)
        switch sessionError {
        case .signedOut:
            services = .loading
            phase = .signedOut(notice: nil)
        case .accountDisabled:
            services = .loading
            phase = .signedOut(notice: "Tu acceso está desactivado. Habla con un administrador.")
        case .network, .unavailable, .server:
            let message = Self.message(for: sessionError)
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
