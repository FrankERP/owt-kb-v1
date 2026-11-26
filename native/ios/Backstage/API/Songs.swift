import Foundation

/// `GET /api/app/v1/songs` (app/utils/appSongs.ts): the whole catalogue, by title.
struct SongsResponse: Decodable, Equatable, Sendable {
    let songs: [LibrarySong]
}

/// `GET /api/app/v1/songs/[slug]`.
struct SongResponse: Decodable, Equatable, Sendable {
    let song: SongDetail
}

struct SongTag: Decodable, Hashable, Sendable {
    let slug: String
    let name: String
}

/// A song as the Biblioteca lists it.
struct LibrarySong: Decodable, Hashable, Identifiable, Sendable {
    let id: String
    let slug: String
    /// The Spanish title; the original («Lion and The Lamb») travels apart.
    let title: String
    let original: String?
    let artist: String?
    let key: String?
    let bpm: Int?
    let timeSig: String?
    let cover: String?
    let coverLarge: String?
    let tags: [SongTag]
    /// ISO instant the song joined the catalogue.
    let addedAt: String?

    /// «Lion and The Lamb · Leeland»: what sits under the title.
    var byline: String? {
        let parts = [original, artist].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

struct SongChart: Decodable, Hashable, Sendable {
    let key: String?
    let content: String
    /// Bracketed chords that can be transposed; false = plain text, shown as written.
    let chordPro: Bool
}

struct SongLink: Decodable, Hashable, Sendable {
    let kind: String
    let label: String
    let url: String
}

/// A rehearsal mix as the server lists it: already grouped and sorted the way the web's player
/// shows them. `key` names it to the audio route; there is no address here.
struct SongMix: Decodable, Hashable, Identifiable, Sendable {
    let key: String
    /// «Banda completa», or the track's name.
    let label: String
    /// `full`, an instrument family, or `other`.
    let family: String
    let familyLabel: String
    /// The key it sounds in.
    let tone: String?
    /// The waveform: bar heights, 0–100. Empty when the mix has none.
    let bars: [Int]

    var id: String { key }
}

/// `GET /api/app/v1/songs/[slug]/mixes/[key]`: where one mix's audio lives, asked for at play time.
struct MixAudioResponse: Decodable, Equatable, Sendable {
    let url: String
}

/// One song: its catalogue row plus the lyric, the charts, the links and the mixes. The JSON is flat.
struct SongDetail: Decodable, Hashable, Sendable {
    let song: LibrarySong
    /// The editor's plain format: `# Coro` a heading, a blank line a stanza.
    let lyrics: String?
    let charts: [SongChart]
    let links: [SongLink]
    let mixes: [SongMix]
    /// The family of the person's first instrument: the mix offered first.
    let preferredFamily: String?

    private enum CodingKeys: String, CodingKey {
        case lyrics, charts, links, mixes, preferredFamily
    }

    init(song: LibrarySong, lyrics: String?, charts: [SongChart], links: [SongLink], mixes: [SongMix] = [], preferredFamily: String? = nil) {
        self.song = song
        self.lyrics = lyrics
        self.charts = charts
        self.links = links
        self.mixes = mixes
        self.preferredFamily = preferredFamily
    }

    init(from decoder: Decoder) throws {
        song = try LibrarySong(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        lyrics = try c.decodeIfPresent(String.self, forKey: .lyrics)
        charts = try c.decode([SongChart].self, forKey: .charts)
        links = try c.decode([SongLink].self, forKey: .links)
        // Absent on a server from before the mixes: a song with none, never a failed page.
        mixes = try c.decodeIfPresent([SongMix].self, forKey: .mixes) ?? []
        preferredFamily = try c.decodeIfPresent(String.self, forKey: .preferredFamily)
    }
}

// MARK: Which mixes a page shows (app/utils/rehearsalMixes.ts)

enum Mixes {
    struct Group: Identifiable, Equatable {
        let family: String
        let label: String
        let mixes: [SongMix]
        var id: String { family }
    }

    struct Selection: Equatable {
        /// The key whose mixes are shown; nil when there is nothing to choose between.
        let tone: String?
        /// False when the song's key has no mix and the nearest key stands in.
        let exact: Bool
        let mixes: [SongMix]
    }

    /// The keys a song has mixes in: one spelling per pitch (the first seen), in pitch order.
    static func tones(_ mixes: [SongMix]) -> [String] {
        var byRoot: [Int: String] = [:]
        for mix in mixes {
            guard let tone = mix.tone, let root = Transpose.rootIndex(tone), byRoot[root] == nil else { continue }
            byRoot[root] = tone
        }
        return byRoot.keys.sorted().compactMap { byRoot[$0] }
    }

    /// The web's `mixesForKey`: the mixes in `key` by pitch (a Db mix answers a C# song), else
    /// the nearest key's — a tie between a semitone up and one down goes to the lower. With no
    /// key, or no readable tone anywhere, everything shows and there is nothing to caption.
    static func forKey(_ mixes: [SongMix], key: String?) -> Selection {
        let all = tones(mixes)
        guard let key, let want = Transpose.rootIndex(key), !all.isEmpty else {
            return Selection(tone: nil, exact: true, mixes: mixes)
        }
        var best: (tone: String, root: Int, distance: Int)?
        for tone in all {
            guard let root = Transpose.rootIndex(tone) else { continue }
            // Signed distance around the circle, -6...5.
            let signed = (((root - want) % 12) + 18) % 12 - 6
            let distance = abs(signed)
            if best == nil || distance < best!.distance || (distance == best!.distance && signed < 0) {
                best = (tone, root, distance)
            }
        }
        guard let chosen = best else { return Selection(tone: nil, exact: true, mixes: mixes) }
        let shown = mixes.filter { $0.tone.flatMap(Transpose.rootIndex) == chosen.root }
        return Selection(tone: chosen.tone, exact: chosen.distance == 0, mixes: shown)
    }

    /// The server's order, cut into its families: nothing is sorted again here.
    static func groups(_ mixes: [SongMix]) -> [Group] {
        var out: [Group] = []
        for mix in mixes {
            if let last = out.last, last.family == mix.family {
                out[out.count - 1] = Group(family: last.family, label: last.label, mixes: last.mixes + [mix])
            } else {
                out.append(Group(family: mix.family, label: mix.familyLabel, mixes: [mix]))
            }
        }
        return out
    }

    /// The web's `preselectMix`: the first track of the person's family, else the whole band,
    /// else the first mix. A highlight only — nothing plays by itself.
    static func preselected(_ mixes: [SongMix], family: String?) -> SongMix? {
        if let family, let own = mixes.first(where: { $0.family == family }) { return own }
        return mixes.first { $0.family == "full" } ?? mixes.first
    }

    /// «1:05».
    static func clock(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0:00" }
        let whole = Int(seconds.rounded(.down))
        return "\(whole / 60):" + String(format: "%02d", whole % 60)
    }
}

// MARK: The Biblioteca's order and search (app/utils/libraryIndex.ts)

enum Library {
    /// The web's `normalizeText`: case and accents folded, so «Él» files under E.
    static func fold(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "es_MX")).lowercased()
    }

    static func byTitle(_ a: LibrarySong, _ b: LibrarySong) -> Bool {
        let (x, y) = (fold(a.title), fold(b.title))
        return x == y ? a.id < b.id : x < y
    }

    struct LetterGroup: Identifiable, Equatable {
        let letter: String
        let songs: [LibrarySong]
        var id: String { letter }
    }

    /// Filed by the folded first letter, «#» last for a title that starts with anything else.
    static func byLetter(_ songs: [LibrarySong]) -> [LetterGroup] {
        var groups: [String: [LibrarySong]] = [:]
        for song in songs {
            let first = fold(song.title).trimmingCharacters(in: .whitespaces).first.map { String($0).uppercased() } ?? ""
            let letter = first.count == 1 && first >= "A" && first <= "Z" ? first : "#"
            groups[letter, default: []].append(song)
        }
        var letters = groups.keys.filter { $0 != "#" }.sorted()
        if groups["#"] != nil { letters.append("#") }
        return letters.map { LetterGroup(letter: $0, songs: (groups[$0] ?? []).sorted(by: byTitle)) }
    }

    /// «Recién agregadas»: the last songs to join, newest first; one with no date is never new.
    static func recent(_ songs: [LibrarySong], count: Int = 8) -> [LibrarySong] {
        songs
            .filter { !($0.addedAt ?? "").isEmpty }
            .sorted { a, b in
                let (x, y) = (a.addedAt ?? "", b.addedAt ?? "")
                return x == y ? byTitle(a, b) : x > y
            }
            .prefix(count)
            .map { $0 }
    }

    /// A title or its original containing the query, an artist's word starting with it, or the
    /// key itself; titles that START with it first, then A–Z.
    static func search(_ songs: [LibrarySong], _ query: String) -> [LibrarySong] {
        let q = fold(query.trimmingCharacters(in: .whitespaces))
        guard !q.isEmpty else { return songs.sorted(by: byTitle) }
        func rank(_ song: LibrarySong) -> Int? {
            let title = fold(song.title)
            if title.hasPrefix(q) { return 0 }
            if title.contains(q) { return 1 }
            if let original = song.original, fold(original).contains(q) { return 2 }
            if let artist = song.artist,
               fold(artist).split(whereSeparator: { !$0.isLetter && !$0.isNumber }).contains(where: { $0.hasPrefix(q) }) { return 3 }
            if let key = song.key, fold(key) == q { return 4 }
            return nil
        }
        return songs
            .compactMap { song in rank(song).map { (song, $0) } }
            .sorted { a, b in a.1 == b.1 ? byTitle(a.0, b.0) : a.1 < b.1 }
            .map(\.0)
    }
}

// MARK: Transposing (app/utils/transpose.ts)

enum Transpose {
    /// One spelling per pitch, the web's `DISPLAY_NOTES`.
    static let notes = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

    private static let index: [String: Int] = [
        "C": 0, "B#": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "Fb": 4, "F": 5, "E#": 5,
        "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11, "Cb": 11,
    ]

    /// `^([A-G][b#]?)(.*)`: the root and whatever follows it (quality, extensions).
    private static func split(_ token: String) -> (root: String, rest: String)? {
        guard let first = token.first, ("A"..."G").contains(first) else { return nil }
        let afterFirst = token.index(after: token.startIndex)
        if afterFirst < token.endIndex, token[afterFirst] == "b" || token[afterFirst] == "#" {
            let end = token.index(after: afterFirst)
            return (String(token[..<end]), String(token[end...]))
        }
        return (String(first), String(token[afterFirst...]))
    }

    static func rootIndex(_ key: String) -> Int? {
        split(key).flatMap { index[$0.root] }
    }

    static func note(at i: Int) -> String {
        notes[((i % 12) + 12) % 12]
    }

    private static func token(_ token: String, by semitones: Int) -> String {
        guard let parts = split(token), let i = index[parts.root] else { return token }
        return note(at: i + semitones) + parts.rest
    }

    /// At rest a key keeps the spelling it was written in (`Db` stays `Db`).
    static func key(_ key: String, by semitones: Int) -> String {
        semitones % 12 == 0 ? key : token(key, by: semitones)
    }

    /// Each side of a slash chord moves on its own: `G/B` up two is `A/C#`.
    static func chord(_ chord: String, by semitones: Int) -> String {
        if semitones % 12 == 0 { return chord }
        return chord.components(separatedBy: "/").map { token($0, by: semitones) }.joined(separator: "/")
    }
}

// MARK: A chart's lines (ChordChart.tsx's `parseLine`)

struct ChordSegment: Equatable {
    let chord: String?
    let lyric: String
}

enum ChartLine: Equatable {
    /// `# Coro`.
    case heading(String)
    case blank
    /// Words with no chord over them.
    case text(String)
    /// `[G]Santo [D]santo`: each chord over the words that follow it.
    case chords([ChordSegment])
}

enum ChordPro {
    static func lines(_ content: String) -> [ChartLine] {
        content.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n").map { line in
            if line.hasPrefix("# ") { return .heading(String(line.dropFirst(2)).trimmingCharacters(in: .whitespaces)) }
            if line.trimmingCharacters(in: .whitespaces).isEmpty { return .blank }
            let parsed = segments(line)
            return parsed.contains { $0.chord != nil } ? .chords(parsed) : .text(line)
        }
    }

    static func segments(_ line: String) -> [ChordSegment] {
        guard let firstBracket = line.firstIndex(of: "[") else { return [ChordSegment(chord: nil, lyric: line)] }
        var out: [ChordSegment] = []
        if firstBracket > line.startIndex {
            out.append(ChordSegment(chord: nil, lyric: String(line[..<firstBracket])))
        }
        var i = firstBracket
        while i < line.endIndex {
            let open = line.index(after: i)
            // A bracket that never closes, or closes on nothing, is not a chord: skip to the next.
            guard open < line.endIndex,
                  let close = line[open...].firstIndex(of: "]"),
                  close > open
            else {
                guard open < line.endIndex, let next = line[open...].firstIndex(of: "[") else { break }
                i = next
                continue
            }
            let lyricStart = line.index(after: close)
            let lyricEnd = line[lyricStart...].firstIndex(of: "[") ?? line.endIndex
            out.append(ChordSegment(chord: String(line[open..<close]), lyric: String(line[lyricStart..<lyricEnd])))
            i = lyricEnd
        }
        return out
    }
}
