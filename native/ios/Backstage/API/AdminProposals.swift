import Foundation

// An admin reviews the leads' setlist proposals from the app (ADR-0091 A-W1; spec
// `docs/superpowers/specs/2026-11-27-native-admin-proposal-review-design.md`). The server's writers
// are the web's (`reviewProposal` in `app/utils/proposalReviewCommit.ts`, `postAdminProposalMessage`
// in `app/utils/proposalMessageCommit.ts`); this file holds the app's side of the contract:
//
//  - the list (`GET /api/app/v1/admin/proposals`, app/utils/appAdminProposals.ts);
//  - the decision body and what its answer means;
//  - `ProposalReviewState`, the one place that decides which revision a decision carries. Its rule:
//    a decision only ever carries the revision whose content was on screen when the admin chose.
//    That revision comes from a list read and from nothing else — never from a message's read-back,
//    which can fold in a lead's save the screen does not show.

// MARK: The wire

struct AdminProposal: Decodable, Equatable, Identifiable, Sendable {
    struct Service: Decodable, Equatable, Sendable {
        let kind: AppService.Kind
        let date: String
        let title: String
    }

    struct Song: Decodable, Equatable, Sendable {
        let songId: String
        let title: String
        let author: String?
        let key: String?
        /// The key the lead proposes (the web's `play_key || key`).
        let playKey: String
        let medleyTag: String?
    }

    let id: String
    let rev: String
    /// A string on the wire, so a status this build does not know never fails the whole list.
    let status: String
    let service: Service
    let leadName: String?
    let coLeads: [String]
    let songs: [Song]
    let pastorMessage: String?
    let teamNotes: String?
    var messages: [ThreadMessage]
    let earlierMessages: [ThreadMessage]
    /// The writers' `isThreadOpen`: the service is today or later in Mexico City.
    let threadOpen: Bool

    var proposalStatus: ProposalStatus? { ProposalStatus(rawValue: status) }

    /// What the admin decides on. A change to any of it under an open detail must be seen again
    /// before a decision (spec D4). The thread is not part of it: a message is not a decision.
    struct Content: Equatable, Sendable {
        let songs: [Song]
        let teamNotes: String?
        let pastorMessage: String?
        let status: String
    }

    var content: Content { Content(songs: songs, teamNotes: teamNotes, pastorMessage: pastorMessage, status: status) }

    /// The service's earlier messages, then the proposal's thread, deduplicated by key and ordered
    /// as the web's `orderedMessages`: the dated ones by time among their own places, an undated one
    /// where it stands.
    var conversation: [ThreadMessage] {
        var seen = Set<String>()
        let all = (earlierMessages + messages).filter { seen.insert($0.key).inserted }
        return Self.ordered(all)
    }

    static func ordered(_ messages: [ThreadMessage]) -> [ThreadMessage] {
        let parse = ISO8601DateFormatter()
        parse.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        func instant(_ at: String?) -> Date? {
            guard let at else { return nil }
            return parse.date(from: at) ?? plain.date(from: at)
        }
        let datable = messages.enumerated().compactMap { index, message in
            instant(message.at).map { (index: index, at: $0, message: message) }
        }
        let slots = datable.map(\.index)
        let sorted = datable.sorted { $0.at != $1.at ? $0.at < $1.at : $0.index < $1.index }
        var out = messages
        for (slot, entry) in zip(slots, sorted) { out[slot] = entry.message }
        return out
    }
}

struct AdminProposalsResponse: Decodable, Equatable, Sendable {
    let proposals: [AdminProposal]
}

/// The three decisions `/admin`'s «Propuestas» offers; the door refuses any other.
enum ProposalAction: String, Encodable, Sendable {
    case approve
    case requestChanges = "request_changes"
    case reopen
}

/// `PATCH /api/app/v1/admin/proposals/{id}`: the web's body. `rev` is the revision the admin
/// reviewed (`ProposalReviewState.beginDecision`), never one fetched for the purpose.
struct ProposalDecisionBody: Encodable, Equatable, Sendable {
    let action: ProposalAction
    let rev: String
    let adminNotes: String
}

/// The door's 200: the status after the call, whether it was a no-write replay, and what an
/// approval did with the leads' pastor's message (ADR-0087).
struct ProposalDecisionResponse: Decodable, Equatable, Sendable {
    var status: String? = nil
    var idempotent: Bool = false
    var pastorMessage: String? = nil
}

/// What became of one decision.
enum ProposalDecisionOutcome: Equatable, Sendable {
    case done(ProposalDecisionResponse)
    /// `409 stale_revision` / `bootstrap_completed_reload`: something moved; reload and look again.
    case conflict
    /// Any other `409`: the proposal has a problem a reload alone will not fix.
    case blocked
    /// `403`: no longer an admin.
    case forbidden
    /// `404`: the proposal is gone.
    case refused
    /// Any other `400`.
    case invalid
    /// `503`, any other status, a timeout or a lost answer: it may or may not have landed. A
    /// repeated identical decision is a no-write replay on the server, so retrying is safe.
    case failed
    /// Nothing was sent: a second tap, something else in flight, or the proposal moved while the
    /// sheet was open.
    case notSent

    static let reloadCodes: Set<String> = ["stale_revision", "bootstrap_completed_reload"]

    private struct Refusal: Decodable { let error: String? }

    static func from(status: Int, data: Data) -> ProposalDecisionOutcome {
        switch status {
        case 200..<300:
            guard let answer = try? JSONDecoder().decode(ProposalDecisionResponse.self, from: data) else { return .failed }
            return .done(answer)
        case 400: return .invalid
        case 403: return .forbidden
        case 404: return .refused
        case 409:
            let code = (try? JSONDecoder().decode(Refusal.self, from: data))?.error ?? ""
            return reloadCodes.contains(code) ? .conflict : .blocked
        default: return .failed
        }
    }

    /// What the detail says after a decision that landed (the web's toasts).
    static func doneText(_ answer: ProposalDecisionResponse, action: ProposalAction) -> String {
        if answer.idempotent { return "Ya estaba aplicado." }
        switch action {
        case .approve:
            switch answer.pastorMessage {
            case "copied": return "Aprobada. El mensaje del pastor quedó en el servicio."
            case "kept_existing": return "Aprobada. El servicio ya tenía otro mensaje del pastor; no se cambió (revísalo en la web)."
            case "failed": return "Aprobada, pero no se pudo pasar el mensaje del pastor. Pásalo desde la web."
            default: return "Setlist publicado."
            }
        case .requestChanges: return "Cambios solicitados."
        case .reopen: return "Propuesta reabierta."
        }
    }
}

// MARK: The review state

/// One proposal open in the detail, and every rule about when a decision may be sent and with
/// which revision (spec D4). Pure: no network, no clock, so each rule has its own XCTest.
struct ProposalReviewState: Equatable, Sendable {
    /// What is on screen. Its `rev` is `heldRev`.
    private(set) var proposal: AdminProposal
    /// The fail-closed lock: a decision's 409, or a message whose server saw another revision.
    private(set) var locked = false
    /// Why it is locked, for the banner.
    private(set) var lockReason: ProposalDecisionOutcome?
    /// False after a reload changed what the admin decides on, until they say they looked again.
    private(set) var changeSeen = true
    /// The proposal left the list (decided into a past-dated status, or deleted).
    private(set) var gone = false
    private(set) var deciding = false
    private(set) var posting = false
    /// Set by a decision that landed: the next reload compares everything but the status, which
    /// the admin's own decision changed.
    private var ownStatusChange = false

    init(proposal: AdminProposal) { self.proposal = proposal }

    /// The revision a decision carries. Written only by a list read (`apply`).
    var heldRev: String { proposal.rev }

    var status: ProposalStatus? { proposal.proposalStatus }
    var reviewable: Bool { status == .pending || status == .changesRequested }

    func canDecide(_ action: ProposalAction) -> Bool {
        guard !deciding, !posting, !locked, changeSeen, !gone else { return false }
        switch action {
        case .approve: return reviewable && !proposal.songs.isEmpty
        case .requestChanges: return reviewable
        case .reopen: return status == .approved
        }
    }

    /// A locked proposal may still take a message, as on the web.
    var canPost: Bool { !deciding && !posting && !gone && proposal.threadOpen }

    /// A list read may land on the detail only when nothing is in flight.
    var canApply: Bool { !deciding && !posting }

    enum Begin: Equatable {
        case send(rev: String)
        /// Something is in flight or the action is not allowed now: send nothing, say nothing.
        case busy
        /// The proposal moved since the sheet was opened on `openedRev`: send nothing.
        case moved
    }

    /// A decision's confirming tap. `openedRev` is the revision on screen when the sheet or the
    /// confirmation opened.
    mutating func beginDecision(_ action: ProposalAction, openedRev: String) -> Begin {
        guard canDecide(action) else { return .busy }
        guard openedRev == heldRev else { return .moved }
        deciding = true
        return .send(rev: heldRev)
    }

    mutating func finishDecision(_ outcome: ProposalDecisionOutcome) {
        deciding = false
        switch outcome {
        case .conflict, .blocked:
            locked = true
            lockReason = outcome
        case .done:
            ownStatusChange = true
        case .forbidden, .refused, .invalid, .failed, .notSent:
            break
        }
    }

    /// The proposal id to post to, or nil when a message cannot be sent now.
    mutating func beginMessage() -> String? {
        guard canPost else { return nil }
        posting = true
        return proposal.id
    }

    /// A message's answer. It NEVER adopts the answer's `rev`: that revision is read after the
    /// append, which asserts none, so a lead's save can be folded into it while the screen still
    /// shows the old songs. When the server saw another revision than the one held, it locks (the
    /// web's `postAndLock`); the reload that follows every message brings content and revision
    /// together.
    mutating func finishMessage(proposalId: String, observedRev: String?, messages: [ThreadMessage]?) {
        posting = false
        guard proposalId == proposal.id else { return }
        if let observedRev, observedRev != heldRev {
            locked = true
            lockReason = .conflict
        }
        if let messages { proposal.messages = messages }
    }

    /// A message that was not answered (or refused): only the flight ends.
    mutating func endMessage() { posting = false }

    /// A list read. Returns false (and changes nothing) while something is in flight; the detail
    /// reloads again when it ends. A read always clears the lock: the content and the revision on
    /// screen are then one document's. A change to what the admin decides on raises the notice
    /// and holds every decision until `acknowledgeChange`.
    @discardableResult
    mutating func apply(_ list: [AdminProposal]) -> Bool {
        guard canApply else { return false }
        guard let row = list.first(where: { $0.id == proposal.id }) else {
            gone = true
            return true
        }
        let before = proposal.content
        let after = row.content
        let changed: Bool
        if ownStatusChange {
            changed = before.songs != after.songs || before.teamNotes != after.teamNotes || before.pastorMessage != after.pastorMessage
        } else {
            changed = before != after
        }
        ownStatusChange = false
        if changed { changeSeen = false }
        proposal = row
        gone = false
        locked = false
        lockReason = nil
        return true
    }

    mutating func acknowledgeChange() { changeSeen = true }
}
