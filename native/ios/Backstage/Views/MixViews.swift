import SwiftUI
import UIKit

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
                    // «Banda completa» is its own row's name: a title over it would say it twice.
                    if groups.count > 1, group.family != "full" {
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

/// What is loaded, within reach on every page: the mix keeps sounding after its song's page
/// closes, so its pause and its stop have to stay close.
///
/// Three drawings of one bar. Where the system has a place for it (iOS 26.1 and later: the tab
/// bar's own accessory, the glass capsule Music uses) the bar draws no surface of its own;
/// anywhere else it is a card floating over the page's bottom edge.
struct MiniPlayerBar: View {
    enum Style {
        /// A floating card with its own surface.
        case card
        /// Inside the tab bar's accessory, at full width: the system draws the glass.
        case accessory
        /// Inside the accessory once the tab bar has shrunk beside it: the title, pause and stop.
        case inline
    }

    let player: MixPlayer
    let track: MixPlayer.Track
    var style: Style = .card

    var body: some View {
        HStack(spacing: style == .card ? 12 : 10) {
            // Shrunk beside the tab bar there is room for the cover or for the stop, and the stop
            // is the one the person cannot do without.
            if style != .inline {
                CoverView(url: track.cover, size: coverSize)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(track.title)
                    .font(.bsBody(style == .card ? 15 : 14, .semibold))
                    .foregroundStyle(BS.ink)
                    .lineLimit(1)
                if style != .inline || isFailure {
                    Text(subtitle)
                        .font(.bsBody(style == .card ? 13 : 12))
                        .foregroundStyle(isFailure ? BS.warning : BS.inkMuted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
            }
            Spacer(minLength: 0)
            Button {
                player.toggle(track)
            } label: {
                MiniToggle(player: player)
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
                    .frame(width: style == .inline ? 36 : 40, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cerrar el reproductor")
        }
        .padding(.leading, style == .card ? 10 : 12)
        .padding(.trailing, style == .card ? 4 : 6)
        .padding(.vertical, style == .card ? 8 : 0)
        .background {
            if style == .card {
                ZStack {
                    RoundedRectangle(cornerRadius: 22, style: .continuous).fill(.ultraThinMaterial)
                    RoundedRectangle(cornerRadius: 22, style: .continuous).fill(BS.card.opacity(0.55))
                    RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(BS.ink.opacity(0.10), lineWidth: 1)
                }
                .shadow(color: .black.opacity(0.18), radius: 12, y: 4)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Reproductor")
    }

    private var coverSize: CGFloat {
        switch style {
        case .card: 40
        case .accessory: 30
        case .inline: 0
        }
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

/// The bar's pause and play, inside a ring that fills as the mix plays: the bar's only sign of
/// progress, so it needs no line of its own across the page.
private struct MiniToggle: View {
    let player: MixPlayer

    var body: some View {
        ZStack {
            Circle().stroke(BS.ink.opacity(0.14), lineWidth: 2)
            MiniRing(player: player)
            switch player.status {
            case .loading:
                ProgressView().controlSize(.small).tint(BS.ink)
            case .playing:
                Image(systemName: "pause.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(BS.ink)
            default:
                Image(systemName: "play.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(BS.ink)
                    .offset(x: 1)
            }
        }
        .frame(width: 30, height: 30)
        .accessibilityHidden(true)
    }
}

/// Its own view: it redraws four times a second.
private struct MiniRing: View {
    let player: MixPlayer

    var body: some View {
        Circle()
            .trim(from: 0, to: CGFloat(player.progress))
            .stroke(BS.accent, style: StrokeStyle(lineWidth: 2, lineCap: .round))
            .rotationEffect(.degrees(-90))
    }
}

// MARK: Where the bar lives

extension EnvironmentValues {
    /// True under a tab bar that carries the bar itself, so a tab's stack does not draw a second.
    @Entry var miniPlayerInTabBar = false
}

/// The bar inside the tab bar's accessory. It reads how much room the system gives it.
@available(iOS 26.1, *)
private struct MiniPlayerAccessory: View {
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement
    let player: MixPlayer

    var body: some View {
        if let track = player.track {
            MiniPlayerBar(player: player, track: track, style: placement == .inline ? .inline : .accessory)
        }
    }
}

private struct MiniPlayerTabAccessory: ViewModifier {
    @Environment(MixPlayer.self) private var player: MixPlayer?

    func body(content: Content) -> some View {
        // 26.1, not 26.0: only there can the accessory be absent while nothing is loaded.
        // A phone only: there the tab bar sits at the bottom with the accessory on it. An iPad
        // keeps the card until the accessory has been seen on one.
        if #available(iOS 26.1, *), let player, UIDevice.current.userInterfaceIdiom == .phone {
            content
                .tabBarMinimizeBehavior(.onScrollDown)
                .tabViewBottomAccessory(isEnabled: player.track != nil) {
                    MiniPlayerAccessory(player: player)
                }
                .environment(\.miniPlayerInTabBar, true)
        } else {
            content
        }
    }
}

private struct MiniPlayerInset: ViewModifier {
    @Environment(MixPlayer.self) private var player: MixPlayer?
    @Environment(\.miniPlayerInTabBar) private var inTabBar

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if !inTabBar, let player, let track = player.track {
                    MiniPlayerBar(player: player, track: track)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 8)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.easeOut(duration: 0.22), value: player?.track)
    }
}

extension View {
    /// On the tab view: the loaded mix's bar rides on the tab bar itself where the system can
    /// carry it, and the tab bar shrinks while the page scrolls down.
    func miniPlayerAccessory() -> some View { modifier(MiniPlayerTabAccessory()) }

    /// On a tab's stack: the loaded mix's bar as a card over the bottom edge, wherever the tab
    /// bar does not already carry it.
    func miniPlayer() -> some View { modifier(MiniPlayerInset()) }
}
