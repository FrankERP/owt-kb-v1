import SwiftUI

// «Admin» → «Propuestas»: an admin reviews the leads' setlist proposals from the phone (ADR-0091
// A-W1). The web's `/admin` «Propuestas» tab, through the same writers; better where a phone is
// riskier: an approval shows the songs it will publish and asks first, and a proposal that changed
// under an open detail must be looked at again before any decision (`ProposalReviewState`).

// MARK: The tab

struct AdminTab: View {
    @Environment(AppModel.self) private var model
    let me: Me
    let profile: () -> Void
    @State private var path: [String] = []
    @State private var filter: AdminFilter = .pending
    @State private var refreshes = 0

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                AdminProposalList(
                    proposals: model.adminProposals,
                    filter: $filter,
                    open: { path.append($0) },
                    retry: { Task { await model.loadAdminProposals() } }
                )
            }
            .background(BS.base.ignoresSafeArea())
            .safeAreaInset(edge: .top, spacing: 0) {
                TopBar(me: me, profile: profile)
            }
            .refreshable {
                await model.loadAdminProposals()
                refreshes += 1
            }
            .sensoryFeedback(.impact(weight: .light), trigger: refreshes)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { id in
                AdminProposalDetail(proposalId: id)
            }
        }
        .task {
            if case .idle = model.adminProposals { await model.loadAdminProposals() }
        }
    }
}

enum AdminFilter: String, CaseIterable, Identifiable {
    case pending, changesRequested, approved, draft
    var id: String { rawValue }

    var status: ProposalStatus {
        switch self {
        case .pending: .pending
        case .changesRequested: .changesRequested
        case .approved: .approved
        case .draft: .draft
        }
    }

    var label: String {
        switch self {
        case .pending: "Pendientes"
        case .changesRequested: "En revisión"
        case .approved: "Aprobadas"
        case .draft: "Borradores"
        }
    }

    var empty: String {
        switch self {
        case .pending: "No hay propuestas pendientes."
        case .changesRequested: "Ninguna propuesta espera cambios."
        case .approved: "No hay propuestas aprobadas de aquí en adelante."
        case .draft: "No hay borradores de aquí en adelante."
        }
    }
}

// MARK: The list

struct AdminProposalList: View {
    let proposals: AppModel.AdminProposals
    @Binding var filter: AdminFilter
    let open: (String) -> Void
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Text("ADMIN")
                    .font(.bsLabel(11))
                    .tracking(11 * 0.22)
                    .foregroundStyle(BS.sheetTitle)
                Text("PROPUESTAS")
                    .font(.bsDisplay(28))
                    .tracking(0.56)
                    .foregroundStyle(BS.ink)
            }
            .padding(.top, 8)
            switch proposals {
            case .idle, .loading:
                ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
            case .forbidden:
                quiet("Revisar propuestas es para los admins.")
            case .failed(let message):
                VStack(spacing: 12) {
                    quiet(message)
                    Button("Intentar de nuevo", action: retry).buttonStyle(BrandButtonStyle()).padding(.horizontal, 40)
                }
            case .loaded(let list):
                Picker("Estado", selection: $filter) {
                    ForEach(AdminFilter.allCases) { f in
                        Text(label(f, list)).tag(f)
                    }
                }
                .pickerStyle(.segmented)
                .sensoryFeedback(.selection, trigger: filter)
                let shown = list.filter { $0.status == filter.status.rawValue }
                if shown.isEmpty {
                    quiet(filter.empty)
                } else {
                    VStack(spacing: 12) {
                        ForEach(shown) { proposal in
                            Button { open(proposal.id) } label: { AdminProposalRow(proposal: proposal) }
                                .buttonStyle(CardPressStyle())
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 32)
        .animation(.snappy(duration: 0.25), value: filter)
    }

    private func label(_ f: AdminFilter, _ list: [AdminProposal]) -> String {
        guard f == .pending || f == .changesRequested else { return f.label }
        let n = list.filter { $0.status == f.status.rawValue }.count
        return n > 0 ? "\(f.label) \(n)" : f.label
    }

    private func quiet(_ text: String) -> some View {
        Text(text)
            .font(.bsBody(15))
            .foregroundStyle(BS.inkMuted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
    }
}

struct AdminProposalRow: View {
    let proposal: AdminProposal

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            DateLeaf(date: proposal.service.date, tone: ServiceTone(proposal.service.kind))
            VStack(alignment: .leading, spacing: 6) {
                Text(proposal.service.title.uppercased())
                    .font(.bsDisplay(18))
                    .tracking(0.36)
                    .foregroundStyle(BS.ink)
                    .lineLimit(2)
                Text(proposal.leadName ?? "Sin líder")
                    .font(.bsBody(14))
                    .foregroundStyle(BS.inkMuted)
                HStack(spacing: 8) {
                    StatusChip(status: proposal.proposalStatus)
                    Label("\(proposal.songs.count)", systemImage: "music.note")
                        .font(.bsLabel(12))
                        .foregroundStyle(BS.inkDim)
                        .accessibilityLabel("\(proposal.songs.count) canciones")
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(BS.inkDim)
                .padding(.top, 6)
        }
        .padding(.vertical, 14)
        .padding(.leading, 16)
        .padding(.trailing, 14)
        .cardSurface(tone: ServiceTone(proposal.service.kind))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: The detail

struct AdminProposalDetail: View {
    @Environment(AppModel.self) private var model
    let proposalId: String
    @State private var state: ProposalReviewState?
    @State private var sheet: DecisionSheet?
    @State private var note: String?
    @State private var decisions = 0
    @State private var reloading = false
    /// A note typed into a sheet that closed without sending (the proposal moved): offered again.
    @State private var keptNotes: [ProposalAction: String] = [:]

    struct DecisionSheet: Identifiable {
        let action: ProposalAction
        /// The revision on screen when it opened: the decision is sent only on that one.
        let openedRev: String
        var id: String { action.rawValue }
    }

    var body: some View {
        ScrollView {
            if let binding = Binding($state) {
                AdminProposalContent(
                    state: binding,
                    covers: covers,
                    note: note,
                    reloading: reloading,
                    decide: { action in
                        note = nil
                        sheet = DecisionSheet(action: action, openedRev: binding.wrappedValue.heldRev)
                    },
                    reload: { Task { await reload() } },
                    postMessage: postMessage
                )
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            } else {
                Text("Esta propuesta ya no está en la lista.")
                    .font(.bsBody(16))
                    .foregroundStyle(BS.inkMuted)
                    .padding(32)
            }
        }
        .background(BS.base.ignoresSafeArea())
        .navigationTitle("Propuesta")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .refreshable { await reload() }
        .sensoryFeedback(.success, trigger: decisions)
        .task {
            if state == nil, case .loaded(let list) = model.adminProposals,
               let row = list.first(where: { $0.id == proposalId }) {
                state = ProposalReviewState(proposal: row)
                state?.passOver(read: model.adminProposalsLanded)
            }
            // The covers come from the Biblioteca the phone already keeps (refused outside
            // Alabanza: the rows then show a note instead).
            await model.loadCatalogue()
        }
        // Every list read lands here, whatever started it (a pull, the return to the app): the
        // state decides whether the content changed under the admin.
        .onChange(of: model.adminProposals) { _, _ in land() }
        .sheet(item: $sheet) { open in
            DecisionSheetView(
                action: open.action,
                proposal: state?.proposal,
                initialText: keptNotes[open.action] ?? "",
                confirm: { text in await decide(open, notes: text) }
            )
            .presentationDetents(open.action == .approve ? [.large] : [.medium, .large])
        }
    }

    private var covers: [String: String] {
        guard case .loaded(let songs) = model.catalogue else { return [:] }
        var map: [String: String] = [:]
        for song in songs { if let cover = song.cover { map[song.id] = cover } }
        return map
    }

    /// A list read, then that read applied here if it landed.
    private func reload() async {
        reloading = true
        await model.loadAdminProposals()
        reloading = false
        land()
    }

    /// Applies the model's list when it comes from a read newer than the last one applied here
    /// (`ProposalReviewState.land`). A read refused while a decision or a message is in flight is
    /// applied when the flight ends, which calls this again.
    private func land() {
        guard case .loaded(let rows) = model.adminProposals else { return }
        state?.land(rows, read: model.adminProposalsLanded)
    }

    private func passOverReadsSoFar() { state?.passOver(read: model.adminProposalsLanded) }

    /// What the sheet does next: close, or stay open saying why.
    private func decide(_ open: DecisionSheet, notes: String) async -> DecisionSheetView.Next {
        guard var current = state else { return .close }
        switch current.beginDecision(open.action, openedRev: open.openedRev) {
        case .busy:
            return .stay(nil)
        case .moved:
            keptNotes[open.action] = notes
            note = "La propuesta cambió. Revísala de nuevo."
            return .close
        case .send(let rev):
            keptNotes[open.action] = nil
            state = current
            let body = ProposalDecisionBody(action: open.action, rev: rev, adminNotes: notes)
            let outcome = await model.decideProposal(proposalId: proposalId, body: body)
            state?.finishDecision(outcome)
            switch outcome {
            case .done(let answer):
                note = ProposalDecisionOutcome.doneText(answer, action: open.action)
                decisions += 1
                passOverReadsSoFar()
                await reload()
                return .close
            case .conflict, .blocked:
                // Locked: only a read started after this answer (`Recargar`) clears it.
                keptNotes[open.action] = notes
                note = nil
                passOverReadsSoFar()
                return .close
            case .forbidden:
                note = "Ya no puedes revisar propuestas."
                land()
                return .close
            case .refused:
                note = "Esta propuesta ya no existe."
                await reload()
                return .close
            case .invalid:
                keptNotes[open.action] = notes
                land()
                return .stay("No se pudo procesar. Revisa la nota.")
            case .failed:
                // A repeated identical decision is a no-write replay on the server: retrying is safe.
                keptNotes[open.action] = notes
                land()
                return .stay("No se pudo confirmar. Recarga para ver si quedó, o intenta de nuevo.")
            case .notSent:
                return .stay(nil)
            }
        }
    }

    private func postMessage(_ text: String) async -> ProposalMessageOutcome {
        guard let id = state?.beginMessage() else { return .notSent }
        let outcome = await model.postAdminProposalMessage(proposalId: id, body: text)
        if case .posted(let answer) = outcome {
            state?.finishMessage(proposalId: id, observedRev: answer.observedRev, messages: answer.messages)
            passOverReadsSoFar()
            // Content and revision arrive together only from a list read (spec D4). It runs after
            // the answer goes back, so the composer clears at once and nothing typed during the
            // read is erased; decisions wait for it (`reloading`).
            Task { await reload() }
        } else {
            state?.endMessage()
            land()
        }
        return outcome
    }
}

struct AdminProposalContent: View {
    @Binding var state: ProposalReviewState
    let covers: [String: String]
    let note: String?
    let reloading: Bool
    let decide: (ProposalAction) -> Void
    let reload: () -> Void
    let postMessage: (String) async -> ProposalMessageOutcome

    @State private var composer = ""
    @State private var composerNote: String?
    @State private var sentMessages = 0

    private var proposal: AdminProposal { state.proposal }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            headCard
            if state.gone {
                banner("Esta propuesta ya no está en la lista.", symbol: "tray")
            }
            if !state.changeSeen { changedBanner }
            if state.locked { lockedBanner }
            if let note { banner(note, symbol: "info.circle") }
            songsCard
            if let pastor = proposal.pastorMessage {
                VStack(alignment: .leading, spacing: 6) {
                    NoteBox(title: "Mensaje del pastor", text: pastor, symbol: "megaphone", pastor: true)
                    Text("Al aprobar, pasa al servicio si el servicio no tiene uno.")
                        .font(.bsBody(12))
                        .foregroundStyle(BS.inkDim)
                        .padding(.leading, 44)
                }
            }
            if let team = proposal.teamNotes {
                NoteBox(title: "Mensaje para el equipo", text: team, symbol: "text.bubble", pastor: false)
            }
            if !proposal.conversation.isEmpty || proposal.threadOpen { conversationCard }
            if !state.gone { actions }
        }
        .padding(.top, 8)
    }

    // MARK: Head

    private var headCard: some View {
        HStack(alignment: .top, spacing: 14) {
            DateLeaf(date: proposal.service.date, tone: ServiceTone(proposal.service.kind))
            VStack(alignment: .leading, spacing: 8) {
                Text("PROPUESTA DE SETLIST")
                    .font(.bsLabel(11))
                    .tracking(11 * 0.22)
                    .foregroundStyle(BS.sheetTitle)
                Text(proposal.service.title.uppercased())
                    .font(.bsDisplay(22))
                    .tracking(0.44)
                    .foregroundStyle(BS.ink)
                    .fixedSize(horizontal: false, vertical: true)
                StatusChip(status: proposal.proposalStatus)
                if let lead = proposal.leadName {
                    Label(lead, systemImage: "music.mic")
                        .font(.bsBody(14))
                        .foregroundStyle(BS.inkMuted)
                }
                if !proposal.coLeads.isEmpty {
                    Label("También la editan \(joinNames(proposal.coLeads))", systemImage: "person.2")
                        .font(.bsBody(13))
                        .foregroundStyle(BS.inkDim)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 16)
        .padding(.leading, 20)
        .padding(.trailing, 16)
        .cardSurface(tone: ServiceTone(proposal.service.kind))
        .accessibilityElement(children: .combine)
    }

    // MARK: Banners

    private var changedBanner: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("La propuesta cambió", systemImage: "arrow.triangle.2.circlepath")
                .font(.bsBody(15, .semibold))
            Text("Revisa las canciones y notas antes de decidir.")
                .font(.bsBody(14))
            Button("Ya la revisé") {
                withAnimation(.snappy(duration: 0.2)) { state.acknowledgeChange() }
            }
            .font(.bsBody(15, .semibold))
        }
        .foregroundStyle(BS.warning)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(BS.warning.opacity(0.10)))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(BS.warning.opacity(0.30), lineWidth: 1))
    }

    private var lockedBanner: some View {
        let blocked = state.lockReason == .blocked
        return VStack(alignment: .leading, spacing: 10) {
            Label(blocked ? "No se pudo decidir" : "Propuesta actualizada", systemImage: blocked ? "exclamationmark.triangle" : "arrow.triangle.2.circlepath")
                .font(.bsBody(15, .semibold))
            Text(blocked
                 ? "Esta propuesta tiene un problema que hay que arreglar desde la web."
                 : "Cambió mientras la revisabas. Recarga y vuelve a revisar.")
                .font(.bsBody(14))
            Button(reloading ? "Recargando…" : "Recargar", action: reload)
                .font(.bsBody(15, .semibold))
                .disabled(reloading || !state.canApply)
        }
        .foregroundStyle(BS.warning)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(BS.warning.opacity(0.10)))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(BS.warning.opacity(0.30), lineWidth: 1))
    }

    private func banner(_ text: String, symbol: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
            Text(text).font(.bsBody(14))
            Spacer(minLength: 0)
        }
        .foregroundStyle(BS.accent)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(BS.accent.opacity(0.08)))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(BS.accent.opacity(0.25), lineWidth: 1))
    }

    // MARK: Songs

    private var songsCard: some View {
        let tags = proposal.songs.map(\.medleyTag)
        return VStack(alignment: .leading, spacing: 12) {
            SheetTitle(text: "Canciones", count: proposal.songs.isEmpty ? nil : proposal.songs.count)
            if proposal.songs.isEmpty {
                Text("Esta propuesta no tiene canciones.")
                    .font(.bsBody(15))
                    .foregroundStyle(BS.inkMuted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 20)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(proposal.songs.enumerated()), id: \.offset) { index, song in
                        if index > 0 && MedleyTags.linked(tags, at: index - 1) {
                            MedleyLink(linked: true, editable: false, toggle: {})
                        } else if index > 0 {
                            Spacer().frame(height: 8)
                        }
                        ProposalSongRow(
                            number: index + 1,
                            song: DraftSong(song),
                            cover: covers[song.songId],
                            approved: true,
                            setKey: { _ in }
                        )
                    }
                }
            }
        }
    }

    // MARK: Conversation

    private var conversationCard: some View {
        let messages = proposal.conversation
        return VStack(alignment: .leading, spacing: 12) {
            SheetTitle(text: "Conversación", count: messages.count)
            ForEach(messages) { message in
                MessageBubble(message: message)
            }
            if proposal.threadOpen { composerView(hasMessages: !messages.isEmpty) }
        }
        .padding(16)
        .cardSurface()
        .sensoryFeedback(.success, trigger: sentMessages)
    }

    private var canSend: Bool {
        state.canPost
            && !composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && ProposalLimits.fits(composer)
    }

    private func composerView(hasMessages: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Escribe un mensaje", text: $composer, axis: .vertical)
                    .lineLimit(1...6)
                    .font(.bsBody(16))
                    .foregroundStyle(BS.ink)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(BS.ink.opacity(0.05)))
                    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(BS.ink.opacity(0.10), lineWidth: 1))
                    .disabled(state.posting)
                Button {
                    Task { await send() }
                } label: {
                    Group {
                        if state.posting {
                            ProgressView().tint(BS.base)
                        } else {
                            Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold))
                        }
                    }
                    .foregroundStyle(BS.base)
                    .frame(width: 38, height: 38)
                    .background(Circle().fill(canSend || state.posting ? BS.accent : BS.ink.opacity(0.15)))
                }
                .disabled(!canSend)
                .accessibilityLabel("Enviar mensaje")
            }
            Text(composerHint)
                .font(.bsBody(12))
                .foregroundStyle(composerNote == nil && ProposalLimits.fits(composer) ? BS.inkDim : BS.warning)
        }
        .padding(.top, hasMessages ? 4 : 0)
    }

    private var composerHint: String {
        if let composerNote { return composerNote }
        if !ProposalLimits.fits(composer) { return "Un mensaje puede tener hasta \(ProposalLimits.notesMax) caracteres." }
        return "Lo ven el líder y los admins."
    }

    private func send() async {
        guard canSend else { return }
        composerNote = nil
        switch await postMessage(composer) {
        case .posted:
            composer = ""
            sentMessages += 1
        case .notSent:
            break
        case .failed:
            // No idempotency on a message: a blind retry is a permanent duplicate (spec D4).
            composerNote = "No se pudo confirmar el envío. Recarga para ver si llegó antes de volver a enviarlo."
        case .forbidden:
            composerNote = "Ya no puedes escribir en esta propuesta."
        case .closed:
            composerNote = "La conversación de este servicio ya cerró."
        case .full:
            composerNote = "Esta conversación llegó a su límite de mensajes."
        case .invalid:
            composerNote = "El mensaje no es válido."
        case .refused:
            composerNote = "No se pudo enviar: esta propuesta ya no existe o hay que revisarla desde la web."
        }
    }

    // MARK: Actions

    @ViewBuilder
    private var actions: some View {
        switch state.status {
        case .pending, .changesRequested:
            VStack(spacing: 10) {
                Button { decide(.approve) } label: {
                    if state.deciding { ProgressView().tint(BS.base) } else { Text("Aprobar") }
                }
                .buttonStyle(BrandButtonStyle())
                .disabled(reloading || !state.canDecide(.approve))
                if proposal.songs.isEmpty {
                    Text("Sin canciones no se puede aprobar.")
                        .font(.bsBody(12))
                        .foregroundStyle(BS.inkDim)
                }
                Button("Pedir cambios") { decide(.requestChanges) }
                    .font(.bsBody(16, .semibold))
                    .foregroundStyle(BS.accent)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .disabled(reloading || !state.canDecide(.requestChanges))
            }
        case .approved:
            VStack(alignment: .leading, spacing: 10) {
                Label("Setlist publicado", systemImage: "checkmark.seal.fill")
                    .font(.bsBody(15, .semibold))
                    .foregroundStyle(BS.positive)
                Button("Reabrir para ajustes") { decide(.reopen) }
                    .font(.bsBody(16, .semibold))
                    .foregroundStyle(BS.accent)
                    .frame(minHeight: 44)
                    .disabled(reloading || !state.canDecide(.reopen))
            }
        case .draft:
            Text("El líder todavía no la envía.")
                .font(.bsBody(14))
                .foregroundStyle(BS.inkDim)
        case nil:
            EmptyView()
        }
    }
}

extension DraftSong {
    /// A proposal's song as the read-only row draws it.
    init(_ song: AdminProposal.Song) {
        self.init(
            songId: song.songId, title: song.title, author: song.author, key: song.key,
            playKey: song.playKey, medleyTag: song.medleyTag, previousKeys: []
        )
    }
}

// MARK: Decision sheets

/// «Aprobar» shows the songs it publishes and what happens; «Pedir cambios» needs a note;
/// «Reabrir» takes an optional one. The sheet closes when the detail says so.
struct DecisionSheetView: View {
    enum Next: Equatable {
        case close
        /// Stay open, saying why (nil: say nothing).
        case stay(String?)
    }

    @Environment(\.dismiss) private var dismiss
    let action: ProposalAction
    let proposal: AdminProposal?
    let confirm: (String) async -> Next
    @State private var text: String
    @State private var sending = false
    @State private var problem: String?
    @FocusState private var focused: Bool

    init(action: ProposalAction, proposal: AdminProposal?, initialText: String = "", confirm: @escaping (String) async -> Next) {
        self.action = action
        self.proposal = proposal
        self.confirm = confirm
        _text = State(initialValue: initialText)
    }

    private var title: String {
        switch action {
        case .approve: "¿Aprobar y publicar este setlist?"
        case .requestChanges: "Pedir cambios"
        case .reopen: "Reabrir para ajustes"
        }
    }

    private var canConfirm: Bool {
        guard !sending, ProposalLimits.fits(text) else { return false }
        if action == .requestChanges { return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        return true
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(title)
                        .font(.bsDisplay(22))
                        .foregroundStyle(BS.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    if action == .approve, let proposal {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(Array(proposal.songs.enumerated()), id: \.offset) { index, song in
                                HStack(spacing: 10) {
                                    Text("\(index + 1)")
                                        .font(.bsLabel(13))
                                        .foregroundStyle(BS.inkDim)
                                        .frame(width: 22, alignment: .trailing)
                                    Text(song.title)
                                        .font(.bsBody(15, .semibold))
                                        .foregroundStyle(BS.ink)
                                        .lineLimit(1)
                                    Spacer(minLength: 6)
                                    Text(song.playKey.isEmpty ? "—" : song.playKey)
                                        .font(.bsLabel(14))
                                        .foregroundStyle(BS.key)
                                }
                            }
                        }
                        .padding(14)
                        .cardSurface()
                        Text("El setlist del servicio se reemplaza por esta propuesta y se avisa al líder y a quienes editaron la propuesta. Si el servicio está publicado, el equipo recibe el aviso del setlist.")
                            .font(.bsBody(14))
                            .foregroundStyle(BS.inkMuted)
                    } else {
                        TextField(
                            action == .requestChanges ? "Explica qué debe cambiar el líder…" : "¿Qué debe ajustarse? (opcional)",
                            text: $text, axis: .vertical
                        )
                        .lineLimit(3...8)
                        .font(.bsBody(16))
                        .foregroundStyle(BS.ink)
                        .focused($focused)
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(BS.ink.opacity(0.05)))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(BS.ink.opacity(0.10), lineWidth: 1))
                        Text(ProposalLimits.fits(text)
                             ? "El líder lo ve en la conversación y recibe un aviso."
                             : "Una nota puede tener hasta \(ProposalLimits.notesMax) caracteres.")
                            .font(.bsBody(12))
                            .foregroundStyle(ProposalLimits.fits(text) ? BS.inkDim : BS.warning)
                    }
                    if let problem {
                        Label(problem, systemImage: "exclamationmark.triangle")
                            .font(.bsBody(14))
                            .foregroundStyle(BS.warning)
                    }
                    Button {
                        Task {
                            sending = true
                            problem = nil
                            let next = await confirm(text)
                            sending = false
                            switch next {
                            case .close: dismiss()
                            case .stay(let why): problem = why
                            }
                        }
                    } label: {
                        if sending { ProgressView().tint(BS.base) } else { Text(confirmLabel) }
                    }
                    .buttonStyle(BrandButtonStyle())
                    .disabled(!canConfirm)
                }
                .padding(20)
            }
            .background(BS.base.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }.disabled(sending)
                }
            }
            .onAppear { if action != .approve { focused = true } }
        }
        .interactiveDismissDisabled(sending)
    }

    private var confirmLabel: String {
        switch action {
        case .approve: "Aprobar"
        case .requestChanges: "Enviar"
        case .reopen: "Reabrir"
        }
    }
}
