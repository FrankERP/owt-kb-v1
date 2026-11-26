import SwiftUI

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

/// The editor page.
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

    var body: some View {
        content
            .background(BS.base.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) { header }
            .task { if phase == .loading { await load() } }
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

    private var header: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("PROPUESTA")
                    .font(.bsLabel(11))
                    .tracking(11 * 0.22)
                    .foregroundStyle(BS.sheetTitle)
                Text("\(service.title) · \(ServiceDay.longLabel(service.date))")
                    .font(.bsBody(15, .semibold))
                    .foregroundStyle(BS.ink)
                    .lineLimit(1)
            }
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
        .padding(.leading, 20)
        .padding(.trailing, 12)
        .padding(.vertical, 6)
        .background(BS.base.opacity(0.45).background(.ultraThinMaterial).ignoresSafeArea(edges: .top))
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
            if let editor, draft != nil {
                editorList(editor)
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

    private func editorList(_ editor: ProposalEditorResponse) -> some View {
        let state = draft!
        let approved = state.isApproved
        return List {
            Section {
                statusLine(state, editor)
                if let notice = state.notice { noticeView(notice) }
                if let problem = state.limitProblem { Text(problem).font(.bsBody(14)).foregroundStyle(BS.warning) }
                if let pastor = editor.serviceThread.pastorMessage {
                    readOnlyNote(title: "Mensaje del pastor", text: pastor, accent: true)
                }
                if let admin = editor.proposal?.adminNotes {
                    readOnlyNote(title: "Comentarios del admin", text: admin, accent: false)
                }
            }
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)

            Section {
                if state.songs.isEmpty {
                    Text(approved ? "Esta propuesta no tiene canciones." : "Todavía no hay canciones. Agrega la primera.")
                        .font(.bsBody(15))
                        .foregroundStyle(BS.inkDim)
                }
                ForEach(Array(state.songs.enumerated()), id: \.element.id) { index, song in
                    SongDraftRow(
                        number: index + 1,
                        song: song,
                        approved: approved,
                        linkedToNext: MedleyTags.linked(state.songs.map(\.medleyTag), at: index),
                        hasNext: index + 1 < state.songs.count,
                        setKey: { key in draft?.setPlayKey(key, at: index) },
                        toggleMedley: { withAnimation(.easeOut(duration: 0.2)) { draft?.toggleMedley(at: index) } }
                    )
                }
                .onMove(perform: approved ? nil : moveSongs)
                .onDelete(perform: approved ? nil : removeSongs)
                if !approved {
                    Button {
                        picking = true
                    } label: {
                        Label("Agregar canción", systemImage: "plus.circle.fill")
                            .font(.bsBody(16, .semibold))
                            .foregroundStyle(BS.accent)
                    }
                    .disabled(state.songs.count >= ProposalLimits.songsMax)
                }
            } header: {
                SheetTitle(text: "Canciones", count: state.songs.count)
            } footer: {
                if !approved && state.songs.count > 1 {
                    Text("Mantén presionada una canción para moverla; desliza para quitarla.")
                        .font(.bsBody(12))
                        .foregroundStyle(BS.inkDim)
                }
            }
            .listRowBackground(BS.card)

            Section {
                notesField("Notas para el equipo", text: binding(\.teamNotes), placeholder: "Lo que el equipo debe saber", disabled: approved)
                if showsPastorField(state, editor) {
                    notesField("Mensaje del pastor", text: binding(\.pastorMessage), placeholder: "Lo que el pastor compartió para este servicio", disabled: approved)
                }
                if !state.proposalExists && !approved {
                    notesField("Nota para los admins", text: binding(\.leadNotes), placeholder: "Solo la ven los administradores", disabled: false)
                }
            } header: {
                SheetTitle(text: "Notas")
            }
            .listRowBackground(BS.card)

            let messages = conversation(editor)
            if !messages.isEmpty {
                Section {
                    ForEach(messages) { m in MessageRow(message: m) }
                } header: {
                    SheetTitle(text: "Conversación")
                }
                .listRowBackground(BS.card)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
    }

    private func statusLine(_ state: ProposalDraftState, _ editor: ProposalEditorResponse) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(state.status?.label ?? "Sin propuesta todavía")
                .font(.bsLabel(12))
                .tracking(1.1)
                .foregroundStyle(state.isApproved ? BS.positive : BS.accent)
            let others = (editor.proposal?.contributors ?? []).filter { !$0.mine }.map(\.name)
            if !others.isEmpty {
                Text("También la editan: \(joinNames(others))")
                    .font(.bsBody(13))
                    .foregroundStyle(BS.inkDim)
            }
            if state.isApproved {
                Text("Ya está aprobada: se ve aquí, sin cambios.")
                    .font(.bsBody(13))
                    .foregroundStyle(BS.inkDim)
            }
        }
    }

    @ViewBuilder
    private func noticeView(_ notice: ProposalDraftState.Notice) -> some View {
        switch notice {
        case .reloadNeeded:
            HStack(spacing: 10) {
                Image(systemName: "arrow.triangle.2.circlepath")
                Text("Propuesta actualizada").font(.bsBody(15, .semibold))
                Spacer()
                Button(reloading ? "Recargando…" : "Recargar") {
                    if draft?.reloadDiscardsWork == true { confirmReload = true } else { Task { await reload() } }
                }
                .font(.bsBody(15, .semibold))
                .disabled(reloading)
            }
            .foregroundStyle(BS.warning)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(BS.warning.opacity(0.10)))
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

    private func banner(_ text: String, symbol: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
            Text(text).font(.bsBody(14))
            Spacer(minLength: 0)
            Button { draft?.dismissNotice() } label: { Image(systemName: "xmark").font(.system(size: 12, weight: .bold)) }
                .buttonStyle(.plain)
                .accessibilityLabel("Cerrar aviso")
        }
        .foregroundStyle(BS.warning)
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(BS.warning.opacity(0.10)))
    }

    private func readOnlyNote(title: String, text: String, accent: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.bsLabel(11))
                .tracking(1.1)
                .foregroundStyle(accent ? BS.accent : BS.inkDim)
            Text(text)
                .font(.bsBody(15))
                .foregroundStyle(BS.inkMuted)
                .textSelection(.enabled)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(accent ? BS.accent.opacity(0.05) : BS.ink.opacity(0.03)))
    }

    private func notesField(_ title: String, text: Binding<String>, placeholder: String, disabled: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased())
                .font(.bsLabel(11))
                .tracking(1.1)
                .foregroundStyle(BS.inkDim)
            TextField(placeholder, text: text, axis: .vertical)
                .font(.bsBody(16))
                .foregroundStyle(BS.ink)
                .lineLimit(2...8)
                .disabled(disabled)
            if text.wrappedValue.utf16.count > ProposalLimits.notesMax - 200 {
                Text("\(text.wrappedValue.utf16.count) / \(ProposalLimits.notesMax)")
                    .font(.bsBody(12))
                    .monospacedDigit()
                    .foregroundStyle(ProposalLimits.fits(text.wrappedValue) ? BS.inkDim : BS.warning)
            }
        }
        .padding(.vertical, 4)
    }

    private var actionBar: some View {
        let state = draft
        let saving = state?.saving
        let enabled = state?.canSave == true
        return Group {
            if state?.isApproved == false {
                VStack(spacing: 8) {
                    if let savedNote {
                        Text(savedNote)
                            .font(.bsBody(14))
                            .foregroundStyle(BS.positive)
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
                                .overlay(Capsule().strokeBorder(BS.accent.opacity(0.6), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .disabled(!enabled)
                        Button {
                            confirmSend = true
                        } label: {
                            Text(saving == .pending ? "Enviando…" : "Enviar")
                        }
                        .buttonStyle(BrandButtonStyle())
                        .disabled(!enabled || (state?.songs.isEmpty ?? true))
                    }
                    .opacity(enabled ? 1 : 0.5)
                }
                .padding(.horizontal, 20)
                .padding(.top, 10)
                .padding(.bottom, 8)
                .background(BS.base.opacity(0.6).background(.ultraThinMaterial).ignoresSafeArea(edges: .bottom))
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
        let all = editor.serviceThread.messages + (editor.proposal?.messages ?? [])
        var seen = Set<String>()
        return all
            .filter { seen.insert($0.key).inserted }
            .sorted { ($0.at ?? "") < ($1.at ?? "") }
    }

    private func binding(_ path: WritableKeyPath<ProposalDraftState, String>) -> Binding<String> {
        Binding(
            get: { draft?[keyPath: path] ?? "" },
            set: { value in draft?[keyPath: path] = value }
        )
    }

    // MARK: Work

    private func load() async {
        switch await model.loadProposalEditor(roleId: service.id) {
        case .loaded(let answer):
            editor = answer
            draft = ProposalDraftState(loaded: answer)
            phase = .ready
        case .unavailable:
            phase = .unavailable
        case .failed(let text):
            phase = .failed(text.isEmpty ? "No se pudo abrir la propuesta." : text)
        }
    }

    /// «Recargar»: the one place the editor adopts what the server holds.
    private func reload() async {
        reloading = true
        defer { reloading = false }
        switch await model.loadProposalEditor(roleId: service.id) {
        case .loaded(let answer):
            editor = answer
            draft?.reload(from: answer)
        case .unavailable:
            phase = .unavailable
        case .failed:
            // Nothing replaced: the banner stays, the lead can try again.
            break
        }
    }

    private func save(as target: ProposalStatus) async {
        guard let body = draft?.beginSave(as: target) else { return }
        let outcome = await model.saveProposal(body)
        draft?.finishSave(outcome)
        if case .saved = outcome {
            saves += 1
            withAnimation { savedNote = target == .pending ? "Propuesta enviada" : "Borrador guardado" }
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            withAnimation { savedNote = nil }
        }
    }

    private func moveSongs(_ source: IndexSet, _ destination: Int) {
        draft?.move(from: source, to: destination)
    }

    private func removeSongs(_ offsets: IndexSet) {
        draft?.remove(at: offsets)
    }

    private func add(_ song: LibrarySong) {
        draft?.add(songId: song.id, title: song.title, author: song.artist, key: song.key, previousKeys: [])
        Task {
            let keys = await model.previousKeys(songIds: [song.id])
            draft?.setPreviousKeys(keys)
        }
    }
}

/// One song of the draft: its number, title, the key it is proposed in (a menu), «Tonos
/// anteriores», and the link to the next song when they are a medley.
private struct SongDraftRow: View {
    let number: Int
    let song: DraftSong
    let approved: Bool
    let linkedToNext: Bool
    let hasNext: Bool
    let setKey: (String) -> Void
    let toggleMedley: () -> Void

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
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Text("\(number)")
                    .font(.bsLabel(14))
                    .monospacedDigit()
                    .foregroundStyle(BS.inkDim)
                    .frame(minWidth: 20)
                VStack(alignment: .leading, spacing: 2) {
                    Text(song.title)
                        .font(.bsBody(16, .semibold))
                        .foregroundStyle(BS.ink)
                        .lineLimit(2)
                    if let author = song.author {
                        Text(author).font(.bsBody(13)).foregroundStyle(BS.inkMuted).lineLimit(1)
                    }
                    if !song.previousKeys.isEmpty {
                        Text("Tonos anteriores: \(song.previousKeys.joined(separator: ", "))")
                            .font(.bsBody(12))
                            .foregroundStyle(BS.inkDim)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 4)
                keyControl
            }
            if hasNext && (!approved || linkedToNext) {
                Button(action: toggleMedley) {
                    Label(linkedToNext ? "Medley con la siguiente" : "Unir en medley con la siguiente", systemImage: linkedToNext ? "link" : "link.badge.plus")
                        .font(.bsBody(13, linkedToNext ? .semibold : .regular))
                        .foregroundStyle(linkedToNext ? BS.accent : BS.inkDim)
                }
                .buttonStyle(.borderless)
                .disabled(approved)
                .accessibilityHint(linkedToNext ? "Separa estas dos canciones" : "Las une en un medley")
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var keyControl: some View {
        let label = Text(song.playKey.isEmpty ? "Tono" : song.playKey)
            .font(.bsLabel(14))
            .foregroundStyle(BS.ink)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .overlay(Capsule().strokeBorder(BS.ink.opacity(0.18), lineWidth: 1))
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

/// One message of the conversation, read-only.
private struct MessageRow: View {
    let message: ThreadMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(message.mine ? "Tú" : (message.authorName ?? "Administración"))
                    .font(.bsBody(13, .semibold))
                    .foregroundStyle(message.mine ? BS.positive : BS.ink)
                if let role = roleLabel {
                    Text(role).font(.bsBody(12)).foregroundStyle(BS.inkDim)
                }
            }
            Text(message.body)
                .font(.bsBody(15))
                .foregroundStyle(BS.inkMuted)
                .textSelection(.enabled)
        }
        .padding(.vertical, 4)
    }

    private var roleLabel: String? {
        switch message.authorRole {
        case "admin": "Admin"
        case "pastor": "Pastor"
        case "lead": "Lead"
        default: nil
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
