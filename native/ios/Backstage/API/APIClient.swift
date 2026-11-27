import Foundation

/// The signed-in person (`GET /api/app/v1/me`). `role` and `ministries` only decide which tabs
/// the app shows; the server still judges every call on the person's LIVE access.
struct Me: Decodable, Equatable, Sendable {
    let id: String
    let name: String?
    let alias: String?
    let photoUrl: String?
    let role: String
    let ministries: [String]

    var displayName: String {
        let candidates = [alias, name].compactMap { $0?.trimmingCharacters(in: .whitespaces) }
        return candidates.first { !$0.isEmpty } ?? "Bienvenido"
    }

    var roleLabel: String {
        switch role {
        case "super-admin": "Super admin"
        case "admin": "Administrador"
        case "content-editor": "Editor"
        default: "Miembro"
        }
    }

    var ministryLabels: [String] {
        ministries.map { id in
            switch id {
            case "worship": "Alabanza"
            case "kids": "Oasis Kids"
            case "jovenes": "Jóvenes"
            default: id
            }
        }
    }
}

enum APIError: Error, Equatable {
    case session(SessionError)
    /// `403`: the person lacks the level this endpoint needs.
    case forbidden
    /// `404`: nothing at that address (a song that left the catalogue).
    case notFound
    case decoding
}

/// Calls `/api/app/v1/*` with the bearer token: one refresh on `401 invalid_token`, then sign-in.
struct APIClient: Sendable {
    let config: AppConfig
    let authority: SessionAuthority
    let transport: HTTPTransport

    func me() async throws -> Me { try await get("/api/app/v1/me") }

    func services() async throws -> ServicesResponse { try await get("/api/app/v1/services") }

    func songs() async throws -> SongsResponse { try await get("/api/app/v1/songs") }

    func song(slug: String) async throws -> SongResponse {
        // The slug is one path segment: anything that would not be one is escaped, never spliced.
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#")
        let segment = slug.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
        return try await get("/api/app/v1/songs/\(segment)")
    }

    /// Where one rehearsal mix's audio lives. Asked for each time a mix is played: the address
    /// is handed out only to someone who is in Alabanza right now.
    func mixAudio(slug: String, key: String) async throws -> MixAudioResponse {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#")
        let song = slug.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
        let mix = key.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
        return try await get("/api/app/v1/songs/\(song)/mixes/\(mix)")
    }

    /// The setlist-proposal editor for a service the caller leads (`404` when they do not).
    func proposalEditor(roleId: String) async throws -> ProposalEditorResponse {
        try await get("/api/app/v1/proposals/\(Self.segment(roleId))")
    }

    /// «Tonos anteriores» for songs about to be added: `{ songId: [keys] }`.
    func previousKeys(songIds: [String]) async throws -> [String: [String]] {
        guard !songIds.isEmpty else { return [:] }
        var components = URLComponents()
        components.queryItems = [URLQueryItem(name: "ids", value: songIds.prefix(50).joined(separator: ","))]
        return try await get("/api/app/v1/songs/previous-keys?\(components.percentEncodedQuery ?? "")")
    }

    /// Saves the shared proposal. Never retried by itself: a lost answer is `.failed`, and the
    /// lead's own retry is what the server judges (a 409 if the first one had landed). A session
    /// problem still throws, as on every other call; a 401 is answered before the writer runs, so
    /// the one resend after a refresh cannot write twice.
    func saveProposal(_ body: ProposalSaveBody) async throws -> ProposalSaveOutcome {
        let encoded: Data
        do { encoded = try JSONEncoder().encode(body) } catch { return .invalid }
        let (data, status): (Data, Int)
        do {
            (data, status) = try await send("/api/app/v1/proposals", method: "POST", body: encoded)
        } catch APIError.session(.network) {
            return .failed
        }
        switch status {
        case 200..<300:
            guard let answer = try? JSONDecoder().decode(ProposalSaveResponse.self, from: data) else { return .failed }
            return .saved(answer)
        case 400: return .invalid
        case 403: return .forbidden
        case 409:
            let code = (try? JSONDecoder().decode(ErrorCode.self, from: data))?.error ?? ""
            return .conflict(code: code)
        default: return .failed
        }
    }

    /// One message into a saved proposal's thread (W1b). A lost answer is `.failed`: the message may
    /// have landed, and the composer keeps the text.
    func postProposalMessage(proposalId: String, body text: String) async throws -> ProposalMessageOutcome {
        let encoded: Data
        do { encoded = try JSONEncoder().encode(ProposalMessageBody(body: text)) } catch { return .invalid }
        let (data, status): (Data, Int)
        do {
            (data, status) = try await send("/api/app/v1/proposal-messages/\(Self.segment(proposalId))", method: "POST", body: encoded)
        } catch APIError.session(.network) {
            return .failed
        }
        return ProposalMessageOutcome.from(status: status, data: data)
    }

    private struct ErrorCode: Decodable { let error: String }

    private static func segment(_ value: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    }

    /// One authenticated request, with the same refresh-once rule as `get`; any status other than
    /// a 401 comes back to the caller with its body. A 401 `account_disabled` or a second 401 ends
    /// the session and throws.
    private func send(_ path: String, method: String, body: Data) async throws -> (Data, Int) {
        var token = try await sessionCall { try await authority.accessToken() }
        for attempt in 0..<2 {
            var request = URLRequest(url: config.url(path))
            request.httpMethod = method
            request.httpBody = body
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let data: Data
            let response: HTTPURLResponse
            do {
                (data, response) = try await transport.send(request)
            } catch {
                throw APIError.session(.network)
            }
            guard response.statusCode == 401 else { return (data, response.statusCode) }
            if APIUnauthorized.classify(body: data) == .accountDisabled {
                await authority.end()
                throw APIError.session(.accountDisabled)
            }
            guard attempt == 0 else {
                await authority.end()
                throw APIError.session(.signedOut)
            }
            let rejected = token
            token = try await sessionCall { try await authority.accessToken(replacing: rejected) }
        }
        throw APIError.session(.signedOut)
    }

    func get<T: Decodable>(_ path: String) async throws -> T {
        var token = try await sessionCall { try await authority.accessToken() }
        for attempt in 0..<2 {
            var request = URLRequest(url: config.url(path))
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            let data: Data
            let response: HTTPURLResponse
            do {
                (data, response) = try await transport.send(request)
            } catch {
                throw APIError.session(.network)
            }
            switch response.statusCode {
            case 200..<300:
                do { return try JSONDecoder().decode(T.self, from: data) } catch { throw APIError.decoding }
            case 401:
                if APIUnauthorized.classify(body: data) == .accountDisabled {
                    await authority.end()
                    throw APIError.session(.accountDisabled)
                }
                guard attempt == 0 else {
                    await authority.end()
                    throw APIError.session(.signedOut)
                }
                let rejected = token
                token = try await sessionCall { try await authority.accessToken(replacing: rejected) }
            case 403:
                throw APIError.forbidden
            case 404:
                throw APIError.notFound
            case 503:
                throw APIError.session(.unavailable)
            default:
                throw APIError.session(.server(status: response.statusCode))
            }
        }
        throw APIError.session(.signedOut)
    }

    private func sessionCall(_ body: () async throws -> String) async throws -> String {
        do { return try await body() } catch let error as SessionError { throw APIError.session(error) }
    }
}
