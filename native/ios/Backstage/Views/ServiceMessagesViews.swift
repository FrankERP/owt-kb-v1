import SwiftUI

// «Mensajes del servicio» on the iPhone (ADR-0091 A-W2): what an admin tells one service. The
// pastor's message, the note for the team and the conversation with the leads, through the web
// dialog's writers. The rules live in `ServiceMessagesState` and `ServiceMessageRules`
// (API/ServiceMessages.swift); this file draws them and runs the calls.

/// The row on a service's page that opens the sheet, for an admin (spec D1). The sheet reads the
/// door when it opens and never before: the page costs no read.
struct ServiceMessagesEntry: View {
    let service: AppService
    @State private var open = false

    var body: some View {
        Button { open = true } label: {
            HStack(spacing: 12) {
                Image(systemName: "bubble.left.and.text.bubble.right")
                    .font(.system(size: 15))
                    .foregroundStyle(BS.accent)
                    .frame(width: 32, height: 32)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(BS.accent.opacity(0.14)))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Mensajes del servicio")
                        .font(.bsBody(16, .semibold))
                        .foregroundStyle(BS.ink)
                    Text("Pastor, equipo y líderes")
                        .font(.bsBody(13))
                        .foregroundStyle(BS.inkDim)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(BS.inkDim)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(BS.accent.opacity(0.05)))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(BS.accent.opacity(0.25), lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(CardPressStyle())
        .sheet(isPresented: $open) {
            ServiceMessagesSheet(roleId: service.id)
        }
    }
}

/// What a pastor's-message, team-note or message edit came to, for the section that started it.
enum ServiceWriteResult: Equatable, Sendable {
    case saved
    /// Someone else changed it meanwhile: the stale copy with «Recargar».
    case stale
    case problem(String)
}

/// The sheet: loads the door, runs every write one at a time, and cannot be swiped away while a
/// message's fate is unknown (A1).
struct ServiceMessagesSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let roleId: String

    private enum Phase: Equatable {
        case loading
        case ready
        case missing
        case forbidden
        case failed(String)
    }

    @State private var phase: Phase = .loading
    @State private var state: ServiceMessagesState?
    /// Bumped by an explicit reload: the pastor and team sections start clean on it, as the web's
    /// dialog remounts them per load. The conversation is never remounted (its outbox lives there).
    @State private var generation = 0
    @State private var unsettled = false
    @State private var threadNotice: String?
    /// Deletes whose answer was lost: a `404` on their retry is the first one having landed.
    @State private var retriedDeletes: Set<String> = []
    @State private var editing: EditedMessage?
    @State private var deleting: ThreadMessage?

    private struct EditedMessage: Identifiable {
        let key: String
        let body: String
        var id: String { key }
    }

    private var locked: Bool { unsettled || state?.writing == true }

    var body: some View {
        NavigationStack {
            ScrollView {
                content
                    .padding(.horizontal, 16)
                    .padding(.bottom, 32)
            }
            .background(BS.base.ignoresSafeArea())
            .refreshable { await reload(explicit: true) }
            .navigationTitle("Mensajes del servicio")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cerrar") { dismiss() }.disabled(locked)
                }
            }
        }
        .interactiveDismissDisabled(locked)
        .task { if state == nil { await reload(explicit: false) } }
        .sheet(item: $editing) { edited in
            EditServiceMessageSheet(initial: edited.body) { text in await edit(key: edited.key, body: text) }
                .presentationDetents([.medium, .large])
        }
        .confirmationDialog(
            "¿Borrar este mensaje?",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible,
            presenting: deleting
        ) { message in
            Button("Sí, borrar", role: .destructive) { Task { await delete(message) } }
            Button("No", role: .cancel) {}
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            ProgressView().padding(48).frame(maxWidth: .infinity)
        case .missing:
            notice("Este servicio ya no existe.")
        case .forbidden:
            notice("Ya no puedes ver los mensajes de este servicio.")
        case .failed(let why):
            VStack(spacing: 14) {
                Text("No se pudo cargar la conversación.")
                    .font(.bsBody(16))
                    .foregroundStyle(BS.inkMuted)
                if !why.isEmpty {
                    Text(why).font(.bsBody(13)).foregroundStyle(BS.inkDim).multilineTextAlignment(.center)
                }
                Button("Reintentar") { Task { await reload(explicit: true) } }
                    .buttonStyle(BrandButtonStyle())
            }
            .padding(32)
        case .ready:
            if let state {
                VStack(alignment: .leading, spacing: 8) {
                    if unsettled {
                        Label("Espera a que se confirme el mensaje para cerrar.", systemImage: "hourglass")
                            .font(.bsBody(13))
                            .foregroundStyle(BS.inkDim)
                            .padding(.top, 8)
                    }
                    ServiceMessagesContent(
                        state: state,
                        generation: generation,
                        threadNotice: threadNotice,
                        savePastor: savePastor,
                        saveTeamNotes: saveTeamNotes,
                        move: move,
                        reload: { Task { await reload(explicit: true) } },
                        post: post,
                        verify: verify,
                        actions: actions,
                        outboxChanged: { outbox in
                            self.state?.outboxBusy = outbox.inFlight
                            unsettled = outbox.unsettled
                        }
                    )
                }
            }
        }
    }

    private func notice(_ text: String) -> some View {
        Text(text)
            .font(.bsBody(16))
            .foregroundStyle(BS.inkMuted)
            .multilineTextAlignment(.center)
            .padding(32)
            .frame(maxWidth: .infinity)
    }

    // MARK: Reads

    /// A read of the door. On screen it lands only while nothing is being written; an explicit
    /// one (a pull, «Recargar») also starts the two editors clean.
    private func reload(explicit: Bool) async {
        switch await model.loadServiceMessages(roleId: roleId) {
        case .loaded(let fresh):
            if state == nil {
                state = ServiceMessagesState(data: fresh)
            } else if state?.adopt(fresh) == true, explicit {
                generation += 1
            }
            if explicit { threadNotice = nil }
            phase = .ready
        case .missing:
            if state == nil { phase = .missing } else { threadNotice = "Este servicio ya no existe." }
        case .forbidden:
            phase = .forbidden
        case .failed(let why):
            if state == nil { phase = .failed(why) } else if !why.isEmpty { threadNotice = why }
        }
    }

    /// The conversation's check after a lost answer: a fresh read, landed on screen (both threads),
    /// unless a write is in flight (A5).
    private func verify() async -> [ThreadMessage]? {
        guard let current = state, !current.writing else { return nil }
        guard case .loaded(let fresh) = await model.loadServiceMessages(roleId: roleId) else { return nil }
        guard state?.adopt(fresh) == true else { return nil }
        return state?.conversation
    }

    /// The card under the sheet shows both texts: the services list reads them again (D6).
    private func cardChanged() {
        Task { await model.loadServices() }
    }

    // MARK: Messages

    private func post(_ text: String) async -> ProposalMessageOutcome {
        guard state?.beginPost() == true else { return .notSent }
        let outcome = await model.postServiceMessage(roleId: roleId, body: text)
        state?.endPost()
        var merged: [ThreadMessage]?
        if case .done(let answer) = outcome, let thread = answer.serviceMessages {
            state?.applyThread(thread)
            merged = state?.conversation
        }
        if outcome == .forbidden { Task { await reload(explicit: false) } }
        return ServiceMessageRules.postOutcome(outcome, merged: merged)
    }

    private func actions(_ message: ThreadMessage) -> [MessageAction] {
        guard let state, state.canModify(message) else { return [] }
        return [
            MessageAction(title: "Editar", systemImage: "pencil") {
                editing = EditedMessage(key: message.key, body: message.body)
            },
            MessageAction(title: "Eliminar", systemImage: "trash", destructive: true) {
                deleting = message
            },
        ]
    }

    private func edit(key: String, body raw: String) async -> ServiceWriteResult {
        guard state?.beginWrite() == true else { return .problem("Espera a que termine lo que se está enviando.") }
        let body = raw.trimmingCharacters(in: MessageOutbox.trimmed)
        let outcome = await model.editServiceMessage(roleId: roleId, key: key, body: body)
        state?.endWrite()
        switch outcome {
        case .done(let answer):
            if let thread = answer.serviceMessages {
                state?.applyThread(thread)
            } else {
                state?.applyEditLocally(key: key, body: body, at: Self.now())
            }
            threadNotice = nil
            return .saved
        // A resend sets the same text again and notifies nobody: the admin may simply retry.
        case .failed, .stale: return .problem(ServiceMessageRules.failedCopy)
        case .closed: return .problem("La conversación de este servicio ya cerró.")
        case .forbidden:
            await reload(explicit: false)
            return .problem(ServiceMessageRules.forbiddenCopy)
        case .notFound:
            await reload(explicit: false)
            return .problem("Este mensaje ya no está.")
        case .blocked: return .problem(ServiceMessageRules.blockedCopy)
        case .invalid, .full: return .problem("El servidor no aceptó este mensaje.")
        }
    }

    private func delete(_ message: ThreadMessage) async {
        guard state?.beginWrite() == true else { return }
        let key = message.key
        let isRetry = retriedDeletes.contains(key)
        let outcome = await model.deleteServiceMessage(roleId: roleId, key: key)
        state?.endWrite()
        if ServiceMessageRules.deleteLanded(outcome, isRetry: isRetry) {
            retriedDeletes.remove(key)
            if case .done(let answer) = outcome, let thread = answer.serviceMessages {
                state?.applyThread(thread)
            } else {
                state?.applyDeleteLocally(key: key)
            }
            threadNotice = nil
            return
        }
        switch outcome {
        case .failed, .stale:
            retriedDeletes.insert(key)
            threadNotice = "No se pudo borrar el mensaje. Revisa tu conexión e intenta de nuevo."
        case .notFound:
            threadNotice = "Este mensaje ya no está."
            await reload(explicit: false)
        case .closed:
            threadNotice = "La conversación de este servicio ya cerró."
        case .forbidden:
            threadNotice = ServiceMessageRules.forbiddenCopy
            await reload(explicit: false)
        default:
            threadNotice = "No se pudo borrar el mensaje."
        }
    }

    // MARK: The pastor's message and the team note

    private func savePastor(_ body: String, observed: String?) async -> ServiceWriteResult {
        guard state?.beginWrite() == true else { return .problem("Espera a que termine lo que se está enviando.") }
        let outcome = await model.setPastorMessage(roleId: roleId, body: PastorMessageBody(body: body, observed: observed))
        switch outcome {
        case .done(let answer):
            state?.applyPastor(answer.pastorMessage)
            state?.endWrite()
            cardChanged()
            return .saved
        case .stale:
            // A lost answer resent finds its own stamp moved: the re-read says whether the text
            // stored is the one this phone sent (spec D5).
            guard case .loaded(let fresh) = await model.loadServiceMessages(roleId: roleId) else {
                state?.endWrite()
                return .problem(ServiceMessageRules.failedCopy)
            }
            state?.settle(with: fresh)
            switch ServiceMessageRules.pastorVerdict(sent: body, reread: fresh) {
            case .saved:
                cardChanged()
                return .saved
            default:
                return .stale
            }
        default:
            state?.endWrite()
            return await refusal(outcome)
        }
    }

    private func saveTeamNotes(_ text: String, target: TeamNotesTarget) async -> ServiceWriteResult {
        guard state?.beginWrite() == true else { return .problem("Espera a que termine lo que se está enviando.") }
        let outcome = await model.saveTeamNotes(roleId: roleId, body: TeamNotesBody(teamNotes: text, observed: target))
        switch outcome {
        case .done(let answer):
            state?.applyTeamNotes(answer.teamNotes, observed: answer.observed)
            state?.endWrite()
            cardChanged()
            return .saved
        case .stale:
            guard case .loaded(let fresh) = await model.loadServiceMessages(roleId: roleId) else {
                state?.endWrite()
                return .problem(ServiceMessageRules.failedCopy)
            }
            state?.settle(with: fresh)
            switch ServiceMessageRules.teamNotesVerdict(sent: text, reread: fresh) {
            case .saved:
                cardChanged()
                return .saved
            case .stale: return .stale
            case .noSetlist: return .problem(ServiceMessageRules.noSetlistCopy)
            case .blocked: return .problem(ServiceMessageRules.blockedCopy)
            }
        default:
            state?.endWrite()
            return await refusal(outcome)
        }
    }

    /// «Mover a mensaje del pastor»: the pastor's message first (nothing can be lost), then the
    /// note cleared. A lost answer the re-read calls «Guardado» goes on to the clear (A7).
    private func move(_ text: String, target: TeamNotesTarget) async -> ServiceWriteResult {
        let first = await savePastor(text, observed: nil)
        guard first == .saved else { return first }
        let second = await saveTeamNotes("", target: target)
        return second == .saved ? .saved : .problem(ServiceMessageRules.movedButKeptCopy)
    }

    /// The words for a refused pastor's-message or team-note write.
    private func refusal<Answer: Decodable & Equatable & Sendable>(_ outcome: ServiceWriteOutcome<Answer>) async -> ServiceWriteResult {
        switch outcome {
        case .blocked: return .problem(ServiceMessageRules.blockedCopy)
        case .forbidden:
            // A lost admin role and a lost author look the same on the wire: the read shows which.
            await reload(explicit: false)
            return .problem(ServiceMessageRules.forbiddenCopy)
        case .notFound: return .problem("Este servicio ya no existe.")
        case .closed: return .problem("La conversación de este servicio ya cerró.")
        case .invalid, .full: return .problem("El servidor no aceptó este mensaje.")
        case .failed, .stale, .done: return .problem(ServiceMessageRules.failedCopy)
        }
    }

    private static func now() -> String {
        let format = ISO8601DateFormatter()
        format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return format.string(from: Date())
    }
}

// MARK: The content

/// What the sheet draws, given its state: the head, the two texts and the conversation. The
/// snapshot test draws it with made-up data.
struct ServiceMessagesContent: View {
    let state: ServiceMessagesState
    let generation: Int
    let threadNotice: String?
    let savePastor: (String, String?) async -> ServiceWriteResult
    let saveTeamNotes: (String, TeamNotesTarget) async -> ServiceWriteResult
    let move: (String, TeamNotesTarget) async -> ServiceWriteResult
    let reload: () -> Void
    let post: (String) async -> ProposalMessageOutcome
    let verify: () async -> [ThreadMessage]?
    let actions: (ThreadMessage) -> [MessageAction]
    let outboxChanged: (MessageOutbox) -> Void

    private var data: ServiceMessages { state.data }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            head
            VStack(alignment: .leading, spacing: 24) {
                PastorMessageSection(
                    message: data.pastorMessage,
                    offered: data.proposal?.offeredPastorMessage,
                    published: data.service.published,
                    canWrite: state.canWrite,
                    save: savePastor,
                    reload: reload
                )
                .id("pastor-\(generation)")
                TeamNotesSection(
                    notes: data.teamNotes,
                    published: data.service.published,
                    hasPastorMessage: data.pastorMessage != nil,
                    canWrite: state.canWrite,
                    save: saveTeamNotes,
                    move: move,
                    reload: reload
                )
                .id("team-\(generation)")
            }
            .padding(16)
            .cardSurface()
            conversation
        }
        .padding(.top, 8)
    }

    private var head: some View {
        HStack(alignment: .top, spacing: 14) {
            DateLeaf(date: data.service.date, tone: ServiceTone(data.service.kind))
            VStack(alignment: .leading, spacing: 6) {
                Text("MENSAJES DEL SERVICIO")
                    .font(.bsLabel(11))
                    .tracking(11 * 0.22)
                    .foregroundStyle(BS.sheetTitle)
                Text(data.service.title.uppercased())
                    .font(.bsDisplay(22))
                    .tracking(0.44)
                    .foregroundStyle(BS.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Label(
                    data.service.leads.isEmpty ? "Este servicio aún no tiene líder." : "Líderes: \(data.service.leads.joined(separator: ", "))",
                    systemImage: "music.mic"
                )
                .font(.bsBody(14))
                .foregroundStyle(BS.inkMuted)
                if !data.service.published {
                    Label("Borrador: los líderes no reciben avisos", systemImage: "eye.slash")
                        .font(.bsBody(13))
                        .foregroundStyle(BS.warning)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .cardSurface(tone: ServiceTone(data.service.kind))
    }

    private var conversation: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let threadNotice {
                Label(threadNotice, systemImage: "exclamationmark.circle")
                    .font(.bsBody(13))
                    .foregroundStyle(BS.warning)
            }
            ConversationThread(
                messages: state.conversation,
                canCompose: data.open,
                canPostNow: state.canPostNow,
                hint: data.service.published
                    ? "Lo ven los líderes y los admins. A los líderes les llega por correo."
                    : "Lo ven los líderes y los admins. Los líderes no reciben aviso mientras el servicio no esté publicado.",
                post: post,
                verify: verify,
                words: .service,
                actions: actions,
                outboxChanged: outboxChanged
            )
            if !data.open {
                Text("La conversación de este servicio ya cerró.")
                    .font(.bsBody(13))
                    .foregroundStyle(BS.inkDim)
            } else if !state.conversation.isEmpty {
                Text("Mantén presionado uno de tus mensajes para editarlo o borrarlo.")
                    .font(.bsBody(12))
                    .foregroundStyle(BS.inkDim)
            }
        }
        .padding(16)
        .cardSurface()
    }
}

// MARK: Mensaje del pastor

private struct PastorMessageSection: View {
    let message: ServiceMessages.PastorMessage?
    let offered: String?
    let published: Bool
    let canWrite: Bool
    let save: (String, String?) async -> ServiceWriteResult
    let reload: () -> Void

    /// The text being edited and the stamp of the message it STARTED from (never the stamp on
    /// screen at save time): a save another admin made meanwhile is refused, never overwritten.
    private struct Draft: Equatable {
        var body: String
        let observed: String?
    }

    @State private var draft: Draft?
    @State private var saving = false
    @State private var stale = false
    @State private var problem: String?
    @State private var confirmClear = false
    @State private var confirmAdopt = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SheetTitle(text: "Mensaje del pastor")
            if stale {
                StaleBanner(text: ServiceMessageRules.pastorStaleCopy, reload: reload)
            } else if let current = draft {
                editor(current)
            } else if let message {
                NoteBox(title: "Mensaje del pastor", text: message.body, symbol: "megaphone", pastor: true)
                Text(byline(message))
                    .font(.bsLabel(11))
                    .tracking(0.8)
                    .foregroundStyle(BS.inkDim)
                HStack(spacing: 16) {
                    Spacer()
                    SectionAction(title: "Quitar", busy: false) { confirmClear = true }
                        .disabled(!canWrite || saving)
                    SectionAction(title: "Editar", strong: true, busy: false) {
                        problem = nil
                        draft = Draft(body: message.body, observed: message.stamp)
                        focused = true
                    }
                    .disabled(!canWrite || saving)
                }
                Hint(text: "Todo el equipo lo ve en la tarjeta del servicio. Corregirlo no vuelve a avisar.")
            } else {
                Text(published
                     ? "Aún no hay. Al guardarlo, les llega a los líderes por correo y todo el equipo lo ve en la tarjeta."
                     : "Aún no hay. Todo el equipo lo verá en la tarjeta cuando se publique el servicio.")
                    .font(.bsBody(14))
                    .foregroundStyle(BS.inkMuted)
                HStack {
                    Spacer()
                    SectionAction(title: "Agregar", strong: true, busy: false) {
                        problem = nil
                        draft = Draft(body: "", observed: nil)
                        focused = true
                    }
                    .disabled(!canWrite || saving)
                }
            }
            if let offered, !stale, draft == nil { offeredBlock(offered) }
            if let problem { ProblemLine(text: problem) }
        }
        .confirmationDialog("¿Quitar el mensaje del pastor?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Sí, quitar", role: .destructive) { run("", observed: message?.stamp) }
            Button("No", role: .cancel) {}
        }
        .confirmationDialog("¿Reemplazar el mensaje del pastor actual?", isPresented: $confirmAdopt, titleVisibility: .visible) {
            Button("Sí, reemplazar") { if let offered { run(offered, observed: message?.stamp) } }
            Button("No", role: .cancel) {}
        }
    }

    private func editor(_ current: Draft) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            NoteEditor(
                placeholder: "Pega aquí el mensaje del pastor…",
                text: Binding(get: { draft?.body ?? "" }, set: { draft?.body = $0 }),
                focused: $focused,
                disabled: saving
            )
            if !ProposalLimits.fits(current.body) {
                ProblemLine(text: "Un mensaje puede tener hasta \(ProposalLimits.notesMax) caracteres.")
            }
            HStack(spacing: 16) {
                Spacer()
                SectionAction(title: "Cancelar", busy: false) { draft = nil; problem = nil }
                    .disabled(saving)
                SectionAction(title: "Guardar", strong: true, busy: saving) {
                    run(current.body.trimmingCharacters(in: MessageOutbox.trimmed), observed: current.observed)
                }
                .disabled(!canSave(current))
            }
            if current.observed == nil, published {
                Hint(text: "Les llega a los líderes por correo.")
            }
        }
    }

    private func canSave(_ current: Draft) -> Bool {
        canWrite && !saving && ProposalLimits.fits(current.body)
            && !current.body.trimmingCharacters(in: MessageOutbox.trimmed).isEmpty
    }

    private func offeredBlock(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("LOS LÍDERES MANDARON ESTE MENSAJE DEL PASTOR CON SU PROPUESTA")
                .font(.bsLabel(11))
                .tracking(0.8)
                .foregroundStyle(BS.inkDim)
            Text(text)
                .font(.bsBody(15))
                .foregroundStyle(BS.inkMuted)
                .textSelection(.enabled)
            HStack {
                Spacer()
                SectionAction(title: "Usar como mensaje del pastor", strong: true, busy: saving && message == nil) {
                    if message != nil { confirmAdopt = true } else { run(text, observed: nil) }
                }
                .disabled(!canWrite || saving)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(BS.ink.opacity(0.10), lineWidth: 1))
    }

    private func byline(_ message: ServiceMessages.PastorMessage) -> String {
        let who = message.authorName.map { "LO GUARDÓ \($0.uppercased())" } ?? "GUARDADO"
        return message.editedAt == nil ? who : "\(who) · EDITADO"
    }

    private func run(_ body: String, observed: String?) {
        guard !saving else { return }
        saving = true
        problem = nil
        Task {
            let result = await save(body, observed)
            saving = false
            switch result {
            case .saved: draft = nil
            case .stale: stale = true
            case .problem(let why): problem = why
            }
        }
    }
}

// MARK: Mensaje para el equipo

private struct TeamNotesSection: View {
    let notes: ServiceMessages.TeamNotes
    let published: Bool
    let hasPastorMessage: Bool
    let canWrite: Bool
    let save: (String, TeamNotesTarget) async -> ServiceWriteResult
    let move: (String, TeamNotesTarget) async -> ServiceWriteResult
    let reload: () -> Void

    /// The text being edited and the setlist revision it was started on.
    private struct Draft: Equatable {
        var text: String
        let target: TeamNotesTarget
    }

    @State private var draft: Draft?
    @State private var saving = false
    @State private var stale = false
    @State private var problem: String?
    @State private var confirmMove: (text: String, target: TeamNotesTarget)?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SheetTitle(text: "Mensaje para el equipo")
            switch notes {
            case .none:
                Text(ServiceMessageRules.noSetlistCopy).font(.bsBody(14)).foregroundStyle(BS.inkMuted)
            case .ambiguous:
                Text(ServiceMessageRules.blockedCopy).font(.bsBody(14)).foregroundStyle(BS.inkMuted)
            case .target(let text, let target):
                loaded(text: text, target: target)
            }
        }
        .confirmationDialog(
            published ? "¿Moverlo al mensaje del pastor? Les llega a los líderes por correo." : "¿Moverlo al mensaje del pastor?",
            isPresented: Binding(get: { confirmMove != nil }, set: { if !$0 { confirmMove = nil } }),
            titleVisibility: .visible
        ) {
            Button("Sí, mover") {
                if let pending = confirmMove { runMove(pending.text, pending.target) }
            }
            Button("No", role: .cancel) {}
        }
    }

    @ViewBuilder
    private func loaded(text: String, target: TeamNotesTarget) -> some View {
        if stale {
            StaleBanner(text: ServiceMessageRules.teamStaleCopy, reload: reload)
        } else if let current = draft {
            NoteEditor(
                placeholder: "Mensaje para todo el equipo…",
                text: Binding(get: { draft?.text ?? "" }, set: { draft?.text = $0 }),
                focused: $focused,
                disabled: saving
            )
            if !ProposalLimits.fits(current.text) {
                ProblemLine(text: "Un mensaje puede tener hasta \(ProposalLimits.notesMax) caracteres.")
            }
            HStack(spacing: 16) {
                Spacer()
                SectionAction(title: "Cancelar", busy: false) { draft = nil; problem = nil }
                    .disabled(saving)
                SectionAction(title: "Guardar", strong: true, busy: saving) {
                    run { await save(current.text.trimmingCharacters(in: MessageOutbox.trimmed), current.target) }
                }
                .disabled(!canWrite || saving || !ProposalLimits.fits(current.text))
            }
            Hint(text: "Déjalo vacío para quitarlo. Guardar no avisa a nadie.")
        } else {
            if text.isEmpty {
                Text("Este setlist no tiene mensaje para el equipo.").font(.bsBody(14)).foregroundStyle(BS.inkMuted)
            } else {
                NoteBox(title: "Notas para el equipo", text: text, symbol: "text.bubble", pastor: false)
            }
            HStack(spacing: 16) {
                Spacer()
                // Only into an EMPTY pastor's message: moving onto one would overwrite it.
                if !text.isEmpty, !hasPastorMessage {
                    SectionAction(title: "Mover a mensaje del pastor", busy: saving) { confirmMove = (text, target) }
                        .disabled(!canWrite || saving)
                }
                SectionAction(title: text.isEmpty ? "Agregar" : "Editar", strong: true, busy: false) {
                    problem = nil
                    draft = Draft(text: text, target: target)
                    focused = true
                }
                .disabled(!canWrite || saving)
            }
            Hint(text: "Si apruebas una nueva propuesta de los líderes, su mensaje reemplaza este.")
        }
        if let problem { ProblemLine(text: problem) }
    }

    private func runMove(_ text: String, _ target: TeamNotesTarget) {
        run { await move(text, target) }
    }

    private func run(_ write: @escaping () async -> ServiceWriteResult) {
        guard !saving else { return }
        saving = true
        problem = nil
        Task {
            let result = await write()
            saving = false
            switch result {
            case .saved: draft = nil
            case .stale: stale = true
            case .problem(let why): problem = why
            }
        }
    }
}

// MARK: Pieces

/// The multi-line field the two texts are edited in.
private struct NoteEditor: View {
    let placeholder: String
    @Binding var text: String
    var focused: FocusState<Bool>.Binding
    let disabled: Bool

    var body: some View {
        TextField(placeholder, text: $text, axis: .vertical)
            .lineLimit(4...10)
            .font(.bsBody(16))
            .foregroundStyle(BS.ink)
            .focused(focused)
            .disabled(disabled)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(BS.ink.opacity(0.05)))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(BS.ink.opacity(0.10), lineWidth: 1))
    }
}

private struct SectionAction: View {
    let title: String
    var strong = false
    let busy: Bool
    let run: () -> Void
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        Button(action: run) {
            HStack(spacing: 6) {
                if busy { ProgressView().controlSize(.mini) }
                Text(busy ? "Guardando…" : title)
            }
            .font(.bsBody(14, strong ? .semibold : .regular))
            .foregroundStyle(strong ? BS.accent : BS.inkMuted)
            .opacity(enabled ? 1 : 0.45)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct StaleBanner: View {
    let text: String
    let reload: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(text).font(.bsBody(14)).foregroundStyle(BS.ink)
            Button("Recargar", action: reload)
                .font(.bsBody(14, .semibold))
                .foregroundStyle(BS.accent)
                .frame(minHeight: 44)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(BS.warning.opacity(0.10)))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(BS.warning.opacity(0.35), lineWidth: 1))
    }
}

private struct ProblemLine: View {
    let text: String

    var body: some View {
        Label(text, systemImage: "exclamationmark.circle")
            .font(.bsBody(13))
            .foregroundStyle(BS.warning)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct Hint: View {
    let text: String

    var body: some View {
        Text(text).font(.bsBody(12)).foregroundStyle(BS.inkDim)
    }
}

// MARK: Editing one message

/// «Editar» on one of the admin's own messages: the text and «Guardar». A resend notifies nobody,
/// so a failed save simply stays open to be tried again.
struct EditServiceMessageSheet: View {
    @Environment(\.dismiss) private var dismiss
    let initial: String
    let save: (String) async -> ServiceWriteResult
    @State private var text: String
    @State private var saving = false
    @State private var problem: String?
    @FocusState private var focused: Bool

    init(initial: String, save: @escaping (String) async -> ServiceWriteResult) {
        self.initial = initial
        self.save = save
        _text = State(initialValue: initial)
    }

    private var canSave: Bool {
        let trimmed = text.trimmingCharacters(in: MessageOutbox.trimmed)
        return !saving && !trimmed.isEmpty && ProposalLimits.fits(text) && trimmed != initial.trimmingCharacters(in: MessageOutbox.trimmed)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    TextField("Mensaje", text: $text, axis: .vertical)
                        .lineLimit(3...10)
                        .font(.bsBody(16))
                        .foregroundStyle(BS.ink)
                        .focused($focused)
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(BS.ink.opacity(0.05)))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(BS.ink.opacity(0.10), lineWidth: 1))
                    Text(ProposalLimits.fits(text) ? "Corregirlo no vuelve a avisar." : "Un mensaje puede tener hasta \(ProposalLimits.notesMax) caracteres.")
                        .font(.bsBody(12))
                        .foregroundStyle(ProposalLimits.fits(text) ? BS.inkDim : BS.warning)
                    if let problem { ProblemLine(text: problem) }
                    Button {
                        Task {
                            saving = true
                            problem = nil
                            let result = await save(text)
                            saving = false
                            switch result {
                            case .saved: dismiss()
                            case .stale: problem = ServiceMessageRules.failedCopy
                            case .problem(let why): problem = why
                            }
                        }
                    } label: {
                        if saving { ProgressView().tint(BS.base) } else { Text("Guardar") }
                    }
                    .buttonStyle(BrandButtonStyle())
                    .disabled(!canSave)
                }
                .padding(20)
            }
            .background(BS.base.ignoresSafeArea())
            .navigationTitle("Editar mensaje")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }.disabled(saving)
                }
            }
            .onAppear { focused = true }
        }
        .interactiveDismissDisabled(saving)
    }
}
