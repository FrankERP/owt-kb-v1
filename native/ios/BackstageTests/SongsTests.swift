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
