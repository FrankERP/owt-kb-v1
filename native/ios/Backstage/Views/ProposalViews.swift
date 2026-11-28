import SwiftUI
import UniformTypeIdentifiers

extension UTType {
    /// A song row dragged inside the proposal editor (declared in project.yml).
    static let setlistRow = UTType(exportedAs: "com.owtBackstage.app.setlist-row")
}

// «Proponer setlist» (ADR-0091 W1): a Lead builds the service's shared setlist proposal, the same
// one the web editor (`/me/propose/{roleId}`) edits, with the same rules. Every answer of a save
// goes through `ProposalDraftState`, which never throws the lead's work away.

/// The way in, on a service the caller leads: «Proponer setlist», or «Editar propuesta» with the
/// proposal's status.
struct ProposeEntry: View {
    let service: AppService

    var body: some View {
        if service.mayPropose {
            NavigationLink(value: Route.proposal(service)) {
                HStack(spacing: 12) {
                    Image(systemName: service.proposal == .approved ? "checkmark.seal" : "music.note.list")
                        .font(.system(size: 15))
                        .foregroundStyle(BS.accent)
                        .frame(width: 32, height: 32)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(BS.accent.opacity(0.14)))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title)
                            .font(.bsBody(16, .semibold))
                            .foregroundStyle(BS.ink)
                        if let status = service.proposal {
                            Text(status.label)
                                .font(.bsBody(13))
                                .foregroundStyle(BS.inkDim)
                        } else {
                            Text("Diriges este servicio")
                                .font(.bsBody(13))
                                .foregroundStyle(BS.inkDim)
                        }
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
        }
    }

    private var title: String {
        switch service.proposal {
        case nil: "Proponer setlist"
        case .approved: "Ver propuesta"
        default: "Editar propuesta"
        }
    }
}

/// The editor page: loads the proposal, keeps the lead's draft, saves it. What it looks like is
/// `ProposalEditorContent`, which the snapshot test draws with made-up data.
struct ProposalEditorView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let service: AppService

    private enum Phase: Equatable {
        case loading
        case ready
        case unavailable
        case failed(String)
    }

    @State private var phase: Phase = .loading
    @State private var editor: ProposalEditorResponse?
    @State private var draft: ProposalDraftState?
    @State private var picking = false
    @State private var confirmSend = false
    @State private var confirmReload = false
    @State private var confirmLeave = false
    @State private var reloading = false
    @State private var savedNote: String?
    @State private var saves = 0
    /// The proposal's thread as the last save answered it, until the next load or reload.
    @State private var savedMessages: [ThreadMessage]?

    var body: some View {
        content
            .background(BS.base.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            // Unsaved work: no back swipe, so leaving goes through the X and its confirmation.
            .navigationBarBackButtonHidden(draft?.isDirty == true)
            .safeAreaInset(edge: .top, spacing: 0) { header }
            .task {
                if phase == .loading { await load() }
                // The covers come from the Biblioteca the phone already keeps.
                await model.loadCatalogue()
            }
            .sensoryFeedback(.success, trigger: saves)
            .sheet(isPresented: $picking) {
                SongPicker(chosen: Set(draft?.songs.map(\.songId) ?? [])) { song in add(song) }
            }
            .confirmationDialog("¿Enviar la propuesta?", isPresented: $confirmSend, titleVisibility: .visible) {
                Button("Enviar a revisión") { Task { await save(as: .pending) } }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Los administradores la revisan antes de publicarla. Puedes seguir editándola mientras tanto.")
            }
            .confirmationDialog("¿Recargar la propuesta?", isPresented: $confirmReload, titleVisibility: .visible) {
                Button("Descartar mis cambios y recargar", role: .destructive) { Task { await reload() } }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Alguien más la cambió. Tus cambios sin guardar se pierden al recargar.")
            }
            .confirmationDialog("¿Salir sin guardar?", isPresented: $confirmLeave, titleVisibility: .visible) {
                Button("Salir sin guardar", role: .destructive) { dismiss() }
                Button("Seguir editando", role: .cancel) {}
            }
    }

    // MARK: Pieces

    /// Only the close: the page's own head card says which service this is.
    private var header: some View {
        HStack {
            Spacer()
            Button {
                if draft?.isDirty == true { confirmLeave = true } else { dismiss() }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(BS.ink)
                    .frame(width: 36, height: 36)
                    .background(.ultraThinMaterial, in: Circle())
                    .overlay(Circle().strokeBorder(BS.ink.opacity(0.10), lineWidth: 1))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cerrar")
        }
        .padding(.horizontal, 12)
        .padding(.top, 2)
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            ProgressView().tint(BS.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
        case .unavailable:
            message("Ya no puedes proponer para este servicio.")
        case .failed(let text):
            VStack(spacing: 16) {
                message(text)
                Button("Intentar de nuevo") { Task { phase = .loading; await load() } }
                    .buttonStyle(BrandButtonStyle())
                    .padding(.horizontal, 40)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .ready:
            if let editor, let bound = Binding($draft) {
                ScrollView {
                    ProposalEditorContent(
                        service: service,
                        editor: editor,
                        draft: bound,
                        covers: covers,
                        messages: conversation(editor),
                        showsPastorField: showsPastorField(bound.wrappedValue, editor),
                        reloading: reloading,
                        threadOpen: ProposalThreadRule.isOpen(serviceDate: editor.role.date),
                        addSongs: { picking = true },
                        reload: {
                            if draft?.reloadDiscardsWork == true { confirmReload = true } else { Task { await reload() } }
                        },
                        postMessage: { text in await postMessage(text) },
                        verifyThread: { await verifyThread() }
                    )
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
                    .padding(.bottom, 24)
                }
                .scrollDismissesKeyboard(.interactively)
                .safeAreaInset(edge: .bottom, spacing: 0) { actionBar }
            }
        }
    }

    private func message(_ text: String) -> some View {
        Text(text)
            .font(.bsBody(16))
            .foregroundStyle(BS.inkMuted)
            .multilineTextAlignment(.center)
            .padding(32)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Song id → its album cover, from the Biblioteca (empty until it loads: the rows show notes).
    private var covers: [String: String] {
        guard case .loaded(let songs) = model.catalogue else { return [:] }
        var map: [String: String] = [:]
        for song in songs { if let cover = song.cover { map[song.id] = cover } }
        return map
    }

    private var actionBar: some View {
        let state = draft
        let saving = state?.saving
        let enabled = state?.canSave == true
        return Group {
            if state?.isApproved == false {
                VStack(spacing: 8) {
                    if let savedNote {
                        Label(savedNote, systemImage: "checkmark.circle.fill")
                            .font(.bsBody(14, .semibold))
                            .foregroundStyle(BS.positive)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    } else if state?.isDirty == true {
                        HStack(spacing: 6) {
                            Circle().fill(BS.warning).frame(width: 6, height: 6)
                            Text("Cambios sin guardar")
                        }
                        .font(.bsBody(13))
                        .foregroundStyle(BS.inkDim)
                        .transition(.opacity)
                    }
                    HStack(spacing: 12) {
                        Button {
                            Task { await save(as: .draft) }
                        } label: {
                            Text(saving == .draft ? "Guardando…" : "Guardar borrador")
                                .font(.bsBody(16, .semibold))
                                .frame(maxWidth: .infinity, minHeight: 50)
                                .foregroundStyle(BS.accent)
                                .background(Capsule().fill(BS.accent.opacity(0.08)))
                                .overlay(Capsule().strokeBorder(BS.accent.opacity(0.5), lineWidth: 1))
                        }
                        .buttonStyle(CardPressStyle())
                        .disabled(!enabled)
                        Button {
                            confirmSend = true
                        } label: {
                            Label(saving == .pending ? "Enviando…" : "Enviar", systemImage: "paperplane.fill")
                        }
                        .buttonStyle(BrandButtonStyle())
                        .disabled(!enabled || (state?.songs.isEmpty ?? true))
                    }
                    .opacity(enabled ? 1 : 0.5)
                }
                .animation(.easeOut(duration: 0.2), value: state?.isDirty)
                .padding(.horizontal, 20)
                .padding(.top, 10)
                .padding(.bottom, 8)
                .background(BS.base.opacity(0.6).background(.ultraThinMaterial).ignoresSafeArea(edges: .bottom))
                .overlay(alignment: .top) { Rectangle().fill(BS.ink.opacity(0.08)).frame(height: 1) }
            }
        }
    }

    // MARK: Rules the web editor follows

    /// ADR-0087: offered while the service has no pastor's message, and kept whenever this
    /// proposal holds one (stored, or being typed).
    private func showsPastorField(_ state: ProposalDraftState, _ editor: ProposalEditorResponse) -> Bool {
        guard !state.isApproved else { return false }
        let stored = editor.proposal?.pastorMessage.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return editor.serviceThread.pastorMessage == nil || !stored.isEmpty
            || !state.pastorMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// The proposal's thread and the service's conversation, oldest first.
    private func conversation(_ editor: ProposalEditorResponse) -> [ThreadMessage] {
        Self.merged(editor.serviceThread.messages, savedMessages ?? editor.proposal?.messages ?? [])
    }

    private static func merged(_ service: [ThreadMessage], _ proposal: [ThreadMessage]) -> [ThreadMessage] {
        var seen = Set<String>()
        return (service + proposal)
            .filter { seen.insert($0.key).inserted }
            .sorted { ($0.at ?? "") < ($1.at ?? "") }
    }

    // MARK: Work

    private func load() async {
        switch await model.loadProposalEditor(roleId: service.id) {
        case .loaded(let answer):
            editor = answer
            draft = ProposalDraftState(loaded: answer)
            savedMessages = nil
            phase = .ready
        case .unavailable:
            phase = .unavailable
        case .failed(let text):
            phase = .failed(text.isEmpty ? "No se pudo abrir la propuesta." : text)
        }
    }

    /// «Recargar»: the one place the editor adopts what the server holds.
    private func reload() async {
        // A message in flight first: reloading now would forget it and invite a duplicate.
        guard draft?.canReload != false else { return }
        reloading = true
        defer { reloading = false }
        let read = await model.loadProposalEditor(roleId: service.id)
        // The composer waits for a reload, so nothing should have started meanwhile; if it did,
        // what the read answered may predate it: keep everything as it is.
        guard draft?.canReload != false else { return }
        switch read {
        case .loaded(let answer):
            editor = answer
            draft?.reload(from: answer)
            savedMessages = nil
        case .unavailable:
            // No longer the Lead (or the service left): say so over the draft instead of
            // replacing the screen, so what was typed stays visible to copy.
            draft?.noteForbidden()
        case .failed:
            // Nothing replaced: the banner stays, the lead can try again.
            break
        }
    }

    private func save(as target: ProposalStatus) async {
        guard let body = draft?.beginSave(as: target) else { return }
        let outcome = await model.saveProposal(body)
        draft?.finishSave(outcome)
        if case .saved(let answer) = outcome {
            if let messages = answer.messages { savedMessages = messages }
            saves += 1
            withAnimation { savedNote = target == .pending ? "Propuesta enviada" : "Borrador guardado" }
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            withAnimation { savedNote = nil }
        }
    }

    /// One message into the proposal's thread (W1b). The thread on screen follows the answer when
    /// the server could read it back; otherwise what is shown stays.
    private func postMessage(_ text: String) async -> ProposalMessageOutcome {
        // A reload in flight may answer with what predates this message: wait for it.
        guard !reloading, let id = draft?.beginMessage() else { return .notSent }
        let outcome = await model.postProposalMessage(proposalId: id, body: text)
        var rev: String?
        var observedRev: String?
        if case .posted(let answer) = outcome {
            rev = answer.rev
            observedRev = answer.observedRev
            if let messages = answer.messages { savedMessages = messages }
        }
        draft?.finishMessage(proposalId: id, rev: rev, observedRev: observedRev)
        return outcome
    }

    /// The editor read again for its conversation only, after a message's answer was lost: the
    /// thread on screen follows it, the draft is never touched. Nil when the read fails.
    ///
    /// What it answers is always this read's own thread, never the one on screen: the outbox judges
    /// whether the message landed on it, and judging a fresh read on an older thread would call a
    /// landed message «No se envió» and offer the resend that duplicates it.
    private func verifyThread() async -> [ThreadMessage]? {
        guard case .loaded(let answer) = await model.loadProposalEditor(roleId: service.id) else { return nil }
        let fresh = answer.proposal?.messages ?? []
        if !reloading, draft?.isSaving != true {
            if let messages = answer.proposal?.messages { savedMessages = messages }
        } else {
            // A save or «Recargar» in flight brings its own, newer thread: replace nothing, only
            // add what the screen lacks, so a message the outbox now hands over stays in view.
            let shown = savedMessages ?? editor?.proposal?.messages ?? []
            let have = Set(shown.map(\.key))
            let missing = fresh.filter { !have.contains($0.key) }
            if !missing.isEmpty { savedMessages = shown + missing }
        }
        return Self.merged(answer.serviceThread.messages, fresh)
    }

    private func add(_ song: LibrarySong) {
        draft?.add(songId: song.id, title: song.title, author: song.artist, key: song.key, previousKeys: [])
        Task {
            let keys = await model.previousKeys(songIds: [song.id])
            draft?.setPreviousKeys(keys)
        }
    }
}

// MARK: The page

/// Everything between the close and the action bar: the service as a card, the notices, the
/// songs (covers, keys, medleys, reorder by dragging), the notes and the conversation.
struct ProposalEditorContent: View {
    let service: AppService
    let editor: ProposalEditorResponse
    @Binding var draft: ProposalDraftState
    let covers: [String: String]
    let messages: [ThreadMessage]
    let showsPastorField: Bool
    let reloading: Bool
    /// The service day has not passed (the writer's `isThreadOpen`): the composer may show.
    let threadOpen: Bool
    let addSongs: () -> Void
    let reload: () -> Void
    let postMessage: (String) async -> ProposalMessageOutcome
    /// Reads the conversation again after a message's answer was lost (`ConversationThread`).
    let verifyThread: () async -> [ThreadMessage]?

    /// The row being dragged: it stays in the list as a faint placeholder while the others make
    /// room, so the order on screen is always the order that will be saved.
    @State private var dragging: UUID?
    @Environment(\.scenePhase) private var scenePhase

    init(
        service: AppService,
        editor: ProposalEditorResponse,
        draft: Binding<ProposalDraftState>,
        covers: [String: String],
        messages: [ThreadMessage],
        showsPastorField: Bool,
        reloading: Bool = false,
        threadOpen: Bool = false,
        addSongs: @escaping () -> Void = {},
        reload: @escaping () -> Void = {},
        postMessage: @escaping (String) async -> ProposalMessageOutcome = { _ in .failed },
        verifyThread: @escaping () async -> [ThreadMessage]? = { nil }
    ) {
        self.service = service
        self.editor = editor
        _draft = draft
        self.covers = covers
        self.messages = messages
        self.showsPastorField = showsPastorField
        self.reloading = reloading
        self.threadOpen = threadOpen
        self.addSongs = addSongs
        self.reload = reload
        self.postMessage = postMessage
        self.verifyThread = verifyThread
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            headCard
            if let notice = draft.notice { noticeView(notice) }
            if let problem = draft.limitProblem {
                banner(problem, symbol: "exclamationmark.triangle", dismissible: false)
            }
            if let pastor = editor.serviceThread.pastorMessage {
                NoteBox(title: "Mensaje del pastor", text: pastor, symbol: "megaphone", pastor: true)
            }
            if let admin = editor.proposal?.adminNotes {
                NoteBox(title: "Comentarios del admin", text: admin, symbol: "checkmark.bubble", pastor: false)
            }
            songsCard
            notesCard
            if !messages.isEmpty || showsComposer { conversationCard }
        }
        // A drag released anywhere on the page ends; so does any touch after one the system
        // cancelled, and leaving the app (no drop is ever reported for those).
        .onDrop(of: [UTType.setlistRow], isTargeted: nil) { _ in
            dragging = nil
            return true
        }
        .simultaneousGesture(TapGesture().onEnded { if dragging != nil { dragging = nil } })
        .onChange(of: scenePhase) { dragging = nil }
    }

    // MARK: The service

    private var headCard: some View {
        HStack(alignment: .top, spacing: 14) {
            DateLeaf(date: service.date, tone: ServiceTone(service.kind))
            VStack(alignment: .leading, spacing: 8) {
                Text("PROPUESTA DE SETLIST")
                    .font(.bsLabel(11))
                    .tracking(11 * 0.22)
                    .foregroundStyle(BS.sheetTitle)
                Text(service.title.uppercased())
                    .font(.bsDisplay(22))
                    .tracking(0.44)
                    .foregroundStyle(BS.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if let time = service.time {
                    ClockLine(time: time)
                }
                StatusChip(status: draft.status)
                let others = (editor.proposal?.contributors ?? []).filter { !$0.mine }.map(\.name)
                if !others.isEmpty {
                    Label("También la editan \(joinNames(others))", systemImage: "person.2")
                        .font(.bsBody(13))
                        .foregroundStyle(BS.inkDim)
                }
                if draft.isApproved {
                    Text("Ya está aprobada: se ve aquí, sin cambios.")
                        .font(.bsBody(13))
                        .foregroundStyle(BS.inkDim)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 16)
        .padding(.leading, 20)
        .padding(.trailing, 16)
        .background(alignment: .top) {
            LinearGradient(colors: [BS.ink.opacity(0.06), .clear], startPoint: .top, endPoint: .bottom)
                .frame(height: 120)
        }
        .cardSurface(tone: ServiceTone(service.kind))
        .accessibilityElement(children: .combine)
    }

    // MARK: Notices

    @ViewBuilder
    private func noticeView(_ notice: ProposalDraftState.Notice) -> some View {
        switch notice {
        case .reloadNeeded:
            HStack(spacing: 10) {
                Image(systemName: "arrow.triangle.2.circlepath")
                Text("Propuesta actualizada").font(.bsBody(15, .semibold))
                Spacer()
                Button(reloading ? "Recargando…" : "Recargar", action: reload)
                    .font(.bsBody(15, .semibold))
                    .disabled(reloading || !draft.canReload)
            }
            .foregroundStyle(BS.warning)
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(BS.warning.opacity(0.10)))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(BS.warning.opacity(0.30), lineWidth: 1))
        case .needsAdmin:
            banner("Este servicio necesita que un admin lo revise. Tu borrador sigue aquí.", symbol: "exclamationmark.triangle")
        case .notSaved:
            banner("No se pudo guardar. Tus cambios siguen aquí; intenta de nuevo.", symbol: "wifi.exclamationmark")
        case .forbidden:
            banner("Ya no puedes proponer para este servicio.", symbol: "lock")
        case .invalid:
            banner("El servidor no aceptó la propuesta. Revisa las notas y las canciones.", symbol: "exclamationmark.triangle")
        }
    }

    private func banner(_ text: String, symbol: String, dismissible: Bool = true) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
            Text(text).font(.bsBody(14))
            Spacer(minLength: 0)
            if dismissible {
                Button { draft.dismissNotice() } label: { Image(systemName: "xmark").font(.system(size: 12, weight: .bold)) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Cerrar aviso")
            }
        }
        .foregroundStyle(BS.warning)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(BS.warning.opacity(0.10)))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(BS.warning.opacity(0.30), lineWidth: 1))
    }

    // MARK: Songs

    private var songsCard: some View {
        let approved = draft.isApproved
        let tags = draft.songs.map(\.medleyTag)
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                SheetTitle(text: "Canciones", count: draft.songs.isEmpty ? nil : draft.songs.count)
                Spacer()
                if !approved && draft.songs.count > 1 {
                    Text("Mantén presionada para mover o quitar")
                        .font(.bsBody(12))
                        .foregroundStyle(BS.inkDim)
                }
            }
            if draft.songs.isEmpty {
                emptySongs(approved: approved)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(draft.songs.enumerated()), id: \.element.id) { index, song in
                        if index > 0 {
                            MedleyLink(
                                linked: MedleyTags.linked(tags, at: index - 1),
                                editable: !approved,
                                toggle: { withAnimation(.snappy(duration: 0.22)) { draft.toggleMedley(at: index - 1) } }
                            )
                        }
                        ProposalSongRow(
                            number: index + 1,
                            song: song,
                            cover: covers[song.songId],
                            approved: approved,
                            setKey: { key in setKey(key, for: song.id) }
                        )
                        .opacity(dragging == song.id ? 0.35 : 1)
                        .modifier(SongReorder(
                            enabled: !approved,
                            id: song.id,
                            dragging: $dragging,
                            preview: ProposalSongRow(number: index + 1, song: song, cover: covers[song.songId], approved: true, setKey: { _ in }),
                            move: move
                        ))
                        .contextMenu {
                            if !approved {
                                if index > 0 {
                                    Button { step(song.id, by: -1) } label: { Label("Subir", systemImage: "arrow.up") }
                                }
                                if index + 1 < draft.songs.count {
                                    Button { step(song.id, by: 1) } label: { Label("Bajar", systemImage: "arrow.down") }
                                }
                                Button(role: .destructive) { removeSong(song.id) } label: {
                                    Label("Quitar de la propuesta", systemImage: "trash")
                                }
                            }
                        }
                    }
                }
                // A drop in the gaps between rows ends the drag too.
                .onDrop(of: [UTType.setlistRow], isTargeted: nil) { _ in
                    dragging = nil
                    return true
                }
                .sensoryFeedback(.selection, trigger: draft.songs.map(\.id))
                if !approved {
                    addButton
                        .disabled(draft.songs.count >= ProposalLimits.songsMax)
                }
            }
        }
    }

    private func emptySongs(approved: Bool) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "music.note.list")
                .font(.system(size: 22))
                .foregroundStyle(BS.accent)
                .frame(width: 52, height: 52)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(BS.accent.opacity(0.12)))
            Text(approved ? "Esta propuesta no tiene canciones." : "Todavía no hay canciones")
                .font(.bsBody(16, .semibold))
                .foregroundStyle(BS.ink)
            if !approved {
                Text("Elige de la Biblioteca las que propones para este servicio.")
                    .font(.bsBody(14))
                    .foregroundStyle(BS.inkMuted)
                    .multilineTextAlignment(.center)
                Button(action: addSongs) {
                    Label("Agregar canciones", systemImage: "plus")
                }
                .buttonStyle(BrandButtonStyle())
                .padding(.horizontal, 24)
                .padding(.top, 4)
            }
        }
        .padding(.vertical, 24)
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity)
        .overlay(
            RoundedRectangle(cornerRadius: BS.panelRadius, style: .continuous)
                .strokeBorder(BS.ink.opacity(0.14), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
        )
    }

    private var addButton: some View {
        Button(action: addSongs) {
            HStack(spacing: 8) {
                Image(systemName: "plus.circle.fill").font(.system(size: 18))
                Text("Agregar canciones").font(.bsBody(16, .semibold))
            }
            .foregroundStyle(BS.accent)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(RoundedRectangle(cornerRadius: BS.panelRadius, style: .continuous).fill(BS.accent.opacity(0.05)))
            .overlay(
                RoundedRectangle(cornerRadius: BS.panelRadius, style: .continuous)
                    .strokeBorder(BS.accent.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(CardPressStyle())
    }

    /// The dragged row takes the place of the one it is over, right away: the list is already in
    /// its final order when the finger lifts, so nothing settles afterwards.
    private func move(_ moving: UUID, over target: UUID) {
        guard moving != target,
              let from = draft.songs.firstIndex(where: { $0.id == moving }),
              let to = draft.songs.firstIndex(where: { $0.id == target }) else { return }
        withAnimation(.snappy(duration: 0.22)) {
            draft.move(from: IndexSet(integer: from), to: to > from ? to + 1 : to)
        }
    }

    // The menus act on the row they were opened on, found by its identity when tapped: the
    // list may have changed under an open menu (a reload landing).

    private func step(_ id: UUID, by delta: Int) {
        dragging = nil
        guard let index = draft.songs.firstIndex(where: { $0.id == id }) else { return }
        let to = index + delta
        guard draft.songs.indices.contains(to) else { return }
        withAnimation(.snappy(duration: 0.22)) {
            draft.move(from: IndexSet(integer: index), to: delta > 0 ? to + 1 : to)
        }
    }

    private func removeSong(_ id: UUID) {
        dragging = nil
        guard let index = draft.songs.firstIndex(where: { $0.id == id }) else { return }
        withAnimation(.snappy(duration: 0.22)) { draft.remove(at: IndexSet(integer: index)) }
    }

    private func setKey(_ key: String, for id: UUID) {
        guard let index = draft.songs.firstIndex(where: { $0.id == id }) else { return }
        draft.setPlayKey(key, at: index)
    }

    // MARK: Notes

    private var notesCard: some View {
        let approved = draft.isApproved
        return VStack(alignment: .leading, spacing: 16) {
            SheetTitle(text: "Notas")
            NoteField(
                title: "Notas para el equipo", symbol: "text.bubble",
                text: $draft.teamNotes, placeholder: "Lo que el equipo debe saber", disabled: approved
            )
            if showsPastorField {
                NoteField(
                    title: "Mensaje del pastor", symbol: "megaphone",
                    text: $draft.pastorMessage, placeholder: "Lo que el pastor compartió para este servicio", disabled: approved
                )
            }
            if !draft.proposalExists && !approved {
                NoteField(
                    title: "Nota para los admins", symbol: "lock",
                    text: $draft.leadNotes, placeholder: "Solo la ven los administradores", disabled: false
                )
            }
        }
        .padding(16)
        .cardSurface()
    }

    // MARK: Conversation

    /// The web's composer: once the proposal exists, until the service day has passed.
    private var showsComposer: Bool { draft.proposalExists && threadOpen }

    private var conversationCard: some View {
        ConversationThread(
            messages: messages,
            canCompose: showsComposer,
            // A message waits while a save or a reload is in flight.
            canPostNow: draft.canPostMessage && !reloading,
            hint: "Solo la ven los líderes y los admins.",
            post: postMessage,
            verify: verifyThread
        )
        .padding(16)
        .cardSurface()
    }
}

/// The proposal's state as a chip: a draft is quiet, a review in progress cyan, a change
/// request amber, an approval green.
struct StatusChip: View {
    let status: ProposalStatus?

    private var look: (text: String, symbol: String, color: Color) {
        switch status {
        case nil: return ("Nueva", "sparkles", BS.inkDim)
        case .draft: return ("Borrador", "pencil", BS.inkMuted)
        case .pending: return ("En revisión", "hourglass", BS.accent)
        case .changesRequested: return ("Cambios solicitados", "arrow.uturn.backward", BS.warning)
        case .approved: return ("Aprobada", "checkmark.seal.fill", BS.positive)
        }
    }

    var body: some View {
        let look = look
        Label(look.text, systemImage: look.symbol)
            .font(.bsLabel(12))
            .foregroundStyle(look.color)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Capsule().fill(look.color.opacity(0.12)))
            .overlay(Capsule().strokeBorder(look.color.opacity(0.30), lineWidth: 1))
    }
}

/// One song of the draft: its cover with its place, the title, the author, the keys it was
/// played in before, the key it is proposed in (a menu, in the key's rose) and a grip.
struct ProposalSongRow: View {
    let number: Int
    let song: DraftSong
    let cover: String?
    let approved: Bool
    let setKey: (String) -> Void

    /// The web's `KEY_OPTIONS`, plus the song's own spellings when the list lacks them.
    static let keys = [
        "A", "Am", "Bb", "Bbm", "B", "Bm", "C", "Cm",
        "C#", "C#m", "D", "Dm", "Eb", "Ebm", "E", "Em",
        "F", "Fm", "F#", "F#m", "G", "Gm", "Ab", "Abm",
    ]

    private var options: [String] {
        let own = [song.playKey, song.key ?? ""].filter { !$0.isEmpty && !Self.keys.contains($0) }
        var seen = Set<String>()
        return own.filter { seen.insert($0).inserted } + Self.keys
    }

    var body: some View {
        HStack(spacing: 12) {
            CoverView(url: cover, size: 52, number: number)
            VStack(alignment: .leading, spacing: 3) {
                Text(song.title)
                    .font(.bsBody(16, .semibold))
                    .foregroundStyle(BS.ink)
                    .lineLimit(2)
                if let author = song.author {
                    Text(author)
                        .font(.bsBody(13))
                        .foregroundStyle(BS.inkMuted)
                        .lineLimit(1)
                }
                if !song.previousKeys.isEmpty {
                    HStack(spacing: 4) {
                        Text("Antes")
                            .font(.bsBody(11))
                            .foregroundStyle(BS.inkDim)
                        ForEach(song.previousKeys.prefix(4), id: \.self) { key in
                            Text(key)
                                .font(.bsLabel(10))
                                .foregroundStyle(BS.inkMuted)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 1)
                                .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(BS.ink.opacity(0.14), lineWidth: 1))
                        }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Tonos anteriores: \(song.previousKeys.joined(separator: ", "))")
                }
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 3) {
                keyControl
                if let original = song.key, !original.isEmpty, original != song.playKey {
                    Text("orig. \(original)")
                        .font(.bsLabel(10))
                        .foregroundStyle(BS.inkDim)
                }
            }
            if !approved {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(BS.inkDim)
                    .frame(width: 22)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: BS.panelRadius, style: .continuous).fill(BS.card))
        .overlay(RoundedRectangle(cornerRadius: BS.panelRadius, style: .continuous).strokeBorder(BS.ink.opacity(0.08), lineWidth: 1))
        .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
        .contentShape(RoundedRectangle(cornerRadius: BS.panelRadius, style: .continuous))
    }

    @ViewBuilder
    private var keyControl: some View {
        let label = HStack(spacing: 3) {
            Text(song.playKey.isEmpty ? "Tono" : song.playKey)
            if !approved {
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold))
            }
        }
        .font(.bsLabel(14))
        .foregroundStyle(BS.key)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .frame(minWidth: 44)
        .background(Capsule().fill(BS.key.opacity(0.10)))
        .overlay(Capsule().strokeBorder(BS.key.opacity(0.35), lineWidth: 1))
        if approved {
            label
        } else {
            Menu {
                Picker("Tono", selection: Binding(get: { song.playKey }, set: setKey)) {
                    ForEach(options, id: \.self) { key in
                        Text(key == song.key ? "\(key) (original)" : key).tag(key)
                    }
                }
            } label: {
                label
            }
            .accessibilityLabel("Tono: \(song.playKey)")
        }
    }
}

/// The gap between two songs: a thread joins them when they are a medley, and the chip there
/// links or unlinks them.
struct MedleyLink: View {
    let linked: Bool
    let editable: Bool
    let toggle: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            // Under the covers' centre (row padding 12 + half a 52 pt cover).
            Capsule()
                .fill(linked ? BS.accent : BS.ink.opacity(0.10))
                .frame(width: linked ? 3 : 1, height: 26)
                .padding(.leading, 37)
            if editable || linked {
                Button(action: toggle) {
                    Label(linked ? "Medley" : "Unir en medley", systemImage: linked ? "link" : "plus")
                        .font(.bsLabel(10))
                        .tracking(0.8)
                        .foregroundStyle(linked ? BS.accent : BS.inkDim)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(linked ? BS.accent.opacity(0.12) : Color.clear))
                        .overlay(Capsule().strokeBorder(linked ? BS.accent.opacity(0.40) : BS.ink.opacity(0.12), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(!editable)
                .accessibilityHint(linked ? "Separa estas dos canciones" : "Las une en un medley")
            }
            Spacer()
        }
        .frame(height: 30)
    }
}

/// Long-press a row and drag it: the row under the finger gives up its place at once.
private struct SongReorder<Preview: View>: ViewModifier {
    let enabled: Bool
    let id: UUID
    @Binding var dragging: UUID?
    let preview: Preview
    let move: (UUID, UUID) -> Void

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content
                .onDrag {
                    dragging = id
                    // Only this app's own rows read this type, and only inside this app: nothing
                    // takes the row as text (a notes field would paste its id).
                    let provider = NSItemProvider()
                    let payload = Data(id.uuidString.utf8)
                    provider.registerDataRepresentation(forTypeIdentifier: UTType.setlistRow.identifier, visibility: .ownProcess) { done in
                        done(payload, nil)
                        return nil
                    }
                    return provider
                } preview: {
                    preview.frame(width: 361)
                }
                .onDrop(of: [UTType.setlistRow], delegate: SongDropDelegate(target: id, dragging: $dragging, move: move))
        } else {
            content
        }
    }
}

private struct SongDropDelegate: DropDelegate {
    let target: UUID
    @Binding var dragging: UUID?
    let move: (UUID, UUID) -> Void

    func dropEntered(info: DropInfo) {
        guard let dragging, dragging != target else { return }
        move(dragging, target)
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func performDrop(info: DropInfo) -> Bool {
        dragging = nil
        return true
    }
}

/// A note the lead writes: an icon, a small-caps title, the field in a soft well.
private struct NoteField: View {
    let title: String
    let symbol: String
    @Binding var text: String
    let placeholder: String
    let disabled: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title.uppercased(), systemImage: symbol)
                .font(.bsLabel(11))
                .tracking(1.1)
                .foregroundStyle(BS.inkDim)
            TextField(placeholder, text: $text, axis: .vertical)
                .font(.bsBody(16))
                .foregroundStyle(BS.ink)
                .lineLimit(2...8)
                .disabled(disabled)
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(BS.ink.opacity(0.04)))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(BS.ink.opacity(0.10), lineWidth: 1))
            if text.utf16.count > ProposalLimits.notesMax - 200 {
                Text("\(text.utf16.count) / \(ProposalLimits.notesMax)")
                    .font(.bsBody(12))
                    .monospacedDigit()
                    .foregroundStyle(ProposalLimits.fits(text) ? BS.inkDim : BS.warning)
            }
        }
    }
}

/// One message of the conversation as a bubble: the lead's own on the right, everyone else's on
/// the left with their name and role.
struct MessageBubble: View {
    let message: ThreadMessage
    /// Sent from this screen: it carries «Enviado», as a messaging app does.
    var sent = false

    var body: some View {
        HStack {
            if message.mine { Spacer(minLength: 40) }
            VStack(alignment: message.mine ? .trailing : .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(message.mine ? "Tú" : (message.authorName ?? "Administración"))
                        .font(.bsBody(12, .semibold))
                        .foregroundStyle(message.mine ? BS.accent : BS.ink)
                    if let role = roleLabel {
                        Text(role).font(.bsBody(11)).foregroundStyle(BS.inkDim)
                    }
                    if let day = dayLabel {
                        Text(day).font(.bsBody(11)).foregroundStyle(BS.inkDim)
                    }
                }
                Text(message.body)
                    .font(.bsBody(15))
                    .foregroundStyle(BS.inkMuted)
                    .multilineTextAlignment(message.mine ? .trailing : .leading)
                    .textSelection(.enabled)
                if sent && message.mine { SentMark() }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(message.mine ? BS.accent.opacity(0.10) : BS.ink.opacity(0.05))
            )
            if !message.mine { Spacer(minLength: 40) }
        }
        .accessibilityElement(children: .combine)
    }

    private var roleLabel: String? {
        switch message.authorRole {
        case "admin": "Admin"
        case "pastor": "Pastor"
        case "lead": "Lead"
        default: nil
        }
    }

    /// «26 nov»: the day it was written, read from the ISO instant's date part.
    private var dayLabel: String? {
        guard let at = message.at, at.count >= 10 else { return nil }
        return ServiceDay.parse(String(at.prefix(10))).map { date in
            let f = DateFormatter()
            f.locale = Locale(identifier: "es_MX")
            f.dateFormat = "d MMM"
            return f.string(from: date).replacingOccurrences(of: ".", with: "")
        }
    }
}

/// The Biblioteca, to pick songs from: search, tap to add; a song already in the list reads
/// «En lista». The sheet stays open so a lead can pick the whole set in one go.
private struct SongPicker: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let chosen: Set<String>
    let pick: (LibrarySong) -> Void
    @State private var query = ""
    @State private var added: Set<String> = []

    init(chosen: Set<String>, pick: @escaping (LibrarySong) -> Void) {
        self.chosen = chosen
        self.pick = pick
    }

    var body: some View {
        NavigationStack {
            Group {
                switch model.catalogue {
                case .idle, .loading:
                    ProgressView().tint(BS.accent).frame(maxWidth: .infinity, maxHeight: .infinity)
                case .notInWorship:
                    Text("La Biblioteca es del equipo de Alabanza.").font(.bsBody(15)).foregroundStyle(BS.inkDim)
                case .failed(let text):
                    VStack(spacing: 12) {
                        Text(text).font(.bsBody(15)).foregroundStyle(BS.inkDim).multilineTextAlignment(.center)
                        Button("Intentar de nuevo") { Task { await model.loadCatalogue(force: true) } }
                    }
                    .padding(24)
                case .loaded(let songs):
                    List(Library.search(songs, query)) { song in
                        let inList = chosen.contains(song.id) || added.contains(song.id)
                        Button {
                            guard !inList else { return }
                            added.insert(song.id)
                            pick(song)
                        } label: {
                            HStack(spacing: 12) {
                                CoverView(url: song.cover, size: 44, number: nil)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(song.title).font(.bsBody(16, .semibold)).foregroundStyle(BS.ink).lineLimit(1)
                                    if let byline = song.byline {
                                        Text(byline).font(.bsBody(13)).foregroundStyle(BS.inkMuted).lineLimit(1)
                                    }
                                }
                                Spacer(minLength: 4)
                                if inList {
                                    Text("En lista").font(.bsLabel(12)).foregroundStyle(BS.positive)
                                } else if let key = song.key {
                                    Text(key).font(.bsLabel(13)).foregroundStyle(BS.inkDim)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(BS.card)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Buscar canción")
                }
            }
            .background(BS.base.ignoresSafeArea())
            .navigationTitle("Agregar canciones")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Listo") { dismiss() }
                }
            }
        }
        .task { await model.loadCatalogue() }
    }
}
