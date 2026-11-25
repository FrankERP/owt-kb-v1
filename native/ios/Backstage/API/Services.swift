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

    var initial: String { String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased() }
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

    /// «Hoy», «Mañana», «En 5 días», «En 3 semanas».
    static func countdown(from today: String, to date: String) -> String? {
        guard let days = daysBetween(today, date), days >= 0 else { return nil }
        switch days {
        case 0: return "Hoy"
        case 1: return "Mañana"
        case 2..<14: return "En \(days) días"
        default: return "En \(days / 7) semanas"
        }
    }

    private static let longFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "es_MX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "EEEE d 'de' MMMM"
        return f
    }()

    private static let monthFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "es_MX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "MMM"
        return f
    }()

    /// «domingo 29 de noviembre».
    static func longLabel(_ iso: String) -> String {
        guard let date = parse(iso) else { return iso }
        return longFormatter.string(from: date)
    }

    /// The date tile: («29», «NOV»).
    static func tile(_ iso: String) -> (day: String, month: String) {
        guard let date = parse(iso) else { return ("", "") }
        let day = String(calendar.component(.day, from: date))
        let month = monthFormatter.string(from: date)
            .replacingOccurrences(of: ".", with: "")
            .uppercased()
        return (day, month)
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
