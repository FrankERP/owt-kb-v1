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
            // A mix playing: its row with the waveform, and the bar that follows it around.
            let playing = MixPlayer.fixture(track: Fixture.playingTrack, status: .playing, elapsed: 42, duration: 251)
            try render(
                VStack(spacing: 0) {
                    MixSection(detail: Fixture.detail).padding(20)
                    MiniPlayerBar(player: playing, track: Fixture.playingTrack, expand: {})
                        .padding(.horizontal, 12)
                        .padding(.bottom, 8)
                }
                .environment(playing),
                scheme: scheme, to: "\(dir)/8-ensayo-\(suffix).png"
            )
            // The full player the bar opens: the waveform to drag, and fifteen seconds either way.
            try render(
                MixPlayerSheet(player: playing).frame(height: 300).background(BS.card),
                scheme: scheme, to: "\(dir)/9-reproductor-\(suffix).png"
            )
            // A Lead's proposal: covers with their places, keys in rose, a medley, the notes and
            // the conversation.
            let editor = try JSONDecoder().decode(ProposalEditorResponse.self, from: Data(Fixture.proposalJSON.utf8))
            let proposal = ProposalDraftState(loaded: editor)
            try render(
                ProposalEditorContent(
                    service: services[1],
                    editor: editor,
                    draft: .constant(proposal),
                    covers: [:],
                    messages: editor.proposal?.messages ?? [],
                    showsPastorField: true,
                    threadOpen: true
                )
                .padding(16),
                scheme: scheme, to: "\(dir)/10-propuesta-\(suffix).png"
            )
            // An admin's «Propuestas» (A-W1): the queue, then one proposal with its songs, notes,
            // conversation and the decisions; and the same one after a lead changed it.
            let reviewList = try JSONDecoder().decode(AdminProposalsResponse.self, from: Data(Fixture.adminProposalsJSON.utf8)).proposals
            try render(
                VStack(spacing: 0) {
                    TopBar(me: me) {}
                    AdminProposalList(proposals: .loaded(reviewList), filter: .constant(.pending), open: { _ in }, retry: {})
                },
                scheme: scheme, to: "\(dir)/11-admin-propuestas-\(suffix).png"
            )
            var review = ProposalReviewState(proposal: reviewList[0])
            try render(
                AdminProposalContent(
                    state: .constant(review), covers: [:], note: nil, reloading: false,
                    decide: { _ in }, reload: {}, postMessage: { _ in .notSent }, verifyThread: { nil }
                )
                .padding(16),
                scheme: scheme, to: "\(dir)/12-admin-revisar-\(suffix).png"
            )
            var changed = reviewList[0]
            changed = AdminProposal(
                id: changed.id, rev: "r2", status: changed.status, service: changed.service,
                leadName: changed.leadName, coLeads: changed.coLeads, songs: Array(changed.songs.reversed()),
                pastorMessage: changed.pastorMessage, teamNotes: changed.teamNotes,
                messages: changed.messages, earlierMessages: changed.earlierMessages, threadOpen: changed.threadOpen
            )
            review.apply([changed])
            try render(
                AdminProposalContent(
                    state: .constant(review), covers: [:], note: nil, reloading: false,
                    decide: { _ in }, reload: {}, postMessage: { _ in .notSent }, verifyThread: { nil }
                )
                .padding(16),
                scheme: scheme, to: "\(dir)/13-admin-cambio-\(suffix).png"
            )
            try render(
                DecisionSheetView(action: .approve, proposal: reviewList[0], confirm: { _ in .close }),
                scheme: scheme, to: "\(dir)/14-admin-aprobar-\(suffix).png"
            )
            // An admin's «Mensajes del servicio» (A-W2): filled; empty with no setlist yet; and a
            // past service whose conversation closed.
            let screens: [(String, String)] = [
                ("15-mensajes-servicio", ServiceMessagesTests.readJSON),
                ("16-mensajes-vacio", Fixture.serviceMessagesEmptyJSON),
                ("17-mensajes-sin-setlist", Fixture.serviceMessagesNoSetlistJSON),
                ("18-mensajes-cerrado", Fixture.serviceMessagesClosedJSON),
            ]
            for (name, json) in screens {
                let data = try JSONDecoder().decode(ServiceMessages.self, from: Data(json.utf8))
                try render(
                    ServiceMessagesContent(
                        state: ServiceMessagesState(data: data), generation: 0, threadNotice: nil,
                        savePastor: { _, _ in .saved }, saveTeamNotes: { _, _ in .saved }, move: { _, _ in .saved },
                        reload: {}, post: { _ in .notSent }, verify: { nil }, actions: { _ in [] }, outboxChanged: { _ in }
                    )
                    .padding(16),
                    scheme: scheme, to: "\(dir)/\(name)-\(suffix).png"
                )
            }
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
    static let serviceMessagesEmptyJSON = """
    {"service":{"id":"sun-6","kind":"sunday","date":"2026-12-06","title":"Domingo","published":true,"leads":[]},
     "open":true,"pastorMessage":null,"teamNotes":{"text":"","observed":{"id":"featuredSongs.sun-6","rev":"r1"}},
     "proposal":null,"serviceMessages":[],"proposalMessages":[]}
    """
    static let serviceMessagesNoSetlistJSON = """
    {"service":{"id":"sun-13","kind":"sunday","date":"2026-12-13","title":"Domingo","published":true,"leads":["Luis"]},
     "open":true,"pastorMessage":{"body":"Domingo de Santa Cena.","authorName":"Frank","at":"2026-11-28T10:00:00.000Z","editedAt":null,"stamp":"2026-11-28T10:00:00.000Z"},
     "teamNotes":null,"proposal":null,"serviceMessages":[],"proposalMessages":[]}
    """
    static let serviceMessagesClosedJSON = """
    {"service":{"id":"spc-1","kind":"special","date":"2026-11-20","title":"Noche de alabanza","published":true,"leads":["Ana"]},
     "open":false,"pastorMessage":null,
     "teamNotes":{"text":"","observed":{"id":"spc-1","rev":"r3"}},"proposal":{"status":"approved","offeredPastorMessage":null},
     "serviceMessages":[{"key":"k1","authorName":"Frank","authorRole":"admin","kind":"admin_change_request","body":"Gracias a todos por hoy.","at":"2026-11-20T22:00:00Z","editedAt":null,"mine":true,"editable":false}],
     "proposalMessages":[]}
    """
    static let adminProposalsJSON = """
    {"proposals":[
      {"id":"setlistProposal.a","rev":"r1","status":"pending","service":{"kind":"sunday","date":"2026-11-29","title":"Domingo"},
       "leadName":"Luis Pérez","coLeads":["Sara"],
       "songs":[
         {"songId":"s1","title":"Gracia Sublime Es","author":"Bethel Music","key":"G","playKey":"A","medleyTag":null},
         {"songId":"s2","title":"Way Maker","author":"Sinach","key":"E","playKey":"D","medleyTag":"A"},
         {"songId":"s3","title":"Tu Fidelidad","author":"Marcos Witt","key":"C","playKey":"C","medleyTag":"A"}
       ],
       "pastorMessage":"Domingo de Santa Cena: terminamos con una canción tranquila.",
       "teamNotes":"Llegar a las 9:00 para prueba de sonido.",
       "messages":[
         {"key":"m1","authorName":"Luis Pérez","authorRole":"lead","kind":"lead_note","body":"Propongo cerrar con Tu Fidelidad.","at":"2026-11-26T18:00:00Z","editedAt":null,"mine":false},
         {"key":"m2","authorName":"Frank","authorRole":"admin","kind":"admin_change_request","body":"¿Podemos bajar Way Maker a D?","at":"2026-11-26T19:00:00Z","editedAt":null,"mine":true}
       ],
       "earlierMessages":[],"threadOpen":true},
      {"id":"setlistProposal.b","rev":"r1","status":"pending","service":{"kind":"special","date":"2026-12-05","title":"Noche de alabanza"},
       "leadName":"Ana","coLeads":[],"songs":[],"pastorMessage":null,"teamNotes":null,"messages":[],"earlierMessages":[],"threadOpen":true},
      {"id":"setlistProposal.c","rev":"r1","status":"changes_requested","service":{"kind":"saturday","date":"2026-11-28","title":"Sábado"},
       "leadName":"Sara","coLeads":[],"songs":[],"pastorMessage":null,"teamNotes":null,"messages":[],"earlierMessages":[],"threadOpen":true}
    ]}
    """
    static let proposalJSON = """
    {
      "role": { "id": "sun-6", "kind": "sunday", "date": "2026-12-06", "title": "Domingo" },
      "observed": { "state": "single", "id": "setlistProposal.sun-6", "rev": "rev-1" },
      "proposal": {
        "status": "draft",
        "songs": [
          { "songId": "a", "title": "Santo por siempre", "author": "Chris Tomlin", "key": "Db", "play_key": "Db", "medley_tag": null, "previous_keys": ["Db", "C"] },
          { "songId": "b", "title": "Por siempre cantaré", "author": "Bethel Music", "key": "A", "play_key": "G", "medley_tag": "t1", "previous_keys": [] },
          { "songId": "c", "title": "Amor sin condición", "author": "Su Presencia", "key": "G", "play_key": "G", "medley_tag": "t1", "previous_keys": ["G"] },
          { "songId": "d", "title": "Dios de imposibles", "author": "Toque de Fe", "key": "G", "play_key": "A", "medley_tag": null, "previous_keys": [] }
        ],
        "contributors": [{ "name": "Frank", "mine": true }, { "name": "Lali", "mine": false }],
        "teamNotes": "Entramos con la banda completa desde el inicio.", "pastorMessage": "", "adminNotes": null,
        "messages": [
          { "key": "k1", "authorName": "Frank", "authorRole": "lead", "kind": "lead_note", "body": "¿Podemos cerrar con Dios de imposibles?", "at": "2026-11-26T18:00:00Z", "editedAt": null, "mine": true },
          { "key": "k2", "authorName": "Ana", "authorRole": "admin", "kind": "admin_message", "body": "Sí, me parece bien.", "at": "2026-11-27T10:00:00Z", "editedAt": null, "mine": false }
        ]
      },
      "serviceThread": { "messages": [], "pastorMessage": "Hablaremos de la fidelidad de Dios." }
    }
    """

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
        ],
        mixes: [
            mix("full", "Banda completa", "full", "Banda completa", seed: 1),
            mix("keys1", "Keys 1", "keys", "Teclado", seed: 2),
            mix("keys2", "Keys 2", "keys", "Teclado", seed: 3),
            mix("drums", "Drums", "drums", "Batería", seed: 4),
            mix("eg1", "EG 1", "electric", "Guitarra eléctrica", seed: 5),
            mix("eg2", "EG 2", "electric", "Guitarra eléctrica", seed: 6),
            mix("full-g", "Banda completa", "full", "Banda completa", tone: "G", seed: 7),
        ],
        preferredFamily: "electric"
    )

    /// A waveform that looks like one: two swells, never the same for two mixes.
    static func mix(_ key: String, _ label: String, _ family: String, _ familyLabel: String, tone: String = "A", seed: Int) -> SongMix {
        let bars = (0..<60).map { i -> Int in
            let x = Double(i)
            let swell = 55 + 35 * sin(x / 9 + Double(seed)) * cos(x / 23)
            let grain = Double((i * 37 + seed * 11) % 17) - 8
            return Int(min(100, max(8, swell + grain)))
        }
        return SongMix(key: key, label: label, family: family, familyLabel: familyLabel, tone: tone, bars: bars)
    }

    static let playingTrack = MixPlayer.Track(
        slug: detail.song.slug, mixKey: "eg1", title: detail.song.title, label: "EG 1", artist: detail.song.artist, cover: nil,
        bars: (0..<60).map { 30 + ($0 * 37) % 60 }
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
