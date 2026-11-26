import AVFoundation
import MediaPlayer
import Observation
import UIKit

/// The app's one audio player: a rehearsal mix at a time, app-wide, so a mix keeps sounding
/// when its song's page closes, when another app comes forward and when the phone locks —
/// with the lock screen's own controls (the web cannot do any of the three).
///
/// It never holds an address of its own: each play asks `resolve` (the server, with the
/// person's session) where that mix lives, so someone who left Alabanza stops being answered.
@MainActor
@Observable
final class MixPlayer {
    /// What is loaded: which mix of which song, and the words the lock screen shows.
    struct Track: Equatable {
        /// The same mix of the same song, whatever words came with it.
        func isSameMix(as other: Track?) -> Bool {
            other.map { $0.slug == slug && $0.mixKey == mixKey } ?? false
        }

        let slug: String
        let mixKey: String
        /// The song's title.
        let title: String
        /// «Banda completa», «Bajo»…
        let label: String
        let artist: String?
        let cover: String?
    }

    enum Status: Equatable {
        /// Asking for the address, or buffering.
        case loading
        case playing
        case paused
        /// Could not play; the words say why.
        case failed(String)
    }

    /// `resolve`'s answer. An empty failure means the session ended: nothing to say here.
    enum Source: Equatable {
        case url(URL)
        case failed(String)
    }

    private(set) var track: Track?
    private(set) var status: Status = .paused
    /// Seconds played and the mix's length (0 until the player knows it).
    private(set) var elapsed: Double = 0
    private(set) var duration: Double = 0

    var progress: Double { duration > 0 ? min(1, max(0, elapsed / duration)) : 0 }

    @ObservationIgnored var resolve: ((_ slug: String, _ mixKey: String) async -> Source)?

    @ObservationIgnored private var player: AVPlayer?
    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var rateObservation: NSKeyValueObservation?
    @ObservationIgnored private var itemObservation: NSKeyValueObservation?
    @ObservationIgnored private var endObserver: NSObjectProtocol?
    @ObservationIgnored private var failObserver: NSObjectProtocol?
    /// Bumped on every start and stop: a late answer for an earlier mix is dropped.
    @ObservationIgnored private var generation = 0
    /// True from the moment a mix's audio is handed to the player until the next start or stop:
    /// what the player reports in between belongs to the loaded mix.
    @ObservationIgnored private var hasItem = false
    @ObservationIgnored private var commandsReady = false
    @ObservationIgnored private var artwork: MPMediaItemArtwork?

    init() {}

    /// A player frozen in a state, for a drawing test. It plays nothing.
    static func fixture(track: Track, status: Status, elapsed: Double, duration: Double) -> MixPlayer {
        let player = MixPlayer()
        player.track = track
        player.status = status
        player.elapsed = elapsed
        player.duration = duration
        return player
    }

    // MARK: What a tap does

    /// The row's one control: play this mix, or pause and resume it when it is the loaded one.
    func toggle(_ wanted: Track) {
        guard wanted.isSameMix(as: track) else {
            start(wanted)
            return
        }
        switch status {
        case .playing: pause()
        case .paused: resume()
        // Still asking where the mix lives: the tap takes it back. Buffering mid-song on a weak
        // signal: the tap is a pause, and the place in the mix is kept.
        case .loading: if hasItem { pause() } else { stop() }
        case .failed: start(wanted)
        }
    }

    func pause() {
        player?.pause()
    }

    func resume() {
        guard track != nil, hasItem, let player else { return }
        activateSession()
        player.play()
    }

    /// Moves the playhead to a fraction of the mix.
    func seek(toFraction fraction: Double) {
        guard duration > 0 else { return }
        seek(toSeconds: min(1, max(0, fraction)) * duration)
    }

    func seek(toSeconds seconds: Double) {
        guard let player, duration > 0, seconds.isFinite else { return }
        let target = min(max(0, seconds), duration)
        elapsed = target
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        publishNowPlaying()
    }

    /// Ends the session: nothing loaded, nothing on the lock screen.
    func stop() {
        generation += 1
        hasItem = false
        player?.pause()
        clearItem()
        player?.replaceCurrentItem(with: nil)
        track = nil
        status = .paused
        elapsed = 0
        duration = 0
        artwork = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: Loading a mix

    private func start(_ wanted: Track) {
        generation += 1
        let mine = generation
        hasItem = false
        player?.pause()
        clearItem()
        player?.replaceCurrentItem(with: nil)
        track = wanted
        status = .loading
        elapsed = 0
        duration = 0
        artwork = nil
        publishNowPlaying()
        Task { [weak self] in
            guard let self else { return }
            let source = await self.resolve?(wanted.slug, wanted.mixKey) ?? .failed("No se pudo reproducir esta mezcla.")
            guard mine == self.generation else { return }
            switch source {
            case .url(let url):
                self.begin(url, generation: mine)
            case .failed(let message):
                if message.isEmpty {
                    self.stop()
                } else {
                    self.status = .failed(message)
                }
            }
        }
        loadArtwork(for: wanted, generation: mine)
    }

    private func begin(_ url: URL, generation mine: Int) {
        activateSession()
        registerCommands()
        let player = self.player ?? makePlayer()
        let item = AVPlayerItem(url: url)
        itemObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            let failed = item.status == .failed
            let seconds = item.status == .readyToPlay ? item.duration.seconds : 0
            Task { @MainActor [weak self] in
                self?.itemChanged(failed: failed, seconds: seconds, generation: mine)
            }
        }
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.finished(generation: mine)
            }
        }
        failObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.itemChanged(failed: true, seconds: 0, generation: mine)
            }
        }
        player.replaceCurrentItem(with: item)
        hasItem = true
        player.play()
    }

    private func makePlayer() -> AVPlayer {
        let player = AVPlayer()
        self.player = player
        rateObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            let value = player.timeControlStatus
            Task { @MainActor [weak self] in
                self?.playerChanged(value)
            }
        }
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main
        ) { [weak self] time in
            let seconds = time.seconds
            Task { @MainActor [weak self] in
                self?.tick(seconds)
            }
        }
        return player
    }

    private func clearItem() {
        itemObservation?.invalidate()
        itemObservation = nil
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
        endObserver = nil
        if let failObserver {
            NotificationCenter.default.removeObserver(failObserver)
        }
        failObserver = nil
    }

    // MARK: What the player reports

    private func playerChanged(_ value: AVPlayer.TimeControlStatus) {
        guard track != nil, hasItem else { return }
        if case .failed = status { return }
        switch value {
        case .playing: status = .playing
        case .paused: status = .paused
        case .waitingToPlayAtSpecifiedRate: status = .loading
        @unknown default: break
        }
        publishNowPlaying()
    }

    private func itemChanged(failed: Bool, seconds: Double, generation mine: Int) {
        guard mine == generation else { return }
        if failed {
            player?.pause()
            status = .failed("No se pudo reproducir esta mezcla. Revisa tu conexión.")
            return
        }
        if seconds.isFinite, seconds > 0 {
            duration = seconds
            publishNowPlaying()
        }
    }

    private func tick(_ seconds: Double) {
        guard track != nil, hasItem, seconds.isFinite, seconds >= 0 else { return }
        if case .failed = status { return }
        elapsed = duration > 0 ? min(seconds, duration) : seconds
        if duration == 0, let length = player?.currentItem?.duration.seconds, length.isFinite, length > 0 {
            duration = length
            publishNowPlaying()
        }
    }

    /// The mix ran out: back to its start, paused, still loaded.
    private func finished(generation mine: Int) {
        guard mine == generation, let player else { return }
        player.pause()
        player.seek(to: .zero)
        elapsed = 0
        status = .paused
        publishNowPlaying()
    }

    // MARK: The phone's side: the audio session, the lock screen

    private func activateSession() {
        let session = AVAudioSession.sharedInstance()
        // `.playback`: sounds with the ring switch on silent and with the screen locked.
        try? session.setCategory(.playback, mode: .default)
        try? session.setActive(true)
    }

    private func registerCommands() {
        guard !commandsReady else { return }
        commandsReady = true
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.resume() }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.pause() }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if self.status == .playing { self.pause() } else { self.resume() }
            }
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let position = (event as? MPChangePlaybackPositionCommandEvent)?.positionTime else { return .commandFailed }
            Task { @MainActor [weak self] in self?.seek(toSeconds: position) }
            return .success
        }
        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.seek(toSeconds: self.elapsed - 15)
            }
            return .success
        }
        center.skipForwardCommand.preferredIntervals = [15]
        center.skipForwardCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.seek(toSeconds: self.elapsed + 15)
            }
            return .success
        }
    }

    private func publishNowPlaying() {
        guard let track else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.label,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: status == .playing ? 1.0 : 0.0,
        ]
        if let artist = track.artist { info[MPMediaItemPropertyAlbumTitle] = artist }
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func loadArtwork(for wanted: Track, generation mine: Int) {
        guard let address = wanted.cover, let url = URL(string: address) else { return }
        Task { [weak self] in
            guard let image = await ImageStore.shared.image(for: url) else { return }
            guard let self, mine == self.generation else { return }
            self.artwork = Self.makeArtwork(image)
            self.publishNowPlaying()
        }
    }

    /// Apart from the main actor on purpose: the system asks for the picture on a queue of its own.
    private nonisolated static func makeArtwork(_ image: UIImage) -> MPMediaItemArtwork {
        MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    }
}
