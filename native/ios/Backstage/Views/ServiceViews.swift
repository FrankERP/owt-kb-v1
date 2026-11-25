import SwiftUI

// «Próximos servicios»: the row, the «Tu próximo servicio» card and the service's own page.
// The web's service card (ADR-0088) is the reference: faces for the team, album covers for the
// setlist, the key in rose. What the phone adds: the countdown, «Los míos», and your own seat
// marked on every face and row.

// MARK: Building blocks

/// A person as a photo, or their initial when there is none. Your own face carries a ring.
struct FaceView: View {
    let person: AppPerson
    var size: CGFloat = 32

    var body: some View {
        AsyncImage(url: person.photo.flatMap(URL.init(string:))) { phase in
            if let image = phase.image {
                image.resizable().scaledToFill()
            } else {
                Text(person.initial)
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.accentColor.opacity(0.15))
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(
            Circle().strokeBorder(person.mine ? Color.accentColor : Color(uiColor: .systemBackground), lineWidth: 2)
        )
        .accessibilityHidden(true)
    }
}

/// Up to `limit` overlapping faces, then «+N».
struct FaceStack: View {
    let people: [AppPerson]
    var limit = 5
    var size: CGFloat = 28

    var body: some View {
        HStack(spacing: -size * 0.3) {
            ForEach(Array(people.prefix(limit).enumerated()), id: \.offset) { _, person in
                FaceView(person: person, size: size)
            }
            if people.count > limit {
                Text("+\(people.count - limit)")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: size, height: size)
                    .background(Circle().fill(Color(uiColor: .secondarySystemFill)))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(people.count) personas en el equipo")
    }
}

/// A song's album cover, or a music note when it has none.
struct CoverView: View {
    let url: String?
    var size: CGFloat = 44

    var body: some View {
        AsyncImage(url: url.flatMap(URL.init(string:))) { phase in
            if let image = phase.image {
                image.resizable().scaledToFill()
            } else {
                Image(systemName: "music.note")
                    .font(.system(size: size * 0.4))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(uiColor: .secondarySystemFill))
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.18, style: .continuous))
        .accessibilityHidden(true)
    }
}

/// The calendar leaf: day number over the short month.
struct DateTileView: View {
    let date: String
    var highlighted = false

    var body: some View {
        let tile = ServiceDay.tile(date)
        VStack(spacing: 0) {
            Text(tile.month)
                .font(.caption2.weight(.bold))
                .foregroundStyle(highlighted ? Color.white.opacity(0.9) : Color.accentColor)
            Text(tile.day)
                .font(.title2.weight(.bold))
                .monospacedDigit()
                .foregroundStyle(highlighted ? Color.white : Color.primary)
        }
        .frame(width: 52, height: 56)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(highlighted ? Color.accentColor : Color(uiColor: .secondarySystemFill))
        )
        .accessibilityHidden(true)
    }
}

/// «Tú: Keys · BGV».
struct MySeatsLabel: View {
    let seats: [String]

    var body: some View {
        Label("Tú: \(seats.joined(separator: " · "))", systemImage: "person.fill.checkmark")
            .font(.caption.weight(.semibold))
            .foregroundStyle(Color.accentColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(Color.accentColor.opacity(0.12)))
    }
}

/// The musical key. Rose means the key and only the key, as on the web (ADR-0071).
struct KeyBadge: View {
    let key: String

    var body: some View {
        Text(key)
            .font(.subheadline.weight(.bold))
            .foregroundStyle(Color.pink)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Capsule().fill(Color.pink.opacity(0.12)))
            .accessibilityLabel("Tono \(key)")
    }
}

extension AppService {
    /// «Domingo · 11:00».
    var headline: String {
        [title, time].compactMap { $0 }.joined(separator: " · ")
    }
}

// MARK: The list row

struct ServiceRow: View {
    let service: AppService
    let today: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            DateTileView(date: service.date, highlighted: service.isMine)
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(service.headline)
                        .font(.headline)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if let countdown = ServiceDay.countdown(from: today, to: service.date) {
                        Text(countdown)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                if service.worshipNight {
                    Label("Noche de alabanza", systemImage: "sparkles")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }
                if service.isMine {
                    MySeatsLabel(seats: service.mySeats)
                }
                HStack(spacing: 10) {
                    if !service.people.isEmpty {
                        FaceStack(people: service.people)
                    }
                    Spacer(minLength: 0)
                    if service.songs.isEmpty {
                        Text("Setlist pendiente")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    } else {
                        HStack(spacing: -8) {
                            ForEach(Array(service.songs.prefix(3).enumerated()), id: \.offset) { _, song in
                                CoverView(url: song.cover, size: 28)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                                            .strokeBorder(Color(uiColor: .systemBackground), lineWidth: 1.5)
                                    )
                            }
                        }
                        Text("\(service.songs.count)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .accessibilityLabel("\(service.songs.count) canciones")
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

// MARK: «Tu próximo servicio»

struct NextServiceCard: View {
    let service: AppService
    let today: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("TU PRÓXIMO SERVICIO")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.accentColor)
                Spacer()
                if let countdown = ServiceDay.countdown(from: today, to: service.date) {
                    Text(countdown)
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(Color.accentColor.opacity(0.15)))
                }
            }
            Text(service.headline)
                .font(.title2.weight(.bold))
            Text(ServiceDay.longLabel(service.date).capitalizedFirst)
                .foregroundStyle(.secondary)
            MySeatsLabel(seats: service.mySeats)
            if !service.songs.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(service.songs.enumerated()), id: \.offset) { _, song in
                            CoverView(url: song.cover, size: 52)
                        }
                    }
                }
                .accessibilityHidden(true)
            }
        }
        .padding(.vertical, 6)
    }
}

extension String {
    /// «domingo 29 de noviembre» → «Domingo 29 de noviembre».
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

// MARK: The service's page

struct ServiceDetailView: View {
    let service: AppService
    let today: String

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(ServiceDay.longLabel(service.date).capitalizedFirst)
                            .font(.headline)
                        Spacer()
                        if let countdown = ServiceDay.countdown(from: today, to: service.date) {
                            Text(countdown)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    if let time = service.time {
                        Label(time, systemImage: "clock")
                            .foregroundStyle(.secondary)
                    }
                    if service.worshipNight {
                        Label("Noche de alabanza", systemImage: "sparkles")
                            .foregroundStyle(.secondary)
                    }
                    if service.isMine {
                        MySeatsLabel(seats: service.mySeats)
                    }
                }
                .padding(.vertical, 4)
            }

            if let message = service.pastorMessage {
                Section("Mensaje del pastor") {
                    Text(message)
                        .textSelection(.enabled)
                }
            }

            if let notes = service.teamNotes {
                Section("Notas para el equipo") {
                    Text(notes)
                        .textSelection(.enabled)
                }
            }

            Section {
                if service.songs.isEmpty {
                    Text("El setlist todavía no está listo.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(Array(service.songs.enumerated()), id: \.offset) { index, song in
                        SongRow(number: index + 1, song: song)
                    }
                }
            } header: {
                Text("Setlist")
            }

            ForEach(service.sections.filter { !$0.people.isEmpty }) { section in
                Section(section.label) {
                    ForEach(Array(section.people.enumerated()), id: \.offset) { _, person in
                        PersonRow(person: person)
                    }
                }
            }
        }
        .navigationTitle(service.title)
        .navigationBarTitleDisplayMode(.large)
    }
}

private struct SongRow: View {
    let number: Int
    let song: AppSong

    var body: some View {
        HStack(spacing: 12) {
            CoverView(url: song.cover, size: 48)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(song.title)
                        .font(.body.weight(.semibold))
                        .lineLimit(2)
                    if let medley = song.medley {
                        Text("Medley \(medley)")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Capsule().strokeBorder(Color.secondary.opacity(0.5)))
                    }
                }
                if let author = song.author {
                    Text(author)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if !song.leads.isEmpty {
                    Text("Dirige: \(song.leads.joined(separator: " y "))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let detail = details {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            Spacer(minLength: 4)
            if let key = song.key {
                KeyBadge(key: key)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(number). \(song.title)")
    }

    /// «72 bpm · 4/4 · Original A».
    private var details: String? {
        var parts: [String] = []
        if let bpm = song.bpm { parts.append("\(bpm) bpm") }
        if let timeSig = song.timeSig { parts.append(timeSig) }
        if let original = song.songKey, original != song.key { parts.append("Original \(original)") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

private struct PersonRow: View {
    let person: AppPerson

    var body: some View {
        HStack(spacing: 12) {
            FaceView(person: person, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(person.name)
                    .font(.body.weight(person.mine ? .semibold : .regular))
                Text(person.seat)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if person.mine {
                Text("Tú")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.accentColor)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Color.accentColor.opacity(0.12)))
            }
        }
        .accessibilityElement(children: .combine)
    }
}
