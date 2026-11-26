import Foundation

/// `GET /api/app/v1/services` (app/utils/appServices.ts): the worship services from today (CDMX)
/// through the next 95 days. `today` is the SERVER's CDMX date, so «Hoy» and «Mañana» agree with
/// the web whatever time zone the phone is in.
struct ServicesResponse: Decodable, Equatable, Sendable {
    let today: String
    let services: [AppService]
}

struct AppService: Decodable, Hashable, Identifiable, Sendable {
    enum Kind: String, Decodable, Sendable {
        case sunday, saturday, special
    }

    let id: String
    let kind: Kind
    /// `YYYY-MM-DD`, a calendar day: never turned into an instant.
    let date: String
    /// `HH:mm`, display and order only.
    let time: String?
    let title: String
    let worshipNight: Bool
    /// The caller holds a seat here (decided on the server by member id), even one with no name.
    let seated: Bool
    /// The caller's named seats («Keys», «BGV», «FOH: Console»…).
    let mySeats: [String]
    let sections: [AppSection]
    let songs: [AppSong]
    let teamNotes: String?
    let pastorMessage: String?

    var isMine: Bool { seated }

    /// Who leads, for the folded card's «Lead Jakey y Lali».
    var leads: [AppPerson] { sections.first { $0.id == "voces" }?.people.filter { $0.seat == "Lead" } ?? [] }

    /// Everyone on the service, in section order, for the face stack.
    var people: [AppPerson] { sections.flatMap(\.people) }
}

struct AppSection: Decodable, Hashable, Identifiable, Sendable {
    let id: String
    let label: String
    let people: [AppPerson]
}

struct AppPerson: Decodable, Hashable, Sendable {
    let name: String
    let seat: String
    let photo: String?
    let mine: Bool

    /// The web's `initialsOf`: the first two letters of the name.
    var initials: String {
        let two = String(name.trimmingCharacters(in: .whitespaces).prefix(2)).uppercased()
        return two.isEmpty ? "?" : two
    }
}

struct AppSong: Decodable, Hashable, Sendable {
    let id: String?
    let slug: String?
    let title: String
    let author: String?
    /// The key the team plays it in this service.
    let key: String?
    /// The song's original key.
    let songKey: String?
    let bpm: Int?
    let timeSig: String?
    let cover: String?
    let coverLarge: String?
    let medley: String?
    /// On a Noche de alabanza, who leads this song.
    let leads: [String]
}

/// Calendar-day arithmetic on `YYYY-MM-DD` strings, done in UTC so no device time zone or
/// daylight-saving change can move a day (the web's «local noon» rule, in date-only form).
enum ServiceDay {
    private static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    static func parse(_ iso: String) -> Date? {
        let parts = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        let components = DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)
        guard let date = calendar.date(from: components),
              calendar.component(.day, from: date) == parts[2],
              calendar.component(.month, from: date) == parts[1]
        else { return nil }
        return date
    }

    /// Whole days from `today` to `date`; nil when either is not a real date.
    static func daysBetween(_ today: String, _ date: String) -> Int? {
        guard let a = parse(today), let b = parse(date) else { return nil }
        return calendar.dateComponents([.day], from: a, to: b).day
    }

    /// «Hoy», «Mañana», «En 5 días»: the web's `formatCountdown`, word for word.
    static func countdown(from today: String, to date: String) -> String? {
        guard let days = daysBetween(today, date), days >= 0 else { return nil }
        switch days {
        case 0: return "Hoy"
        case 1: return "Mañana"
        default: return "En \(days) días"
        }
    }

    private static let weekdays = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
    private static let weekdaysShort = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]
    private static let monthsShort = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

    /// «domingo», for «Te toca el domingo».
    static func weekday(_ iso: String) -> String {
        guard let date = parse(iso) else { return "" }
        return weekdays[calendar.component(.weekday, from: date) - 1]
    }

    /// The date leaf's three parts, as the web's `DateTile` draws them: («Dom», «29», «nov»).
    static func leaf(_ iso: String) -> (weekday: String, day: String, month: String) {
        guard let date = parse(iso) else { return ("", "", "") }
        return (
            weekdaysShort[calendar.component(.weekday, from: date) - 1],
            String(calendar.component(.day, from: date)),
            monthsShort[calendar.component(.month, from: date) - 1]
        )
    }

    private static let longFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "es_MX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "EEEE d 'de' MMMM"
        return f
    }()

    /// «domingo 29 de noviembre».
    static func longLabel(_ iso: String) -> String {
        guard let date = parse(iso) else { return iso }
        return longFormatter.string(from: date)
    }

    /// «Noviembre 2026», the list's month headers.
    static func monthHeader(_ iso: String) -> String {
        guard let date = parse(iso) else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "es_MX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "LLLL yyyy"
        return f.string(from: date).capitalized(with: Locale(identifier: "es_MX"))
    }
}

/// «Jakey», «Jakey y Lali», «Ana, Jakey y Lali»: the web's `joinNames`.
func joinNames(_ names: [String]) -> String {
    guard names.count > 1 else { return names.first ?? "" }
    return names.dropLast().joined(separator: ", ") + " y " + names[names.count - 1]
}

/// The services grouped by month, in order, for the list's section headers.
struct ServiceMonth: Identifiable, Hashable {
    let id: String
    let title: String
    let services: [AppService]

    static func group(_ services: [AppService]) -> [ServiceMonth] {
        var months: [ServiceMonth] = []
        for service in services {
            let key = String(service.date.prefix(7))
            if let last = months.last, last.id == key {
                months[months.count - 1] = ServiceMonth(id: key, title: last.title, services: last.services + [service])
            } else {
                months.append(ServiceMonth(id: key, title: ServiceDay.monthHeader(service.date), services: [service]))
            }
        }
        return months
    }
}

/// Inicio's greeting (the web's `homeGreeting`): «Hola, Frank» over «Te toca el domingo», the
/// day in green; the line under it says the rest when the card below is another service.
struct HomeGreeting: Equatable {
    let hello: String?
    let lead: String
    let day: String
    let sub: String?
    /// The service the greeting speaks of, so the page can tell whether it is the card below.
    let serviceID: String?

    static func make(name: String?, today: String, services: [AppService]) -> HomeGreeting {
        let first = name?.split(whereSeparator: \.isWhitespace).first.map(String.init)
        let hello = first.map { "Hola, \($0)" }
        guard let mine = services.first(where: { $0.isMine }),
              let days = ServiceDay.daysBetween(today, mine.date)
        else {
            return HomeGreeting(hello: hello, lead: "Esta vez no te toca", day: "", sub: nil, serviceID: nil)
        }
        let lead: String
        let day: String
        switch days {
        case 0: (lead, day) = ("Te toca ", "hoy")
        case 1: (lead, day) = ("Te toca ", "mañana")
        case 2..<7: (lead, day) = ("Te toca el ", ServiceDay.weekday(mine.date))
        default: (lead, day) = ("Te toca el ", "\(ServiceDay.weekday(mine.date)) \(ServiceDay.leaf(mine.date).day)")
        }
        let weekend = mine.kind != .special
        var parts: [String] = []
        if !weekend { parts.append(mine.headline) }
        if !mine.mySeats.isEmpty { parts.append(mine.mySeats.joined(separator: " · ")) }
        if weekend, let time = mine.time { parts.append(time) }
        if days >= 2 { parts.append("en \(days) días") }
        if !mine.songs.isEmpty { parts.append(mine.songs.count == 1 ? "1 canción" : "\(mine.songs.count) canciones") }
        return HomeGreeting(hello: hello, lead: lead, day: day, sub: parts.joined(separator: " · "), serviceID: mine.id)
    }
}

extension AppService {
    /// «Domingo · 11:00».
    var headline: String {
        [title, time].compactMap { $0 }.joined(separator: " · ")
    }
}

extension String {
    /// «domingo 29 de noviembre» → «Domingo 29 de noviembre».
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

// MARK: A service on the phone's calendar (app/utils/calendarFeed.ts)

/// What «Agregar al calendario» writes: the web feed's event for the same service, so a service
/// reads the same whichever way it reached the calendar.
struct ServiceEvent: Equatable {
    /// The team's wall clock, wherever the phone is.
    static let zone = TimeZone(identifier: "America/Mexico_City")!

    let title: String
    let notes: String
    let start: Date
    let end: Date
    /// A service with no time of its own takes the whole day.
    let allDay: Bool

    /// Nil for a date that is not a real day.
    static func make(_ service: AppService) -> ServiceEvent? {
        let day = service.date.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard day.count == 3 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let clock = (service.time ?? "").split(separator: ":").compactMap { Int($0) }
        let timed = clock.count == 2 && (0...23).contains(clock[0]) && (0...59).contains(clock[1])
        var parts = DateComponents(year: day[0], month: day[1], day: day[2])
        if timed {
            parts.hour = clock[0]
            parts.minute = clock[1]
        }
        guard let start = calendar.date(from: parts),
              calendar.component(.day, from: start) == day[2],
              calendar.component(.month, from: start) == day[1]
        else { return nil }
        // Two hours, the feed's length; an all-day event ends the day it starts.
        let end = timed ? start.addingTimeInterval(2 * 60 * 60) : start

        let seat = service.mySeats.joined(separator: ", ")
        let title = service.seated
            ? "⭐ \(service.title)\(seat.isEmpty ? "" : " · \(seat)") · Oasis Worship"
            : "\(service.title) · Oasis Worship"
        var notes: [String] = []
        if service.seated { notes += [seat.isEmpty ? "Te toca servir" : "Tu lugar: \(seat)", ""] }
        notes.append("Canciones")
        notes += service.songs.isEmpty
            ? ["Setlist pendiente"]
            : service.songs.map { song in song.key.map { "\(song.title) (\($0))" } ?? song.title }
        return ServiceEvent(title: title, notes: notes.joined(separator: "\n"), start: start, end: end, allDay: !timed)
    }
}
