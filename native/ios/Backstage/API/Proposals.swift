import Foundation

// A Lead proposes a service's setlist from the app (ADR-0091 W1). The server's writer is the web's
// (`app/utils/proposalSaveCommit.ts`); this file holds the app's side of the contract:
//
//  - the editor read (`GET /api/app/v1/proposals/{roleId}`, app/utils/appProposalEditor.ts);
//  - the save body, encoded key for key as `native/contract/proposal-save-body.json` says, because
//    the server ignores a key it does not know and treats a missing notes field as empty: a key
//    spelled differently would still get a 200 and drop keys, medleys or the co-leads' notes;
//  - `ProposalDraftState`, the one place that decides what a save's answer does to the lead's
//    work. Its rule: the lead's edits are never discarded, and the editor never adopts a revision
//    the lead did not see land.

// MARK: The wire

/// What the app saw of the service's ONE shared proposal. The server refuses a save unless the
/// proposal is still exactly this (or, for `none`, unless none exists yet).
enum ObservedTarget: Codable, Equatable, Sendable {
    case none
    case single(id: String, rev: String)

    private enum CodingKeys: String, CodingKey { case state, id, rev }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        switch try c.decode(String.self, forKey: .state) {
        case "none": self = .none
        case "single": self = .single(id: try c.decode(String.self, forKey: .id), rev: try c.decode(String.self, forKey: .rev))
        default: throw DecodingError.dataCorruptedError(forKey: .state, in: c, debugDescription: "unknown observed state")
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .none:
            try c.encode("none", forKey: .state)
        case .single(let id, let rev):
            try c.encode("single", forKey: .state)
            try c.encode(id, forKey: .id)
            try c.encode(rev, forKey: .rev)
        }
    }

    var exists: Bool {
        if case .single = self { return true }
        return false
    }
}

enum ProposalStatus: String, Codable, Sendable {
    case draft, pending, approved
    case changesRequested = "changes_requested"

    /// The web's `STATUS_LABEL`.
    var label: String {
        switch self {
        case .draft: "Borrador"
        case .pending: "Pendiente de revisión"
        case .approved: "Aprobada"
        case .changesRequested: "Cambios solicitados"
        }
    }
}

/// `GET /api/app/v1/proposals/{roleId}`.
struct ProposalEditorResponse: Decodable, Equatable, Sendable {
    struct Role: Decodable, Equatable, Sendable {
        let id: String
        let kind: AppService.Kind
        let date: String
        let title: String
    }

    struct Song: Decodable, Equatable, Sendable {
        let songId: String
        let title: String
        let author: String?
        let key: String?
        let play_key: String
        let medley_tag: String?
        let previous_keys: [String]
    }

    struct Contributor: Decodable, Equatable, Sendable {
        let name: String
        let mine: Bool
    }

    struct Proposal: Decodable, Equatable, Sendable {
        let status: ProposalStatus
        let songs: [Song]
        let contributors: [Contributor]
        let teamNotes: String
        let pastorMessage: String
        let adminNotes: String?
        let messages: [ThreadMessage]
    }

    struct ServiceThread: Decodable, Equatable, Sendable {
        let messages: [ThreadMessage]
        let pastorMessage: String?
    }

    let role: Role
    let observed: ObservedTarget
    let proposal: Proposal?
    let serviceThread: ServiceThread
}

struct ThreadMessage: Decodable, Equatable, Identifiable, Sendable {
    let key: String
    let authorName: String?
    let authorRole: String?
    let kind: String?
    let body: String
    let at: String?
    let editedAt: String?
    let mine: Bool

    var id: String { key }
}

/// One row of the save body: the server's spelling, `medley_tag` always present (`null` = none).
struct ProposalSaveSong: Encodable, Equatable, Sendable {
    let songId: String
    let playKey: String
    let medleyTag: String?

    private enum CodingKeys: String, CodingKey {
        case songId
        case playKey = "play_key"
        case medleyTag = "medley_tag"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(songId, forKey: .songId)
        try c.encode(playKey, forKey: .playKey)
        // `encode`, not `encodeIfPresent`: a missing key and `null` both mean «no medley» to the
        // server, but the contract fixture pins `null` so the two sides read the same.
        try c.encode(medleyTag, forKey: .medleyTag)
    }
}

/// `POST /api/app/v1/proposals`. Every notes field is always sent: an omitted `teamNotes` would
/// erase the stored team notes, and `pastorMessage` is sent cleared (`""`) as the web sends it.
struct ProposalSaveBody: Encodable, Equatable, Sendable {
    let roleId: String
    let observed: ObservedTarget
    let songs: [ProposalSaveSong]
    let leadNotes: String
    let teamNotes: String
    let pastorMessage: String
    let status: ProposalStatus
}

/// The writer's 200: the proposal's id, its new revision (`null` when the commit landed but the
/// read-back failed) and its status.
struct ProposalSaveResponse: Decodable, Equatable, Sendable {
    let _id: String?
    let _rev: String?
    let status: ProposalStatus
    /// The proposal's thread as it stands after the save (a submission adds the lead's note).
    /// `nil` when the server could not read it back: keep what is shown, never blank it.
    var messages: [ThreadMessage]? = nil
}

/// What became of one save, as the editor needs it.
enum ProposalSaveOutcome: Equatable, Sendable {
    case saved(ProposalSaveResponse)
    /// `409`, with the server's code (`stale_revision`, `integrity_conflict`, …).
    case conflict(code: String)
    /// `403`: no longer a Lead of a published service, or no longer in Alabanza.
    case forbidden
    /// `400`: the server refused the body (a limit the app should have caught first).
    case invalid
    /// `503`, any other status, a timeout or a lost answer: the save may or may not have landed.
    case failed
}

// MARK: A message in a saved proposal's thread (W1b)

/// `POST /api/app/v1/proposal-messages/{proposalId}`: the web's lead thread writer, through the app's
/// door (`app/utils/proposalMessageCommit.ts`). The body is the web composer's, `{ body }`.
struct ProposalMessageBody: Encodable, Equatable, Sendable {
    let body: String
}

/// The door's 200: the proposal's thread after the append (`nil` when it could not be read back:
/// keep what is shown, never blank it), the revision after the append, and the one read just before.
struct ProposalMessageResponse: Decodable, Equatable, Sendable {
    var messages: [ThreadMessage]? = nil
    var rev: String? = nil
    var observedRev: String? = nil
}

/// What became of one message, as the composer needs it.
enum ProposalMessageOutcome: Equatable, Sendable {
    case posted(ProposalMessageResponse)
    /// `403`: no longer a Lead of a published service, or no longer in Alabanza.
    case forbidden
    /// `400 thread_closed`: the service day has passed.
    case closed
    /// `400 messages_full`: the thread holds its maximum.
    case full
    /// Any other `400`: the server refused the text.
    case invalid
    /// `404` / `409`: the proposal is gone or needs an admin; sending again would not help.
    case refused
    /// `503`, any other status, a timeout or a lost answer: the message may or may not have landed.
    case failed

    private struct Refusal: Decodable {
        struct Details: Decodable { let issues: [String]? }
        let details: Details?
    }

    /// The door's answer read as an outcome. Pure, so each mapping has its own XCTest.
    static func from(status: Int, data: Data) -> ProposalMessageOutcome {
        switch status {
        case 200..<300:
            guard let answer = try? JSONDecoder().decode(ProposalMessageResponse.self, from: data) else { return .failed }
            return .posted(answer)
        case 400:
            let issues = (try? JSONDecoder().decode(Refusal.self, from: data))?.details?.issues ?? []
            if issues.contains("thread_closed") { return .closed }
            if issues.contains("messages_full") { return .full }
            return .invalid
        case 403: return .forbidden
        case 404, 409: return .refused
        default: return .failed
        }
    }
}

/// The writer's `isThreadOpen` (app/utils/proposalThread.ts): the conversation stays open through
/// the service day, in Mexico City, whatever the phone's own zone. A date that is not a day is
/// closed, as the server fails closed. The server decides anyway; this only hides a composer that
/// would be refused.
enum ProposalThreadRule {
    static func isOpen(serviceDate: String, now: Date = Date()) -> Bool {
        let day = String(serviceDate.prefix(10))
        guard day.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return false }
        let format = DateFormatter()
        format.calendar = Calendar(identifier: .gregorian)
        format.locale = Locale(identifier: "en_US_POSIX")
        format.timeZone = ServiceEvent.zone
        format.dateFormat = "yyyy-MM-dd"
        return day >= format.string(from: now)
    }
}

// MARK: Limits (the server's, checked before sending so a 400 is never the first a lead hears)

enum ProposalLimits {
    /// `PROPOSAL_NOTES_MAX` (app/utils/proposalNotesLimit.ts), in UTF-16 units as JavaScript counts.
    static let notesMax = 4000
    /// `SETLIST_SONGS_MAX` (app/utils/setlistWriteRequest.ts).
    static let songsMax = 60

    static func fits(_ text: String) -> Bool { text.utf16.count <= notesMax }
}

// MARK: Medleys

/// The web's `app/utils/medley.ts`, ported. Both are tested against
/// `native/contract/medley-normalize.json`, so the two cannot drift.
enum MedleyTags {
    /// Every maximal run of two or more consecutive songs with the same tag gets a fresh tag; a
    /// lone tagged song loses its tag. Called after every reorder and removal.
    static func normalize(_ tags: [String?], newTag: () -> String) -> [String?] {
        var result = tags
        var i = 0
        while i < result.count {
            guard let tag = result[i], !tag.isEmpty else {
                result[i] = nil
                i += 1
                continue
            }
            var j = i
            while j + 1 < result.count, result[j + 1] == tag { j += 1 }
            if j - i + 1 < 2 {
                result[i] = nil
            } else {
                let fresh = newTag()
                for k in i...j { result[k] = fresh }
            }
            i = j + 1
        }
        return result
    }

    /// The songs at `index` and `index + 1` are in one medley.
    static func linked(_ tags: [String?], at index: Int) -> Bool {
        guard index >= 0, index + 1 < tags.count, let a = tags[index] else { return false }
        return a == tags[index + 1]
    }

    /// The web's `toggleMedleyLink`: links the songs at `index` and `index + 1` (merging their
    /// medleys), or splits the medley between them when they are already linked.
    static func toggle(_ tags: [String?], at index: Int, newTag: () -> String) -> [String?] {
        guard index >= 0, index + 1 < tags.count else { return tags }
        var next = tags
        let a = next[index], b = next[index + 1]
        if let a, let b, a == b {
            let group = next.indices.filter { next[$0] == a }
            let split = group.firstIndex(of: index + 1) ?? group.count
            let left = Array(group[..<split]), right = Array(group[split...])
            if left.count < 2 { for k in left { next[k] = nil } }
            if right.count >= 2 {
                let t = newTag()
                for k in right { next[k] = t }
            } else {
                for k in right { next[k] = nil }
            }
        } else if let a, let b {
            for k in next.indices where next[k] == b { next[k] = a }
        } else if let a {
            next[index + 1] = a
        } else if let b {
            next[index] = b
        } else {
            let t = newTag()
            next[index] = t
            next[index + 1] = t
        }
        return next
    }

    /// A new tag, unique enough within one proposal: the web uses seven random characters too.
    static func random() -> String {
        String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(7))
    }
}

// MARK: The editor's state

/// One song in the lead's draft.
struct DraftSong: Equatable, Identifiable, Sendable {
    let songId: String
    let title: String
    let author: String?
    /// The song's own key in the library.
    let key: String?
    var playKey: String
    var medleyTag: String?
    var previousKeys: [String]
    /// The row's own identity: a stored proposal may list one song twice (legacy data).
    var rowID = UUID()

    var id: UUID { rowID }
}

/// The proposal editor's state and every transition a save's answer causes (W1 spec D5). Pure:
/// no network, no clock, so each rule has its own XCTest.
struct ProposalDraftState: Equatable, Sendable {
    enum Notice: Equatable, Sendable {
        /// Someone else changed the proposal, or this save's own result could not be read back:
        /// «Propuesta actualizada · Recargar». Saving waits for «Recargar».
        case reloadNeeded
        /// A conflict reloading would not fix: «Este servicio necesita que un admin lo revise».
        case needsAdmin
        /// The save did not answer: «No se pudo guardar». Nothing changed here.
        case notSaved
        /// `403`: «Ya no puedes proponer para este servicio».
        case forbidden
        /// `400`: a limit or a value the server refused.
        case invalid
    }

    let roleId: String
    private(set) var observed: ObservedTarget
    private(set) var status: ProposalStatus?
    var songs: [DraftSong]
    var teamNotes: String
    /// A note to the admins, sent only while no proposal exists yet (the web's rule); after that
    /// the note is a message in the proposal's thread.
    var leadNotes: String
    var pastorMessage: String
    private(set) var saving: ProposalStatus?
    private(set) var notice: Notice?
    /// A thread message is in flight (W1b). Saving and «Recargar» wait for it: a save would race
    /// the append's new revision, and a reload would forget the post and invite a duplicate.
    private(set) var postingMessage = false
    /// What was last loaded or saved, to tell unsaved work.
    private var savedSnapshot: Snapshot
    /// What the save in flight SENT. The editor stays editable while it runs, so a 200 makes this
    /// the saved state, never what is on screen when the answer lands (the web's rule too).
    private var sendingSnapshot: Snapshot?

    private struct Snapshot: Equatable, Sendable {
        let songs: [[String]]
        let teamNotes: String
        let leadNotes: String
        let pastorMessage: String

        var withoutLeadNotes: Snapshot {
            Snapshot(songs: songs, teamNotes: teamNotes, leadNotes: "", pastorMessage: pastorMessage)
        }
    }

    init(roleId: String, observed: ObservedTarget, status: ProposalStatus?, songs: [DraftSong], teamNotes: String, leadNotes: String, pastorMessage: String) {
        self.roleId = roleId
        self.observed = observed
        self.status = status
        self.songs = songs
        self.teamNotes = teamNotes
        self.leadNotes = leadNotes
        self.pastorMessage = pastorMessage
        saving = nil
        notice = nil
        sendingSnapshot = nil
        savedSnapshot = Snapshot(songs: [], teamNotes: "", leadNotes: "", pastorMessage: "")
        savedSnapshot = snapshot()
    }

    /// The state the editor opens on: what the server holds.
    init(loaded: ProposalEditorResponse) {
        let p = loaded.proposal
        self.init(
            roleId: loaded.role.id,
            observed: loaded.observed,
            status: p?.status,
            songs: (p?.songs ?? []).map {
                DraftSong(songId: $0.songId, title: $0.title, author: $0.author, key: $0.key, playKey: $0.play_key, medleyTag: $0.medley_tag, previousKeys: $0.previous_keys)
            },
            teamNotes: p?.teamNotes ?? "",
            leadNotes: "",
            pastorMessage: p?.pastorMessage ?? ""
        )
    }

    // MARK: What the screen asks

    var proposalExists: Bool { observed.exists }
    var isApproved: Bool { status == .approved }
    var isSaving: Bool { saving != nil }
    var reloadNeeded: Bool { notice == .reloadNeeded }

    /// Both actions: never while a save is in flight (a double tap cannot send two saves with the
    /// same observed revision), never once a reload is needed, never on an approved proposal.
    var canSave: Bool { !isSaving && !postingMessage && !reloadNeeded && !isApproved && limitProblem == nil }

    /// The composer under the conversation: once the proposal exists (any status, approved too, as
    /// the web), never while a save or another message is in flight.
    var canPostMessage: Bool { proposalExists && !isSaving && !postingMessage }

    /// «Recargar» waits for a message in flight.
    var canReload: Bool { !postingMessage }

    var isDirty: Bool { !isApproved && snapshot() != savedSnapshot }

    /// A limit the server would refuse, in the lead's words; nil when the draft fits.
    var limitProblem: String? {
        if songs.count > ProposalLimits.songsMax { return "Una propuesta puede tener hasta \(ProposalLimits.songsMax) canciones." }
        for text in [teamNotes, pastorMessage] + (proposalExists ? [] : [leadNotes]) where !ProposalLimits.fits(text) {
            return "Cada nota puede tener hasta \(ProposalLimits.notesMax) caracteres."
        }
        return nil
    }

    // MARK: Editing

    mutating func add(songId: String, title: String, author: String?, key: String?, previousKeys: [String]) {
        guard !isApproved, !songs.contains(where: { $0.songId == songId }) else { return }
        songs.append(DraftSong(songId: songId, title: title, author: author, key: key, playKey: key ?? "", medleyTag: nil, previousKeys: previousKeys))
    }

    mutating func setPreviousKeys(_ byId: [String: [String]]) {
        for i in songs.indices { if let keys = byId[songs[i].songId] { songs[i].previousKeys = keys } }
    }

    mutating func remove(at offsets: IndexSet, newTag: () -> String = MedleyTags.random) {
        guard !isApproved else { return }
        for i in offsets.sorted(by: >) where songs.indices.contains(i) { songs.remove(at: i) }
        renormalize(newTag: newTag)
    }

    mutating func move(from source: IndexSet, to destination: Int, newTag: () -> String = MedleyTags.random) {
        guard !isApproved else { return }
        let moving = source.sorted().filter { songs.indices.contains($0) }
        let items = moving.map { songs[$0] }
        var rest = songs.enumerated().filter { !moving.contains($0.offset) }.map(\.element)
        let before = moving.filter { $0 < destination }.count
        let at = min(max(destination - before, 0), rest.count)
        rest.insert(contentsOf: items, at: at)
        songs = rest
        renormalize(newTag: newTag)
    }

    mutating func setPlayKey(_ key: String, at index: Int) {
        guard !isApproved, songs.indices.contains(index) else { return }
        songs[index].playKey = key
    }

    mutating func toggleMedley(at index: Int, newTag: () -> String = MedleyTags.random) {
        guard !isApproved else { return }
        apply(MedleyTags.toggle(songs.map(\.medleyTag), at: index, newTag: newTag))
    }

    private mutating func renormalize(newTag: () -> String) {
        apply(MedleyTags.normalize(songs.map(\.medleyTag), newTag: newTag))
    }

    private mutating func apply(_ tags: [String?]) {
        for i in songs.indices where i < tags.count { songs[i].medleyTag = tags[i] }
    }

    // MARK: Saving

    /// The body for a save, and the editor now «saving»; nil when it may not save now.
    mutating func beginSave(as target: ProposalStatus) -> ProposalSaveBody? {
        guard canSave, target == .draft || target == .pending else { return nil }
        saving = target
        notice = nil
        sendingSnapshot = snapshot()
        return body(as: target)
    }

    /// The exact body the server receives for this draft (the web editor's payload).
    func body(as target: ProposalStatus) -> ProposalSaveBody {
        ProposalSaveBody(
            roleId: roleId,
            observed: observed,
            songs: songs.map { ProposalSaveSong(songId: $0.songId, playKey: $0.playKey, medleyTag: $0.medleyTag) },
            leadNotes: proposalExists ? "" : leadNotes,
            teamNotes: teamNotes,
            pastorMessage: pastorMessage,
            status: target
        )
    }

    /// What one save's answer does. The draft on screen is never replaced here: only `reload`
    /// adopts what the server holds.
    mutating func finishSave(_ outcome: ProposalSaveOutcome) {
        saving = nil
        let sent = sendingSnapshot
        sendingSnapshot = nil
        switch outcome {
        case .saved(let answer):
            status = answer.status
            if let id = answer._id, let rev = answer._rev {
                let wasFirst = !observed.exists
                observed = .single(id: id, rev: rev)
                // What was sent is now saved. A first save also takes the note to the admins out of
                // the fingerprint, as it leaves the payload.
                if let sent { savedSnapshot = wasFirst ? sent.withoutLeadNotes : sent }
                notice = nil
            } else {
                // The commit landed, but its new revision could not be read back: the next save
                // could not be guarded, so it waits for «Recargar». `observed` stays as it was
                // (never a guessed revision); what was sent is saved.
                if let sent { savedSnapshot = sent }
                notice = .reloadNeeded
            }
        case .conflict(let code):
            notice = Self.reloadCodes.contains(code) ? .reloadNeeded : .needsAdmin
        case .forbidden:
            notice = .forbidden
        case .invalid:
            notice = .invalid
        case .failed:
            // `observed` is untouched: if the save did land, the lead's retry is refused with a
            // 409 before any write, and the editor then says «Propuesta actualizada».
            notice = .notSaved
        }
    }

    // MARK: Thread messages (W1b)

    /// The proposal id to post into, and the editor now «posting»; nil when it may not post now.
    mutating func beginMessage() -> String? {
        guard canPostMessage, case .single(let id, _) = observed else { return nil }
        postingMessage = true
        return id
    }

    /// What one message's answer does. The lead's own post moves the proposal's revision, so the
    /// next save would be refused unless the editor follows it. It follows ONLY when the revision
    /// read just before the append is the one this editor holds, for the same proposal (the web's
    /// rule, `ProposalEditor.tsx` `postMessage`): if anything else moved the proposal first, the
    /// editor keeps its revision and the next save says «Propuesta actualizada». The draft, the
    /// notice and what counts as saved are never touched here.
    mutating func finishMessage(proposalId: String, rev: String?, observedRev: String?) {
        postingMessage = false
        guard let rev, let observedRev,
              case .single(let id, let current) = observed,
              id == proposalId, current == observedRev
        else { return }
        observed = .single(id: id, rev: rev)
    }

    /// The 409 codes a reload fixes: the proposal moved, or its first create raced a co-lead's.
    static let reloadCodes: Set<String> = ["stale_revision", "bootstrap_completed_reload"]

    /// «Recargar» asks first when this would throw away the lead's unsaved changes.
    var reloadDiscardsWork: Bool { isDirty }

    /// «Recargar»: the ONE path that adopts what the server holds, the lead's draft replaced.
    mutating func reload(from fresh: ProposalEditorResponse) {
        guard canReload else { return }
        self = ProposalDraftState(loaded: fresh)
    }

    /// The editor read answered that the caller may no longer propose here: the draft stays on
    /// screen (to copy from), saving is refused by the server anyway.
    mutating func noteForbidden() {
        notice = .forbidden
    }

    /// Closes a notice the lead has read. «Recargar» stays until the lead reloads.
    mutating func dismissNotice() {
        if notice != .reloadNeeded { notice = nil }
    }

    private func snapshot() -> Snapshot {
        Snapshot(
            songs: songs.map { [$0.songId, $0.playKey, $0.medleyTag ?? ""] },
            teamNotes: teamNotes.trimmingCharacters(in: .whitespacesAndNewlines),
            leadNotes: proposalExists ? "" : leadNotes.trimmingCharacters(in: .whitespacesAndNewlines),
            pastorMessage: pastorMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }
}
