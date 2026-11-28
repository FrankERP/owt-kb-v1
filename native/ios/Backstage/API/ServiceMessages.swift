import Foundation

// An admin's «Mensajes del servicio» from the app (ADR-0091 A-W2; spec
// `docs/superpowers/specs/2026-11-28-native-service-messages-design.md`). The server's writers are
// the web dialog's (`app/utils/serviceThreadCommit.ts`); this file holds the app's side:
//
//  - the read (`GET /api/app/v1/admin/service-threads/{roleId}`, app/utils/appServiceMessages.ts);
//  - the write bodies, key for key as `native/contract/service-message-bodies.json` says;
//  - what each write's answer means (`ServiceWriteOutcome`);
//  - `ServiceMessagesState`, the one place that decides what a read or an answer does to the
//    sheet. Its rules: one write at a time (A2); a write answer replaces the SERVICE thread only,
//    never the proposal's (D2); a read never lands while a write is in flight (A5).

// MARK: The wire

struct ServiceMessages: Decodable, Equatable, Sendable {
    struct Service: Decodable, Equatable, Sendable {
        let id: String
        let kind: AppService.Kind
        let date: String
        let title: String
        let published: Bool
        /// Names only.
        let leads: [String]
    }

    struct PastorMessage: Decodable, Equatable, Sendable {
        let body: String
        let authorName: String?
        let at: String?
        let editedAt: String?
        /// Sent back verbatim as the PUT's `observed`: the app never derives it.
        let stamp: String
    }

    /// Where the «Mensaje para el equipo» lives.
    enum TeamNotes: Decodable, Equatable, Sendable {
        /// No setlist yet: the note arrives with the leads' proposal.
        case noSetlist
        /// A duplicated setlist (or an unpublished Studio draft): fix it on the web first.
        case ambiguous
        /// The note, and the setlist revision a save asserts.
        case target(text: String, observed: TeamNotesTarget)

        private enum CodingKeys: String, CodingKey { case unavailable, text, observed }

        init(from decoder: Decoder) throws {
            if let single = try? decoder.singleValueContainer(), single.decodeNil() {
                self = .noSetlist
                return
            }
            let c = try decoder.container(keyedBy: CodingKeys.self)
            if let observed = try c.decodeIfPresent(TeamNotesTarget.self, forKey: .observed) {
                self = .target(text: try c.decodeIfPresent(String.self, forKey: .text) ?? "", observed: observed)
            } else {
                // `{unavailable: "ambiguous"}`, or a shape this build does not know: not editable.
                self = .ambiguous
            }
        }
    }

    struct Proposal: Decodable, Equatable, Sendable {
        /// A string on the wire, so a status this build does not know never fails the read.
        let status: String
        /// A submitted proposal's pastor's message that differs from the service's (the web's
        /// «Usar como mensaje del pastor», ADR-0087); nil = nothing to offer.
        let offeredPastorMessage: String?
    }

    let service: Service
    /// The writers' `isThreadOpen` at read time: the conversation takes messages.
    let open: Bool
    var pastorMessage: PastorMessage?
    var teamNotes: TeamNotes
    let proposal: Proposal?
    var serviceMessages: [ThreadMessage]
    let proposalMessages: [ThreadMessage]

    private enum CodingKeys: String, CodingKey {
        case service, open, pastorMessage, teamNotes, proposal, serviceMessages, proposalMessages
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        service = try c.decode(Service.self, forKey: .service)
        open = try c.decodeIfPresent(Bool.self, forKey: .open) ?? false
        pastorMessage = try c.decodeIfPresent(PastorMessage.self, forKey: .pastorMessage)
        teamNotes = try c.decodeIfPresent(TeamNotes.self, forKey: .teamNotes) ?? .noSetlist
        proposal = try c.decodeIfPresent(Proposal.self, forKey: .proposal)
        serviceMessages = try c.decodeIfPresent([ThreadMessage].self, forKey: .serviceMessages) ?? []
        proposalMessages = try c.decodeIfPresent([ThreadMessage].self, forKey: .proposalMessages) ?? []
    }

    /// Both threads as one conversation, deduplicated by key and ordered as the web orders it.
    var conversation: [ThreadMessage] {
        var seen = Set<String>()
        let all = (serviceMessages + proposalMessages).filter { seen.insert($0.key).inserted }
        return AdminProposal.ordered(all)
    }
}

/// The setlist (or special role) document a team-note save asserts: document ids only.
struct TeamNotesTarget: Codable, Equatable, Sendable {
    let id: String
    let rev: String
}

/// `PUT …/pastor-message`. `observed` is the stamp the edit STARTED from, or `null` for a message
/// that did not exist: always sent, because the server refuses a body without it.
struct PastorMessageBody: Encodable, Equatable, Sendable {
    let body: String
    let observed: String?

    private enum CodingKeys: String, CodingKey { case body, observed }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(body, forKey: .body)
        try c.encode(observed, forKey: .observed)
    }
}

/// `PUT …/team-notes`: the whole note (empty clears it) and the target it was started on.
struct TeamNotesBody: Encodable, Equatable, Sendable {
    let teamNotes: String
    let observed: TeamNotesTarget
}

/// A message write's 200 (POST, PATCH, DELETE): the SERVICE thread after the write, or nil when
/// the server could not read it back (keep what is shown).
struct ServiceThreadAnswer: Decodable, Equatable, Sendable {
    var serviceMessages: [ThreadMessage]? = nil
}

/// The pastor's-message PUT's 200: the message after the write (nil = none).
struct PastorAnswer: Decodable, Equatable, Sendable {
    var pastorMessage: ServiceMessages.PastorMessage? = nil
}

/// The team-notes PUT's 200: the note after the write and the target's new revision.
struct TeamNotesAnswer: Decodable, Equatable, Sendable {
    var teamNotes: String? = nil
    let observed: TeamNotesTarget
}

/// What became of one write, read from the status, `error` and `issues` only: nothing else
/// crosses the app's doors (spec D3.1 step 8).
enum ServiceWriteOutcome<Answer: Decodable & Equatable & Sendable>: Equatable, Sendable {
    case done(Answer)
    /// `400 thread_closed`: the service day has passed.
    case closed
    /// `400 messages_full`: the thread holds its maximum.
    case full
    /// Any other `400`.
    case invalid
    /// `403`: not an admin any more, or not the message's author.
    case forbidden
    /// `404`: the service, or the message, is gone.
    case notFound
    /// `409 stale_revision`: something moved since the screen read it.
    case stale
    /// Any other `409`: a duplicated setlist or a Studio draft the web must fix.
    case blocked
    /// `503`, any other status, a timeout or a lost answer: it may or may not have landed.
    case failed

    private struct Refusal: Decodable {
        struct Details: Decodable { let issues: [String]? }
        let error: String?
        let details: Details?
    }

    static func from(status: Int, data: Data) -> ServiceWriteOutcome {
        switch status {
        case 200..<300:
            guard let answer = try? JSONDecoder().decode(Answer.self, from: data) else { return .failed }
            return .done(answer)
        case 400:
            let issues = (try? JSONDecoder().decode(Refusal.self, from: data))?.details?.issues ?? []
            if issues.contains("thread_closed") { return .closed }
            if issues.contains("messages_full") { return .full }
            return .invalid
        case 403: return .forbidden
        case 404: return .notFound
        case 409:
            let code = (try? JSONDecoder().decode(Refusal.self, from: data))?.error
            return code == "stale_revision" ? .stale : .blocked
        default: return .failed
        }
    }
}

// MARK: The rules

enum ServiceMessageRules {
    /// The web's blocked copy (a duplicated setlist or a Studio draft).
    static let blockedCopy = "Este servicio tiene un setlist duplicado o un borrador sin publicar en Studio; corrígelo ahí antes de editar el mensaje."
    static let pastorStaleCopy = "Otro admin cambió este mensaje mientras lo editabas. Recarga para ver el actual."
    static let teamStaleCopy = "Alguien cambió el setlist o el mensaje mientras lo editabas. Recarga para ver el actual."
    static let noSetlistCopy = "Este servicio aún no tiene setlist. El mensaje para el equipo llega con la propuesta de los líderes."
    static let movedButKeptCopy = "Ya es el mensaje del pastor, pero no se pudo quitar de aquí. Bórralo con «Editar»."
    static let forbiddenCopy = "No tienes permiso para hacer esto."
    static let failedCopy = "No se pudo guardar. Revisa tu conexión."

    /// The server's `comparablePastor`: trimmed, line endings folded.
    static func folded(_ text: String?) -> String {
        (text ?? "")
            .trimmingCharacters(in: MessageOutbox.trimmed)
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
    }

    /// What a re-read after a `409 stale_revision` says about the phone's OWN write (spec D5). It
    /// never judges another admin's write: a different text is the conflict it is.
    enum Verdict: Equatable, Sendable {
        /// The stored text is what the phone sent: its write landed (a lost answer, then a resend).
        case saved
        /// Someone else's text: show the stale copy with «Recargar».
        case stale
        /// The setlist is gone: the note has nowhere to live yet.
        case noSetlist
        /// The setlist is duplicated now.
        case blocked
    }

    /// A pastor's-message PUT refused as stale. A clear (`""`) equals a re-read with no message (A6).
    static func pastorVerdict(sent body: String, reread: ServiceMessages) -> Verdict {
        folded(body) == folded(reread.pastorMessage?.body) ? .saved : .stale
    }

    /// A team-notes PUT refused as stale.
    static func teamNotesVerdict(sent text: String, reread: ServiceMessages) -> Verdict {
        switch reread.teamNotes {
        case .noSetlist: return .noSetlist
        case .ambiguous: return .blocked
        case .target(let stored, _): return folded(stored) == folded(text) ? .saved : .stale
        }
    }

    /// A DELETE's answer: a `404` on a RETRY of the phone's own delete is that delete having
    /// landed the first time (spec D5).
    static func deleteLanded(_ outcome: ServiceWriteOutcome<ServiceThreadAnswer>, isRetry: Bool) -> Bool {
        switch outcome {
        case .done: return true
        case .notFound: return isRetry
        default: return false
        }
    }

    /// What the conversation's composer reads from a POST's answer. `merged` is the conversation
    /// once the answer is applied, or nil when the answer brought no thread.
    static func postOutcome(_ outcome: ServiceWriteOutcome<ServiceThreadAnswer>, merged: [ThreadMessage]?) -> ProposalMessageOutcome {
        switch outcome {
        case .done: return .posted(ProposalMessageResponse(messages: merged))
        case .closed: return .closed
        case .full: return .full
        case .invalid: return .invalid
        case .forbidden: return .forbidden
        case .notFound, .blocked: return .refused
        // A `stale_revision` on a POST is a Sanity write conflict: nothing was stored, but the
        // outbox reads the thread before offering it again, as for any lost answer.
        case .stale, .failed: return .failed
        }
    }
}

// MARK: The sheet's state

/// One service's messages open in the sheet. Pure, so each rule has its own XCTest.
struct ServiceMessagesState: Equatable, Sendable {
    private(set) var data: ServiceMessages
    /// A pastor's-message, team-note, edit or delete write on its way.
    private(set) var writing = false
    /// A message POST on its way (the sheet's own call).
    private(set) var posting = false
    /// The conversation has a message on its way or being checked (reported by its outbox).
    var outboxBusy = false
    /// Bumped whenever a write ends (its answer, or its own re-read, landed): a read started before
    /// that predates what the screen now shows, and must not land over it.
    private(set) var epoch = 0
    /// Reads are numbered as they start; one lands only if it is newer than the last one that did,
    /// so a slow pull never undoes a quicker check that already showed a message.
    private var readsStarted = 0
    private var lastLanded = 0

    /// What a read carries from its start to its answer.
    struct ReadTicket: Equatable, Sendable {
        let epoch: Int
        let number: Int
    }

    /// Called just before a read of the door is sent.
    mutating func startRead() -> ReadTicket {
        readsStarted += 1
        return ReadTicket(epoch: epoch, number: readsStarted)
    }

    init(data: ServiceMessages) { self.data = data }

    var conversation: [ThreadMessage] { data.conversation }

    /// One write at a time, in either direction (A2).
    var canWrite: Bool { !writing && !posting && !outboxBusy }
    var canPostNow: Bool { !writing }

    /// Offers «Editar»/«Eliminar» on a message: the server marked it the caller's own, keyed and in
    /// the open service thread, and nothing else is in flight.
    func canModify(_ message: ThreadMessage) -> Bool {
        data.open && message.editable == true && canWrite
    }

    mutating func beginWrite() -> Bool {
        guard canWrite else { return false }
        writing = true
        return true
    }

    mutating func endWrite() {
        writing = false
        epoch += 1
    }

    mutating func beginPost() -> Bool {
        guard canPostNow, !posting else { return false }
        posting = true
        return true
    }

    mutating func endPost() {
        posting = false
        epoch += 1
    }

    /// A read of the door, with the ticket it started with. Refused (false) while a write is in
    /// flight, when a write ended after the read started (that write's answer, not an older read,
    /// says what the screen shows: a message the outbox already handed over must not vanish), and
    /// when a read that started later has already landed.
    @discardableResult
    mutating func adopt(_ read: ServiceMessages, ticket: ReadTicket) -> Bool {
        guard !writing, !posting, ticket.epoch == epoch, ticket.number > lastLanded else { return false }
        data = read
        lastLanded = ticket.number
        return true
    }

    /// A write's own re-read after its `409 stale_revision` (spec D5): it lands, and the write ends.
    mutating func settle(with read: ServiceMessages) {
        data = read
        writing = false
        epoch += 1
    }

    /// A message write's answer: it replaces the SERVICE thread only; nil keeps it (D2).
    mutating func applyThread(_ messages: [ThreadMessage]?) {
        if let messages { data.serviceMessages = messages }
    }

    /// A PATCH whose read-back failed: the edit applied here, as the web does (A3).
    mutating func applyEditLocally(key: String, body: String, at now: String) {
        data.serviceMessages = data.serviceMessages.map { message in
            guard message.key == key else { return message }
            return ThreadMessage(
                key: message.key, authorName: message.authorName, authorRole: message.authorRole,
                kind: message.kind, body: body, at: message.at, editedAt: now, mine: message.mine,
                editable: message.editable
            )
        }
    }

    /// A DELETE whose read-back failed (or a retry's 404): the row removed here (A3).
    mutating func applyDeleteLocally(key: String) {
        data.serviceMessages.removeAll { $0.key == key }
    }

    mutating func applyPastor(_ message: ServiceMessages.PastorMessage?) {
        data.pastorMessage = message
    }

    mutating func applyTeamNotes(_ text: String?, observed: TeamNotesTarget) {
        data.teamNotes = .target(text: text ?? "", observed: observed)
    }
}
