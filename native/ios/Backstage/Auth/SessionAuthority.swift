import Foundation

/// What can go wrong with the session, sorted by what the app shows.
enum SessionError: Error, Equatable {
    /// No session, or the server ended it: show the sign-in screen.
    case signedOut
    /// The member is no longer active: sign-in screen with «Tu acceso está desactivado».
    case accountDisabled
    /// The server is briefly unavailable (Sanity, a lost refresh race): keep everything, retry.
    case unavailable
    /// No connection. Never retried automatically (a silent retry of a refresh is a reuse).
    case network
    /// The server answered something this build does not expect.
    case server(status: Int)
}

/// Sends one HTTP request. A protocol so tests can answer without a network.
protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        session = URLSession(configuration: configuration)
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, http)
    }
}

/// The one owner of the tokens. An actor, so refreshes are SINGLE-FLIGHT (MOBILE.md): however
/// many requests find the access token stale at once, one refresh runs and every caller waits for
/// it and uses what it stored. This app presents a refresh token again only when the server never
/// saw it rotate (a plain 503 or a lost connection); one the server says was superseded is dropped.
actor SessionAuthority {
    private let config: AppConfig
    private let store: TokenStoring
    private let transport: HTTPTransport
    private let now: @Sendable () -> Date

    private var tokens: TokenSet?
    private var loaded = false
    private var refreshFlight: Task<TokenSet, Error>?
    /// Bumped by every sign-out. A token answer that arrives for an older generation is thrown
    /// away, so a refresh in flight when the person signs out cannot bring the session back.
    private var generation = 0

    init(
        config: AppConfig,
        store: TokenStoring,
        transport: HTTPTransport,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.config = config
        self.store = store
        self.transport = transport
        self.now = now
    }

    /// Reads the Keychain once. Throws when the Keychain cannot answer (e.g. before the first
    /// unlock): that is «try again», never «signed out».
    func restore() throws -> Bool {
        try ensureLoaded()
        return tokens != nil
    }

    private func ensureLoaded() throws {
        guard !loaded else { return }
        tokens = try store.load()
        loaded = true
    }

    // MARK: Sign-in

    /// Redeems the code of a callback this app started. Called once per code: a failed exchange
    /// means signing in again, never resending the same code.
    func exchange(code: String, verifier: String) async throws {
        let started = generation
        let outcome = try await postToken([
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": config.redirectURI,
            "client_id": AppConfig.clientID,
            "code_verifier": verifier,
        ], generation: started)
        switch outcome {
        case .tokens(let fresh):
            adopt(fresh)
        case .accountDisabled:
            throw SessionError.accountDisabled
        case .invalidGrant:
            throw SessionError.signedOut
        case .unavailable, .refreshInProgress:
            throw SessionError.unavailable
        case .failure(let status):
            throw SessionError.server(status: status)
        }
    }

    /// Forgets the session here at once, then tells the server (best effort: a failed revoke still
    /// signs this phone out; the person can close the grant from «Apps conectadas»).
    func signOut() async {
        // The pair may not be read yet (the Keychain is read lazily): read it so it can be revoked.
        // A Keychain that cannot answer leaves nothing to revoke; the local sign-out still happens.
        try? ensureLoaded()
        let refreshToken = tokens?.refreshToken
        end()
        guard let refreshToken else { return }
        var request = URLRequest(url: config.revokeURL)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Self.form(["token": refreshToken, "client_id": AppConfig.clientID])
        _ = try? await transport.send(request)
    }

    /// Drops the tokens without calling the server (the server already ended the session).
    func end() {
        generation += 1
        refreshFlight?.cancel()
        refreshFlight = nil
        tokens = nil
        loaded = true
        store.clear()
    }

    /// Keeps a new pair. If the Keychain refuses it, the stored pair is now superseded and would
    /// be a reuse on the next launch, so it is cleared: this launch keeps working from memory.
    private func adopt(_ fresh: TokenSet) {
        do { try store.save(fresh) } catch { store.clear() }
        tokens = fresh
        loaded = true
    }

    // MARK: Access tokens

    /// A usable access token, refreshing first if it is about to lapse.
    func accessToken() async throws -> String {
        try loadOrUnavailable()
        guard let current = tokens else { throw SessionError.signedOut }
        if current.accessIsFresh(at: now()) { return current.accessToken }
        return try await refreshed().accessToken
    }

    /// After a `401 invalid_token` on `rejected`: if another call already refreshed, use its
    /// token; otherwise refresh once.
    func accessToken(replacing rejected: String) async throws -> String {
        try loadOrUnavailable()
        guard let current = tokens else { throw SessionError.signedOut }
        if current.accessToken != rejected { return current.accessToken }
        return try await refreshed().accessToken
    }

    private func loadOrUnavailable() throws {
        do { try ensureLoaded() } catch { throw SessionError.unavailable }
    }

    private func refreshed() async throws -> TokenSet {
        if let flight = refreshFlight { return try await flight.value }
        guard let presented = tokens?.refreshToken else { throw SessionError.signedOut }
        let started = generation
        let flight = Task { try await self.performRefresh(presenting: presented, generation: started) }
        refreshFlight = flight
        defer { if refreshFlight == flight { refreshFlight = nil } }
        return try await flight.value
    }

    private func performRefresh(presenting refreshToken: String, generation started: Int) async throws -> TokenSet {
        let outcome = try await postToken([
            "grant_type": "refresh_token",
            "refresh_token": refreshToken,
            "client_id": AppConfig.clientID,
        ], generation: started)
        guard tokens?.refreshToken == refreshToken else { throw SessionError.signedOut }
        switch outcome {
        case .tokens(let fresh):
            adopt(fresh)
            return fresh
        case .refreshInProgress:
            // The server already rotated this token for another request. Adopt the pair that
            // request stored (another process sharing the Keychain) if there is one; otherwise the
            // winner's answer is lost, and presenting this token again would be a reuse that
            // revokes the grant, so the session ends here and the person signs in again.
            if let stored = try? store.load(), stored.refreshToken != refreshToken {
                tokens = stored
                return stored
            }
            end()
            throw SessionError.signedOut
        case .unavailable:
            // The server did not rotate (MOBILE.md): the same token may be presented later. A pair
            // another process stored meanwhile still wins.
            if let stored = try? store.load(), stored.refreshToken != refreshToken {
                tokens = stored
                return stored
            }
            throw SessionError.unavailable
        case .accountDisabled:
            end()
            throw SessionError.accountDisabled
        case .invalidGrant:
            end()
            throw SessionError.signedOut
        case .failure(let status):
            throw SessionError.server(status: status)
        }
    }

    // MARK: Transport

    /// One token POST, never retried. If the person signed out while it was in flight (sign-out
    /// bumps `generation` and cancels the flight), whatever came back, an answer or an error,
    /// belongs to a session they ended: it is reported as `.signedOut` and nothing is stored.
    private func postToken(_ fields: [String: String], generation started: Int) async throws -> TokenEndpointOutcome {
        var request = URLRequest(url: config.tokenURL)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = Self.form(fields)
        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await transport.send(request)
        } catch {
            throw generation == started ? SessionError.network : SessionError.signedOut
        }
        guard generation == started else { throw SessionError.signedOut }
        return TokenEndpoint.classify(
            status: response.statusCode,
            body: data,
            retryAfter: response.value(forHTTPHeaderField: "Retry-After"),
            now: now()
        )
    }

    /// `application/x-www-form-urlencoded`, keys sorted so a request is reproducible in tests.
    static func form(_ fields: [String: String]) -> Data {
        // RFC 3986 unreserved characters, ASCII only: everything else is percent-encoded.
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        let body = fields.keys.sorted().map { key in
            let value = fields[key] ?? ""
            let k = key.addingPercentEncoding(withAllowedCharacters: allowed) ?? key
            let v = value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
            return "\(k)=\(v)"
        }.joined(separator: "&")
        return Data(body.utf8)
    }
}
