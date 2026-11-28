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

    /// An admin or super-admin: the web's rule for «Propuestas» (A-W1). Only hides the tab; the
    /// server decides every call on live access.
    var reviewsProposals: Bool { role == "admin" || role == "super-admin" }

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

    // MARK: Admin: proposals (A-W1)

    /// The proposals an admin reviews: the queue, plus every other one still ahead.
    func adminProposals() async throws -> AdminProposalsResponse { try await get("/api/app/v1/admin/proposals") }

    /// One decision. Never retried by itself: a lost answer is `.failed`, and the admin's own retry
    /// is what the server judges (an identical decision that had landed is a no-write replay).
    func decideProposal(proposalId: String, body: ProposalDecisionBody) async throws -> ProposalDecisionOutcome {
        let encoded: Data
        do { encoded = try JSONEncoder().encode(body) } catch { return .invalid }
        let (data, status): (Data, Int)
        do {
            (data, status) = try await send("/api/app/v1/admin/proposals/\(Self.segment(proposalId))", method: "PATCH", body: encoded)
        } catch APIError.session(.network) {
            return .failed
        }
        return ProposalDecisionOutcome.from(status: status, data: data)
    }

    /// One admin message into a proposal's thread. A lost answer is `.failed`: it may have landed.
    func postAdminProposalMessage(proposalId: String, body text: String) async throws -> ProposalMessageOutcome {
        let encoded: Data
        do { encoded = try JSONEncoder().encode(ProposalMessageBody(body: text)) } catch { return .invalid }
        let (data, status): (Data, Int)
        do {
            (data, status) = try await send("/api/app/v1/admin/proposal-messages/\(Self.segment(proposalId))", method: "POST", body: encoded)
        } catch APIError.session(.network) {
            return .failed
        }
        return ProposalMessageOutcome.from(status: status, data: data)
    }

    // MARK: Admin: «Mensajes del servicio» (A-W2)

    /// One service's pastor's message, team note and conversation with its leads.
    func serviceMessages(roleId: String) async throws -> ServiceMessages {
        try await get(Self.serviceThreadPath(roleId))
    }

    /// One admin message into the service's thread. No idempotency on the server: a lost answer is
    /// `.failed`, and the conversation reads the thread before offering it again.
    func postServiceMessage(roleId: String, body text: String) async throws -> ServiceWriteOutcome<ServiceThreadAnswer> {
        try await serviceWrite(Self.serviceThreadPath(roleId) + "/messages", method: "POST", body: ProposalMessageBody(body: text))
    }

    /// Edits one of the caller's own messages. A resend sets the same text again and notifies nobody.
    func editServiceMessage(roleId: String, key: String, body text: String) async throws -> ServiceWriteOutcome<ServiceThreadAnswer> {
        try await serviceWrite(
            Self.serviceThreadPath(roleId) + "/messages/\(Self.segment(key))", method: "PATCH", body: ProposalMessageBody(body: text)
        )
    }

    /// Deletes one of the caller's own messages. A resend of one that landed answers `404`.
    func deleteServiceMessage(roleId: String, key: String) async throws -> ServiceWriteOutcome<ServiceThreadAnswer> {
        try await serviceWrite(Self.serviceThreadPath(roleId) + "/messages/\(Self.segment(key))", method: "DELETE", body: Optional<ProposalMessageBody>.none)
    }

    /// Sets (or, with `""`, clears) the pastor's message against the stamp the edit started from.
    func setPastorMessage(roleId: String, body: PastorMessageBody) async throws -> ServiceWriteOutcome<PastorAnswer> {
        try await serviceWrite(Self.serviceThreadPath(roleId) + "/pastor-message", method: "PUT", body: body)
    }

    /// Saves the team note against the setlist revision it was started on. Notifies nobody.
    func saveTeamNotes(roleId: String, body: TeamNotesBody) async throws -> ServiceWriteOutcome<TeamNotesAnswer> {
        try await serviceWrite(Self.serviceThreadPath(roleId) + "/team-notes", method: "PUT", body: body)
    }

    private static func serviceThreadPath(_ roleId: String) -> String {
        "/api/app/v1/admin/service-threads/\(segment(roleId))"
    }

    /// One write to a service-thread door. Never retried by itself: a lost answer is `.failed`, and
    /// what a retry may do is the sheet's rule per write (spec D5). A session problem still throws.
    private func serviceWrite<Body: Encodable, Answer: Decodable & Equatable & Sendable>(
        _ path: String, method: String, body: Body?
    ) async throws -> ServiceWriteOutcome<Answer> {
        var encoded: Data?
        if let body {
            do { encoded = try JSONEncoder().encode(body) } catch { return .invalid }
        }
        let (data, status): (Data, Int)
        do {
            (data, status) = try await send(path, method: method, body: encoded)
        } catch APIError.session(.network) {
            return .failed
        }
        return ServiceWriteOutcome<Answer>.from(status: status, data: data)
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
    private func send(_ path: String, method: String, body: Data?) async throws -> (Data, Int) {
        var token = try await sessionCall { try await authority.accessToken() }
        for attempt in 0..<2 {
            var request = URLRequest(url: config.url(path))
            request.httpMethod = method
            request.httpBody = body
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
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
