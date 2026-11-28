import Foundation

/// The messages the person has sent in a proposal's conversation that the thread on screen does not
/// show yet, as a messaging app shows them: in the chat at once, «Enviando…», then «Enviado», and
/// the composer free the whole time.
///
/// Its one hard rule comes from the server: a thread message has NO idempotency. A send whose answer
/// was lost may have landed, and sending it again would store a permanent duplicate and a second
/// notice. So a lost answer is never retried blindly: the thread is read again first (`verify`), and
/// only a message that is provably not there is offered «Reintentar».
///
/// Pure (no network, no clock), so each rule has its own XCTest.
struct MessageOutbox: Equatable, Sendable {
    struct Item: Equatable, Identifiable, Sendable {
        enum State: Equatable, Sendable {
            /// Waiting for the one send before it.
            case queued
            /// On its way.
            case sending
            /// The server stored it; the thread on screen does not show it yet.
            case sent
            /// The answer was lost: the thread is being read to see whether it landed.
            case checking
            /// The answer was lost and the thread could not be read either: nobody knows yet.
            case unconfirmed
            /// Read again and not there: safe to send again.
            case notDelivered
            /// The server refused it; sending it again would not help.
            case refused(String)
        }

        let id: Int
        let body: String
        var state: State
        /// The keys of the person's own messages the thread already held when this one was written:
        /// a message of theirs with the same text and a key outside this set is this one.
        var known: Set<String>
        /// Reads after a lost answer that did not show it. One is not proof: the write may still be
        /// on its way to the database when the read answers.
        var misses = 0
    }

    /// Reads of the thread, after a lost answer, that must all miss the message before it is
    /// offered again.
    static let missesBeforeRetry = 2

    /// What the server's `trim()` removes: every white space and line end, plus U+FEFF, which
    /// JavaScript counts as white space and Foundation does not.
    static let trimmed = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "\u{FEFF}"))

    /// Why a message waiting for a conversation that stopped taking them was never sent.
    static let strandedReason = "No se envió: la conversación ya no acepta mensajes."

    private(set) var items: [Item] = []
    /// The thread keys of the messages sent from this screen, for their «Enviado».
    private(set) var sentKeys: Set<String> = []
    private var nextId = 1

    // MARK: Sending

    /// The person tapped «Enviar»: the message joins the chat at once. It is kept, and sent,
    /// trimmed: the server stores `body.trim()`, and the thread's copy must read the same to be
    /// recognised as this message.
    @discardableResult
    mutating func enqueue(_ body: String, thread: [ThreadMessage]) -> Int {
        let id = nextId
        nextId += 1
        let text = body.trimmingCharacters(in: Self.trimmed)
        items.append(Item(id: id, body: text, state: .queued, known: Self.ownKeys(thread)))
        return id
    }

    /// The one message to send now, or nil: sends go one at a time, in order, and wait while an
    /// earlier one's fate is being read.
    var next: Item? {
        guard !items.contains(where: { $0.state == .sending || $0.state == .checking }) else { return nil }
        return items.first { $0.state == .queued }
    }

    mutating func markSending(_ id: Int) { set(id, .sending) }

    /// The refusals that name what the conversation belongs to: a proposal (the lead's editor, the
    /// admin's review) or a service (the admin's «Mensajes del servicio», A-W2).
    struct Words: Equatable, Sendable {
        let forbidden: String
        let refused: String

        static let proposal = Words(
            forbidden: "Ya no puedes escribir en esta propuesta.",
            refused: "No se pudo enviar: esta propuesta ya no existe o necesita que un admin la revise."
        )
        static let service = Words(
            forbidden: "Ya no puedes escribir en este servicio.",
            refused: "No se pudo enviar: este servicio ya no existe o hay que corregirlo en la web."
        )
    }

    /// A message is on its way or its fate is being read: nothing else may write meanwhile.
    var inFlight: Bool {
        items.contains { $0.state == .sending || $0.state == .checking }
    }

    /// A message the screen must not forget: one waiting, on its way, being read, or whose fate
    /// nobody knows. Closing the screen then could lose it, or invite a retype that duplicates it.
    var unsettled: Bool {
        items.contains {
            switch $0.state {
            case .queued, .sending, .checking, .unconfirmed: return true
            case .sent, .notDelivered, .refused: return false
            }
        }
    }

    /// What the send answered. `thread` is the conversation the answer brought, when it brought one.
    mutating func resolve(_ id: Int, _ outcome: ProposalMessageOutcome, thread: [ThreadMessage]?, words: Words = .proposal) {
        switch outcome {
        case .posted:
            set(id, .sent)
            guard let thread else { return }
            // This message first: an earlier one with the same text must not take its key.
            if let index = items.firstIndex(where: { $0.id == id }) { _ = claim(at: index, in: thread) }
            reconcile(thread)
        case .failed:
            set(id, .checking)
        case .notSent:
            // Nothing left the phone: it goes again when the screen can post.
            set(id, .queued)
        case .forbidden:
            set(id, .refused(words.forbidden))
        case .closed:
            set(id, .refused("La conversación de este servicio ya cerró."))
        case .full:
            set(id, .refused("Esta conversación llegó a su límite de mensajes."))
        case .invalid:
            set(id, .refused("El servidor no aceptó este mensaje."))
        case .refused:
            set(id, .refused(words.refused))
        }
    }

    /// The thread read after a lost answer, or nil when that read failed too. Answers whether
    /// another read is needed: a message is «No se envió» only after `missesBeforeRetry` reads
    /// that do not show it.
    @discardableResult
    mutating func checked(_ id: Int, thread: [ThreadMessage]?) -> Bool {
        guard let index = items.firstIndex(where: { $0.id == id }), items[index].state == .checking else { return false }
        guard let thread else {
            items[index].state = .unconfirmed
            return false
        }
        if claim(at: index, in: thread) { return false }
        items[index].misses += 1
        if items[index].misses < Self.missesBeforeRetry { return true }
        items[index].state = .notDelivered
        return false
    }

    /// «Revisar» on an unconfirmed message: read the thread again, from the start.
    mutating func recheck(_ id: Int) {
        guard let index = items.firstIndex(where: { $0.id == id }), items[index].state == .unconfirmed else { return }
        items[index].state = .checking
        items[index].misses = 0
    }

    /// «Reintentar»: only a message the thread provably does not hold.
    mutating func retry(_ id: Int) {
        guard let index = items.firstIndex(where: { $0.id == id }), items[index].state == .notDelivered else { return }
        items[index].state = .queued
    }

    /// The conversation stopped taking messages (the service day passed, the proposal left the
    /// admin's reach): every message still waiting says so and never goes, even if it opens again.
    mutating func strand() {
        for index in items.indices where items[index].state == .queued {
            items[index].state = .refused(Self.strandedReason)
        }
    }

    /// «Quitar» (or «Editar», which puts the text back in the composer): never a message on its
    /// way or one being checked.
    @discardableResult
    mutating func remove(_ id: Int) -> String? {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return nil }
        switch items[index].state {
        case .queued, .notDelivered, .refused, .unconfirmed:
            return items.remove(at: index).body
        case .sending, .checking, .sent:
            return nil
        }
    }

    // MARK: The thread on screen

    /// A new thread on screen (an answer, a reload): a sent message it now shows leaves the outbox,
    /// its bubble taken over by the thread's own, which keeps its «Enviado». So does a message whose
    /// answer was lost and that turns out to be there, even one already called «No se envió» (a
    /// write that reached the database after both reads): «Reintentar» must not stay under it.
    ///
    /// The messages the server confirmed claim first: an earlier one with the same text whose fate
    /// was unknown must not take the key of one that is known to have landed.
    mutating func reconcile(_ thread: [ThreadMessage]) {
        claimAll(in: thread) { $0 == .sent }
        claimAll(in: thread) { $0 == .checking || $0 == .unconfirmed || $0 == .notDelivered }
    }

    private mutating func claimAll(in thread: [ThreadMessage], _ which: (Item.State) -> Bool) {
        var index = 0
        while index < items.count {
            if which(items[index].state), claim(at: index, in: thread) { continue }
            index += 1
        }
    }

    // MARK: Helpers

    private static func ownKeys(_ thread: [ThreadMessage]) -> Set<String> {
        Set(thread.filter(\.mine).map(\.key))
    }

    /// The thread's own copy of the item at `index`, if it holds one: the item leaves, its key joins
    /// `sentKeys`, and no other item can claim that key.
    private mutating func claim(at index: Int, in thread: [ThreadMessage]) -> Bool {
        let item = items[index]
        let body = item.body.trimmingCharacters(in: Self.trimmed)
        guard let match = thread.first(where: {
            $0.mine && $0.body.trimmingCharacters(in: Self.trimmed) == body
                && !item.known.contains($0.key) && !sentKeys.contains($0.key)
        }) else { return false }
        sentKeys.insert(match.key)
        items.remove(at: index)
        for other in items.indices { items[other].known.insert(match.key) }
        return true
    }

    private mutating func set(_ id: Int, _ state: Item.State) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        items[index].state = state
    }
}
