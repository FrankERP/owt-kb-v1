import XCTest
@testable import Backstage

/// The shared fixtures in `native/contract`, read from the source tree (the Simulator sees the
/// Mac's files): the same files the web's vitest suite reads, so the two sides cannot drift.
private func contractFixture(_ name: String) throws -> Data {
    let native = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // BackstageTests
        .deletingLastPathComponent() // ios
        .deletingLastPathComponent() // native
    return try Data(contentsOf: native.appendingPathComponent("contract").appendingPathComponent(name))
}

private func counter() -> () -> String {
    var n = 0
    return { n += 1; return "t\(n)" }
}

final class ProposalContractTests: XCTestCase {
    private struct SaveCases: Decodable {
        struct Case: Decodable {
            struct State: Decodable {
                struct Song: Decodable { let songId: String; let playKey: String; let medleyTag: String? }
                let roleId: String
                let observed: ObservedTarget
                let songs: [Song]
                let teamNotes: String
                let leadNotes: String
                let pastorMessage: String
            }
            let name: String
            let state: State
            let status: ProposalStatus
        }
        let cases: [Case]
    }

    /// W1 spec D7b: given the matching editor state, the encoder produces each body key for key.
    func testTheSaveBodyIsExactlyTheContractsBody() throws {
        let data = try contractFixture("proposal-save-body.json")
        let fixture = try JSONDecoder().decode(SaveCases.self, from: data)
        let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let rawCases = try XCTUnwrap(raw["cases"] as? [[String: Any]])
        XCTAssertGreaterThanOrEqual(fixture.cases.count, 3)
        for (c, rawCase) in zip(fixture.cases, rawCases) {
            let state = ProposalDraftState(
                roleId: c.state.roleId,
                observed: c.state.observed,
                status: nil,
                songs: c.state.songs.map {
                    DraftSong(songId: $0.songId, title: "x", author: nil, key: nil, playKey: $0.playKey, medleyTag: $0.medleyTag, previousKeys: [])
                },
                teamNotes: c.state.teamNotes,
                leadNotes: c.state.leadNotes,
                pastorMessage: c.state.pastorMessage
            )
            let encoded = try JSONEncoder().encode(state.body(as: c.status))
            let ours = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? NSDictionary, c.name)
            let theirs = try XCTUnwrap(rawCase["body"] as? NSDictionary, c.name)
            XCTAssertEqual(ours, theirs, c.name)
        }
    }

    /// W1 spec D6: the Swift port of `normalizeMedleyTags` gives every shared case exactly.
    func testMedleysNormalizeAsTheWebDoes() throws {
        struct Cases: Decodable {
            struct Case: Decodable { let name: String; let input: [String?]; let expected: [String?] }
            let cases: [Case]
        }
        let fixture = try JSONDecoder().decode(Cases.self, from: try contractFixture("medley-normalize.json"))
        XCTAssertGreaterThanOrEqual(fixture.cases.count, 5)
        for c in fixture.cases {
            XCTAssertEqual(MedleyTags.normalize(c.input, newTag: counter()), c.expected, c.name)
        }
    }

    func testTheEditorReadDecodes() throws {
        let json = """
        {
          "role": { "id": "sun-1", "kind": "sunday", "date": "2099-01-04", "title": "Domingo" },
          "observed": { "state": "single", "id": "setlistProposal.sun-1", "rev": "rev-7" },
          "proposal": {
            "status": "changes_requested",
            "songs": [{ "songId": "song-1", "title": "Santo", "author": null, "key": "G", "play_key": "A",
                        "medley_tag": null, "previous_keys": ["B", "C"] }],
            "contributors": [{ "name": "Ana", "mine": true }],
            "teamNotes": "", "pastorMessage": "", "adminNotes": "Cambiar la segunda",
            "messages": [{ "key": "k1", "authorName": "Beto", "authorRole": "admin", "kind": "admin_change_request",
                           "body": "Hola", "at": "2099-01-01T10:00:00Z", "editedAt": null, "mine": false }]
          },
          "serviceThread": { "messages": [], "pastorMessage": null }
        }
        """
        let answer = try JSONDecoder().decode(ProposalEditorResponse.self, from: Data(json.utf8))
        XCTAssertEqual(answer.observed, .single(id: "setlistProposal.sun-1", rev: "rev-7"))
        let state = ProposalDraftState(loaded: answer)
        XCTAssertEqual(state.status, .changesRequested)
        XCTAssertEqual(state.songs.first?.playKey, "A")
        XCTAssertEqual(state.songs.first?.previousKeys, ["B", "C"])
        XCTAssertTrue(state.proposalExists)
        XCTAssertFalse(state.isDirty)
    }

    func testAServiceWithNoProposalDecodesAsNone() throws {
        let json = """
        { "role": { "id": "sp-1", "kind": "special", "date": "2099-02-01", "title": "Noche" },
          "observed": { "state": "none" }, "proposal": null,
          "serviceThread": { "messages": [], "pastorMessage": "Oremos" } }
        """
        let answer = try JSONDecoder().decode(ProposalEditorResponse.self, from: Data(json.utf8))
        let state = ProposalDraftState(loaded: answer)
        XCTAssertEqual(state.observed, .none)
        XCTAssertNil(state.status)
        XCTAssertTrue(state.songs.isEmpty)
    }

    func testTheServicesListCarriesWhereTheCallerMayPropose() throws {
        let json = """
        { "today": "2099-01-01", "services": [
          { "id": "sun-1", "kind": "sunday", "date": "2099-01-04", "time": "11:00", "title": "Domingo",
            "worshipNight": false, "seated": true, "mySeats": ["Lead"], "sections": [], "songs": [],
            "teamNotes": null, "pastorMessage": null, "canPropose": true, "proposalStatus": "pending" },
          { "id": "sun-2", "kind": "sunday", "date": "2099-01-11", "time": "11:00", "title": "Domingo",
            "worshipNight": false, "seated": false, "mySeats": [], "sections": [], "songs": [],
            "teamNotes": null, "pastorMessage": null, "canPropose": false, "proposalStatus": "a-status-this-build-does-not-know" },
          { "id": "sun-3", "kind": "sunday", "date": "2099-01-18", "time": "11:00", "title": "Domingo",
            "worshipNight": false, "seated": false, "mySeats": [], "sections": [], "songs": [],
            "teamNotes": null, "pastorMessage": null }
        ] }
        """
        let answer = try JSONDecoder().decode(ServicesResponse.self, from: Data(json.utf8))
        XCTAssertTrue(answer.services[0].mayPropose)
        XCTAssertEqual(answer.services[0].proposal, .pending)
        XCTAssertFalse(answer.services[1].mayPropose)
        XCTAssertNil(answer.services[1].proposal)
        // A server that predates the field: nobody may propose, nothing fails.
        XCTAssertFalse(answer.services[2].mayPropose)
    }
}

/// W1 spec D5: every answer of a save, one rule — the lead's edits are never discarded, and the
/// editor never adopts a revision the lead did not see land.
final class ProposalDraftStateTests: XCTestCase {
    private let stored = ObservedTarget.single(id: "setlistProposal.sun-1", rev: "rev-1")

    private func song(_ id: String, key: String = "G", medley: String? = nil) -> DraftSong {
        DraftSong(songId: id, title: id, author: nil, key: key, playKey: key, medleyTag: medley, previousKeys: [])
    }

    private func existing() -> ProposalDraftState {
        ProposalDraftState(roleId: "sun-1", observed: stored, status: .draft, songs: [song("a"), song("b")], teamNotes: "Notas", leadNotes: "", pastorMessage: "")
    }

    private func fresh() -> ProposalDraftState {
        ProposalDraftState(roleId: "sun-1", observed: .none, status: nil, songs: [], teamNotes: "", leadNotes: "", pastorMessage: "")
    }

    func testA200WithARevisionAdoptsItAndTheDraftIsTheSavedState() throws {
        var state = existing()
        state.songs.append(song("c"))
        XCTAssertTrue(state.isDirty)
        let body = try XCTUnwrap(state.beginSave(as: .pending))
        XCTAssertEqual(body.observed, stored)
        state.finishSave(.saved(ProposalSaveResponse(_id: "setlistProposal.sun-1", _rev: "rev-2", status: .pending)))
        XCTAssertEqual(state.observed, .single(id: "setlistProposal.sun-1", rev: "rev-2"))
        XCTAssertEqual(state.status, .pending)
        XCTAssertFalse(state.isDirty)
        XCTAssertNil(state.notice)
        XCTAssertEqual(state.songs.map(\.songId), ["a", "b", "c"])
        XCTAssertTrue(state.canSave)
    }

    func testAnEditMadeWhileTheSaveRunsStaysUnsaved() throws {
        var state = existing()
        state.songs.append(song("c"))
        _ = try XCTUnwrap(state.beginSave(as: .draft))
        // The editor stays editable while the save is in flight.
        state.teamNotes = "Escrito durante el guardado"
        state.finishSave(.saved(ProposalSaveResponse(_id: "setlistProposal.sun-1", _rev: "rev-2", status: .draft)))
        XCTAssertTrue(state.isDirty, "what was typed after the save left is not saved")
        XCTAssertEqual(state.teamNotes, "Escrito durante el guardado")
        state.teamNotes = "Notas"
        XCTAssertFalse(state.isDirty, "what the save sent is the saved state")
    }

    func testAFirstSaveWithANoteToTheAdminsEndsClean() throws {
        var state = fresh()
        state.songs = [song("a")]
        state.leadNotes = "Para los admins"
        _ = try XCTUnwrap(state.beginSave(as: .pending))
        state.finishSave(.saved(ProposalSaveResponse(_id: "setlistProposal.sun-1", _rev: "rev-1", status: .pending)))
        XCTAssertFalse(state.isDirty)
    }

    func testTheEditorReadSayingNoLongerLeadKeepsTheDraft() {
        var state = existing()
        state.teamNotes = "Sin guardar"
        state.noteForbidden()
        XCTAssertEqual(state.notice, .forbidden)
        XCTAssertEqual(state.teamNotes, "Sin guardar")
        XCTAssertEqual(state.songs.map(\.songId), ["a", "b"])
    }

    func testTheSameSongTwiceInAStoredProposalGetsTwoRows() {
        let rows = [song("a"), song("a")]
        XCTAssertEqual(Set(rows.map(\.id)).count, 2)
    }

    func testASaveAnswerCarriesTheThreadOrNone() throws {
        let with = #"{"_id":"setlistProposal.sun-1","_rev":"r2","status":"pending","messages":[{"key":"k1","authorName":"Frank","authorRole":"lead","kind":"lead_note","body":"Va","at":"2026-11-26T10:00:00Z","editedAt":null,"mine":true}]}"#
        let answer = try JSONDecoder().decode(ProposalSaveResponse.self, from: Data(with.utf8))
        XCTAssertEqual(answer.messages?.map(\.key), ["k1"])
        XCTAssertEqual(answer.messages?.first?.mine, true)
        let without = #"{"_id":"setlistProposal.sun-1","_rev":null,"status":"draft","messages":null}"#
        XCTAssertNil(try JSONDecoder().decode(ProposalSaveResponse.self, from: Data(without.utf8)).messages)
    }

    func testA200WithNoRevisionKeepsTheDraftAndWaitsForAReload() throws {
        var state = existing()
        state.teamNotes = "Nuevas"
        _ = try XCTUnwrap(state.beginSave(as: .draft))
        state.finishSave(.saved(ProposalSaveResponse(_id: "setlistProposal.sun-1", _rev: nil, status: .draft)))
        XCTAssertEqual(state.teamNotes, "Nuevas")
        XCTAssertEqual(state.observed, stored, "never a guessed revision")
        XCTAssertEqual(state.notice, .reloadNeeded)
        XCTAssertFalse(state.canSave)
        XCTAssertNil(state.beginSave(as: .draft))
    }

    func testAStaleConflictKeepsTheDraftAndDisablesSavingUntilReload() throws {
        for code in ["stale_revision", "bootstrap_completed_reload"] {
            var state = existing()
            state.songs.append(song("mine"))
            _ = try XCTUnwrap(state.beginSave(as: .draft))
            state.finishSave(.conflict(code: code))
            XCTAssertEqual(state.songs.map(\.songId), ["a", "b", "mine"], code)
            XCTAssertEqual(state.observed, stored, code)
            XCTAssertEqual(state.notice, .reloadNeeded, code)
            XCTAssertFalse(state.canSave, code)
            XCTAssertTrue(state.reloadDiscardsWork, code)
        }
    }

    func testAnyOtherConflictAsksForAnAdminAndKeepsTheDraft() throws {
        var state = existing()
        state.songs.append(song("mine"))
        _ = try XCTUnwrap(state.beginSave(as: .draft))
        state.finishSave(.conflict(code: "integrity_conflict"))
        XCTAssertEqual(state.notice, .needsAdmin)
        XCTAssertEqual(state.songs.count, 3)
        XCTAssertEqual(state.observed, stored)
    }

    func testAFailedOrLostSaveChangesNothingButTheNotice() throws {
        var state = existing()
        state.pastorMessage = "Oremos"
        _ = try XCTUnwrap(state.beginSave(as: .pending))
        state.finishSave(.failed)
        XCTAssertEqual(state.notice, .notSaved)
        XCTAssertEqual(state.observed, stored)
        XCTAssertEqual(state.status, .draft)
        XCTAssertEqual(state.pastorMessage, "Oremos")
        XCTAssertTrue(state.isDirty)
        XCTAssertTrue(state.canSave, "the lead may try again by hand")
    }

    func testADoubleTapSendsOneSave() throws {
        var state = existing()
        XCTAssertNotNil(state.beginSave(as: .draft))
        XCTAssertTrue(state.isSaving)
        XCTAssertFalse(state.canSave)
        XCTAssertNil(state.beginSave(as: .draft))
        XCTAssertNil(state.beginSave(as: .pending))
    }

    /// A save that landed but whose answer was lost, then the lead's retry: the retry carries the
    /// SAME observed revision, the server refuses it with a 409 before writing anything, and the
    /// draft is still there.
    func testALostResponseThenARetryGetsAConflictAndKeepsTheDraft() throws {
        var state = existing()
        state.songs.append(song("c"))
        let first = try XCTUnwrap(state.beginSave(as: .pending))
        state.finishSave(.failed)
        let retry = try XCTUnwrap(state.beginSave(as: .pending))
        XCTAssertEqual(retry.observed, first.observed)
        state.finishSave(.conflict(code: "stale_revision"))
        XCTAssertEqual(state.songs.map(\.songId), ["a", "b", "c"])
        XCTAssertEqual(state.notice, .reloadNeeded)
    }

    /// A co-lead saves between this lead's failure and their retry: the retry still observes the
    /// revision this lead SAW, so the server refuses it rather than overwrite the co-lead.
    func testACoLeadsSaveBetweenAFailureAndARetryIsNeverOverwritten() throws {
        var state = existing()
        state.teamNotes = "Lo mío"
        _ = try XCTUnwrap(state.beginSave(as: .draft))
        state.finishSave(.failed)
        // (A co-lead's save moves the stored revision to rev-9 here; this editor never hears of it.)
        let retry = try XCTUnwrap(state.beginSave(as: .draft))
        XCTAssertEqual(retry.observed, stored, "the retry must not claim a revision it never saw")
        state.finishSave(.conflict(code: "stale_revision"))
        XCTAssertEqual(state.teamNotes, "Lo mío")
        XCTAssertFalse(state.canSave)
    }

    func testTheNoteToTheAdminsTravelsOnlyWhileNoProposalExists() throws {
        var state = fresh()
        state.leadNotes = "Para los admins"
        state.songs = [song("a")]
        let first = try XCTUnwrap(state.beginSave(as: .draft))
        XCTAssertEqual(first.leadNotes, "Para los admins")
        XCTAssertEqual(first.observed, .none)
        state.finishSave(.saved(ProposalSaveResponse(_id: "setlistProposal.sun-1", _rev: "rev-1", status: .draft)))
        XCTAssertTrue(state.proposalExists)
        XCTAssertFalse(state.isDirty, "the note left the fingerprint with the payload")
        let second = try XCTUnwrap(state.beginSave(as: .draft))
        XCTAssertEqual(second.leadNotes, "")
        XCTAssertEqual(second.observed, .single(id: "setlistProposal.sun-1", rev: "rev-1"))
    }

    func testReloadIsTheOnlyPathThatAdoptsTheStoredProposal() throws {
        var state = existing()
        state.songs.append(song("mine"))
        _ = try XCTUnwrap(state.beginSave(as: .draft))
        state.finishSave(.conflict(code: "stale_revision"))
        let freshRead = ProposalEditorResponse(
            role: .init(id: "sun-1", kind: .sunday, date: "2099-01-04", title: "Domingo"),
            observed: .single(id: "setlistProposal.sun-1", rev: "rev-9"),
            proposal: .init(status: .pending, songs: [.init(songId: "z", title: "Z", author: nil, key: "C", play_key: "D", medley_tag: nil, previous_keys: [])],
                            contributors: [], teamNotes: "De otro", pastorMessage: "", adminNotes: nil, messages: []),
            serviceThread: .init(messages: [], pastorMessage: nil)
        )
        state.reload(from: freshRead)
        XCTAssertEqual(state.songs.map(\.songId), ["z"])
        XCTAssertEqual(state.teamNotes, "De otro")
        XCTAssertEqual(state.observed, .single(id: "setlistProposal.sun-1", rev: "rev-9"))
        XCTAssertNil(state.notice)
        XCTAssertTrue(state.canSave)
    }

    func testAForbiddenAnswerKeepsTheDraft() throws {
        var state = existing()
        _ = try XCTUnwrap(state.beginSave(as: .draft))
        state.finishSave(.forbidden)
        XCTAssertEqual(state.notice, .forbidden)
        XCTAssertEqual(state.songs.count, 2)
    }

    func testAnApprovedProposalIsReadOnly() {
        var state = ProposalDraftState(roleId: "sun-1", observed: stored, status: .approved, songs: [song("a")], teamNotes: "", leadNotes: "", pastorMessage: "")
        XCTAssertNil(state.beginSave(as: .draft))
        state.add(songId: "b", title: "b", author: nil, key: "C", previousKeys: [])
        state.remove(at: IndexSet(integer: 0))
        XCTAssertEqual(state.songs.map(\.songId), ["a"])
        XCTAssertFalse(state.isDirty)
    }

    func testTheServersLimitsAreCheckedBeforeSending() {
        var state = existing()
        state.teamNotes = String(repeating: "a", count: ProposalLimits.notesMax + 1)
        XCTAssertNotNil(state.limitProblem)
        XCTAssertFalse(state.canSave)
        XCTAssertNil(state.beginSave(as: .draft))
        state.teamNotes = String(repeating: "a", count: ProposalLimits.notesMax)
        XCTAssertTrue(state.canSave)
    }

    func testReorderingAndRemovingReDeriveMedleys() {
        var state = ProposalDraftState(
            roleId: "sun-1", observed: stored, status: .draft,
            songs: [song("a", medley: "m"), song("b", medley: "m"), song("c")],
            teamNotes: "", leadNotes: "", pastorMessage: ""
        )
        // c moved between a and b breaks the medley apart.
        state.move(from: IndexSet(integer: 2), to: 1, newTag: counter())
        XCTAssertEqual(state.songs.map(\.songId), ["a", "c", "b"])
        XCTAssertEqual(state.songs.map(\.medleyTag), [nil, nil, nil])
        // Linking a and c, then c and b, makes one medley of three.
        state.toggleMedley(at: 0, newTag: counter())
        state.toggleMedley(at: 1, newTag: counter())
        XCTAssertEqual(Set(state.songs.compactMap(\.medleyTag)).count, 1)
        XCTAssertTrue(state.songs.allSatisfy { $0.medleyTag != nil })
        // Splitting between c and b leaves a+c, and b alone.
        state.toggleMedley(at: 1, newTag: counter())
        XCTAssertTrue(MedleyTags.linked(state.songs.map(\.medleyTag), at: 0))
        XCTAssertNil(state.songs[2].medleyTag)
        // Removing c orphans a.
        state.remove(at: IndexSet(integer: 1), newTag: counter())
        XCTAssertEqual(state.songs.map(\.medleyTag), [nil, nil])
    }

    func testAddingASongTwiceAddsItOnce() {
        var state = fresh()
        state.add(songId: "a", title: "A", author: nil, key: "G", previousKeys: [])
        state.add(songId: "a", title: "A", author: nil, key: "G", previousKeys: [])
        XCTAssertEqual(state.songs.count, 1)
        XCTAssertEqual(state.songs[0].playKey, "G")
        state.setPreviousKeys(["a": ["A", "Bb"]])
        XCTAssertEqual(state.songs[0].previousKeys, ["A", "Bb"])
    }

    // MARK: Thread messages (W1b)

    func testOnlyASavedProposalTakesAMessage() {
        var none = fresh()
        XCTAssertFalse(none.canPostMessage)
        XCTAssertNil(none.beginMessage())
        var saved = existing()
        XCTAssertTrue(saved.canPostMessage)
        XCTAssertEqual(saved.beginMessage(), "setlistProposal.sun-1")
    }

    func testAnApprovedProposalStillTakesAMessage() {
        let state = ProposalDraftState(roleId: "sun-1", observed: stored, status: .approved, songs: [], teamNotes: "", leadNotes: "", pastorMessage: "")
        XCTAssertFalse(state.canSave)
        XCTAssertTrue(state.canPostMessage)
    }

    func testTheLeadsOwnPostMovesTheRevisionTheNextSaveSends() throws {
        var state = existing()
        let id = try XCTUnwrap(state.beginMessage())
        state.finishMessage(proposalId: id, rev: "rev-2", observedRev: "rev-1")
        XCTAssertFalse(state.postingMessage)
        XCTAssertEqual(state.observed, .single(id: "setlistProposal.sun-1", rev: "rev-2"))
        XCTAssertEqual(try XCTUnwrap(state.beginSave(as: .draft)).observed, .single(id: "setlistProposal.sun-1", rev: "rev-2"))
    }

    func testARevisionSomeoneElseMovedFirstIsNeverAdopted() throws {
        var state = existing()
        let id = try XCTUnwrap(state.beginMessage())
        state.finishMessage(proposalId: id, rev: "rev-3", observedRev: "rev-2")
        XCTAssertEqual(state.observed, stored)
    }

    func testAPostWithNoReadBackKeepsTheRevision() throws {
        var state = existing()
        let id = try XCTUnwrap(state.beginMessage())
        state.finishMessage(proposalId: id, rev: nil, observedRev: "rev-1")
        XCTAssertEqual(state.observed, stored)
        XCTAssertTrue(state.canSave)
        var lost = existing()
        let again = try XCTUnwrap(lost.beginMessage())
        lost.finishMessage(proposalId: again, rev: nil, observedRev: nil)
        XCTAssertEqual(lost.observed, stored)
    }

    func testARevisionForAnotherProposalIsNeverAdopted() throws {
        var state = existing()
        _ = try XCTUnwrap(state.beginMessage())
        state.finishMessage(proposalId: "setlistProposal.other", rev: "rev-2", observedRev: "rev-1")
        XCTAssertEqual(state.observed, stored)
    }

    func testAMessageInFlightHoldsSavingReloadingAndASecondMessage() throws {
        var state = existing()
        state.songs.append(song("c"))
        _ = try XCTUnwrap(state.beginMessage())
        XCTAssertFalse(state.canSave)
        XCTAssertNil(state.beginSave(as: .draft))
        XCTAssertFalse(state.canReload)
        XCTAssertNil(state.beginMessage())
        let freshRead = ProposalEditorResponse(
            role: .init(id: "sun-1", kind: .sunday, date: "2099-01-04", title: "Domingo"),
            observed: .single(id: "setlistProposal.sun-1", rev: "rev-9"),
            proposal: .init(status: .pending, songs: [], contributors: [], teamNotes: "", pastorMessage: "", adminNotes: nil, messages: []),
            serviceThread: .init(messages: [], pastorMessage: nil)
        )
        state.reload(from: freshRead)
        XCTAssertTrue(state.postingMessage, "a reload in flight must not forget the message")
        XCTAssertEqual(state.songs.map(\.songId), ["a", "b", "c"])
        state.finishMessage(proposalId: "setlistProposal.sun-1", rev: "rev-2", observedRev: "rev-1")
        XCTAssertTrue(state.canSave)
        XCTAssertTrue(state.canReload)
        XCTAssertTrue(state.isDirty, "the unsaved song stays unsaved")
    }

    func testASaveInFlightHoldsTheComposer() throws {
        var state = existing()
        _ = try XCTUnwrap(state.beginSave(as: .draft))
        XCTAssertFalse(state.canPostMessage)
    }

    func testTheDoorsAnswersReadAsOutcomes() {
        func data(_ s: String) -> Data { Data(s.utf8) }
        let ok = ProposalMessageOutcome.from(status: 200, data: data(#"{"messages":[{"key":"a1","authorName":"Frank","authorRole":"lead","kind":"lead_note","body":"Hola","at":"2026-11-27T19:00:00Z","editedAt":null,"mine":true}],"rev":"r2","observedRev":"r1"}"#))
        guard case .posted(let answer) = ok else { return XCTFail("expected posted") }
        XCTAssertEqual(answer.rev, "r2")
        XCTAssertEqual(answer.observedRev, "r1")
        XCTAssertEqual(answer.messages?.map(\.key), ["a1"])
        XCTAssertEqual(ProposalMessageOutcome.from(status: 200, data: data(#"{"messages":null,"rev":null,"observedRev":"r1"}"#)),
                       .posted(ProposalMessageResponse(messages: nil, rev: nil, observedRev: "r1")))
        XCTAssertEqual(ProposalMessageOutcome.from(status: 200, data: data("nope")), .failed)
        XCTAssertEqual(ProposalMessageOutcome.from(status: 400, data: data(#"{"error":"invalid_request","details":{"issues":["thread_closed"]}}"#)), .closed)
        XCTAssertEqual(ProposalMessageOutcome.from(status: 400, data: data(#"{"error":"invalid_request","details":{"issues":["messages_full"]}}"#)), .full)
        XCTAssertEqual(ProposalMessageOutcome.from(status: 400, data: data(#"{"error":"invalid_request","details":{"issues":["notes_length"]}}"#)), .invalid)
        XCTAssertEqual(ProposalMessageOutcome.from(status: 403, data: data("{}")), .forbidden)
        XCTAssertEqual(ProposalMessageOutcome.from(status: 404, data: data("{}")), .refused)
        XCTAssertEqual(ProposalMessageOutcome.from(status: 409, data: data(#"{"error":"integrity_conflict"}"#)), .refused)
        XCTAssertEqual(ProposalMessageOutcome.from(status: 409, data: data(#"{"error":"stale_revision","conflict":true}"#)), .failed)
        XCTAssertEqual(ProposalMessageOutcome.from(status: 503, data: data("{}")), .failed)
    }

    func testTheThreadStaysOpenThroughTheServiceDayInMexicoCity() throws {
        // 2026-11-28 05:30 UTC is still the 27th in Mexico City (UTC-6).
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-11-28T05:30:00Z"))
        XCTAssertTrue(ProposalThreadRule.isOpen(serviceDate: "2026-11-27", now: now))
        XCTAssertTrue(ProposalThreadRule.isOpen(serviceDate: "2026-11-28", now: now))
        XCTAssertFalse(ProposalThreadRule.isOpen(serviceDate: "2026-11-26", now: now))
        XCTAssertFalse(ProposalThreadRule.isOpen(serviceDate: "nope", now: now))
        XCTAssertFalse(ProposalThreadRule.isOpen(serviceDate: "2027-02-30", now: now))
        XCTAssertTrue(ProposalThreadRule.isOpen(serviceDate: "2027-02-24T00:00:00Z", now: now))
    }
}
