import SwiftUI
import XCTest
@testable import Backstage

/// Draws Inicio and a service's page with made-up data, in dark and light, to PNG files the iOS
/// workflow uploads as an artifact — the only way to SEE the app from a session that cannot run
/// a Simulator. Skipped unless `SNAPSHOT_DIR` is set (`TEST_RUNNER_SNAPSHOT_DIR` on xcodebuild).
/// Photos and covers are remote, so they draw as their initials and notes here.
@MainActor
final class SnapshotTests: XCTestCase {
    func testDrawsTheScreens() throws {
        guard let dir = ProcessInfo.processInfo.environment["SNAPSHOT_DIR"], !dir.isEmpty else {
            throw XCTSkip("SNAPSHOT_DIR is not set")
        }
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let me = Me(id: "me", name: "Francisco", alias: "Frank", photoUrl: nil, role: "super-admin", ministries: ["worship", "jovenes"])
        let services = Fixture.services
        for (scheme, suffix) in [(ColorScheme.dark, "dark"), (ColorScheme.light, "light")] {
            try render(
                VStack(spacing: 0) {
                    TopBar(me: me) {}
                    HomeScreen(me: me, banner: nil, services: .loaded(today: "2026-11-25", services: services), onlyMine: .constant(false), open: { _ in }, retry: {})
                },
                scheme: scheme, to: "\(dir)/1-inicio-\(suffix).png"
            )
            try render(
                ServiceFullCard(service: services[1], today: "2026-11-25").padding(16),
                scheme: scheme, to: "\(dir)/2-servicio-\(suffix).png"
            )
        }
    }

    private func render<V: View>(_ view: V, scheme: ColorScheme, to path: String) throws {
        let content = view
            .frame(width: 393)
            .background(BS.base)
            .environment(\.colorScheme, scheme)
        let renderer = ImageRenderer(content: content)
        renderer.scale = 2
        let data = try XCTUnwrap(renderer.uiImage?.pngData(), "nothing drawn for \(path)")
        try data.write(to: URL(fileURLWithPath: path))
    }
}

private enum Fixture {
    static func person(_ name: String, _ seat: String, mine: Bool = false) -> AppPerson {
        AppPerson(name: name, seat: seat, photo: nil, mine: mine)
    }

    static func song(_ title: String, _ author: String, key: String, original: String? = nil, bpm: Int?, medley: String? = nil) -> AppSong {
        AppSong(id: title, slug: nil, title: title, author: author, key: key, songKey: original ?? key, bpm: bpm, timeSig: nil, cover: nil, coverLarge: nil, medley: medley, leads: [])
    }

    static let team: [AppSection] = [
        AppSection(id: "voces", label: "Voces", people: [
            person("Jakey", "Lead"), person("Lali", "Lead"),
            person("Noemí", "BGV"), person("Pato", "BGV"), person("Gaby", "BGV"),
            person("Mimí", "Coro"),
        ]),
        AppSection(id: "banda", label: "Banda", people: [
            person("Mkz", "Keys"), person("Tony", "Drums"), person("Frank", "EG", mine: true), person("Vega", "AG"), person("Toño", "Bass"),
        ]),
        AppSection(id: "cabina", label: "Cabina", people: [person("Pau", "Console")]),
    ]

    static let services: [AppService] = [
        AppService(
            id: "sun-29", kind: .sunday, date: "2026-11-29", time: "11:00", title: "Domingo", worshipNight: false,
            seated: true, mySeats: ["EG"], sections: team, songs: [], teamNotes: nil, pastorMessage: nil
        ),
        AppService(
            id: "sat-5", kind: .saturday, date: "2026-12-05", time: "18:00", title: "Sábado", worshipNight: false,
            seated: true, mySeats: ["EG"], sections: team,
            songs: [
                song("Gracia sublime es", "Elevation Worship", key: "G", original: "A", bpm: 72),
                song("Nadie", "Su Presencia", key: "D", bpm: 68, medley: "A"),
                song("Cristo es mi vida", "Su Presencia", key: "D", bpm: 74, medley: "A"),
                song("Tu fidelidad", "Marcos Witt", key: "E", bpm: 70),
            ],
            teamNotes: "Llegar 9:30 para prueba de sonido.",
            pastorMessage: "Este domingo hablamos de la fidelidad de Dios en el desierto."
        ),
        AppService(
            id: "sp-12", kind: .special, date: "2026-12-12", time: "19:00", title: "Noche de alabanza", worshipNight: true,
            seated: false, mySeats: [], sections: team, songs: [song("Way Maker", "Sinach", key: "E", bpm: 68)], teamNotes: nil, pastorMessage: nil
        ),
    ]
}
