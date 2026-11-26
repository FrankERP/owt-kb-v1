import SwiftUI

// The rehearsal mixes on a song's page (the web's `RehearsalPlayer`): the whole band and each
// instrument on its own, in the server's order. What the phone adds: the person's own
// instrument first and the rest folded away, a mix that keeps sounding once the page closes,
// and the bar that follows it around the app.

// MARK: The section

struct MixSection: View {
    let detail: SongDetail
    /// Optional: a drawing test hosts the page with no player, and the rows draw at rest.
    @Environment(MixPlayer.self) private var player: MixPlayer?
    /// The key the person picked; nil = the song's own.
    @State private var pickedTone: String?
    @State private var showingAll = false

    var body: some View {
        let tones = Mixes.tones(detail.mixes)
        let selection = Mixes.forKey(detail.mixes, key: pickedTone ?? detail.song.key)
        let groups = Mixes.groups(selection.mixes)
        let highlighted = Mixes.preselected(selection.mixes, family: detail.preferredFamily)
        // What shows before «Ver todas»: the whole band and the person's own instrument.
        let featured = groups.filter { $0.family == "full" || $0.family == detail.preferredFamily }
        let folded = featured.isEmpty ? [] : groups.filter { group in !featured.contains(group) }
        let foldedCount = folded.reduce(0) { $0 + $1.mixes.count }
        // A mix playing from the folded part opens it: its row must be on screen.
        let playingFolded = folded.contains { group in group.mixes.contains { isLoaded($0) } }
        let open = showingAll || playingFolded
        let shown = featured.isEmpty || open ? groups : featured

        VStack(alignment: .leading, spacing: 16) {
            SongSectionTitle(text: "Ensayo", symbol: "waveform")
            if tones.count > 1, let tone = selection.tone {
                TonePicker(tones: tones, tone: tone, missing: selection.exact ? nil : (pickedTone ?? detail.song.key)) { picked in
                    withAnimation(.easeOut(duration: 0.2)) { pickedTone = picked }
                }
            } else if !selection.exact, let tone = selection.tone, let wanted = detail.song.key {
                // One key only, and not the song's: say so, there is nothing to pick.
                Text("No hay mezcla en \(wanted). Se muestra \(tone).")
                    .font(.bsBody(14))
                    .foregroundStyle(BS.inkMuted)
            }
            ForEach(shown) { group in
                VStack(alignment: .leading, spacing: 2) {
                    if groups.count > 1 {
                        Text(group.label)
                            .font(.bsBody(14))
                            .foregroundStyle(BS.inkMuted)
                            .padding(.bottom, 4)
                            .accessibilityAddTraits(.isHeader)
                    }
                    ForEach(Array(group.mixes.enumerated()), id: \.element.id) { index, mix in
                        if index > 0 {
                            Rectangle().fill(BS.ink.opacity(0.10)).frame(height: 1)
                        }
                        MixRow(mix: mix, track: track(for: mix), mine: mix == highlighted, player: player)
                    }
                }
            }
            if !folded.isEmpty, !playingFolded {
                Button {
                    withAnimation(.easeOut(duration: 0.25)) { showingAll.toggle() }
                } label: {
                    HStack(spacing: 8) {
                        Text(showingAll ? "Ver menos" : "Ver todas las pistas (\(foldedCount) más)")
                            .font(.bsBody(15, .semibold))
                        Image(systemName: showingAll ? "chevron.up" : "chevron.down")
                            .font(.system(size: 12, weight: .semibold))
                            .accessibilityHidden(true)
                    }
                    .foregroundStyle(BS.accent)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func track(for mix: SongMix) -> MixPlayer.Track {
        MixPlayer.Track(
            slug: detail.song.slug,
            mixKey: mix.key,
            title: detail.song.title,
            label: mix.label,
            artist: detail.song.artist,
            cover: detail.song.coverLarge ?? detail.song.cover
        )
    }

    private func isLoaded(_ mix: SongMix) -> Bool {
        guard let loaded = player?.track else { return false }
        return loaded.slug == detail.song.slug && loaded.mixKey == mix.key
    }
}

/// The keys the song has mixes in. Rose, because it is a musical key (ADR-0071).
private struct TonePicker: View {
    let tones: [String]
    let tone: String
    /// The key that has no mix, when another one stands in for it.
    let missing: String?
    let pick: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(missing.map { "No hay mezcla en \($0). Se muestra \(tone)." } ?? "Mezclas en")
                .font(.bsBody(14))
                .foregroundStyle(BS.inkMuted)
            HStack(spacing: 8) {
                ForEach(tones, id: \.self) { option in
                    let on = option == tone
                    Button {
                        pick(option)
                    } label: {
                        Text(option)
                            .font(.bsLabel(15))
                            .foregroundStyle(on ? BS.key : BS.inkMuted)
                            .padding(.horizontal, 14)
                            .frame(minWidth: 48, minHeight: 36)
                            .background(Capsule().fill(on ? BS.key.opacity(0.14) : Color.clear))
                            .overlay(Capsule().strokeBorder(on ? BS.key.opacity(0.45) : BS.ink.opacity(0.16), lineWidth: 1))
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Tono \(option)")
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
        }
    }
}

// MARK: A mix

struct MixRow: View {
    let mix: SongMix
    let track: MixPlayer.Track
    /// The mix the page offers first: the person's instrument, named in the accent.
    let mine: Bool
    let player: MixPlayer?

    var body: some View {
        let status: MixPlayer.Status? = track.isSameMix(as: player?.track) ? player?.status : nil
        let playing = status == .playing
        VStack(alignment: .leading, spacing: 10) {
            Button {
                player?.toggle(track)
            } label: {
                HStack(spacing: 14) {
                    PlayGlyph(status: status)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(mix.label)
                            .font(.bsBody(17, .semibold))
                            .foregroundStyle(mine ? BS.accent : BS.ink)
                            .lineLimit(1)
                        caption(status)
                    }
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 48)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(playing || status == .loading ? "Pausar" : "Reproducir") \(mix.label)")
            .sensoryFeedback(.impact(weight: .light), trigger: playing)
            if let player, let status, !isFailure(status) {
                MixScrubber(bars: mix.bars, player: player)
                    .transition(.opacity)
            }
        }
        .padding(.vertical, 6)
        .animation(.easeOut(duration: 0.2), value: status)
    }

    @ViewBuilder
    private func caption(_ status: MixPlayer.Status?) -> some View {
        if case .failed(let message) = status {
            Text(message)
                .font(.bsBody(14))
                .foregroundStyle(BS.warning)
                .fixedSize(horizontal: false, vertical: true)
        } else if let player, status != nil {
            MixClock(tone: mix.tone, player: player)
        } else if let tone = mix.tone {
            Text(tone)
                .font(.bsBody(14))
                .foregroundStyle(BS.inkMuted)
        }
    }

    private func isFailure(_ status: MixPlayer.Status) -> Bool {
        if case .failed = status { return true }
        return false
    }
}

/// «G · 0:42 / 4:10». Its own view, so only these words redraw as the mix plays.
private struct MixClock: View {
    let tone: String?
    let player: MixPlayer

    var body: some View {
        let clock = player.duration > 0
            ? "\(Mixes.clock(player.elapsed)) / \(Mixes.clock(player.duration))"
            : Mixes.clock(player.elapsed)
        Text([tone, clock].compactMap { $0 }.joined(separator: " · "))
            .font(.bsBody(14))
            .monospacedDigit()
            .foregroundStyle(BS.inkMuted)
    }
}

/// The row's control: an open circle at rest, filled for the mix that is loaded.
private struct PlayGlyph: View {
    let status: MixPlayer.Status?
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            Circle().fill(status == nil ? BS.ink.opacity(0.08) : BS.accent)
            switch status {
            case .loading?:
                ProgressView().tint(BS.base)
            case .playing?:
                Image(systemName: "pause.fill")
                    .font(.system(size: size * 0.36, weight: .semibold))
                    .foregroundStyle(BS.base)
            default:
                Image(systemName: "play.fill")
                    .font(.system(size: size * 0.36, weight: .semibold))
                    .foregroundStyle(status == nil ? BS.ink : BS.base)
                    .offset(x: size * 0.03)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The mix's waveform, filled up to the playhead; a touch or a drag moves it. A mix with no
/// waveform draws a plain line.
struct MixScrubber: View {
    let bars: [Int]
    let player: MixPlayer
    /// Where the finger is, while it is down: the playhead follows it, the audio moves on release.
    @State private var dragging: Double?

    var body: some View {
        let progress = dragging ?? player.progress
        GeometryReader { geometry in
            Canvas { context, size in
                let played = GraphicsContext.Shading.color(BS.accent)
                let rest = GraphicsContext.Shading.color(BS.ink.opacity(0.22))
                if bars.isEmpty {
                    let line = CGRect(x: 0, y: size.height / 2 - 2, width: size.width, height: 4)
                    context.fill(Path(roundedRect: line, cornerRadius: 2), with: rest)
                    let done = CGRect(x: 0, y: size.height / 2 - 2, width: size.width * CGFloat(progress), height: 4)
                    context.fill(Path(roundedRect: done, cornerRadius: 2), with: played)
                    return
                }
                let step = size.width / CGFloat(bars.count)
                let width = max(1.5, step * 0.58)
                for (index, value) in bars.enumerated() {
                    let height = max(3, size.height * CGFloat(min(100, max(0, value))) / 100)
                    let rect = CGRect(x: CGFloat(index) * step + (step - width) / 2, y: (size.height - height) / 2, width: width, height: height)
                    let before = (Double(index) + 0.5) / Double(bars.count) <= progress
                    context.fill(Path(roundedRect: rect, cornerRadius: width / 2), with: before ? played : rest)
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        guard geometry.size.width > 0 else { return }
                        dragging = min(1, max(0, Double(value.location.x / geometry.size.width)))
                    }
                    .onEnded { _ in
                        if let dragging { player.seek(toFraction: dragging) }
                        dragging = nil
                    }
            )
        }
        .frame(height: 40)
        .accessibilityElement()
        .accessibilityLabel("Posición")
        .accessibilityValue("\(Mixes.clock(player.elapsed)) de \(Mixes.clock(player.duration))")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: player.seek(toFraction: player.progress + 0.05)
            case .decrement: player.seek(toFraction: player.progress - 0.05)
            @unknown default: break
            }
        }
    }
}

// MARK: The bar that follows the mix around the app

/// What is loaded, over the bottom of every page of a tab: the mix keeps sounding after its
/// song's page closes, so its pause and its stop have to stay within reach.
struct MiniPlayerBar: View {
    let player: MixPlayer
    let track: MixPlayer.Track

    var body: some View {
        VStack(spacing: 0) {
            MiniProgress(player: player)
            HStack(spacing: 12) {
                CoverView(url: track.cover, size: 40)
                VStack(alignment: .leading, spacing: 1) {
                    Text(track.title)
                        .font(.bsBody(15, .semibold))
                        .foregroundStyle(BS.ink)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.bsBody(13))
                        .foregroundStyle(isFailure ? BS.warning : BS.inkMuted)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Button {
                    player.toggle(track)
                } label: {
                    PlayGlyph(status: player.status, size: 38)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(player.status == .playing || player.status == .loading ? "Pausar" : "Reproducir")
                Button {
                    player.stop()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(BS.inkMuted)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Cerrar el reproductor")
            }
            .padding(.leading, 16)
            .padding(.trailing, 6)
            .padding(.vertical, 6)
        }
        .background {
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                BS.card.opacity(0.55)
            }
        }
        .overlay(alignment: .top) {
            Rectangle().fill(BS.ink.opacity(0.10)).frame(height: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Reproductor")
    }

    private var isFailure: Bool {
        if case .failed = player.status { return true }
        return false
    }

    private var subtitle: String {
        if case .failed(let message) = player.status { return message }
        return track.label
    }
}

/// The hairline of progress on the bar's top edge. Its own view: it redraws four times a second.
private struct MiniProgress: View {
    let player: MixPlayer

    var body: some View {
        GeometryReader { geometry in
            Rectangle()
                .fill(BS.accent)
                .frame(width: geometry.size.width * CGFloat(player.progress))
        }
        .frame(height: 2)
        .accessibilityHidden(true)
    }
}

private struct MiniPlayerInset: ViewModifier {
    @Environment(MixPlayer.self) private var player: MixPlayer?

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if let player, let track = player.track {
                    MiniPlayerBar(player: player, track: track)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.easeOut(duration: 0.22), value: player?.track)
    }
}

extension View {
    /// Puts the loaded mix's bar over the bottom of a tab's stack, above the tab bar.
    func miniPlayer() -> some View { modifier(MiniPlayerInset()) }
}
