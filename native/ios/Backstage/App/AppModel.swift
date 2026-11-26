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

    /// The Biblioteca's catalogue.
    enum Catalogue: Equatable {
        case idle
        case loading
        case loaded([LibrarySong])
        case notInWorship
        case failed(String)
    }

    /// One song's page.
    enum SongLoad: Equatable {
        case loaded(SongDetail)
        case missing
        case failed(String)
    }

    private(set) var phase: Phase = .starting
    private(set) var catalogue: Catalogue = .idle
    /// Songs already opened in this run: a song reopens at once, and offline.
    private var openedSongs: [String: SongDetail] = [:]
    private(set) var services: Services = .loading
    /// When the list last loaded, so coming back to the app refreshes a list left from another day.
    private var servicesLoadedAt: Date?
    private var catalogueLoadedAt: Date?
    /// The last `today` the server sent, so a service page left open keeps its countdown while
    /// the list reloads or fails.
    private(set) var lastToday = ""
    /// A passing problem shown over the signed-in screen («No hay conexión»…).
    var banner: String?

    let config: AppConfig
    /// The one audio player, app-wide: a mix outlives the page that started it.
    let player: MixPlayer
    private let authority: SessionAuthority
    private let api: APIClient

    init(config: AppConfig, store: TokenStoring, transport: HTTPTransport) {
        self.config = config
        authority = SessionAuthority(config: config, store: store, transport: transport)
        api = APIClient(config: config, authority: authority, transport: transport)
        player = MixPlayer()
        player.resolve = { [weak self] slug, key in
            await self?.mixSource(slug: slug, key: key) ?? .failed("")
        }
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

    // MARK: Biblioteca

    /// Loads the catalogue once; `force` (pull to refresh, «Intentar de nuevo») reads it again.
    /// A failed refresh keeps the list on screen.
    func loadCatalogue(force: Bool = false) async {
        if case .loading = catalogue { return }
        // A list read a while ago is read again behind what is on screen, so a song added
        // today shows without a relaunch.
        let fresh = catalogueLoadedAt.map { Date().timeIntervalSince($0) < 600 } ?? false
        if case .loaded = catalogue, !force, fresh { return }
        let had = catalogue
        if case .loaded = had {} else { catalogue = .loading }
        do {
            catalogue = .loaded(try await api.songs().songs)
            catalogueLoadedAt = Date()
        } catch APIError.forbidden {
            catalogue = .notInWorship
        } catch {
            let cause = Self.sessionError(from: error)
            switch cause {
            case .signedOut, .accountDisabled:
                show(cause)
            case .network, .unavailable, .server:
                if case .loaded = had {
                    catalogue = had
                    banner = Self.message(for: cause)
                } else {
                    catalogue = .failed(Self.message(for: cause))
                }
            }
        }
    }

    /// The song already opened in this run, if any: its page draws without a wait.
    func openedSong(slug: String) -> SongDetail? { openedSongs[slug] }

    func loadSong(slug: String) async -> SongLoad {
        do {
            let detail = try await api.song(slug: slug).song
            openedSongs[slug] = detail
            return .loaded(detail)
        } catch APIError.notFound {
            return .missing
        } catch {
            let cause = Self.sessionError(from: error)
            switch cause {
            case .signedOut, .accountDisabled:
                show(cause)
                return .failed("")
            case .network, .unavailable, .server:
                if let kept = openedSongs[slug] { return .loaded(kept) }
                return .failed(Self.message(for: cause))
            }
        }
    }

    /// Where a mix's audio lives, asked for every time one is played: the server answers only
    /// someone who is in Alabanza right now. Only Sanity's CDN over https is ever played.
    private func mixSource(slug: String, key: String) async -> MixPlayer.Source {
        do {
            let answer = try await api.mixAudio(slug: slug, key: key)
            guard let url = URL(string: answer.url), url.scheme == "https", url.host == "cdn.sanity.io" else {
                return .failed("Esta mezcla no está disponible.")
            }
            return .url(url)
        } catch APIError.notFound {
            return .failed("Esta mezcla ya no está disponible.")
        } catch APIError.forbidden {
            return .failed("Las mezclas de ensayo son para el equipo de Alabanza.")
        } catch {
            let cause = Self.sessionError(from: error)
            switch cause {
            case .signedOut, .accountDisabled:
                show(cause)
                return .failed("")
            case .network, .unavailable, .server:
                return .failed(Self.message(for: cause))
            }
        }
    }

    // MARK: Proponer setlist (ADR-0091 W1)

    enum ProposalLoad: Equatable {
        case loaded(ProposalEditorResponse)
        /// `404` or `403`: the caller no longer leads this published service.
        case unavailable
        case failed(String)
    }

    /// The editor's read. A session that ended goes to sign-in, as anywhere else.
    func loadProposalEditor(roleId: String) async -> ProposalLoad {
        do {
            return .loaded(try await api.proposalEditor(roleId: roleId))
        } catch APIError.notFound {
            return .unavailable
        } catch APIError.forbidden {
            return .unavailable
        } catch {
            let cause = Self.sessionError(from: error)
            switch cause {
            case .signedOut, .accountDisabled:
                show(cause)
                return .failed("")
            case .network, .unavailable, .server:
                return .failed(Self.message(for: cause))
            }
        }
    }

    /// «Tonos anteriores» for songs just added; an empty answer when it cannot be read (the
    /// picker then shows none, as the web shows none on a failed search).
    func previousKeys(songIds: [String]) async -> [String: [String]] {
        (try? await api.previousKeys(songIds: songIds)) ?? [:]
    }

    /// One save. A session that ended goes to sign-in (the in-memory draft is lost then, as when
    /// iOS ends the app mid-edit); every other answer goes back to the editor. After a save that
    /// landed, the list refreshes so its «Borrador»/«Enviada» chip follows.
    func saveProposal(_ body: ProposalSaveBody) async -> ProposalSaveOutcome {
        let outcome: ProposalSaveOutcome
        do {
            outcome = try await api.saveProposal(body)
        } catch {
            let cause = Self.sessionError(from: error)
            switch cause {
            case .signedOut, .accountDisabled:
                show(cause)
            case .network, .unavailable, .server:
                break
            }
            return .failed
        }
        if case .saved = outcome { await loadServices() }
        if outcome == .forbidden { await loadServices() }
        return outcome
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
        player.stop()
        await authority.signOut()
        ImageStore.shared.clear()
        banner = nil
        services = .loading
        servicesLoadedAt = nil
        catalogue = .idle
        openedSongs = [:]
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
            case .notFound: return .server(status: 404)
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
            player.stop()
            services = .loading
            catalogue = .idle
            openedSongs = [:]
            phase = .signedOut(notice: nil)
        case .accountDisabled:
            player.stop()
            services = .loading
            catalogue = .idle
            openedSongs = [:]
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
