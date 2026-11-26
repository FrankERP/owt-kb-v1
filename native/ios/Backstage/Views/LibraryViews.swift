import SwiftUI

// The Biblioteca and a song's page, as the web draws them (app/components/LibraryIndex.tsx,
// app/(client)/posts/[slug]/page.tsx, ADR-0070, ADR-0088): the catalogue filed by letter with
// its covers and «Recién agregadas» on a shelf; a song as its cover, its title, its key in the
// brand's rose, then the chart (or the lyric) and its links.

// MARK: Where a tap goes

/// What a song's page can draw before its own read lands: whatever the row that was tapped
/// already showed.
struct SongSeed: Hashable {
    let slug: String
    let title: String
    let byline: String?
    let cover: String?
    let coverLarge: String?
    let key: String?
    let bpm: Int?
    let timeSig: String?
    /// The zoom source this page grew from and returns to. Every place that lists a song names
    /// its own («shelf-…», «row-…», «setlist-…»): the same song can sit in two of them on one
    /// screen, and a shared id sent the page back to whichever SwiftUI found first.
    let origin: String?

    init(_ song: LibrarySong, origin: String? = nil) {
        self.origin = origin
        slug = song.slug
        title = song.title
        byline = song.byline
        cover = song.cover
        coverLarge = song.coverLarge
        key = song.key
        bpm = song.bpm
        timeSig = song.timeSig
    }

    /// A setlist's song, when it still points at a song of the catalogue.
    init?(_ song: AppSong, origin: String? = nil) {
        guard let slug = song.slug, !slug.isEmpty else { return nil }
        self.origin = origin
        self.slug = slug
        title = song.title
        byline = song.author
        cover = song.cover
        coverLarge = song.coverLarge
        key = song.songKey ?? song.key
        bpm = song.bpm
        timeSig = song.timeSig
    }
}

enum Route: Hashable {
    case service(AppService)
    case song(SongSeed)
}

private struct OpenSongKey: EnvironmentKey {
    static let defaultValue: ((SongSeed) -> Void)? = nil
}

private struct SongZoomKey: EnvironmentKey {
    static let defaultValue: Namespace.ID? = nil
}

extension EnvironmentValues {
    /// The stack's zoom namespace, for a song row drawn deep inside it (a setlist).
    var songZoom: Namespace.ID? {
        get { self[SongZoomKey.self] }
        set { self[SongZoomKey.self] = newValue }
    }

    /// Opens a song's page from wherever a song is listed; nil where nothing navigates.
    var openSong: ((SongSeed) -> Void)? {
        get { self[OpenSongKey.self] }
        set { self[OpenSongKey.self] = newValue }
    }
}

// MARK: Biblioteca

struct LibraryView: View {
    @Environment(AppModel.self) private var model
    let me: Me
    let profile: () -> Void
    @State private var query = ""
    @State private var path: [Route] = []
    @State private var refreshes = 0
    @Namespace private var zoom

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                LibraryScreen(
                    catalogue: model.catalogue,
                    query: $query,
                    zoom: zoom,
                    open: { path.append(.song($0)) },
                    retry: { Task { await model.loadCatalogue(force: true) } }
                )
            }
            .scrollDismissesKeyboard(.immediately)
            .background(BS.base.ignoresSafeArea())
            .safeAreaInset(edge: .top, spacing: 0) {
                TopBar(me: me, profile: profile)
            }
            .refreshable {
                await model.loadCatalogue(force: true)
                refreshes += 1
            }
            .sensoryFeedback(.impact(weight: .light), trigger: refreshes)
            .sensoryFeedback(trigger: path) { old, new in
                new.count > old.count ? .impact(weight: .light) : nil
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { route in
                RouteDestination(route: route, today: model.lastToday, zoom: zoom)
            }
        }
        // On the stack itself, so a page pushed onto it inherits both.
        .environment(\.openSong) { path.append(.song($0)) }
        .environment(\.songZoom, zoom)
        .task { await model.loadCatalogue() }
    }
}

/// One place decides what a route shows, so Inicio's stack and the Biblioteca's agree.
struct RouteDestination: View {
    let route: Route
    let today: String
    let zoom: Namespace.ID

    var body: some View {
        switch route {
        case .service(let service):
            ServiceDetailView(service: service, today: today)
                .zoomDestination(id: service.id, in: zoom)
        case .song(let seed):
            // The page grows from the very row or tile that was tapped and returns to it;
            // opened from somewhere that names no origin, it slides in like any page.
            if let origin = seed.origin {
                SongView(seed: seed).zoomDestination(id: origin, in: zoom)
            } else {
                SongView(seed: seed)
            }
        }
    }
}

/// The Biblioteca's content, apart from the model so a test can draw it.
struct LibraryScreen: View {
    let catalogue: AppModel.Catalogue
    @Binding var query: String
    var zoom: Namespace.ID?
    let open: (SongSeed) -> Void
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Biblioteca")
                .font(.bsDisplay(52, relativeTo: .largeTitle))
                .foregroundStyle(BS.ink)
                .padding(.top, 28)
                .accessibilityAddTraits(.isHeader)
            switch catalogue {
            case .idle, .loading:
                VStack(spacing: 10) {
                    ForEach(0..<8, id: \.self) { _ in
                        HStack(spacing: 14) {
                            SkeletonBlock(width: 48, height: 48, radius: 8)
                            VStack(alignment: .leading, spacing: 8) {
                                SkeletonBlock(width: 180, height: 14)
                                SkeletonBlock(width: 110, height: 10)
                            }
                            Spacer()
                        }
                    }
                }
                .padding(.top, 28)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Cargando canciones")
            case .notInWorship:
                quiet("La Biblioteca aparece aquí cuando formas parte del equipo de Alabanza.")
            case .failed(let message):
                VStack(alignment: .leading, spacing: 16) {
                    quiet(message)
                    Button("Intentar de nuevo", action: retry)
                        .buttonStyle(BrandButtonStyle())
                }
            case .loaded(let songs):
                loaded(songs)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 48)
    }

    @ViewBuilder
    private func loaded(_ songs: [LibrarySong]) -> some View {
        Text(songs.count == 1 ? "1 canción" : "\(songs.count) canciones")
            .font(.bsBody(17))
            .foregroundStyle(BS.inkMuted)
            .padding(.top, 4)
        SearchLine(query: $query)
            .padding(.top, 20)
        let searching = !query.trimmingCharacters(in: .whitespaces).isEmpty
        if searching {
            let found = Library.search(songs, query)
            SheetTitle(text: "Resultados", hairline: true, count: found.count)
                .padding(.top, 28)
                .padding(.bottom, 6)
            if found.isEmpty {
                quiet("Ninguna canción coincide con «\(query.trimmingCharacters(in: .whitespaces))».")
            }
            rows(found)
        } else {
            let recent = Library.recent(songs)
            if !recent.isEmpty {
                SheetTitle(text: "Recién agregadas", hairline: true)
                    .padding(.top, 28)
                    .padding(.bottom, 12)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 14) {
                        ForEach(recent) { song in
                            let origin = "shelf-\(song.slug)"
                            Button { open(SongSeed(song, origin: origin)) } label: { ShelfTile(song: song) }
                                .buttonStyle(CardPressStyle())
                                .zoomSource(id: origin, in: zoom)
                        }
                    }
                    .padding(.horizontal, 20)
                }
                .padding(.horizontal, -20)
            }
            ForEach(Library.byLetter(songs)) { group in
                SheetTitle(text: group.letter, hairline: true, count: group.songs.count)
                    .padding(.top, 28)
                    .padding(.bottom, 6)
                rows(group.songs)
            }
        }
    }

    private func rows(_ songs: [LibrarySong]) -> some View {
        LazyVStack(spacing: 0) {
            ForEach(Array(songs.enumerated()), id: \.element.id) { index, song in
                if index > 0 {
                    Rectangle().fill(BS.ink.opacity(0.06)).frame(height: 1).padding(.leading, 62)
                }
                let origin = "row-\(song.slug)"
                Button { open(SongSeed(song, origin: origin)) } label: { LibraryRow(song: song) }
                    .buttonStyle(CardPressStyle())
                    .zoomSource(id: origin, in: zoom)
            }
        }
    }

    private func quiet(_ text: String) -> some View {
        Text(text)
            .font(.bsBody(15))
            .foregroundStyle(BS.inkMuted)
            .padding(.vertical, 20)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The web's hairline search: a glass, the words, a line under them. 17 pt, so iOS never zooms.
private struct SearchLine: View {
    @Binding var query: String
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 15))
                    .foregroundStyle(focused ? BS.accent : BS.inkDim)
                TextField("", text: $query, prompt: Text("Buscar por título, artista o tono").foregroundStyle(BS.inkDim))
                    .font(.bsBody(17))
                    .foregroundStyle(BS.ink)
                    .tint(BS.accent)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .submitLabel(.search)
                    .focused($focused)
                if !query.isEmpty {
                    Button { query = "" } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(BS.inkDim)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Borrar la búsqueda")
                }
            }
            Rectangle()
                .fill(focused ? BS.accent : BS.ink.opacity(0.16))
                .frame(height: 1)
        }
        .animation(.easeOut(duration: 0.15), value: focused)
    }
}

/// A song in the list: its cover, its title, who it is by, its tempo and its key in rose.
struct LibraryRow: View {
    let song: LibrarySong

    var body: some View {
        HStack(spacing: 14) {
            CoverView(url: song.cover, size: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text(song.title)
                    .font(.bsBody(17, .semibold))
                    .foregroundStyle(BS.ink)
                    .lineLimit(1)
                if let byline = song.byline {
                    Text(byline)
                        .font(.bsBody(14))
                        .foregroundStyle(BS.inkMuted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if let bpm = song.bpm {
                Text("\(bpm)")
                    .font(.bsLabel(12))
                    .monospacedDigit()
                    .foregroundStyle(BS.inkDim)
            }
            if let key = song.key {
                KeyPill(key: key)
            }
        }
        .padding(.vertical, 9)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([song.title, song.byline, song.key.map { "tono \($0)" }].compactMap { $0 }.joined(separator: ", "))
        .accessibilityAddTraits(.isButton)
    }
}

/// The musical key, the one place rose appears (ADR-0071).
struct KeyPill: View {
    let key: String
    var large = false

    var body: some View {
        Text(key)
            .font(.bsLabel(large ? 16 : 13))
            .foregroundStyle(BS.key)
            .padding(.horizontal, large ? 14 : 9)
            .padding(.vertical, large ? 6 : 3)
            .frame(minWidth: large ? 44 : 34)
            .background(Capsule().fill(BS.key.opacity(0.10)))
            .overlay(Capsule().strokeBorder(BS.key.opacity(0.35), lineWidth: 1))
    }
}

/// A recent song on the shelf: the record's sleeve, then its name.
private struct ShelfTile: View {
    let song: LibrarySong

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            CoverView(url: song.coverLarge ?? song.cover, size: 132)
                .shadow(color: .black.opacity(0.18), radius: 8, y: 5)
            Text(song.title)
                .font(.bsBody(15, .semibold))
                .foregroundStyle(BS.ink)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            if let artist = song.artist {
                Text(artist)
                    .font(.bsBody(13))
                    .foregroundStyle(BS.inkMuted)
                    .lineLimit(1)
            }
        }
        .frame(width: 132, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: A song's page

struct SongView: View {
    @Environment(AppModel.self) private var model
    let seed: SongSeed
    @State private var load: AppModel.SongLoad?

    var body: some View {
        ScrollView {
            SongPage(seed: seed, load: load ?? model.openedSong(slug: seed.slug).map { .loaded($0) }) {
                Task { await fetch() }
            }
        }
        .background(BS.base.ignoresSafeArea())
        .navigationTitle(seed.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(BS.base, for: .navigationBar)
        .task { await fetch() }
    }

    private func fetch() async {
        let answer = await model.loadSong(slug: seed.slug)
        if Task.isCancelled { return }
        withAnimation(.easeOut(duration: 0.2)) { load = answer }
    }
}

/// The page itself, apart from the model so a test can draw it. `load` nil = still reading.
struct SongPage: View {
    let seed: SongSeed
    let load: AppModel.SongLoad?
    let retry: () -> Void

    private var detail: SongDetail? {
        if case .loaded(let detail) = load { return detail }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            hero
            VStack(alignment: .leading, spacing: 36) {
                switch load {
                case nil:
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(0..<7, id: \.self) { line in
                            SkeletonBlock(width: line.isMultiple(of: 3) ? 150 : 250, height: 13)
                        }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Cargando la canción")
                case .missing:
                    quiet("Esta canción ya no está en la Biblioteca.")
                case .failed(let message):
                    if !message.isEmpty {
                        VStack(alignment: .leading, spacing: 16) {
                            quiet(message)
                            Button("Intentar de nuevo", action: retry)
                                .buttonStyle(BrandButtonStyle())
                        }
                    }
                case .loaded(let detail):
                    // A filled chart replaces the lyric, as on the web (ADR-0018 keeps both stored).
                    if !detail.charts.isEmpty {
                        ChartSection(charts: detail.charts, songKey: detail.song.key)
                    } else if let lyrics = detail.lyrics {
                        VStack(alignment: .leading, spacing: 14) {
                            SongSectionTitle(text: "Letra", symbol: "text.alignleft")
                            LyricsView(text: lyrics)
                        }
                    } else {
                        quiet("Esta canción todavía no tiene letra ni acordes.")
                    }
                    if !detail.links.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            SongSectionTitle(text: "Para escuchar y aprender", symbol: "headphones")
                                .padding(.bottom, 6)
                            ForEach(Array(detail.links.enumerated()), id: \.offset) { _, link in
                                SongLinkRow(link: link)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 28)
            .padding(.bottom, 56)
        }
    }

    private var hero: some View {
        let song = detail?.song
        let byline = song?.byline ?? seed.byline
        let key = song?.key ?? seed.key
        let bpm = song?.bpm ?? seed.bpm
        let timeSig = song?.timeSig ?? seed.timeSig
        return VStack(alignment: .leading, spacing: 18) {
            CoverView(url: seed.coverLarge ?? seed.cover, size: 168)
                .shadow(color: .black.opacity(0.28), radius: 18, y: 10)
            VStack(alignment: .leading, spacing: 8) {
                Text(song?.title ?? seed.title)
                    .font(.bsDisplay(44, relativeTo: .largeTitle))
                    .foregroundStyle(BS.ink)
                    .lineSpacing(-4)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if let byline {
                    Text(byline)
                        .font(.bsBody(17))
                        .foregroundStyle(BS.inkMuted)
                }
            }
            if key != nil || bpm != nil || timeSig != nil {
                HStack(spacing: 8) {
                    if let key { KeyPill(key: key, large: true) }
                    if let bpm {
                        FactPill(symbol: "metronome", text: "\(bpm) bpm")
                    }
                    if let timeSig {
                        FactPill(symbol: nil, text: timeSig)
                    }
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .top) {
            // The record's own colours behind the head: the small tile, blurred past recognition
            // and faded into the page — an atmosphere, never a picture (ADR-0088).
            RemoteImage(seed.cover) { Color.clear }
                .frame(height: 380)
                .frame(maxWidth: .infinity)
                .clipped()
                .blur(radius: 60)
                .opacity(0.30)
                .mask(LinearGradient(colors: [.black, .black.opacity(0)], startPoint: .init(x: 0.5, y: 0.25), endPoint: .bottom))
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    private func quiet(_ text: String) -> some View {
        Text(text)
            .font(.bsBody(15))
            .foregroundStyle(BS.inkMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct FactPill: View {
    let symbol: String?
    let text: String

    var body: some View {
        HStack(spacing: 5) {
            if let symbol {
                Image(systemName: symbol).font(.system(size: 12))
            }
            Text(text)
                .font(.bsLabel(13))
                .monospacedDigit()
        }
        .foregroundStyle(BS.inkMuted)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .overlay(Capsule().strokeBorder(BS.ink.opacity(0.16), lineWidth: 1))
    }
}

/// A section's title on the song page: an accent icon tile, the small caps, a hairline.
private struct SongSectionTitle: View {
    let text: String
    let symbol: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(BS.accent)
                .frame(width: 28, height: 28)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(BS.accent.opacity(0.12)))
                .accessibilityHidden(true)
            SheetTitle(text: text, hairline: true)
        }
    }
}

// MARK: Lyrics

/// The lyric in the editor's plain format: `# Coro` an eyebrow, a blank line a breath.
struct LyricsView: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(Array(text.components(separatedBy: "\n").enumerated()), id: \.offset) { index, line in
                if line.hasPrefix("# ") {
                    LyricEyebrow(text: String(line.dropFirst(2)))
                        .padding(.top, index == 0 ? 0 : 16)
                } else if line.trimmingCharacters(in: .whitespaces).isEmpty {
                    Color.clear.frame(height: 8)
                } else {
                    Text(Self.marked(line))
                        .font(.bsBody(17))
                        .foregroundStyle(BS.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// `**fuerte**` and `*énfasis*`, as the editor writes them; anything else as typed.
    static func marked(_ line: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: line, options: options)) ?? AttributedString(line)
    }
}

private struct LyricEyebrow: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.bsLabel(12))
            .tracking(12 * 0.22)
            .foregroundStyle(BS.inkMuted)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: Chords

/// The chart, with the key it is shown in: − and + move every chord a semitone, and the pill in
/// the middle returns to the key it was written in.
struct ChartSection: View {
    let charts: [SongChart]
    let songKey: String?
    @State private var selected = 0
    @State private var semitones = 0

    var body: some View {
        let chart = charts[min(selected, charts.count - 1)]
        let written = chart.key ?? songKey
        VStack(alignment: .leading, spacing: 16) {
            SongSectionTitle(text: "Acordes", symbol: "guitars")
            if charts.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(Array(charts.enumerated()), id: \.offset) { index, option in
                            Button {
                                selected = index
                                semitones = 0
                            } label: {
                                Text((option.key.map { "Tono \($0)" } ?? "Versión \(index + 1)").uppercased())
                                    .font(.bsLabel(11))
                                    .tracking(1)
                                    .foregroundStyle(index == selected ? BS.accent : BS.inkDim)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6)
                                    .background(Capsule().fill(index == selected ? BS.accent.opacity(0.12) : .clear))
                                    .overlay(Capsule().strokeBorder(index == selected ? BS.accent.opacity(0.35) : BS.ink.opacity(0.12), lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(index == selected ? .isSelected : [])
                        }
                    }
                }
                .sensoryFeedback(.selection, trigger: selected)
            }
            if chart.chordPro {
                // Only a key the transposer can read gets the dial: «Do» would move the chords
                // and leave the pill still.
                if let written, Transpose.rootIndex(written) != nil {
                    transposer(written: written)
                }
                ChordProView(content: chart.content, semitones: semitones)
            } else {
                // Plain text places its chords with spaces: one fixed-width block, scrolled sideways.
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(chart.content)
                        .font(.system(size: 14, design: .monospaced))
                        .foregroundStyle(BS.ink)
                        .lineSpacing(4)
                        .textSelection(.enabled)
                        .padding(16)
                }
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(BS.accent.opacity(0.05)))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(BS.accent.opacity(0.18), lineWidth: 1))
            }
        }
    }

    private func transposer(written: String) -> some View {
        HStack(spacing: 10) {
            step("minus", label: "Bajar medio tono") { semitones -= 1 }
            Button {
                semitones = 0
            } label: {
                VStack(spacing: 1) {
                    KeyPill(key: Transpose.key(written, by: semitones), large: true)
                    Text(semitones % 12 == 0 ? "ORIGINAL" : "ORIG. \(written)")
                        .font(.bsLabel(9))
                        .tracking(1)
                        .foregroundStyle(BS.inkDim)
                }
            }
            .buttonStyle(.plain)
            .disabled(semitones % 12 == 0)
            .accessibilityLabel("Tono \(Transpose.key(written, by: semitones))")
            .accessibilityHint(semitones % 12 == 0 ? "" : "Toca para volver al tono original, \(written)")
            step("plus", label: "Subir medio tono") { semitones += 1 }
            Spacer()
        }
        .sensoryFeedback(.selection, trigger: semitones)
    }

    private func step(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(BS.ink)
                .frame(width: 44, height: 44)
                .overlay(Circle().strokeBorder(BS.ink.opacity(0.16), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// A ChordPro chart: every chord sits over the word it falls on, and a long line wraps between
/// words with its chords still over them.
struct ChordProView: View {
    let content: String
    let semitones: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(ChordPro.lines(content).enumerated()), id: \.offset) { index, line in
                switch line {
                case .heading(let text):
                    LyricEyebrow(text: text)
                        .padding(.top, index == 0 ? 0 : 14)
                case .blank:
                    Color.clear.frame(height: 6)
                case .text(let text):
                    Text(text)
                        .font(.bsBody(16))
                        .foregroundStyle(BS.ink)
                        .fixedSize(horizontal: false, vertical: true)
                case .chords(let segments):
                    let units = Self.units(segments)
                    let wordless = units.allSatisfy { $0.words.trimmingCharacters(in: .whitespaces).isEmpty }
                    FlowLayout(lineSpacing: 4) {
                        ForEach(Array(units.enumerated()), id: \.offset) { _, unit in
                            VStack(alignment: .leading, spacing: 1) {
                                // A word with no chord keeps the row's height and takes no
                                // width of its own, or a short word («a», «y») would be pushed
                                // away from the next one.
                                if let chord = unit.chord {
                                    Text(Transpose.chord(chord, by: semitones))
                                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                                        .foregroundStyle(BS.accent)
                                        .padding(.trailing, 6)
                                } else {
                                    Text(" ")
                                        .font(.system(size: 13, weight: .semibold, design: .monospaced))
                                        .frame(width: 0)
                                }
                                if !wordless {
                                    // A plain space at a segment's edge would be trimmed away and
                                    // close the gap between two words.
                                    Text(unit.words.replacingOccurrences(of: " ", with: "\u{00A0}"))
                                        .font(.bsBody(16))
                                        .foregroundStyle(BS.ink)
                                }
                            }
                            .fixedSize()
                        }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(segments.map(\.lyric).joined())
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    struct Unit: Equatable {
        let chord: String?
        let words: String
    }

    /// A segment's words one by one, each keeping the spaces after it, so a line can wrap
    /// between words; the chord stays with the first.
    static func units(_ segments: [ChordSegment]) -> [Unit] {
        var out: [Unit] = []
        for segment in segments {
            var pieces: [String] = []
            var current = ""
            var inSpaces = false
            for ch in segment.lyric {
                if ch == " " {
                    inSpaces = true
                    current.append(ch)
                } else {
                    if inSpaces, !current.trimmingCharacters(in: .whitespaces).isEmpty {
                        pieces.append(current)
                        current = ""
                    }
                    inSpaces = false
                    current.append(ch)
                }
            }
            if !current.isEmpty || pieces.isEmpty { pieces.append(current) }
            for (i, piece) in pieces.enumerated() {
                out.append(Unit(chord: i == 0 ? segment.chord : nil, words: piece))
            }
        }
        return out
    }
}

/// Lays its pieces left to right and starts a new row when the next does not fit.
struct FlowLayout: Layout {
    var lineSpacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let spots = arrange(width: bounds.width, subviews: subviews).spots
        for (subview, spot) in zip(subviews, spots) {
            subview.place(at: CGPoint(x: bounds.minX + spot.x, y: bounds.minY + spot.y), proposal: .unspecified)
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (size: CGSize, spots: [CGPoint]) {
        var spots: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + lineSpacing
                rowHeight = 0
            }
            spots.append(CGPoint(x: x, y: y))
            x += size.width
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x)
        }
        return (CGSize(width: widest, height: y + rowHeight), spots)
    }
}

// MARK: Links

private struct SongLinkRow: View {
    @Environment(\.openURL) private var openURL
    let link: SongLink

    var body: some View {
        Button {
            if let url = URL(string: link.url), url.scheme == "https" { openURL(url) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 14))
                    .foregroundStyle(BS.inkMuted)
                    .frame(width: 36, height: 36)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(BS.ink.opacity(0.07)))
                VStack(alignment: .leading, spacing: 1) {
                    Text(link.label)
                        .font(.bsBody(16, .semibold))
                        .foregroundStyle(BS.ink)
                        .lineLimit(1)
                    if let host = URL(string: link.url)?.host {
                        Text(host.replacingOccurrences(of: "www.", with: ""))
                            .font(.bsBody(13))
                            .foregroundStyle(BS.inkDim)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(BS.inkDim)
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(CardPressStyle())
        .accessibilityHint("Se abre fuera de Backstage")
    }

    private var symbol: String {
        switch link.kind {
        case "video": "play.rectangle"
        case "tutorial": "graduationcap"
        default: "headphones"
        }
    }
}
