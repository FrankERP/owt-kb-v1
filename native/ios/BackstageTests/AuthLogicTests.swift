import XCTest
@testable import Backstage

final class PKCETests: XCTestCase {
    func testChallengeMatchesRFC7636AppendixB() {
        XCTAssertEqual(
            PKCE.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        )
    }

    func testVerifierAndStateAreUnreservedAndInRange() {
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        for value in [PKCE.makeVerifier(), PKCE.makeState()] {
            XCTAssertEqual(value.count, 43)
            XCTAssertTrue(value.unicodeScalars.allSatisfy(allowed.contains))
        }
        XCTAssertNotEqual(PKCE.makeVerifier(), PKCE.makeVerifier())
    }
}

final class AppConfigTests: XCTestCase {
    func testProductionUsesTheVerifiedHttpsCallbackExactly() {
        let config = AppConfig(origin: "https://owt-backstage.vercel.app/")
        XCTAssertEqual(config.origin, "https://owt-backstage.vercel.app")
        XCTAssertEqual(config.redirectURI, "https://owt-backstage.vercel.app/app/callback/ios")
        XCTAssertEqual(config.callbackHost, "owt-backstage.vercel.app")
        XCTAssertFalse(config.isLocal)
        XCTAssertEqual(config.tokenURL.absoluteString, "https://owt-backstage.vercel.app/api/app/v1/auth/token")
    }

    func testLocalUsesThePrivateSchemeTheServerAcceptsOnlyOnLocalhost() {
        let config = AppConfig(origin: "http://localhost:3000")
        XCTAssertTrue(config.isLocal)
        XCTAssertNil(config.callbackHost)
        XCTAssertEqual(config.redirectURI, "app.vercel.owt-backstage:/oauth/callback/ios")
    }
}

final class AuthCallbackTests: XCTestCase {
    private let iss = "https://owt-backstage.vercel.app"

    private func url(_ query: String) -> URL {
        URL(string: "https://owt-backstage.vercel.app/app/callback/ios?\(query)")!
    }

    func testCodeWithMatchingStateAndIssuer() {
        let result = AuthCallback.parse(
            url("code=abc&state=s1&iss=https%3A%2F%2Fowt-backstage.vercel.app"),
            expectedState: "s1", expectedIssuer: iss
        )
        XCTAssertEqual(result, .code("abc"))
    }

    func testStateMismatchIsNeverRedeemed() {
        XCTAssertEqual(AuthCallback.parse(url("code=abc&state=other&iss=\(iss)"), expectedState: "s1", expectedIssuer: iss), .invalid)
    }

    func testIssuerMismatchOrMissingIsNeverRedeemed() {
        XCTAssertEqual(AuthCallback.parse(url("code=abc&state=s1&iss=https://evil.example"), expectedState: "s1", expectedIssuer: iss), .invalid)
        XCTAssertEqual(AuthCallback.parse(url("code=abc&state=s1"), expectedState: "s1", expectedIssuer: iss), .invalid)
    }

    func testDuplicatedParametersAreRefused() {
        XCTAssertEqual(AuthCallback.parse(url("code=a&code=b&state=s1&iss=\(iss)"), expectedState: "s1", expectedIssuer: iss), .invalid)
        XCTAssertEqual(AuthCallback.parse(url("code=a&state=s1&state=s1&iss=\(iss)"), expectedState: "s1", expectedIssuer: iss), .invalid)
    }

    func testCancelIsDeniedAndOtherErrorsAreInvalid() {
        XCTAssertEqual(AuthCallback.parse(url("error=access_denied&state=s1&iss=\(iss)"), expectedState: "s1", expectedIssuer: iss), .denied)
        XCTAssertEqual(AuthCallback.parse(url("error=invalid_request&state=s1&iss=\(iss)"), expectedState: "s1", expectedIssuer: iss), .invalid)
    }
}

final class TokenEndpointTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    private func classify(_ status: Int, _ json: String, retryAfter: String? = nil) -> TokenEndpointOutcome {
        TokenEndpoint.classify(status: status, body: Data(json.utf8), retryAfter: retryAfter, now: now)
    }

    func testSuccess() {
        let outcome = classify(200, #"{"access_token":"a","token_type":"Bearer","expires_in":3600,"refresh_token":"r"}"#)
        XCTAssertEqual(outcome, .tokens(TokenSet(accessToken: "a", refreshToken: "r", accessExpiresAt: now.addingTimeInterval(3600))))
    }

    func testSuccessWithAnotherTokenTypeIsRefused() {
        XCTAssertEqual(classify(200, #"{"access_token":"a","token_type":"mac","expires_in":3600,"refresh_token":"r"}"#), .failure(status: 200))
    }

    func testAccountDisabledIsDistinctFromAGoneGrant() {
        XCTAssertEqual(classify(400, #"{"error":"invalid_grant","error_description":"account_disabled"}"#), .accountDisabled)
        XCTAssertEqual(classify(400, #"{"error":"invalid_grant","error_description":"the grant is invalid"}"#), .invalidGrant)
    }

    func testLostRefreshRaceIsNotAnOutage() {
        XCTAssertEqual(classify(503, #"{"error":"temporarily_unavailable","error_description":"refresh_in_progress"}"#), .refreshInProgress)
        XCTAssertEqual(classify(503, #"{"error":"temporarily_unavailable","error_description":"try again"}"#, retryAfter: "1"), .unavailable(retryAfter: 1))
    }

    func testOtherAnswersKeepTheTokens() {
        XCTAssertEqual(classify(500, #"{"error":"server_error"}"#), .failure(status: 500))
        XCTAssertEqual(classify(400, #"{"error":"invalid_request"}"#), .failure(status: 400))
    }

    func testUnauthorizedBodies() {
        XCTAssertEqual(APIUnauthorized.classify(body: Data(#"{"error":"account_disabled"}"#.utf8)), .accountDisabled)
        XCTAssertEqual(APIUnauthorized.classify(body: Data(#"{"error":"invalid_token"}"#.utf8)), .invalidToken)
        XCTAssertEqual(APIUnauthorized.classify(body: Data()), .invalidToken)
    }

    func testFormEncodingIsSortedAndEscaped() {
        let body = String(decoding: SessionAuthority.form(["b": "x y", "a": "https://h/p?q=1&r"]), as: UTF8.self)
        XCTAssertEqual(body, "a=https%3A%2F%2Fh%2Fp%3Fq%3D1%26r&b=x%20y")
    }
}

final class MeTests: XCTestCase {
    func testDisplayNamePrefersAlias() throws {
        let json = #"{"id":"m1","name":"Francisco","alias":"Frank","photoUrl":null,"role":"super-admin","ministries":["worship","jovenes"],"platform":"ios"}"#
        let me = try JSONDecoder().decode(Me.self, from: Data(json.utf8))
        XCTAssertEqual(me.displayName, "Frank")
        XCTAssertEqual(me.roleLabel, "Super admin")
        XCTAssertEqual(me.ministryLabels, ["Alabanza", "Jóvenes"])
    }

    func testDisplayNameFallsBackToNameWhenAliasIsBlank() throws {
        let json = #"{"id":"m1","name":"Ana","alias":"  ","photoUrl":null,"role":"member","ministries":[]}"#
        XCTAssertEqual(try JSONDecoder().decode(Me.self, from: Data(json.utf8)).displayName, "Ana")
    }
}
