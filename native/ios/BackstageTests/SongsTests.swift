import XCTest
@testable import Backstage

final class SongsDecodingTests: XCTestCase {
    func testDecodesTheCatalogue() throws {
        let json = """
        { "songs": [ { "id": "s1", "slug": "cordero", "title": "Cordero y León", "original": "Lion and The Lamb",
          "artist": "Leeland", "key": "G", "bpm": 90, "timeSig": null, "cover": null, "coverLarge": null,
          "tags": [ { "slug": "up-beat", "name": "Up beat" } ], "addedAt": "2026-01-02T03:04:05Z" } ] }
        """
        let songs = try JSONDecoder().decode(SongsResponse.self, from: Data(json.utf8)).songs
        XCTAssertEqual(songs.first?.byline, "Lion and The Lamb · Leeland")
        XCTAssertEqual(songs.first?.bpm, 90)
    }

    func testDecodesAFlatSong() throws {
        let json = """
        { "song": { "id": "s1", "slug": "santo", "title": "Santo", "original": null, "artist": null, "key": "G",
          "bpm": null, "timeSig": null, "cover": null, "coverLarge": null, "tags": [], "addedAt": null,
          "lyrics": "# Coro\\nSanto", "charts": [ { "key": "G", "content": "[G]Santo", "chordPro": true } ],
          "links": [ { "kind": "tutorial", "label": "Tutorial", "url": "https://youtu.be/t" } ] } }
        """
        let detail = try JSONDecoder().decode(SongResponse.self, from: Data(json.utf8)).song
        XCTAssertEqual(detail.song.slug, "santo")
        XCTAssertNil(detail.song.byline)
        XCTAssertEqual(detail.lyrics, "# Coro\nSanto")
        XCTAssertEqual(detail.charts.first?.chordPro, true)
        XCTAssertEqual(detail.links.first?.kind, "tutorial")
        // A server from before the mixes: a song with none, never a page that fails to decode.
        XCTAssertEqual(detail.mixes, [])
        XCTAssertNil(detail.preferredFamily)
    }

    func testDecodesTheMixes() throws {
        let json = """
        { "song": { "id": "s1", "slug": "santo", "title": "Santo", "original": null, "artist": null, "key": "G",
          "bpm": null, "timeSig": null, "cover": null, "coverLarge": null, "tags": [], "addedAt": null,
          "lyrics": null, "charts": [], "links": [], "preferredFamily": "bass",
          "mixes": [ { "key": "k1", "label": "Banda completa", "family": "full", "familyLabel": "Banda completa", "tone": "G", "bars": [0, 50, 100] },
                     { "key": "k2", "label": "Bass", "family": "bass", "familyLabel": "Bajo", "tone": null, "bars": [] } ] } }
        """
        let detail = try JSONDecoder().decode(SongResponse.self, from: Data(json.utf8)).song
        XCTAssertEqual(detail.mixes.map(\.key), ["k1", "k2"])
        XCTAssertEqual(detail.mixes[0].bars, [0, 50, 100])
        XCTAssertNil(detail.mixes[1].tone)
        XCTAssertEqual(detail.preferredFamily, "bass")
        let audio = try JSONDecoder().decode(MixAudioResponse.self, from: Data(#"{"url":"https://cdn.sanity.io/files/p/d/a.mp3"}"#.utf8))
        XCTAssertEqual(audio.url, "https://cdn.sanity.io/files/p/d/a.mp3")
    }
}

final class MixesTests: XCTestCase {
    private func mix(_ key: String, family: String = "full", tone: String? = "G") -> SongMix {
        SongMix(key: key, label: key, family: family, familyLabel: family.uppercased(), tone: tone, bars: [])
    }

    func testListsOneSpellingPerPitchInPitchOrder() {
        let mixes = [mix("a", tone: "G"), mix("b", tone: "Db"), mix("c", tone: "C#"), mix("d", tone: nil), mix("e", tone: "?")]
        XCTAssertEqual(Mixes.tones(mixes), ["Db", "G"])
    }

    func testShowsTheSongsKeyByPitch() {
        let mixes = [mix("a", tone: "Db"), mix("b", tone: "G")]
        let selection = Mixes.forKey(mixes, key: "C#")
        XCTAssertEqual(selection.tone, "Db")
        XCTAssertTrue(selection.exact)
        XCTAssertEqual(selection.mixes.map(\.key), ["a"])
    }

    func testFallsBackToTheNearestKeyLowerOnATie() {
        let mixes = [mix("up", tone: "A"), mix("down", tone: "G")]
        let selection = Mixes.forKey(mixes, key: "Ab")
        XCTAssertEqual(selection.tone, "G")
        XCTAssertFalse(selection.exact)
        XCTAssertEqual(selection.mixes.map(\.key), ["down"])
        // Around the circle: B is one below C, nearer than D.
        XCTAssertEqual(Mixes.forKey([mix("b", tone: "B"), mix("d", tone: "D")], key: "C").tone, "B")
    }

    func testShowsEverythingWhenThereIsNothingToChoose() {
        let mixes = [mix("a", tone: nil), mix("b", tone: "G")]
        XCTAssertEqual(Mixes.forKey(mixes, key: nil), Mixes.Selection(tone: nil, exact: true, mixes: mixes))
        let toneless = [mix("a", tone: nil)]
        XCTAssertEqual(Mixes.forKey(toneless, key: "G"), Mixes.Selection(tone: nil, exact: true, mixes: toneless))
    }

    func testCutsTheServersOrderIntoFamilies() {
        let groups = Mixes.groups([mix("f"), mix("k1", family: "keys"), mix("k2", family: "keys"), mix("d", family: "drums")])
        XCTAssertEqual(groups.map(\.family), ["full", "keys", "drums"])
        XCTAssertEqual(groups[1].mixes.map(\.key), ["k1", "k2"])
        XCTAssertEqual(groups[1].label, "KEYS")
    }

    func testOffersThePersonsInstrumentThenTheBandThenTheFirst() {
        let mixes = [mix("f"), mix("k", family: "keys"), mix("b", family: "bass")]
        XCTAssertEqual(Mixes.preselected(mixes, family: "bass")?.key, "b")
        XCTAssertEqual(Mixes.preselected(mixes, family: "drums")?.key, "f")
        XCTAssertEqual(Mixes.preselected(mixes, family: nil)?.key, "f")
        XCTAssertEqual(Mixes.preselected([mix("k", family: "keys")], family: nil)?.key, "k")
        XCTAssertNil(Mixes.preselected([], family: "bass"))
    }

    func testWritesAClock() {
        XCTAssertEqual(Mixes.clock(0), "0:00")
        XCTAssertEqual(Mixes.clock(65.9), "1:05")
        XCTAssertEqual(Mixes.clock(600), "10:00")
        XCTAssertEqual(Mixes.clock(.nan), "0:00")
    }
}

@MainActor
final class MixPlayerTests: XCTestCase {
    private let track = MixPlayer.Track(slug: "santo", mixKey: "k1", title: "Santo", label: "Bajo", artist: nil, cover: nil)

    func testAFailedAnswerSaysWhyAndAnotherTapAsksAgain() async {
        let player = MixPlayer()
        var asked: [String] = []
        player.resolve = { slug, key in
            asked.append("\(slug)/\(key)")
            return .failed("No hay conexión.")
        }
        player.toggle(track)
        XCTAssertEqual(player.status, .loading)
        XCTAssertEqual(player.track, track)
        await settle { player.status != .loading }
        XCTAssertEqual(player.status, .failed("No hay conexión."))
        player.toggle(track)
        await settle { asked.count == 2 }
        XCTAssertEqual(asked, ["santo/k1", "santo/k1"])
    }

    func testASessionThatEndedLeavesNothingLoaded() async {
        let player = MixPlayer()
        player.resolve = { _, _ in .failed("") }
        player.toggle(track)
        await settle { player.track == nil }
        XCTAssertNil(player.track)
        XCTAssertEqual(player.status, .paused)
    }

    func testStoppingDropsALateAnswer() async {
        let player = MixPlayer()
        player.resolve = { _, _ in
            try? await Task.sleep(nanoseconds: 50_000_000)
            return .failed("tarde")
        }
        player.toggle(track)
        player.stop()
        try? await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertNil(player.track)
        XCTAssertEqual(player.status, .paused)
    }

    func testProgressIsAFractionOfTheLength() {
        XCTAssertEqual(MixPlayer.fixture(track: track, status: .playing, elapsed: 30, duration: 120).progress, 0.25)
        XCTAssertEqual(MixPlayer.fixture(track: track, status: .loading, elapsed: 0, duration: 0).progress, 0)
    }

    private func settle(_ done: () -> Bool) async {
        for _ in 0..<200 where !done() {
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
    }
}

final class LibraryTests: XCTestCase {
    private func song(_ title: String, artist: String? = nil, key: String? = nil, added: String? = nil, original: String? = nil) -> LibrarySong {
        LibrarySong(id: title, slug: title, title: title, original: original, artist: artist, key: key, bpm: nil, timeSig: nil, cover: nil, coverLarge: nil, tags: [], addedAt: added)
    }

    func testFilesByFoldedLetterWithTheRestLast() {
        let groups = Library.byLetter([song("Él vive"), song("eres"), song("10,000 razones"), song("Ábrenos"), song("Cristo")])
        XCTAssertEqual(groups.map(\.letter), ["A", "C", "E", "#"])
        XCTAssertEqual(groups[2].songs.map(\.title), ["Él vive", "eres"])
    }

    func testRecentIsNewestFirstAndSkipsUndated() {
        let recent = Library.recent([song("a", added: "2026-01-01T00:00:00Z"), song("b"), song("c", added: "2026-03-01T00:00:00Z")], count: 8)
        XCTAssertEqual(recent.map(\.title), ["c", "a"])
    }

    func testSearchRanksTitleStartThenContainsThenOriginalArtistAndKey() {
        let all = [
            song("Gracia sublime"), song("Sublime gracia"), song("Cordero", original: "Graceful"),
            song("Nadie", artist: "Grupo Grace"), song("Rey", key: "G"), song("Otro"),
        ]
        XCTAssertEqual(Library.search(all, "gra").map(\.title), ["Gracia sublime", "Sublime gracia", "Cordero", "Nadie"])
        XCTAssertEqual(Library.search(all, "g").map(\.title), ["Gracia sublime", "Sublime gracia", "Cordero", "Nadie", "Rey"])
        XCTAssertEqual(Library.search(all, "  ").count, 6)
        XCTAssertEqual(Library.search([song("Él vive")], "el").count, 1)
    }
}

final class TransposeTests: XCTestCase {
    func testAKeyAtRestKeepsItsSpelling() {
        XCTAssertEqual(Transpose.key("Db", by: 0), "Db")
        XCTAssertEqual(Transpose.key("Db", by: 12), "Db")
    }

    func testMovesKeysAndChordsWithTheirQuality() {
        XCTAssertEqual(Transpose.key("G", by: 2), "A")
        XCTAssertEqual(Transpose.key("Bbm", by: 1), "Bm")
        XCTAssertEqual(Transpose.key("C", by: -1), "B")
        XCTAssertEqual(Transpose.chord("G/B", by: 2), "A/C#")
        XCTAssertEqual(Transpose.chord("F#m7", by: 3), "Am7")
        XCTAssertEqual(Transpose.chord("Dsus4", by: -2), "Csus4")
        XCTAssertEqual(Transpose.chord("N.C.", by: 2), "N.C.")
        XCTAssertEqual(Transpose.chord("x", by: 2), "x")
    }

    func testRootIndex() {
        XCTAssertEqual(Transpose.rootIndex("Ab"), 8)
        XCTAssertEqual(Transpose.rootIndex("G#m"), 8)
        XCTAssertNil(Transpose.rootIndex("?"))
    }
}

final class ChordProTests: XCTestCase {
    func testSplitsALineIntoChordsOverTheirWords() {
        XCTAssertEqual(ChordPro.segments("Oh [G]Santo [D/F#]santo"), [
            ChordSegment(chord: nil, lyric: "Oh "),
            ChordSegment(chord: "G", lyric: "Santo "),
            ChordSegment(chord: "D/F#", lyric: "santo"),
        ])
        XCTAssertEqual(ChordPro.segments("[G][D]"), [ChordSegment(chord: "G", lyric: ""), ChordSegment(chord: "D", lyric: "")])
        XCTAssertEqual(ChordPro.segments("sin acordes"), [ChordSegment(chord: nil, lyric: "sin acordes")])
    }

    func testABracketThatNeverClosesIsNotAChord() {
        XCTAssertEqual(ChordPro.segments("a [b"), [ChordSegment(chord: nil, lyric: "a ")])
        XCTAssertEqual(ChordPro.segments("[] [G]x"), [ChordSegment(chord: "G", lyric: "x")])
    }

    func testReadsHeadingsBlanksTextAndChordLines() {
        XCTAssertEqual(ChordPro.lines("# Coro\n[G]Santo\n\nsolo letra"), [
            .heading("Coro"),
            .chords([ChordSegment(chord: "G", lyric: "Santo")]),
            .blank,
            .text("solo letra"),
        ])
    }
}
