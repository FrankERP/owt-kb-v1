import XCTest
@testable import Backstage

/// The shared fixtures in `native/contract`, read from the source tree (see `ProposalTests.swift`).
private func contractFixture(_ name: String) throws -> Data {
    let native = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // BackstageTests
        .deletingLastPathComponent() // ios
        .deletingLastPathComponent() // native
    return try Data(contentsOf: native.appendingPathComponent("contract").appendingPathComponent(name))
}

/// A-W2 («Mensajes del servicio»): the wire, the retry rules of spec D5, and what an answer or a
/// read does to the sheet (D2, A2, A3, A5).
final class ServiceMessagesTests: XCTestCase {
    static let readJSON = """
    {
      "service": {"id":"sat-1","kind":"saturday","date":"2026-12-05","title":"Sábado","published":true,"leads":["Luis","Sara"]},
      "open": true,
      "pastorMessage": {"body":"Dios les bendiga","authorName":"Frank","at":"2026-11-28T10:00:00.000Z","editedAt":null,"stamp":"2026-11-28T10:00:00.000Z"},
      "teamNotes": {"text":"Llegar a las 9:00","observed":{"id":"saturdarSongs.x","rev":"r1"}},
      "proposal": {"status":"pending","offeredPastorMessage":"Otro texto"},
      "serviceMessages": [
        {"key":"k1","authorName":"Frank","authorRole":"admin","kind":"admin_change_request","body":"¿Ya tienen el tono?","at":"2026-11-28T11:00:00Z","editedAt":null,"mine":true,"editable":true},
        {"key":"s1","authorName":"Ana","authorRole":"admin","kind":"admin_change_request","body":"Sin llave","at":"2026-11-28T09:00:00Z","editedAt":null,"mine":false,"editable":false}
      ],
      "proposalMessages": [
        {"key":"p1","authorName":"Luis","authorRole":"lead","kind":"lead_note","body":"Sí","at":"2026-11-28T12:00:00Z","editedAt":null,"mine":false,"editable":false}
      ]
    }
    """

    private func read(_ json: String = readJSON) throws -> ServiceMessages {
        try JSONDecoder().decode(ServiceMessages.self, from: Data(json.utf8))
    }

    private func message(_ key: String, _ body: String, mine: Bool = true, editable: Bool? = true) -> ThreadMessage {
        ThreadMessage(key: key, authorName: "Frank", authorRole: "admin", kind: "admin_change_request", body: body, at: nil, editedAt: nil, mine: mine, editable: editable)
    }

    // MARK: The wire

    /// Spec D3.2: each body the iPhone sends is the contract's, key for key (`observed: null` sent).
    func testTheWriteBodiesAreExactlyTheContractsBodies() throws {
        let data = try contractFixture("service-message-bodies.json")
        let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let cases = try XCTUnwrap(raw["cases"] as? [[String: Any]])
        XCTAssertEqual(cases.count, 5)
        for c in cases {
            let name = try XCTUnwrap(c["name"] as? String)
            let theirs = try XCTUnwrap(c["body"] as? NSDictionary, name)
            let encoded: Data
            switch try XCTUnwrap(c["door"] as? String, name) {
            case "post", "edit":
                encoded = try JSONEncoder().encode(ProposalMessageBody(body: try XCTUnwrap(theirs["body"] as? String)))
            case "pastor":
                encoded = try JSONEncoder().encode(PastorMessageBody(body: try XCTUnwrap(theirs["body"] as? String), observed: theirs["observed"] as? String))
            case "teamNotes":
                let observed = try XCTUnwrap(theirs["observed"] as? [String: String])
                encoded = try JSONEncoder().encode(TeamNotesBody(
                    teamNotes: try XCTUnwrap(theirs["teamNotes"] as? String),
                    observed: TeamNotesTarget(id: try XCTUnwrap(observed["id"]), rev: try XCTUnwrap(observed["rev"]))
                ))
            default:
                XCTFail("unknown door in \(name)")
                continue
            }
            let ours = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? NSDictionary, name)
            XCTAssertEqual(ours, theirs, name)
        }
    }

    func testTheReadDecodesBothThreadsApart() throws {
        let data = try read()
        XCTAssertEqual(data.service.leads, ["Luis", "Sara"])
        XCTAssertEqual(data.pastorMessage?.stamp, "2026-11-28T10:00:00.000Z")
        XCTAssertEqual(data.teamNotes, .target(text: "Llegar a las 9:00", observed: TeamNotesTarget(id: "saturdarSongs.x", rev: "r1")))
        XCTAssertEqual(data.proposal?.offeredPastorMessage, "Otro texto")
        XCTAssertEqual(data.serviceMessages.map(\.key), ["k1", "s1"])
        XCTAssertEqual(data.proposalMessages.map(\.key), ["p1"])
        // Merged and ordered by time for display.
        XCTAssertEqual(data.conversation.map(\.key), ["s1", "k1", "p1"])
    }

    func testEachTeamNotesArmDecodes() throws {
        func notes(_ value: String) throws -> ServiceMessages.TeamNotes {
            try read(#"{"service":{"id":"a","kind":"sunday","date":"2026-12-06","title":"Domingo","published":true,"leads":[]},"open":true,"pastorMessage":null,"teamNotes":\#(value),"proposal":null,"serviceMessages":[],"proposalMessages":[]}"#).teamNotes
        }
        XCTAssertEqual(try notes("null"), .noSetlist)
        XCTAssertEqual(try read(#"{"service":{"id":"a","kind":"sunday","date":"2026-12-06","title":"Domingo","published":true,"leads":[]},"open":true}"#).teamNotes, .noSetlist)
        XCTAssertEqual(try notes(#"{"unavailable":"ambiguous"}"#), .ambiguous)
        XCTAssertEqual(try notes(#"{"text":"","observed":{"id":"featuredSongs.a","rev":"r"}}"#), .target(text: "", observed: TeamNotesTarget(id: "featuredSongs.a", rev: "r")))
    }

    /// The other doors' rows carry no `editable`: never editable.
    func testAMissingEditableIsNotEditable() throws {
        let row = try JSONDecoder().decode(ThreadMessage.self, from: Data(#"{"key":"k","authorName":null,"authorRole":"lead","kind":"lead_note","body":"x","at":null,"editedAt":null,"mine":true}"#.utf8))
        XCTAssertNil(row.editable)
        var state = ServiceMessagesState(data: try read())
        XCTAssertFalse(state.canModify(row))
        XCTAssertTrue(state.canModify(state.data.serviceMessages[0]))
        XCTAssertFalse(state.canModify(state.data.serviceMessages[1]))
        state.outboxBusy = true
        XCTAssertFalse(state.canModify(state.data.serviceMessages[0]), "never while a message is on its way (A2)")
    }

    func testTheDoorsAnswersReadAsOutcomes() {
        typealias O = ServiceWriteOutcome<ServiceThreadAnswer>
        func issues(_ i: String) -> Data { Data(#"{"error":"invalid_request","conflict":false,"details":{"issues":["\#(i)"]}}"#.utf8) }
        XCTAssertEqual(O.from(status: 200, data: Data(#"{"serviceMessages":null}"#.utf8)), .done(ServiceThreadAnswer(serviceMessages: nil)))
        XCTAssertEqual(O.from(status: 200, data: Data("nope".utf8)), .failed)
        XCTAssertEqual(O.from(status: 400, data: issues("thread_closed")), .closed)
        XCTAssertEqual(O.from(status: 400, data: issues("messages_full")), .full)
        XCTAssertEqual(O.from(status: 400, data: issues("json")), .invalid)
        XCTAssertEqual(O.from(status: 403, data: Data()), .forbidden)
        XCTAssertEqual(O.from(status: 404, data: Data()), .notFound)
        XCTAssertEqual(O.from(status: 409, data: Data(#"{"error":"stale_revision","conflict":true}"#.utf8)), .stale)
        XCTAssertEqual(O.from(status: 409, data: Data(#"{"error":"ambiguous_target","conflict":true}"#.utf8)), .blocked)
        XCTAssertEqual(O.from(status: 503, data: Data()), .failed)
    }

    // MARK: Spec D5

    func testAPastorConflictWhoseReadShowsTheSentTextIsSaved() throws {
        let fresh = try read()
        XCTAssertEqual(ServiceMessageRules.pastorVerdict(sent: "Dios les bendiga\r\n", reread: fresh), .saved)
        XCTAssertEqual(ServiceMessageRules.pastorVerdict(sent: "Otro", reread: fresh), .stale)
        var cleared = fresh
        cleared.pastorMessage = nil
        XCTAssertEqual(ServiceMessageRules.pastorVerdict(sent: "", reread: cleared), .saved, "a clear equals no message (A6)")
    }

    func testATeamNotesConflictIsJudgedOnTheReread() throws {
        var fresh = try read()
        XCTAssertEqual(ServiceMessageRules.teamNotesVerdict(sent: " Llegar a las 9:00 ", reread: fresh), .saved)
        XCTAssertEqual(ServiceMessageRules.teamNotesVerdict(sent: "Otra", reread: fresh), .stale)
        fresh.teamNotes = .noSetlist
        XCTAssertEqual(ServiceMessageRules.teamNotesVerdict(sent: "Otra", reread: fresh), .noSetlist)
        fresh.teamNotes = .ambiguous
        XCTAssertEqual(ServiceMessageRules.teamNotesVerdict(sent: "Otra", reread: fresh), .blocked)
    }

    func testADeletes404IsDoneOnlyOnARetry() {
        XCTAssertTrue(ServiceMessageRules.deleteLanded(.notFound, isRetry: true))
        XCTAssertFalse(ServiceMessageRules.deleteLanded(.notFound, isRetry: false))
        XCTAssertTrue(ServiceMessageRules.deleteLanded(.done(ServiceThreadAnswer()), isRetry: false))
        XCTAssertFalse(ServiceMessageRules.deleteLanded(.failed, isRetry: true))
    }

    func testAPostsAnswerReadsAsTheComposersOutcome() {
        let merged = [message("k9", "Hola")]
        XCTAssertEqual(ServiceMessageRules.postOutcome(.done(ServiceThreadAnswer()), merged: merged), .posted(ProposalMessageResponse(messages: merged)))
        XCTAssertEqual(ServiceMessageRules.postOutcome(.done(ServiceThreadAnswer()), merged: nil), .posted(ProposalMessageResponse(messages: nil)))
        XCTAssertEqual(ServiceMessageRules.postOutcome(.stale, merged: nil), .failed, "read before offering it again")
        XCTAssertEqual(ServiceMessageRules.postOutcome(.failed, merged: nil), .failed)
        XCTAssertEqual(ServiceMessageRules.postOutcome(.notFound, merged: nil), .refused)
        XCTAssertEqual(ServiceMessageRules.postOutcome(.blocked, merged: nil), .refused)
        XCTAssertEqual(ServiceMessageRules.postOutcome(.closed, merged: nil), .closed)
        XCTAssertEqual(ServiceMessageRules.postOutcome(.forbidden, merged: nil), .forbidden)
    }

    // MARK: Answers and reads (D2, A3, A5)

    func testAWriteAnswerReplacesTheServiceThreadAndKeepsEveryProposalRow() throws {
        var state = ServiceMessagesState(data: try read())
        state.applyThread([message("k2", "Nuevo")])
        XCTAssertEqual(state.data.serviceMessages.map(\.key), ["k2"])
        XCTAssertEqual(state.data.proposalMessages.map(\.key), ["p1"])
        state.applyThread(nil)
        XCTAssertEqual(state.data.serviceMessages.map(\.key), ["k2"], "a null answer keeps the list")
        XCTAssertEqual(state.data.proposalMessages.map(\.key), ["p1"])
    }

    func testANullReadBackAfterAnEditOrDeleteIsAppliedHere() throws {
        var state = ServiceMessagesState(data: try read())
        state.applyEditLocally(key: "k1", body: "Corregido", at: "2026-11-28T13:00:00.000Z")
        XCTAssertEqual(state.data.serviceMessages[0].body, "Corregido")
        XCTAssertEqual(state.data.serviceMessages[0].editedAt, "2026-11-28T13:00:00.000Z")
        XCTAssertEqual(state.data.serviceMessages[0].editable, true)
        state.applyDeleteLocally(key: "k1")
        XCTAssertEqual(state.data.serviceMessages.map(\.key), ["s1"])
        XCTAssertEqual(state.data.proposalMessages.map(\.key), ["p1"])
    }

    func testOneWriteAtATimeAndNoReadLandsDuringOne() throws {
        var state = ServiceMessagesState(data: try read())
        var other = try read()
        other.serviceMessages = []
        XCTAssertTrue(state.beginWrite())
        XCTAssertFalse(state.beginWrite())
        XCTAssertFalse(state.canPostNow, "a message waits for the edit (A2)")
        XCTAssertFalse(state.adopt(other, ticket: state.startRead()))
        XCTAssertEqual(state.data.serviceMessages.count, 2)
        state.endWrite()
        XCTAssertTrue(state.beginPost())
        XCTAssertFalse(state.canWrite, "an edit waits for the message")
        XCTAssertFalse(state.adopt(other, ticket: state.startRead()))
        state.endPost()
        state.outboxBusy = true
        XCTAssertFalse(state.canWrite, "nor while its fate is being read")
        XCTAssertTrue(state.adopt(other, ticket: state.startRead()), "the check's read lands")
        XCTAssertTrue(state.data.serviceMessages.isEmpty)
    }

    /// A pull started before a message was sent answers after it: it must not erase the message
    /// the outbox already handed over to the thread (a retype would be a second email).
    func testAReadStartedBeforeAWriteEndedNeverLands() throws {
        var state = ServiceMessagesState(data: try read())
        let pulled = state.startRead()
        XCTAssertTrue(state.beginPost())
        state.endPost()
        state.applyThread([message("k1", "¿Ya tienen el tono?"), message("k9", "Nuevo")])
        var older = try read()
        older.serviceMessages = []
        XCTAssertFalse(state.adopt(older, ticket: pulled))
        XCTAssertEqual(state.data.serviceMessages.map(\.key), ["k1", "k9"])
        XCTAssertTrue(state.adopt(older, ticket: state.startRead()), "a read started after it lands")
    }

    /// Two reads in one quiet stretch: the one that started later wins, whichever answers first.
    func testAnOlderReadNeverLandsOverANewerOne() throws {
        var state = ServiceMessagesState(data: try read())
        let slowPull = state.startRead()
        let check = state.startRead()
        var shown = try read()
        shown.serviceMessages = [message("k9", "Llegó")]
        XCTAssertTrue(state.adopt(shown, ticket: check))
        var older = try read()
        older.serviceMessages = []
        XCTAssertFalse(state.adopt(older, ticket: slowPull))
        XCTAssertEqual(state.data.serviceMessages.map(\.key), ["k9"])
    }

    func testAStaleWritesOwnRereadLandsAndEndsIt() throws {
        var state = ServiceMessagesState(data: try read())
        var fresh = try read()
        fresh.pastorMessage = nil
        XCTAssertTrue(state.beginWrite())
        state.settle(with: fresh)
        XCTAssertFalse(state.writing)
        XCTAssertNil(state.data.pastorMessage)
    }

    // MARK: The outbox's words

    func testTheOutboxNamesTheServiceOnTheServiceSheet() {
        var outbox = MessageOutbox()
        let id = outbox.enqueue("Hola", thread: [])
        outbox.markSending(id)
        XCTAssertTrue(outbox.inFlight)
        XCTAssertTrue(outbox.unsettled)
        outbox.resolve(id, .forbidden, thread: nil, words: .service)
        XCTAssertEqual(outbox.items.first?.state, .refused("Ya no puedes escribir en este servicio."))
        XCTAssertFalse(outbox.inFlight)
        XCTAssertFalse(outbox.unsettled)

        var proposal = MessageOutbox()
        let other = proposal.enqueue("Hola", thread: [])
        proposal.resolve(other, .forbidden, thread: nil)
        XCTAssertEqual(proposal.items.first?.state, .refused("Ya no puedes escribir en esta propuesta."), "the proposal screens are unchanged")
    }

    func testAnUnconfirmedMessageKeepsTheSheetOpen() {
        var outbox = MessageOutbox()
        let id = outbox.enqueue("Hola", thread: [])
        outbox.markSending(id)
        outbox.resolve(id, .failed, thread: nil)
        XCTAssertTrue(outbox.inFlight)
        outbox.checked(id, thread: nil)
        XCTAssertFalse(outbox.inFlight)
        XCTAssertTrue(outbox.unsettled, "nobody knows whether it landed (A1)")
    }
}
