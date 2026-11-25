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
                Text("Oasis")
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
    @State private var onlyMine = false
    @State private var showingProfile = false

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
                    Text("Hola, \(me.displayName)")
                        .font(.title2.weight(.semibold))
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
                }
                servicesContent
            }
            .navigationTitle("Backstage")
            .navigationDestination(for: AppService.self) { service in
                ServiceDetailView(service: service, today: today)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingProfile = true
                    } label: {
                        Avatar(url: me.photoUrl.flatMap(URL.init(string:)), name: me.displayName, size: 32)
                    }
                    .accessibilityLabel("Tu perfil")
                }
            }
            .sheet(isPresented: $showingProfile) {
                ProfileSheet(me: me)
            }
            .refreshable { await model.reload() }
        }
    }

    /// The server's CDMX today, once the list has loaded.
    private var today: String {
        if case .loaded(let today, _) = model.services { return today }
        return ""
    }

    @ViewBuilder
    private var servicesContent: some View {
        switch model.services {
        case .loading:
            Section {
                HStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
            }
        case .notInWorship:
            Section {
                Text("Los servicios de Alabanza aparecen aquí cuando formas parte del equipo.")
                    .foregroundStyle(.secondary)
            }
        case .failed(let message):
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(message)
                        .foregroundStyle(.secondary)
                    Button("Intentar de nuevo") {
                        Task { await model.loadServices() }
                    }
                }
            }
        case .loaded(let today, let services):
            if let next = services.first(where: { $0.isMine }) {
                Section {
                    NavigationLink(value: next) {
                        NextServiceCard(service: next, today: today)
                    }
                }
            }
            Section {
                Picker("Mostrar", selection: $onlyMine) {
                    Text("Todos").tag(false)
                    Text("Los míos").tag(true)
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            let shown = onlyMine ? services.filter { $0.isMine } : services
            if shown.isEmpty {
                Section {
                    Text(onlyMine
                        ? "No tienes servicios asignados en los próximos tres meses."
                        : "Todavía no hay servicios publicados para los próximos tres meses.")
                        .foregroundStyle(.secondary)
                }
            }
            ForEach(ServiceMonth.group(shown)) { month in
                Section(month.title) {
                    ForEach(month.services) { service in
                        NavigationLink(value: service) {
                            ServiceRow(service: service, today: today)
                        }
                    }
                }
            }
        }
    }
}

private struct ProfileSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let me: Me

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 16) {
                        Avatar(url: me.photoUrl.flatMap(URL.init(string:)), name: me.displayName, size: 56)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(me.displayName)
                                .font(.title3.weight(.semibold))
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
                    Button("Cerrar sesión", role: .destructive) {
                        dismiss()
                        Task { await model.signOut() }
                    }
                }
            }
            .navigationTitle("Tu perfil")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Listo") { dismiss() }
                }
            }
        }
    }
}

private struct Avatar: View {
    let url: URL?
    let name: String
    var size: CGFloat = 56

    var body: some View {
        AsyncImage(url: url) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Text(String(name.prefix(1)))
                .font(.system(size: size * 0.42, weight: .semibold))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.accentColor.opacity(0.2))
        }
        .frame(width: size, height: size)
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
