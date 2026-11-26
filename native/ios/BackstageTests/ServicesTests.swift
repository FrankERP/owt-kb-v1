import XCTest
@testable import Backstage

final class ServicesDecodingTests: XCTestCase {
    /// The shape `GET /api/app/v1/services` answers (app/utils/appServices.ts), nulls included.
    private let json = """
    {
      "today": "2026-11-28",
      "services": [
        {
          "id": "sun-2026-11-29", "kind": "sunday", "date": "2026-11-29", "time": "11:00",
          "title": "Domingo", "worshipNight": false, "seated": true, "mySeats": ["Keys", "BGV"],
          "sections": [
            { "id": "voces", "label": "Voces", "people": [
              { "name": "Liu", "seat": "Lead", "photo": "https://cdn.sanity.io/x.jpg?w=144", "mine": false },
              { "name": "Frank", "seat": "BGV", "photo": null, "mine": true }
            ] },
            { "id": "banda", "label": "Banda", "people": [] },
            { "id": "cabina", "label": "Cabina", "people": [] }
          ],
          "songs": [
            { "id": "s1", "slug": "gracia", "title": "Gracia sublime", "author": null, "key": "G", "songKey": "A",
              "bpm": 72, "timeSig": null, "cover": null, "coverLarge": null, "medley": "A", "leads": [] }
          ],
          "teamNotes": null, "pastorMessage": "Dios es fiel"
        },
        {
          "id": "sp-1", "kind": "special", "date": "2026-12-05", "time": null, "title": "Servicio especial",
          "worshipNight": true, "seated": false, "mySeats": [], "sections": [], "songs": [], "teamNotes": null, "pastorMessage": null
        }
      ]
    }
    """

    func testDecodesTheServerShape() throws {
        let answer = try JSONDecoder().decode(ServicesResponse.self, from: Data(json.utf8))
        XCTAssertEqual(answer.today, "2026-11-28")
        XCTAssertEqual(answer.services.count, 2)
        let sunday = answer.services[0]
        XCTAssertEqual(sunday.kind, .sunday)
        XCTAssertTrue(sunday.isMine)
        XCTAssertEqual(sunday.mySeats, ["Keys", "BGV"])
        XCTAssertEqual(sunday.people.map(\.name), ["Liu", "Frank"])
        XCTAssertEqual(sunday.songs.first?.bpm, 72)
        XCTAssertEqual(sunday.headline, "Domingo · 11:00")
        let special = answer.services[1]
        XCTAssertFalse(special.isMine)
        XCTAssertTrue(special.worshipNight)
        XCTAssertNil(special.time)
        XCTAssertEqual(special.headline, "Servicio especial")
    }

    func testGroupsByMonthInOrder() throws {
        let answer = try JSONDecoder().decode(ServicesResponse.self, from: Data(json.utf8))
        let months = ServiceMonth.group(answer.services)
        XCTAssertEqual(months.map(\.id), ["2026-11", "2026-12"])
        XCTAssertEqual(months.map(\.title), ["Noviembre 2026", "Diciembre 2026"])
    }
}

final class ServiceDayTests: XCTestCase {
    func testCountsCalendarDaysAcrossMonthsAndYears() {
        XCTAssertEqual(ServiceDay.daysBetween("2026-11-28", "2026-11-28"), 0)
        XCTAssertEqual(ServiceDay.daysBetween("2026-11-30", "2026-12-01"), 1)
        XCTAssertEqual(ServiceDay.daysBetween("2026-12-31", "2027-01-03"), 3)
        XCTAssertNil(ServiceDay.daysBetween("2026-02-30", "2026-03-01"))
        XCTAssertNil(ServiceDay.daysBetween("", "2026-03-01"))
    }

    func testCountdownWords() {
        XCTAssertEqual(ServiceDay.countdown(from: "2026-11-28", to: "2026-11-28"), "Hoy")
        XCTAssertEqual(ServiceDay.countdown(from: "2026-11-28", to: "2026-11-29"), "Mañana")
        XCTAssertEqual(ServiceDay.countdown(from: "2026-11-28", to: "2026-12-05"), "En 7 días")
        XCTAssertEqual(ServiceDay.countdown(from: "2026-11-28", to: "2026-12-26"), "En 28 días")
        XCTAssertNil(ServiceDay.countdown(from: "2026-11-28", to: "2026-11-27"))
    }

    func testLabelsAreSpanishAndIgnoreThePhonesTimeZone() {
        XCTAssertEqual(ServiceDay.longLabel("2026-11-29"), "domingo 29 de noviembre")
        XCTAssertEqual(ServiceDay.longLabel("2026-11-29").capitalizedFirst, "Domingo 29 de noviembre")
        let leaf = ServiceDay.leaf("2026-11-29")
        XCTAssertEqual(leaf.weekday, "Dom")
        XCTAssertEqual(leaf.day, "29")
        XCTAssertEqual(leaf.month, "nov")
        XCTAssertEqual(ServiceDay.weekday("2026-11-28"), "sábado")
        XCTAssertEqual(joinNames(["Jakey"]), "Jakey")
        XCTAssertEqual(joinNames(["Ana", "Jakey", "Lali"]), "Ana, Jakey y Lali")
    }
}

final class ServiceEventTests: XCTestCase {
    private func service(date: String = "2026-11-29", time: String? = "11:00", seated: Bool = true, seats: [String] = ["Keys", "BGV"]) -> AppService {
        AppService(
            id: "x", kind: .sunday, date: date, time: time, title: "Domingo", worshipNight: false,
            seated: seated, mySeats: seats, sections: [], songs: [], teamNotes: nil, pastorMessage: nil
        )
    }

    func testATimedServiceStartsOnTheTeamsClockAndLastsTwoHours() throws {
        let event = try XCTUnwrap(ServiceEvent.make(service()))
        // 11:00 in Mexico City (UTC-6, no daylight saving) is 17:00 UTC, wherever the phone is.
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let parts = utc.dateComponents([.year, .month, .day, .hour, .minute], from: event.start)
        XCTAssertEqual([parts.year, parts.month, parts.day, parts.hour, parts.minute], [2026, 11, 29, 17, 0])
        XCTAssertEqual(event.end.timeIntervalSince(event.start), 7200)
        XCTAssertFalse(event.allDay)
    }

    func testAServiceWithNoUsableTimeTakesTheWholeDay() throws {
        for time in [nil, "", "25:00", "11", "once"] as [String?] {
            let event = try XCTUnwrap(ServiceEvent.make(service(time: time)))
            XCTAssertTrue(event.allDay, "\(time ?? "nil")")
            XCTAssertEqual(event.start, event.end)
        }
    }

    func testAWholeDayStaysOnItsDayForAPhoneFurtherWest() throws {
        let event = try XCTUnwrap(ServiceEvent.make(service(time: nil)))
        for zone in ["America/Los_Angeles", "America/Mexico_City", "Asia/Tokyo"] {
            var phone = Calendar(identifier: .gregorian)
            phone.timeZone = TimeZone(identifier: zone)!
            let parts = phone.dateComponents([.month, .day, .hour], from: event.wholeDay(on: phone))
            XCTAssertEqual([parts.month, parts.day, parts.hour], [11, 29, 12], zone)
        }
    }

    func testADateThatIsNotARealDayMakesNoEvent() {
        XCTAssertNil(ServiceEvent.make(service(date: "2026-02-30")))
        XCTAssertNil(ServiceEvent.make(service(date: "pronto")))
        XCTAssertNil(ServiceEvent.make(service(date: "")))
    }

    func testTheTitleAndNotesSayWhereTheCallerServes() throws {
        let mine = try XCTUnwrap(ServiceEvent.make(service()))
        XCTAssertEqual(mine.title, "⭐ Domingo · Keys, BGV · Oasis Worship")
        XCTAssertEqual(mine.notes, "Tu lugar: Keys, BGV\n\nCanciones\nSetlist pendiente")

        let unnamed = try XCTUnwrap(ServiceEvent.make(service(seats: [])))
        XCTAssertEqual(unnamed.title, "⭐ Domingo · Oasis Worship")
        XCTAssertTrue(unnamed.notes.hasPrefix("Te toca servir"))

        let other = try XCTUnwrap(ServiceEvent.make(service(seated: false, seats: [])))
        XCTAssertEqual(other.title, "Domingo · Oasis Worship")
        XCTAssertEqual(other.notes, "Canciones\nSetlist pendiente")
    }
}
