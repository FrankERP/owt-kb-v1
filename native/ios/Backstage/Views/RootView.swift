import AuthenticationServices
import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            switch model.phase {
            case .starting:
                ProgressView()
            case .signedOut(let notice):
                SignInView(notice: notice, busy: false)
            case .signingIn:
                SignInView(notice: nil, busy: true)
            case .signedIn(let me):
                HomeView(me: me)
            case .offline:
                OfflineView()
            }
        }
        .animation(.default, value: model.phase)
    }
}

struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    let notice: String?
    let busy: Bool

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            VStack(spacing: 8) {
                Text("Backstage")
                    .font(.largeTitle.weight(.bold))
                Text("Oasis Worship Team")
                    .font(.headline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let notice {
                Text(notice)
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.red)
            }
            Button {
                Task { await model.signIn(using: webAuthenticationSession) }
            } label: {
                Group {
                    if busy { ProgressView() } else { Text("Entrar") }
                }
                .frame(maxWidth: .infinity, minHeight: 28)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(busy)
            Text("Se abrirá la página de Backstage para que entres con tu cuenta y confirmes.")
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding(24)
        .frame(maxWidth: 480)
    }
}

struct HomeView: View {
    @Environment(AppModel.self) private var model
    let me: Me

    var body: some View {
        NavigationStack {
            List {
                if let banner = model.banner {
                    Section {
                        Label(banner, systemImage: "wifi.exclamationmark")
                            .foregroundStyle(.orange)
                    }
                }
                Section {
                    HStack(spacing: 16) {
                        Avatar(url: me.photoUrl.flatMap(URL.init(string:)), name: me.displayName)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Hola, \(me.displayName)")
                                .font(.title2.weight(.semibold))
                            Text(me.roleLabel)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 8)
                }
                Section("Tus ministerios") {
                    ForEach(me.ministryLabels, id: \.self) { Text($0) }
                }
                Section {
                    Text("Muy pronto verás aquí tus próximos servicios.")
                        .foregroundStyle(.secondary)
                }
                Section {
                    Button("Cerrar sesión", role: .destructive) {
                        Task { await model.signOut() }
                    }
                }
            }
            .navigationTitle("Backstage")
            .refreshable { await model.reload() }
        }
    }
}

private struct Avatar: View {
    let url: URL?
    let name: String

    var body: some View {
        AsyncImage(url: url) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Text(String(name.prefix(1)))
                .font(.title2.weight(.semibold))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.accentColor.opacity(0.2))
        }
        .frame(width: 56, height: 56)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

struct OfflineView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ContentUnavailableView {
            Label("Sin conexión", systemImage: "wifi.slash")
        } description: {
            Text(model.banner ?? "No pudimos conectar con Backstage.")
        } actions: {
            Button("Intentar de nuevo") { Task { await model.reload() } }
                .buttonStyle(.borderedProminent)
        }
    }
}
