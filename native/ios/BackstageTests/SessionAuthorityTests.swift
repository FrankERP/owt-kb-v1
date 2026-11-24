import XCTest
@testable import Backstage

/// Answers requests from a script, per path, and records what was sent.
final class ScriptedTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var json: String
        var headers: [String: String] = [:]
        var delay: UInt64 = 0
    }

    private let lock = NSLock()
    private var replies: [String: [Reply]] = [:]
    private(set) var sent: [URLRequest] = []

    func enqueue(_ path: String, _ reply: Reply) {
        lock.withLock { replies[path, default: []].append(reply) }
    }

    func requests(to path: String) -> [URLRequest] {
        lock.withLock { sent.filter { $0.url?.path == path } }
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let path = request.url?.path ?? ""
        let reply: Reply? = lock.withLock {
            sent.append(request)
            guard var queue = replies[path], !queue.isEmpty else { return nil }
            let next = queue.removeFirst()
            replies[path] = queue
            return next
        }
        guard let reply else { throw URLError(.notConnectedToInternet) }
        if reply.delay > 0 { try await Task.sleep(nanoseconds: reply.delay) }
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: reply.headers)!
        return (Data(reply.json.utf8), response)
    }
}

final class SessionAuthorityTests: XCTestCase {
    private let config = AppConfig(origin: "https://owt-backstage.vercel.app")
    private let tokenPath = "/api/app/v1/auth/token"
    private let now = Date(timeIntervalSince1970: 1_000_000)

    private func stale(_ refresh: String = "r0") -> TokenSet {
        TokenSet(accessToken: "a0", refreshToken: refresh, accessExpiresAt: now.addingTimeInterval(-10))
    }

    private func tokensJSON(_ access: String, _ refresh: String) -> String {
        #"{"access_token":"\#(access)","token_type":"Bearer","expires_in":3600,"refresh_token":"\#(refresh)"}"#
    }

    private func body(of request: URLRequest) -> [String: String] {
        let text = String(decoding: request.httpBody ?? Data(), as: UTF8.self)
        var out: [String: String] = [:]
        for pair in text.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1).map { String($0).removingPercentEncoding ?? "" }
            out[parts[0]] = parts.count > 1 ? parts[1] : ""
        }
        return out
    }

    func testRefreshIsSingleFlight() async throws {
        let transport = ScriptedTransport()
        transport.enqueue(tokenPath, .init(status: 200, json: tokensJSON("a1", "r1"), delay: 50_000_000))
        let store = MemoryTokenStore(stale())
        let now = self.now
        let authority = SessionAuthority(config: config, store: store, transport: transport, now: { now })

        async let first = authority.accessToken()
        async let second = authority.accessToken()
        async let third = authority.accessToken()
        let tokens = try await [first, second, third]

        XCTAssertEqual(tokens, ["a1", "a1", "a1"])
        XCTAssertEqual(transport.requests(to: tokenPath).count, 1, "one refresh for every waiting caller")
        XCTAssertEqual(store.load()?.refreshToken, "r1")
    }

    func testRefreshSendsOnlyTheRefreshGrant() async throws {
        let transport = ScriptedTransport()
        transport.enqueue(tokenPath, .init(status: 200, json: tokensJSON("a1", "r1")))
        let now = self.now
        let authority = SessionAuthority(config: config, store: MemoryTokenStore(stale()), transport: transport, now: { now })
        _ = try await authority.accessToken()
        XCTAssertEqual(body(of: transport.requests(to: tokenPath)[0]), [
            "grant_type": "refresh_token", "refresh_token": "r0", "client_id": "backstage-ios",
        ])
    }

    func testLostRaceAdoptsTheTokensAnotherFlightStored() async throws {
        let transport = ScriptedTransport()
        transport.enqueue(tokenPath, .init(status: 503, json: #"{"error":"temporarily_unavailable","error_description":"refresh_in_progress"}"#))
        let store = MemoryTokenStore(stale())
        let now = self.now
        let authority = SessionAuthority(config: config, store: store, transport: transport, now: { now })
        // Another process sharing the keychain won the rotation meanwhile.
        try store.save(TokenSet(accessToken: "a9", refreshToken: "r9", accessExpiresAt: now.addingTimeInterval(3600)))

        let token = try await authority.accessToken()
        XCTAssertEqual(token, "a9")
        XCTAssertEqual(transport.requests(to: tokenPath).count, 1, "the superseded token is never resent")
    }

    func testLostRaceWithNothingNewIsUnavailableAndKeepsTheSession() async {
        let transport = ScriptedTransport()
        transport.enqueue(tokenPath, .init(status: 503, json: #"{"error":"temporarily_unavailable","error_description":"refresh_in_progress"}"#))
        let store = MemoryTokenStore(stale())
        let now = self.now
        let authority = SessionAuthority(config: config, store: store, transport: transport, now: { now })
        do {
            _ = try await authority.accessToken()
            XCTFail("expected unavailable")
        } catch {
            XCTAssertEqual(error as? SessionError, .unavailable)
        }
        XCTAssertNotNil(store.load())
    }

    func testGoneGrantSignsOutAndDisabledSaysSo() async {
        for (json, expected) in [
            (#"{"error":"invalid_grant","error_description":"the grant is invalid"}"#, SessionError.signedOut),
            (#"{"error":"invalid_grant","error_description":"account_disabled"}"#, SessionError.accountDisabled),
        ] {
            let transport = ScriptedTransport()
            transport.enqueue(tokenPath, .init(status: 400, json: json))
            let store = MemoryTokenStore(stale())
            let now = self.now
            let authority = SessionAuthority(config: config, store: store, transport: transport, now: { now })
            do {
                _ = try await authority.accessToken()
                XCTFail("expected \(expected)")
            } catch {
                XCTAssertEqual(error as? SessionError, expected)
            }
            XCTAssertNil(store.load())
            let stillSignedIn = await authority.hasSession
            XCTAssertFalse(stillSignedIn)
        }
    }

    func testNetworkFailureIsNeverRetriedAndKeepsTheSession() async {
        let transport = ScriptedTransport() // no reply queued: the transport throws
        let store = MemoryTokenStore(stale())
        let now = self.now
        let authority = SessionAuthority(config: config, store: store, transport: transport, now: { now })
        do {
            _ = try await authority.accessToken()
            XCTFail("expected network")
        } catch {
            XCTAssertEqual(error as? SessionError, .network)
        }
        XCTAssertEqual(transport.requests(to: tokenPath).count, 1)
        XCTAssertNotNil(store.load())
    }

    func testExchangeSendsTheExactRedirectAndVerifier() async throws {
        let transport = ScriptedTransport()
        transport.enqueue(tokenPath, .init(status: 200, json: tokensJSON("a1", "r1")))
        let store = MemoryTokenStore()
        let now = self.now
        let authority = SessionAuthority(config: config, store: store, transport: transport, now: { now })
        try await authority.exchange(code: "c1", verifier: "v1")
        XCTAssertEqual(body(of: transport.requests(to: tokenPath)[0]), [
            "grant_type": "authorization_code",
            "code": "c1",
            "redirect_uri": "https://owt-backstage.vercel.app/app/callback/ios",
            "client_id": "backstage-ios",
            "code_verifier": "v1",
        ])
        XCTAssertEqual(store.load()?.accessToken, "a1")
    }

    func testSignOutForgetsLocallyEvenWhenTheRevokeFails() async {
        let transport = ScriptedTransport() // the revoke throws
        let store = MemoryTokenStore(stale())
        let authority = SessionAuthority(config: config, store: store, transport: transport)
        await authority.signOut()
        XCTAssertNil(store.load())
        XCTAssertEqual(body(of: transport.requests(to: "/api/app/v1/auth/revoke")[0]), ["token": "r0", "client_id": "backstage-ios"])
    }
}

final class APIClientTests: XCTestCase {
    private let config = AppConfig(origin: "https://owt-backstage.vercel.app")
    private let mePath = "/api/app/v1/me"
    private let meJSON = #"{"id":"m1","name":"Ana","alias":null,"photoUrl":null,"role":"member","ministries":["worship"],"platform":"ios"}"#

    private func fresh(_ access: String = "a0") -> TokenSet {
        TokenSet(accessToken: access, refreshToken: "r0", accessExpiresAt: Date().addingTimeInterval(3600))
    }

    func testInvalidTokenRefreshesOnceAndRetries() async throws {
        let transport = ScriptedTransport()
        transport.enqueue(mePath, .init(status: 401, json: #"{"error":"invalid_token"}"#))
        transport.enqueue("/api/app/v1/auth/token", .init(status: 200, json: #"{"access_token":"a1","token_type":"Bearer","expires_in":3600,"refresh_token":"r1"}"#))
        transport.enqueue(mePath, .init(status: 200, json: meJSON))
        let authority = SessionAuthority(config: config, store: MemoryTokenStore(fresh()), transport: transport)
        let api = APIClient(config: config, authority: authority, transport: transport)

        let me = try await api.me()
        XCTAssertEqual(me.displayName, "Ana")
        let auth = transport.requests(to: mePath).map { $0.value(forHTTPHeaderField: "Authorization") }
        XCTAssertEqual(auth, ["Bearer a0", "Bearer a1"])
    }

    func testAccountDisabledEndsTheSession() async {
        let transport = ScriptedTransport()
        transport.enqueue(mePath, .init(status: 401, json: #"{"error":"account_disabled"}"#))
        let store = MemoryTokenStore(fresh())
        let authority = SessionAuthority(config: config, store: store, transport: transport)
        let api = APIClient(config: config, authority: authority, transport: transport)
        do {
            _ = try await api.me()
            XCTFail("expected account_disabled")
        } catch {
            XCTAssertEqual(error as? APIError, .session(.accountDisabled))
        }
        XCTAssertNil(store.load())
    }

    func testOutageKeepsTheSession() async {
        let transport = ScriptedTransport()
        transport.enqueue(mePath, .init(status: 503, json: #"{"error":"temporarily_unavailable"}"#))
        let store = MemoryTokenStore(fresh())
        let authority = SessionAuthority(config: config, store: store, transport: transport)
        let api = APIClient(config: config, authority: authority, transport: transport)
        do {
            _ = try await api.me()
            XCTFail("expected unavailable")
        } catch {
            XCTAssertEqual(error as? APIError, .session(.unavailable))
        }
        XCTAssertNotNil(store.load())
    }
}

@MainActor
final class AuthorizeURLTests: XCTestCase {
    func testAuthorizeURLCarriesExactlyWhatTheServerAccepts() throws {
        let model = AppModel(
            config: AppConfig(origin: "https://owt-backstage.vercel.app"),
            store: MemoryTokenStore(),
            transport: ScriptedTransport()
        )
        let url = model.authorizeURL(challenge: "ch", state: "st")
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.path, "/app/authorize")
        let items = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(items, [
            "response_type": "code",
            "client_id": "backstage-ios",
            "redirect_uri": "https://owt-backstage.vercel.app/app/callback/ios",
            "code_challenge": "ch",
            "code_challenge_method": "S256",
            "state": "st",
        ])
    }
}
