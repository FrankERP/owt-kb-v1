import SwiftUI

/// A proposal's conversation as a messaging app: the thread, the messages on their way, and a
/// composer that never locks. «Enviar» puts the message in the chat at once («Enviando…»), clears
/// the field and frees it for the next one; the bubble then reads «Enviado», or says what went
/// wrong with what can be done about it. The rules (one send at a time, never a blind resend of a
/// lost answer) live in `MessageOutbox`.
///
/// Shared by the lead's proposal editor and the admin's review.
struct ConversationThread: View {
    let messages: [ThreadMessage]
    /// The composer shows (the proposal exists and the service day has not passed).
    let canCompose: Bool
    /// The screen can post this very moment (nothing else in flight); a message waits otherwise.
    let canPostNow: Bool
    let hint: String
    let post: (String) async -> ProposalMessageOutcome
    /// Reads the conversation again without touching anything else; nil when that read fails.
    let verify: () async -> [ThreadMessage]?

    @State private var outbox = MessageOutbox()
    @State private var composer = ""
    @State private var draining = false
    @State private var sent = 0
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SheetTitle(text: "Conversación", count: messages.count)
            ForEach(messages) { message in
                MessageBubble(message: message, sent: outbox.sentKeys.contains(message.key))
            }
            ForEach(outbox.items) { item in
                OutgoingBubble(
                    item: item,
                    // «Editar» and «Reintentar» need a conversation that still takes messages.
                    canWrite: canCompose,
                    recheck: { recheck(item.id) },
                    retry: {
                        guard canCompose else { return }
                        outbox.retry(item.id)
                        drain()
                    },
                    edit: { edit(item.id) },
                    remove: { outbox.remove(item.id) }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            if canCompose { composerView }
        }
        .animation(.snappy(duration: 0.28), value: outbox)
        .sensoryFeedback(.success, trigger: sent)
        .onChange(of: sent) { _, _ in AccessibilityNotification.Announcement("Mensaje enviado").post() }
        .onChange(of: messages) { _, thread in outbox.reconcile(thread) }
        // A message still waiting when the conversation closes never goes, even if it opens again.
        .onChange(of: canCompose) { _, open in if !open { outbox.strand() } }
        // Also one that went back to waiting after the conversation closed (a send the screen
        // could not make then).
        .onChange(of: outbox) { _, _ in if !canCompose { outbox.strand() } }
        .onChange(of: canPostNow) { _, now in if now, canCompose { drain() } }
    }

    // MARK: Composer

    private var canSend: Bool {
        canCompose
            && !composer.trimmingCharacters(in: MessageOutbox.trimmed).isEmpty
            && ProposalLimits.fits(composer)
    }

    private var composerView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Escribe un mensaje", text: $composer, axis: .vertical)
                    .lineLimit(1...6)
                    .font(.bsBody(16))
                    .foregroundStyle(BS.ink)
                    .focused($focused)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(BS.ink.opacity(0.05)))
                    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(BS.ink.opacity(0.10), lineWidth: 1))
                Button(action: send) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(BS.base)
                        .frame(width: 38, height: 38)
                        .background(Circle().fill(canSend ? BS.accent : BS.ink.opacity(0.15)))
                }
                .disabled(!canSend)
                .accessibilityLabel("Enviar mensaje")
            }
            Text(ProposalLimits.fits(composer) ? hint : "Un mensaje puede tener hasta \(ProposalLimits.notesMax) caracteres.")
                .font(.bsBody(12))
                .foregroundStyle(ProposalLimits.fits(composer) ? BS.inkDim : BS.warning)
        }
        .padding(.top, messages.isEmpty && outbox.items.isEmpty ? 0 : 4)
    }

    // MARK: Sending

    private func send() {
        guard canSend else { return }
        // The length is judged on the text as typed (the server counts it before trimming); the
        // outbox keeps and sends it trimmed, as the server stores it.
        outbox.enqueue(composer, thread: messages)
        composer = ""
        drain()
    }

    /// Sends the next waiting message, one at a time. A send the screen could not make now waits
    /// for `canPostNow`; any other answer moves on to the next one.
    private func drain() {
        // No look at `canCompose` here: a call from a finished Task's continuation would read the
        // value of the render that started it. The fresh call sites check it, and `strand()` leaves
        // nothing waiting once the conversation closes.
        guard !draining, let item = outbox.next else { return }
        draining = true
        outbox.markSending(item.id)
        Task {
            let outcome = await post(item.body)
            var thread: [ThreadMessage]?
            if case .posted(let answer) = outcome {
                thread = answer.messages
                sent += 1
            }
            outbox.resolve(item.id, outcome, thread: thread)
            if outcome == .failed {
                // A lost answer: it may have landed. Look before anything is offered again.
                await check(item.id)
            }
            draining = false
            if outcome != .notSent { drain() }
        }
    }

    /// Reads the thread until it shows the message or has missed it enough times to say so. The
    /// first read waits a moment: a write whose answer was lost may still be reaching the database.
    private func check(_ id: Int) async {
        repeat {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
        } while outbox.checked(id, thread: await verify())
        // Found in the thread: it was sent after all, and says so like any other.
        if !outbox.items.contains(where: { $0.id == id }) { sent += 1 }
    }

    private func recheck(_ id: Int) {
        guard !draining else { return }
        outbox.recheck(id)
        draining = true
        Task {
            await check(id)
            draining = false
            drain()
        }
    }

    /// The text back in the composer, when the composer is empty (nothing typed is overwritten).
    private func edit(_ id: Int) {
        guard composer.isEmpty, let body = outbox.remove(id) else { return }
        composer = body
        focused = true
    }
}

/// A message of the person's that the thread does not show yet, with where it is.
private struct OutgoingBubble: View {
    let item: MessageOutbox.Item
    let canWrite: Bool
    let recheck: () -> Void
    let retry: () -> Void
    let edit: () -> Void
    let remove: () -> Void

    var body: some View {
        HStack {
            Spacer(minLength: 40)
            VStack(alignment: .trailing, spacing: 6) {
                Text("Tú")
                    .font(.bsBody(12, .semibold))
                    .foregroundStyle(BS.accent)
                Text(item.body)
                    .font(.bsBody(15))
                    .foregroundStyle(BS.inkMuted)
                    .multilineTextAlignment(.trailing)
                    .opacity(isOnItsWay ? 0.75 : 1)
                status
                actions
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(problem ? BS.warning.opacity(0.10) : BS.accent.opacity(0.10))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(problem ? BS.warning.opacity(0.35) : .clear, lineWidth: 1)
            )
        }
        .accessibilityElement(children: .contain)
        .onChange(of: item.state) { _, state in
            if let words = Self.announcement(state) {
                AccessibilityNotification.Announcement(words).post()
            }
        }
    }

    /// «Mensaje enviado» is announced by the conversation, which sees a message sent even when its
    /// bubble leaves in the same moment.
    private static func announcement(_ state: MessageOutbox.Item.State) -> String? {
        switch state {
        case .notDelivered: "El mensaje no se envió"
        case .unconfirmed: "No se pudo confirmar si el mensaje llegó"
        case .refused(let why): why
        default: nil
        }
    }

    private var isOnItsWay: Bool {
        switch item.state {
        case .queued, .sending, .checking: return true
        default: return false
        }
    }

    private var problem: Bool {
        switch item.state {
        case .unconfirmed, .notDelivered, .refused: return true
        default: return false
        }
    }

    @ViewBuilder
    private var status: some View {
        switch item.state {
        case .queued, .sending:
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini)
                Text("Enviando…")
            }
            .font(.bsBody(11))
            .foregroundStyle(BS.inkDim)
        case .checking:
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini)
                Text("Confirmando si llegó…")
            }
            .font(.bsBody(11))
            .foregroundStyle(BS.inkDim)
        case .sent:
            SentMark()
        case .unconfirmed:
            Label("No se pudo confirmar si llegó.", systemImage: "exclamationmark.circle")
                .font(.bsBody(11))
                .foregroundStyle(BS.warning)
        case .notDelivered:
            Label("No se envió.", systemImage: "exclamationmark.circle")
                .font(.bsBody(11))
                .foregroundStyle(BS.warning)
        case .refused(let why):
            Label(why, systemImage: "exclamationmark.circle")
                .font(.bsBody(11))
                .foregroundStyle(BS.warning)
                .multilineTextAlignment(.trailing)
        }
    }

    @ViewBuilder
    private var actions: some View {
        switch item.state {
        case .unconfirmed:
            HStack(spacing: 14) {
                action("Quitar", remove)
                action("Revisar", recheck, strong: true)
            }
        case .notDelivered where canWrite:
            HStack(spacing: 14) {
                action("Quitar", remove)
                action("Editar", edit)
                action("Reintentar", retry, strong: true)
            }
        case .refused where canWrite:
            HStack(spacing: 14) {
                action("Quitar", remove)
                action("Editar", edit, strong: true)
            }
        case .notDelivered, .refused:
            HStack(spacing: 14) {
                action("Quitar", remove, strong: true)
            }
        default:
            EmptyView()
        }
    }

    private func action(_ title: String, _ run: @escaping () -> Void, strong: Bool = false) -> some View {
        Button(title, action: run)
            .font(.bsBody(13, strong ? .semibold : .regular))
            .foregroundStyle(strong ? BS.accent : BS.inkMuted)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
    }
}

/// «✓ Enviado» under a message sent from this screen.
struct SentMark: View {
    var body: some View {
        Label("Enviado", systemImage: "checkmark")
            .font(.bsBody(11))
            .foregroundStyle(BS.inkDim)
            .labelStyle(.titleAndIcon)
    }
}
