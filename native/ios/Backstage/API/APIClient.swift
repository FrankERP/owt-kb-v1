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
    case decoding
}

/// Calls `/api/app/v1/*` with the bearer token: one refresh on `401 invalid_token`, then sign-in.
struct APIClient: Sendable {
    let config: AppConfig
    let authority: SessionAuthority
    let transport: HTTPTransport

    func me() async throws -> Me { try await get("/api/app/v1/me") }

    func services() async throws -> ServicesResponse { try await get("/api/app/v1/services") }

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
