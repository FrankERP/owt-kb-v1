import XCTest
@testable import Backstage

/// A-W1: the admin's review of a setlist proposal. The rule under test everywhere: a decision only
/// ever carries the revision whose content was on screen when the admin chose.
final class AdminProposalTests: XCTestCase {
    static func proposal(
        id: String = "setlistProposal.a", rev: String = "r1", status: String = "pending",
        songs: [AdminProposal.Song] = [song("s1", key: "D")], teamNotes: String? = nil,
        threadOpen: Bool = true, messages: [ThreadMessage] = []
    ) -> AdminProposal {
        AdminProposal(
            id: id, rev: rev, status: status,
            service: .init(kind: .sunday, date: "2099-01-04", title: "Domingo"),
            leadName: "Luis", coLeads: [], songs: songs, pastorMessage: nil, teamNotes: teamNotes,
            messages: messages, earlierMessages: [], threadOpen: threadOpen
        )
    }

    static func song(_ id: String, key: String, medley: String? = nil) -> AdminProposal.Song {
        AdminProposal.Song(songId: id, title: id, author: nil, key: key, playKey: key, medleyTag: medley)
    }

    static func message(_ key: String, at: String?) -> ThreadMessage {
        ThreadMessage(key: key, authorName: "A", authorRole: "admin", kind: nil, body: key, at: at, editedAt: nil, mine: false)
    }

    // MARK: Which revision a decision carries

    func testADecisionCarriesTheRevisionOnScreen() {
        var state = ProposalReviewState(proposal: Self.proposal())
        XCTAssertEqual(state.beginDecision(.approve, openedRev: "r1"), .send(rev: "r1"))
        XCTAssertTrue(state.deciding)
        XCTAssertEqual(state.beginDecision(.approve, openedRev: "r1"), .busy, "a second tap sends nothing")
    }

    func testAMessageNeverMovesTheHeldRevision() {
        var state = ProposalReviewState(proposal: Self.proposal())
        XCTAssertEqual(state.beginMessage(), "setlistProposal.a")
        state.finishMessage(proposalId: "setlistProposal.a", observedRev: "r1", messages: [Self.message("m1", at: nil)])
        XCTAssertEqual(state.heldRev, "r1", "the read-back revision may fold in a lead's save")
        XCTAssertFalse(state.locked)
        XCTAssertEqual(state.proposal.messages.map(\.key), ["m1"], "the admin sees their message at once")
    }

    func testAMessageWhoseServerSawAnotherRevisionLocks() {
        var state = ProposalReviewState(proposal: Self.proposal())
        _ = state.beginMessage()
        state.finishMessage(proposalId: "setlistProposal.a", observedRev: "r0", messages: nil)
        XCTAssertTrue(state.locked)
        XCTAssertFalse(state.canDecide(.approve))
        XCTAssertTrue(state.canPost, "a locked card still takes a message, as on the web")
        XCTAssertEqual(state.heldRev, "r1")
    }

    func testNoObservedRevisionOrAnotherProposalDoesNotLock() {
        var state = ProposalReviewState(proposal: Self.proposal())
        _ = state.beginMessage()
        state.finishMessage(proposalId: "setlistProposal.a", observedRev: nil, messages: nil)
        XCTAssertFalse(state.locked)
        _ = state.beginMessage()
        state.finishMessage(proposalId: "setlistProposal.other", observedRev: "r0", messages: nil)
        XCTAssertFalse(state.locked)
        XCTAssertFalse(state.posting)
    }

    func testAReloadSetsTheRevisionAndTheContentFromOneRow() {
        var state = ProposalReviewState(proposal: Self.proposal())
        XCTAssertTrue(state.apply([Self.proposal(rev: "r2")]))
        XCTAssertEqual(state.heldRev, "r2")
        XCTAssertTrue(state.changeSeen, "only the revision moved: nothing to look at again")
    }

    func testAReloadThatChangesTheSongsHoldsEveryDecision() {
        var state = ProposalReviewState(proposal: Self.proposal())
        state.apply([Self.proposal(rev: "r2", songs: [Self.song("s1", key: "E")])])
        XCTAssertFalse(state.changeSeen)
        XCTAssertFalse(state.canDecide(.approve))
        XCTAssertFalse(state.canDecide(.requestChanges))
        state.acknowledgeChange()
        XCTAssertTrue(state.canDecide(.approve))
        XCTAssertEqual(state.beginDecision(.approve, openedRev: "r2"), .send(rev: "r2"))
    }

    func testNotesStatusAndMedleysCountAsAChangeButTheThreadDoesNot() {
        for changed in [
            Self.proposal(rev: "r2", teamNotes: "nuevo"),
            Self.proposal(rev: "r2", status: "approved"),
            Self.proposal(rev: "r2", songs: [Self.song("s1", key: "D", medley: "A")]),
        ] {
            var state = ProposalReviewState(proposal: Self.proposal())
            state.apply([changed])
            XCTAssertFalse(state.changeSeen)
        }
        var state = ProposalReviewState(proposal: Self.proposal())
        state.apply([Self.proposal(rev: "r2", messages: [Self.message("x", at: nil)])])
        XCTAssertTrue(state.changeSeen)
    }

    func testTheAdminsOwnDecisionChangesTheStatusWithoutANotice() {
        var state = ProposalReviewState(proposal: Self.proposal())
        _ = state.beginDecision(.approve, openedRev: "r1")
        state.finishDecision(.done(ProposalDecisionResponse(status: "approved")))
        state.apply([Self.proposal(rev: "r2", status: "approved")])
        XCTAssertTrue(state.changeSeen)
        XCTAssertTrue(state.canDecide(.reopen))
        // …but only for that one reload, and never for the songs.
        state.apply([Self.proposal(rev: "r3", status: "changes_requested")])
        XCTAssertFalse(state.changeSeen)
    }

    func testASheetOpenedOnARevisionThatMovedSendsNothing() {
        var state = ProposalReviewState(proposal: Self.proposal())
        let opened = state.heldRev
        state.apply([Self.proposal(rev: "r2")])
        XCTAssertEqual(state.beginDecision(.requestChanges, openedRev: opened), .moved)
        XCTAssertFalse(state.deciding)
    }

    func testAListReadWaitsWhileSomethingIsInFlight() {
        var state = ProposalReviewState(proposal: Self.proposal())
        _ = state.beginDecision(.approve, openedRev: "r1")
        XCTAssertFalse(state.apply([Self.proposal(rev: "r9", songs: [])]))
        XCTAssertEqual(state.heldRev, "r1")
        state.finishDecision(.failed)
        _ = state.beginMessage()
        XCTAssertFalse(state.apply([Self.proposal(rev: "r9")]))
        state.endMessage()
        XCTAssertTrue(state.apply([Self.proposal(rev: "r9")]))
    }

    func testAConflictLocksUntilAReload() {
        var state = ProposalReviewState(proposal: Self.proposal())
        _ = state.beginDecision(.approve, openedRev: "r1")
        state.finishDecision(.conflict)
        XCTAssertTrue(state.locked)
        XCTAssertEqual(state.lockReason, .conflict)
        XCTAssertFalse(state.canDecide(.approve))
        state.apply([Self.proposal(rev: "r2")])
        XCTAssertFalse(state.locked)
        _ = state.beginDecision(.approve, openedRev: "r2")
        state.finishDecision(.blocked)
        XCTAssertEqual(state.lockReason, .blocked)
    }

    func testAProposalThatLeftTheListTakesNoDecision() {
        var state = ProposalReviewState(proposal: Self.proposal())
        state.apply([])
        XCTAssertTrue(state.gone)
        XCTAssertFalse(state.canDecide(.approve))
        XCTAssertFalse(state.canPost)
    }

    // MARK: What each action needs

    func testEachActionNeedsItsStatus() {
        let pending = ProposalReviewState(proposal: Self.proposal())
        XCTAssertTrue(pending.canDecide(.approve))
        XCTAssertTrue(pending.canDecide(.requestChanges))
        XCTAssertFalse(pending.canDecide(.reopen))
        XCTAssertFalse(ProposalReviewState(proposal: Self.proposal(songs: [])).canDecide(.approve), "no songs, no approval")
        let approved = ProposalReviewState(proposal: Self.proposal(status: "approved"))
        XCTAssertTrue(approved.canDecide(.reopen))
        XCTAssertFalse(approved.canDecide(.approve))
        let draft = ProposalReviewState(proposal: Self.proposal(status: "draft"))
        XCTAssertFalse(draft.canDecide(.approve) || draft.canDecide(.requestChanges) || draft.canDecide(.reopen))
        XCTAssertFalse(ProposalReviewState(proposal: Self.proposal(threadOpen: false)).canPost)
    }

    // MARK: The wire

    func testTheDecisionDoorsAnswersReadAsOutcomes() {
        func data(_ s: String) -> Data { Data(s.utf8) }
        XCTAssertEqual(ProposalDecisionOutcome.from(status: 200, data: data(#"{"status":"approved","idempotent":false,"pastorMessage":"copied"}"#)),
                       .done(ProposalDecisionResponse(status: "approved", idempotent: false, pastorMessage: "copied")))
        XCTAssertEqual(ProposalDecisionOutcome.from(status: 200, data: data("nope")), .failed)
        XCTAssertEqual(ProposalDecisionOutcome.from(status: 409, data: data(#"{"error":"stale_revision","conflict":true}"#)), .conflict)
        XCTAssertEqual(ProposalDecisionOutcome.from(status: 409, data: data(#"{"error":"bootstrap_completed_reload","conflict":true}"#)), .conflict)
        XCTAssertEqual(ProposalDecisionOutcome.from(status: 409, data: data(#"{"error":"integrity_conflict","conflict":true}"#)), .blocked)
        XCTAssertEqual(ProposalDecisionOutcome.from(status: 403, data: data("{}")), .forbidden)
        XCTAssertEqual(ProposalDecisionOutcome.from(status: 404, data: data("{}")), .refused)
        XCTAssertEqual(ProposalDecisionOutcome.from(status: 400, data: data("{}")), .invalid)
        XCTAssertEqual(ProposalDecisionOutcome.from(status: 503, data: data("{}")), .failed)
        XCTAssertEqual(ProposalDecisionOutcome.doneText(ProposalDecisionResponse(idempotent: true), action: .approve), "Ya estaba aplicado.")
    }

    func testTheDecisionBodyIsTheWebsSpelling() throws {
        let body = ProposalDecisionBody(action: .requestChanges, rev: "r1", adminNotes: "Otro tono")
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as? [String: String]
        XCTAssertEqual(json, ["action": "request_changes", "rev": "r1", "adminNotes": "Otro tono"])
    }

    func testTheListDecodes() throws {
        let json = #"{"proposals":[{"id":"setlistProposal.a","rev":"r1","status":"pending","service":{"kind":"special","date":"2099-01-04","title":"Noche de alabanza"},"leadName":"Luis","coLeads":["Sara"],"songs":[{"songId":"s1","title":"Gracia","author":null,"key":"G","playKey":"A","medleyTag":null}],"pastorMessage":null,"teamNotes":"Llegar 9:00","messages":[],"earlierMessages":[],"threadOpen":true}]}"#
        let answer = try JSONDecoder().decode(AdminProposalsResponse.self, from: Data(json.utf8))
        XCTAssertEqual(answer.proposals.first?.service.kind, .special)
        XCTAssertEqual(answer.proposals.first?.songs.first?.playKey, "A")
        XCTAssertEqual(answer.proposals.first?.proposalStatus, .pending)
    }

    func testTheConversationIsOrderedAsTheWebOrdersIt() {
        let p = AdminProposal(
            id: "a", rev: "r", status: "pending", service: .init(kind: .sunday, date: "2099-01-04", title: "Domingo"),
            leadName: nil, coLeads: [], songs: [], pastorMessage: nil, teamNotes: nil,
            messages: [Self.message("late", at: "2026-11-27T12:00:00Z"), Self.message("undated", at: nil), Self.message("early", at: "2026-11-27T09:00:00.000Z")],
            earlierMessages: [Self.message("before", at: "2026-11-26T08:00:00Z")], threadOpen: true
        )
        XCTAssertEqual(p.conversation.map(\.key), ["before", "early", "undated", "late"])
    }
}
