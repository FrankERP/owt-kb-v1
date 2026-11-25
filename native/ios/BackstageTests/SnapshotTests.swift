import SwiftUI
import UIKit
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
                HomeScreen(me: me, banner: nil, services: .loading, onlyMine: .constant(false), open: { _ in }, retry: {}),
                scheme: scheme, to: "\(dir)/3-cargando-\(suffix).png"
            )
            try render(
                ServiceFullCard(service: services[1], today: "2026-11-25").padding(16),
                scheme: scheme, to: "\(dir)/2-servicio-\(suffix).png"
            )
            try render(
                VStack(spacing: 0) {
                    TopBar(me: me) {}
                    LibraryScreen(catalogue: .loaded(Fixture.catalogue), query: .constant(""), open: { _ in }, retry: {})
                },
                scheme: scheme, to: "\(dir)/4-biblioteca-\(suffix).png"
            )
            try render(
                LibraryScreen(catalogue: .loaded(Fixture.catalogue), query: .constant("gra"), open: { _ in }, retry: {}),
                scheme: scheme, to: "\(dir)/5-buscar-\(suffix).png"
            )
            try render(
                SongPage(seed: SongSeed(Fixture.detail.song), load: .loaded(Fixture.detail), retry: {}),
                scheme: scheme, to: "\(dir)/6-cancion-\(suffix).png"
            )
            try render(
                SongPage(seed: SongSeed(Fixture.lyricOnly.song), load: .loaded(Fixture.lyricOnly), retry: {}),
                scheme: scheme, to: "\(dir)/7-letra-\(suffix).png"
            )
        }
    }

    /// Hosts the view in a real window and draws its layer tree: what the phone shows, fonts and
    /// dynamic colours resolved for `scheme`. (`ImageRenderer` timed out on this content.)
    private func render<V: View>(_ view: V, scheme: ColorScheme, to path: String) throws {
        let host = UIHostingController(rootView: view.frame(width: 393).background(BS.base))
        let style: UIUserInterfaceStyle = scheme == .dark ? .dark : .light
        host.overrideUserInterfaceStyle = style
        host.safeAreaRegions = []
        var size = host.sizeThatFits(in: CGSize(width: 393, height: 20_000))
        size.width = 393
        size.height = min(max(size.height, 100), 6_000)
        let window = UIWindow(frame: CGRect(origin: .zero, size: size))
        window.overrideUserInterfaceStyle = style
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = window.bounds
        host.view.setNeedsLayout()
        host.view.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.5))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 2
        format.opaque = true
        let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        window.isHidden = true
        let data = try XCTUnwrap(image.pngData(), "nothing drawn for \(path)")
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

    static func entry(_ title: String, original: String? = nil, artist: String, key: String, bpm: Int, added: String, tags: [String] = []) -> LibrarySong {
        LibrarySong(
            id: title, slug: title.lowercased().replacingOccurrences(of: " ", with: "-"), title: title, original: original,
            artist: artist, key: key, bpm: bpm, timeSig: "4/4", cover: nil, coverLarge: nil,
            tags: tags.map { SongTag(slug: $0.lowercased(), name: $0) }, addedAt: added
        )
    }

    static let catalogue: [LibrarySong] = [
        entry("Al que está sentado en el trono", artist: "Marcos Brunet", key: "D", bpm: 70, added: "2026-03-02T00:00:00Z"),
        entry("Cristo es mi vida", artist: "Su Presencia", key: "D", bpm: 74, added: "2026-11-20T00:00:00Z"),
        entry("Él es el Rey", artist: "Danilo Montero", key: "A", bpm: 120, added: "2026-02-11T00:00:00Z"),
        entry("Gracia sublime es", original: "This Is Amazing Grace", artist: "Elevation Worship", key: "A", bpm: 72, added: "2026-11-18T00:00:00Z", tags: ["Gracia"]),
        entry("Grande y fuerte", artist: "Miel San Marcos", key: "Bb", bpm: 132, added: "2026-05-01T00:00:00Z"),
        entry("León y Cordero", original: "Lion and The Lamb", artist: "Leeland", key: "G", bpm: 90, added: "2026-11-22T00:00:00Z"),
        entry("Nadie", artist: "Su Presencia", key: "D", bpm: 68, added: "2026-06-09T00:00:00Z"),
        entry("Tu fidelidad", artist: "Marcos Witt", key: "E", bpm: 70, added: "2026-01-15T00:00:00Z"),
        entry("10,000 razones", original: "10,000 Reasons", artist: "Matt Redman", key: "G", bpm: 73, added: "2026-04-04T00:00:00Z"),
    ]

    static let detail = SongDetail(
        song: catalogue[3],
        lyrics: nil,
        charts: [
            SongChart(key: "A", content: """
            # Verso 1
            [A]Quién rompe el poder del pe[D]cado
            Su a[F#m]mor es fuerte y pode[E]roso
            
            # Coro
            [A]Gracia sublime [D]es
            [F#m]Amor sin condi[E]ción
            [A] [D] [E]
            """, chordPro: true),
            SongChart(key: "G", content: "[G]Quién rompe el poder del pe[C]cado", chordPro: true),
        ],
        links: [
            SongLink(kind: "reference", label: "Escuchar la referencia", url: "https://example.com/a"),
            SongLink(kind: "tutorial", label: "Tutorial de guitarra", url: "https://example.com/b"),
        ]
    )

    static let lyricOnly = SongDetail(
        song: catalogue[7],
        lyrics: """
        # Verso
        Tu fidelidad es grande
        Tu fidelidad incomparable es
        
        # Coro
        Nadie como tú, bendito Dios (x2)
        Grande es tu fidelidad
        """,
        charts: [],
        links: []
    )

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
