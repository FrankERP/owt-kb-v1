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
        XCTAssertEqual(ServiceDay.countdown(from: "2026-11-28", to: "2026-12-26"), "En 4 semanas")
        XCTAssertNil(ServiceDay.countdown(from: "2026-11-28", to: "2026-11-27"))
    }

    func testLabelsAreSpanishAndIgnoreThePhonesTimeZone() {
        XCTAssertEqual(ServiceDay.longLabel("2026-11-29"), "domingo 29 de noviembre")
        XCTAssertEqual(ServiceDay.longLabel("2026-11-29").capitalizedFirst, "Domingo 29 de noviembre")
        let tile = ServiceDay.tile("2026-11-29")
        XCTAssertEqual(tile.day, "29")
        XCTAssertEqual(tile.month, "NOV")
    }
}
