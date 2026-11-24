import Foundation

/// The tokens one sign-in holds. The refresh token rotates on EVERY use (90 days idle at most);
/// the access token lives one hour.
struct TokenSet: Codable, Equatable, Sendable {
    var accessToken: String
    var refreshToken: String
    var accessExpiresAt: Date

    /// Refresh a minute early so a request never leaves with a token about to lapse in flight.
    func accessIsFresh(at now: Date) -> Bool { accessExpiresAt.timeIntervalSince(now) > 60 }
}

/// Every answer of `POST /api/app/v1/auth/token`, sorted into what the app must DO about it
/// (MOBILE.md «Answers the apps must handle»).
enum TokenEndpointOutcome: Equatable {
    case tokens(TokenSet)
    /// The member is no longer active: sign out AND say «Tu acceso está desactivado».
    case accountDisabled
    /// The grant is gone (revoked, reused, expired, or a code that failed): sign in again.
    case invalidGrant
    /// A concurrent refresh of the SAME token won the rotation. Never resend this token (that is
    /// a reuse and revokes the grant); re-read the stored tokens instead.
    case refreshInProgress
    /// A Sanity outage or a missing server token: keep the tokens, retry later.
    case unavailable(retryAfter: TimeInterval?)
    /// A request we built wrong, or a server error: keep the tokens, report it.
    case failure(status: Int)
}

enum TokenEndpoint {
    private struct Success: Decodable {
        let access_token: String
        let token_type: String
        let expires_in: Double
        let refresh_token: String
    }

    private struct Failure: Decodable {
        let error: String
        let error_description: String?
    }

    static func classify(status: Int, body: Data, retryAfter: String?, now: Date) -> TokenEndpointOutcome {
        if status == 200 {
            guard let ok = try? JSONDecoder().decode(Success.self, from: body),
                  ok.token_type.caseInsensitiveCompare("Bearer") == .orderedSame,
                  !ok.access_token.isEmpty, !ok.refresh_token.isEmpty, ok.expires_in > 0
            else { return .failure(status: status) }
            return .tokens(TokenSet(
                accessToken: ok.access_token,
                refreshToken: ok.refresh_token,
                accessExpiresAt: now.addingTimeInterval(ok.expires_in)
            ))
        }
        let failure = try? JSONDecoder().decode(Failure.self, from: body)
        switch (status, failure?.error, failure?.error_description) {
        case (400, "invalid_grant", "account_disabled"?):
            return .accountDisabled
        case (400, "invalid_grant", _):
            return .invalidGrant
        case (503, "temporarily_unavailable", "refresh_in_progress"?):
            return .refreshInProgress
        case (503, _, _):
            return .unavailable(retryAfter: retryAfter.flatMap(TimeInterval.init))
        default:
            return .failure(status: status)
        }
    }
}

/// The `401` of a `/api/app/v1/*` endpoint (`appUnauthorizedResponse` on the server).
enum APIUnauthorized: Equatable {
    /// Expired, malformed or revoked access token: refresh once, then sign in again.
    case invalidToken
    /// The member is no longer active: sign out and say so.
    case accountDisabled

    static func classify(body: Data) -> APIUnauthorized {
        struct Body: Decodable { let error: String }
        let error = (try? JSONDecoder().decode(Body.self, from: body))?.error
        return error == "account_disabled" ? .accountDisabled : .invalidToken
    }
}
