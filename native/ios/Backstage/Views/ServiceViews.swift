import SwiftUI

// A worship service as the web draws it (ADR-0088): one card with an edge — the date as a calendar
// leaf, the day as its title, the clock, «En 4 días» and «Tú · EG» as chips, the day's colour on
// the rail and the leaf's band — then the songs with their covers and the team as faces. The
// pieces mirror the web's `DateTile`, `Face`/`FaceStack`, `SongCover`/`CoverRow`, `ServiceFacts`,
// `SeatIcon`, `DayCard` and `DayCardDisclosure`, class for class where SwiftUI allows.

// MARK: Pieces

/// The date as a calendar leaf: the weekday on a band in the day's colour, the number in the
/// display face, the month under it (`DateTile`).
struct DateLeaf: View {
    let date: String
    let tone: ServiceTone

    var body: some View {
        let leaf = ServiceDay.leaf(date)
        VStack(spacing: 0) {
            Text(leaf.weekday.uppercased())
                .font(.bsLabel(10))
                .tracking(10 * 0.16)
                .foregroundStyle(tone.color)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 3)
                .background(tone.wash)
            Text(leaf.day)
                .font(.bsDisplay(28))
                .monospacedDigit()
                .foregroundStyle(BS.ink)
                .padding(.top, 6)
            Text(leaf.month.uppercased())
                .font(.bsLabel(10))
                .tracking(10 * 0.16)
                .foregroundStyle(BS.inkDim)
                .padding(.top, 2)
                .padding(.bottom, 6)
        }
        .frame(width: 58)
        .background(BS.base.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(BS.ink.opacity(0.12), lineWidth: 1))
        .accessibilityHidden(true)
    }
}

/// A seat's glyph (`SeatIcon`): the web's own line icons (app/components/ui/icons.tsx), bundled
/// as template SVGs — the microphone of a voice, the keys, the drum, the guitar of the string
/// seats, the sliders of the booth; an unknown seat takes its section's glyph, else the note.
enum SeatGlyph {
    static func asset(for seat: String, section: String? = nil) -> String {
        let key = seat.lowercased().trimmingCharacters(in: .whitespaces)
        if key.hasPrefix("foh") { return "SeatSliders" }
        switch key {
        case "lead", "bgv", "bgvs", "coro": return "SeatMic"
        case "keys": return "SeatKeys"
        case "drums": return "SeatDrum"
        case "eg", "ag", "bass": return "SeatGuitar"
        case "console": return "SeatSliders"
        default:
            switch section {
            case "voces": return "SeatMic"
            case "banda": return "SeatGuitar"
            case "cabina": return "SeatSliders"
            default: return "SeatNote"
            }
        }
    }

    static func section(_ id: String) -> String {
        switch id {
        case "voces": return "SeatMic"
        case "banda": return "SeatGuitar"
        default: return "SeatSliders"
        }
    }
}

/// One of the web's line icons, tinted by the foreground style.
struct LineIcon: View {
    let name: String
    var size: CGFloat = 14

    var body: some View {
        Image(name)
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// «En 4 días»: a quiet outlined chip (`COUNTDOWN_CHIP`).
struct CountdownChip: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.bsLabel(10))
            .tracking(1)
            .foregroundStyle(BS.inkMuted)
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .overlay(Capsule().strokeBorder(BS.ink.opacity(0.16), lineWidth: 1))
    }
}

/// «Tú · EG» with the seat's glyph, in the app's one green (`MINE_CHIP`). A seat with no name
/// says «Te toca».
struct MineChip: View {
    let seats: [String]

    var body: some View {
        HStack(spacing: 6) {
            LineIcon(name: SeatGlyph.asset(for: seats.first ?? ""), size: 11)
            Text((seats.isEmpty ? "Te toca" : "Tú · \(seats.joined(separator: ", "))").uppercased())
                .font(.bsLabel(10))
                .tracking(1)
        }
        .foregroundStyle(BS.positive)
        .padding(.horizontal, 10)
        .padding(.vertical, 3)
        .background(Capsule().fill(BS.positive.opacity(0.10)))
        .overlay(Capsule().strokeBorder(BS.positive.opacity(0.35), lineWidth: 1))
    }
}

/// The clock line: the icon, then the hour in the body face.
struct ClockLine: View {
    let time: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "clock")
                .font(.system(size: 13))
                .foregroundStyle(BS.inkDim)
            Text(time)
                .font(.bsBody(15, .semibold))
                .monospacedDigit()
                .foregroundStyle(BS.ink)
        }
    }
}

/// A member as a face: the photo, or two initials. «Tú» takes the green ring (`Face`).
struct FaceView: View {
    let name: String
    let photo: String?
    var mine = false
    var size: CGFloat = 36
    var badge: String?

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            AsyncImage(url: photo.flatMap(URL.init(string:))) { phase in
                if let image = phase.image {
                    image.resizable().scaledToFill()
                } else {
                    Text(String(name.trimmingCharacters(in: .whitespaces).prefix(2)).uppercased())
                        .font(.bsLabel(size * 0.3))
                        .foregroundStyle(mine ? BS.positive : BS.ink)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(BS.raised)
                }
            }
            .frame(width: size, height: size)
            .clipShape(Circle())
            .overlay(Circle().strokeBorder(mine ? BS.positive : BS.ink.opacity(0.10), lineWidth: mine ? 2 : 1))
            if let badge {
                LineIcon(name: badge, size: 10)
                    .foregroundStyle(mine ? BS.positive : BS.inkMuted)
                    .frame(width: 18, height: 18)
                    .background(Circle().fill(BS.base))
                    .overlay(Circle().strokeBorder(BS.ink.opacity(0.14), lineWidth: 1))
                    .offset(x: 4, y: 4)
            }
        }
        .accessibilityHidden(true)
    }
}

/// Several faces overlapped, then «+N» (`FaceStack`). One face per person.
struct FaceStack: View {
    let people: [AppPerson]
    var max = 5
    var size: CGFloat = 28

    var body: some View {
        let unique = Self.unique(people)
        HStack(spacing: -8) {
            ForEach(Array(unique.prefix(max).enumerated()), id: \.offset) { _, person in
                FaceView(name: person.name, photo: person.photo, mine: person.mine, size: size)
                    .padding(2)
                    .background(Circle().fill(BS.card))
            }
            if unique.count > max {
                Text("+\(unique.count - max)")
                    .font(.bsLabel(size * 0.36))
                    .foregroundStyle(BS.inkMuted)
                    .frame(width: size, height: size)
                    .background(Circle().fill(BS.raised))
                    .overlay(Circle().strokeBorder(BS.ink.opacity(0.10), lineWidth: 1))
                    .padding(2)
                    .background(Circle().fill(BS.card))
            }
        }
        .accessibilityHidden(true)
    }

    /// Someone who sings and plays is one face.
    static func unique(_ people: [AppPerson]) -> [AppPerson] {
        var seen = Set<String>()
        return people.filter { seen.insert($0.name.lowercased()).inserted }
    }
}

/// A song's album cover, or a neutral tile with a note; `n` is its place in the set
/// (`SongCover`).
struct CoverView: View {
    let url: String?
    var size: CGFloat = 52
    var number: Int?

    var body: some View {
        let radius = size >= 52 ? 10.0 : (size >= 40 ? 8.0 : 6.0)
        ZStack(alignment: .topLeading) {
            AsyncImage(url: url.flatMap(URL.init(string:))) { phase in
                if let image = phase.image {
                    image.resizable().scaledToFill()
                } else {
                    Image(systemName: "music.note")
                        .font(.system(size: size * 0.34))
                        .foregroundStyle(BS.inkDim)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(
                            LinearGradient(colors: [BS.ink.opacity(0.10), BS.ink.opacity(0.03)], startPoint: .topLeading, endPoint: .bottomTrailing)
                        )
                }
            }
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(BS.ink.opacity(0.10), lineWidth: 1))
            if let number {
                Text("\(number)")
                    .font(.bsLabel(10))
                    .monospacedDigit()
                    .foregroundStyle(BS.inkMuted)
                    .frame(minWidth: 19, minHeight: 19)
                    .background(Circle().fill(BS.base))
                    .overlay(Circle().strokeBorder(BS.ink.opacity(0.14), lineWidth: 1))
                    .offset(x: -6, y: -6)
            }
        }
        .accessibilityHidden(true)
    }
}

/// What a folded service says without a sentence: who leads as faces beside their names, and
/// the set as covers beside the count, or «Setlist pendiente» (`ServiceFacts`).
struct ServiceFacts: View {
    let service: AppService

    var body: some View {
        let leads = FaceStack.unique(service.leads)
        VStack(alignment: .leading, spacing: 8) {
            if !leads.isEmpty {
                HStack(spacing: 8) {
                    FaceStack(people: leads, max: 3, size: 24)
                    Text("Lead \(joinNames(leads.map(\.name)))")
                        .font(.bsBody(14))
                        .foregroundStyle(BS.inkMuted)
                        .lineLimit(2)
                }
            }
            if service.songs.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "music.note").font(.system(size: 11))
                    Text("Setlist pendiente").font(.bsBody(14))
                }
                .foregroundStyle(BS.inkDim)
            } else {
                HStack(spacing: 8) {
                    HStack(spacing: 4) {
                        ForEach(Array(service.songs.prefix(5).enumerated()), id: \.offset) { _, song in
                            CoverView(url: song.cover, size: 28)
                        }
                    }
                    Text(service.songs.count == 1 ? "1 canción" : "\(service.songs.count) canciones")
                        .font(.bsBody(14))
                        .foregroundStyle(BS.inkMuted)
                }
            }
        }
    }
}

// MARK: The card's head

/// The leaf, the day in the display face, the clock and the chips (`DayCard`'s framed header).
struct ServiceHead: View {
    let service: AppService
    let today: String
    var trailing: AnyView?

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            DateLeaf(date: service.date, tone: ServiceTone(service.kind))
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top) {
                    Text(service.title.uppercased())
                        .font(.bsDisplay(22))
                        .tracking(0.44)
                        .foregroundStyle(BS.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 2)
                    Spacer(minLength: 8)
                    if let trailing { trailing }
                }
                if let time = service.time {
                    ClockLine(time: time)
                }
                // Only when the title doesn't already say it («Noche de alabanza» twice reads as a stutter).
                if service.worshipNight, service.title.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil) != "noche de alabanza" {
                    HStack(spacing: 6) {
                        Image(systemName: "sparkles").font(.system(size: 12))
                        Text("Noche de alabanza").font(.bsBody(15))
                    }
                    .foregroundStyle(BS.inkMuted)
                }
                let countdown = ServiceDay.countdown(from: today, to: service.date)
                if countdown != nil || service.isMine {
                    ChipRow {
                        if let countdown { CountdownChip(text: countdown) }
                        if service.isMine { MineChip(seats: service.mySeats) }
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Chips that wrap to a second line rather than push anything off the card.
struct ChipRow<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) { content }
            VStack(alignment: .leading, spacing: 6) { content }
        }
    }
}

// MARK: The folded card (a list row)

/// A service in the list: an object with an edge — its date, who leads as faces, its songs as
/// pictures (`DayCardDisclosure`, folded). Tapping it opens the service's page.
struct ServiceFoldedCard: View {
    let service: AppService
    let today: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ServiceHead(service: service, today: today, trailing: AnyView(
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(BS.inkMuted)
                    .frame(width: 34, height: 34)
                    .overlay(Circle().strokeBorder(BS.ink.opacity(0.12), lineWidth: 1))
                    .offset(x: 4, y: -4)
            ))
            ServiceFacts(service: service)
                .padding(.leading, 72)
        }
        .padding(.vertical, 16)
        .padding(.leading, 20)
        .padding(.trailing, 16)
        .cardSurface(tone: ServiceTone(service.kind))
    }
}

// MARK: The full card (the next service, and a service's page)

/// The service as a card: the head, then the setlist, the pastor's message, the team notes and
/// the team by section (`DayCard`, framed).
struct ServiceFullCard: View {
    let service: AppService
    let today: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ServiceHead(service: service, today: today)
                .padding(.vertical, 16)
                .padding(.leading, 20)
                .padding(.trailing, 16)
                .background(alignment: .top) {
                    // Light on the head: a neutral wash that fades out before the body.
                    LinearGradient(colors: [BS.ink.opacity(0.06), .clear], startPoint: .top, endPoint: .bottom)
                        .frame(height: 144)
                }
            Rectangle().fill(BS.ink.opacity(0.08)).frame(height: 1)
            VStack(alignment: .leading, spacing: 24) {
                if let message = service.pastorMessage {
                    NoteBox(title: "Mensaje del pastor", text: message, symbol: "megaphone", pastor: true)
                }
                if let notes = service.teamNotes {
                    NoteBox(title: "Notas para el equipo", text: notes, symbol: "text.bubble", pastor: false)
                }
                SetlistSection(songs: service.songs)
                if !service.sections.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        SheetTitle(text: "Equipo")
                            .padding(.bottom, 4)
                        ForEach(Array(service.sections.enumerated()), id: \.element.id) { index, section in
                            if index > 0 {
                                Rectangle().fill(BS.ink.opacity(0.06)).frame(height: 1)
                            }
                            TeamSectionView(section: section)
                        }
                    }
                }
            }
            .padding(.vertical, 20)
            .padding(.leading, 20)
            .padding(.trailing, 16)
        }
        .cardSurface(tone: ServiceTone(service.kind))
    }
}

/// The pastor's message and the team notes: an icon tile, a small-caps title, the text.
private struct NoteBox: View {
    let title: String
    let text: String
    let symbol: String
    let pastor: Bool
    @State private var expanded = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 14))
                .foregroundStyle(pastor ? BS.accent : BS.inkMuted)
                .frame(width: 32, height: 32)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(pastor ? BS.accent.opacity(0.14) : BS.ink.opacity(0.07)))
            VStack(alignment: .leading, spacing: 4) {
                Text(title.uppercased())
                    .font(.bsLabel(11))
                    .tracking(1.1)
                    .foregroundStyle(pastor ? BS.accent : BS.inkDim)
                Text(text)
                    .font(.bsBody(15))
                    .foregroundStyle(BS.inkMuted)
                    .lineLimit(expanded ? nil : 3)
                    .textSelection(.enabled)
                    .onTapGesture { withAnimation(.easeOut(duration: 0.2)) { expanded.toggle() } }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(pastor ? BS.accent.opacity(0.05) : BS.ink.opacity(0.03)))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(pastor ? BS.accent.opacity(0.25) : BS.ink.opacity(0.10), lineWidth: 1))
    }
}

// MARK: Setlist

/// Consecutive songs that share a medley tag, played as one run.
struct SongRun: Identifiable {
    let id: Int
    let medley: String?
    let songs: [(number: Int, song: AppSong)]

    static func runs(_ songs: [AppSong]) -> [SongRun] {
        var runs: [SongRun] = []
        for (index, song) in songs.enumerated() {
            let entry = (number: index + 1, song: song)
            if let tag = song.medley, let last = runs.last, last.medley == tag {
                runs[runs.count - 1] = SongRun(id: last.id, medley: tag, songs: last.songs + [entry])
            } else {
                runs.append(SongRun(id: index, medley: song.medley, songs: [entry]))
            }
        }
        return runs
    }
}

private struct SetlistSection: View {
    let songs: [AppSong]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 0) {
                Text("SETLIST")
                    .font(.bsLabel(12))
                    .tracking(12 * 0.22)
                    .foregroundStyle(BS.sheetTitle)
                if !songs.isEmpty {
                    Text(" · \(songs.count)")
                        .font(.bsLabel(12))
                        .foregroundStyle(BS.inkDim)
                }
            }
            if songs.isEmpty {
                HStack(spacing: 12) {
                    Image(systemName: "music.note.list")
                        .font(.system(size: 16))
                        .foregroundStyle(BS.inkMuted)
                        .frame(width: 40, height: 40)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(BS.ink.opacity(0.07)))
                    Text("Setlist pendiente")
                        .font(.bsBody(15))
                        .foregroundStyle(BS.inkMuted)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(BS.ink.opacity(0.14), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                )
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(SongRun.runs(songs)) { run in
                        if run.songs.count > 1 {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Image(systemName: "link").font(.system(size: 10))
                                    Text("MEDLEY · \(run.songs.count) CANCIONES SEGUIDAS")
                                        .font(.bsLabel(10))
                                        .tracking(1.8)
                                }
                                .foregroundStyle(BS.inkDim)
                                .padding(.leading, 6)
                                .padding(.bottom, 2)
                                ForEach(run.songs, id: \.number) { entry in
                                    SongRowView(number: entry.number, song: entry.song)
                                }
                            }
                            .padding(.horizontal, 8)
                            .padding(.top, 8)
                            .padding(.bottom, 4)
                            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(BS.ink.opacity(0.03)))
                            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(BS.ink.opacity(0.08), lineWidth: 1))
                        } else if let entry = run.songs.first {
                            SongRowView(number: entry.number, song: entry.song)
                        }
                    }
                }
            }
        }
    }
}

/// A song on the setlist: its cover with its place, the title, the author and tempo, who leads it
/// on a worship night, and the key as an INK pill (inside a day card the key stays ink, ADR-0071).
struct SongRowView: View {
    let number: Int
    let song: AppSong

    var body: some View {
        HStack(spacing: 14) {
            CoverView(url: song.cover, size: 52, number: number)
            VStack(alignment: .leading, spacing: 2) {
                Text(song.title)
                    .font(.bsBody(17, .semibold))
                    .foregroundStyle(BS.ink)
                    .lineLimit(1)
                HStack(spacing: 8) {
                    if let author = song.author {
                        Text(author).lineLimit(1)
                    }
                    if let bpm = song.bpm {
                        HStack(spacing: 3) {
                            Image(systemName: "metronome").font(.system(size: 11))
                            Text("\(bpm)").monospacedDigit()
                        }
                        .foregroundStyle(BS.inkDim)
                    }
                }
                .font(.bsBody(14))
                .foregroundStyle(BS.inkMuted)
                if !song.leads.isEmpty {
                    Text("Dirige: \(joinNames(song.leads))")
                        .font(.bsBody(14))
                        .foregroundStyle(BS.inkMuted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            HStack(spacing: 6) {
                if let original = song.songKey, let key = song.key, original != key {
                    Text("orig. \(original)")
                        .font(.bsLabel(11))
                        .foregroundStyle(BS.inkDim)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(BS.ink.opacity(0.14), lineWidth: 1))
                }
                if let key = song.key ?? song.songKey {
                    Text(key)
                        .font(.bsLabel(14))
                        .foregroundStyle(BS.ink)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .overlay(Capsule().strokeBorder(BS.ink.opacity(0.18), lineWidth: 1))
                }
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

// MARK: Team

/// A section (Voces, Banda, Cabina): an icon tile, «Voces · 8», then each seat as a group of
/// faces with names (`TeamSections`). Folds on a tap.
private struct TeamSectionView: View {
    let section: AppSection
    @State private var isOpen = true

    /// The section's people grouped by seat, in the order the seats first appear.
    private var groups: [(seat: String, people: [AppPerson])] {
        var order: [String] = []
        var bySeat: [String: [AppPerson]] = [:]
        for person in section.people {
            let seat = person.seat.isEmpty ? "Sin nombre" : person.seat
            if bySeat[seat] == nil { order.append(seat) }
            bySeat[seat, default: []].append(person)
        }
        return order.map { ($0, bySeat[$0] ?? []) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.easeOut(duration: 0.25)) { isOpen.toggle() }
            } label: {
                HStack(spacing: 12) {
                    LineIcon(name: SeatGlyph.section(section.id), size: 16)
                        .foregroundStyle(BS.inkMuted)
                        .frame(width: 36, height: 36)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(BS.ink.opacity(0.07)))
                    HStack(spacing: 0) {
                        Text(section.label)
                            .font(.bsBody(17, .semibold))
                            .foregroundStyle(BS.ink)
                        Text(" · \(FaceStack.unique(section.people).count)")
                            .font(.bsBody(17))
                            .foregroundStyle(BS.inkDim)
                    }
                    Spacer()
                    if !isOpen {
                        FaceStack(people: section.people, max: 4, size: 24)
                    }
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(BS.inkDim)
                        .rotationEffect(.degrees(isOpen ? 180 : 0))
                        .frame(width: 28, height: 28)
                        .overlay(Circle().strokeBorder(BS.ink.opacity(0.10), lineWidth: 1))
                }
                .padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(section.label), \(section.people.count) personas")
            .accessibilityHint(isOpen ? "Toca para cerrar" : "Toca para abrir")

            if isOpen {
                VStack(alignment: .leading, spacing: 8) {
                    if section.id == "voces" {
                        ForEach(groups, id: \.seat) { group in
                            TeamBox(title: group.people.count > 1 ? "\(group.seat) · \(group.people.count)" : group.seat) {
                                PeopleGrid(people: group.people, section: section.id, showSeat: false)
                            }
                        }
                    } else {
                        TeamBox(title: nil) {
                            PeopleGrid(people: section.people, section: section.id, showSeat: true)
                        }
                    }
                }
                .padding(.bottom, 8)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
}

/// A rounded group inside a section, with an optional caption («Lead · 2»).
private struct TeamBox<Content: View>: View {
    let title: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title {
                Text(title)
                    .font(.bsBody(14))
                    .foregroundStyle(BS.inkMuted)
            }
            content
        }
        .padding(.horizontal, 12)
        .padding(.top, title == nil ? 12 : 8)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(BS.ink.opacity(0.04)))
    }
}

private struct PeopleGrid: View {
    let people: [AppPerson]
    let section: String
    let showSeat: Bool

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 12, alignment: .leading)], alignment: .leading, spacing: 14) {
            ForEach(Array(people.enumerated()), id: \.offset) { _, person in
                PersonCell(person: person, section: section, showSeat: showSeat)
            }
        }
    }
}

private struct PersonCell: View {
    let person: AppPerson
    let section: String
    let showSeat: Bool

    var body: some View {
        HStack(spacing: 10) {
            FaceView(
                name: person.name,
                photo: person.photo,
                mine: person.mine,
                size: 40,
                badge: section == "voces" ? nil : SeatGlyph.symbol(for: person.seat, section: section)
            )
            VStack(alignment: .leading, spacing: 1) {
                Text(person.name)
                    .font(.bsBody(15, .semibold))
                    .foregroundStyle(person.mine ? BS.positive : BS.ink)
                    .lineLimit(2)
                let seat = showSeat && !person.seat.isEmpty ? person.seat : nil
                if person.mine || seat != nil {
                    Text([person.mine ? "Tú" : nil, seat].compactMap { $0 }.joined(separator: " · "))
                        .font(.bsBody(12))
                        .foregroundStyle(person.mine ? BS.positive : BS.inkDim)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(person.mine ? "\(person.name), tú, \(person.seat)" : "\(person.name), \(person.seat)")
    }
}

// MARK: The service's page

struct ServiceDetailView: View {
    let service: AppService
    let today: String

    var body: some View {
        ScrollView {
            ServiceFullCard(service: service, today: today)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
        }
        .background(BS.base.ignoresSafeArea())
        .navigationTitle(service.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(BS.base, for: .navigationBar)
    }
}
