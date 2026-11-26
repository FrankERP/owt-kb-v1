import SwiftUI

@main
struct BackstageApp: App {
    @State private var model = AppModel.live()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(model.player)
                .task { await model.start() }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active {
                        Task { await model.refreshIfStale() }
                    }
                }
        }
    }
}
