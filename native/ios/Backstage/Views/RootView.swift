import AuthenticationServices
import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            switch model.phase {
            case .starting:
                ProgressView()
                    .tint(BS.accent)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .signedOut(let notice):
                SignInView(notice: notice, busy: false)
            case .signingIn:
                SignInView(notice: nil, busy: true)
            case .signedIn(let me):
                MainTabs(me: me)
            case .offline:
                OfflineView()
            }
        }
        .background(BS.base.ignoresSafeArea())
        .tint(BS.accent)
        .animation(.default, value: model.phase)
    }
}

// MARK: Sign-in

struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    let notice: String?
    let busy: Bool

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            VStack(spacing: 14) {
                Image("BackstageMark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 88, height: 88)
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .accessibilityHidden(true)
                Text("BACKSTAGE")
                    .font(.bsDisplay(44))
                    .tracking(2)
                    .foregroundStyle(BS.ink)
                Text("OASIS")
                    .font(.bsLabel(13))
                    .tracking(13 * 0.22)
                    .foregroundStyle(BS.sheetTitle)
            }
            Spacer()
            if let notice {
                Text(notice)
                    .font(.bsBody(15))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(BS.warning)
            }
            Button {
                Task { await model.signIn(using: webAuthenticationSession) }
            } label: {
                if busy { ProgressView().tint(BS.base) } else { Text("Entrar") }
            }
            .buttonStyle(BrandButtonStyle())
            .disabled(busy)
            Text("Se abrirá la página de Backstage para que entres con tu cuenta y confirmes.")
                .font(.bsBody(14))
                .multilineTextAlignment(.center)
                .foregroundStyle(BS.inkDim)
        }
        .padding(24)
        .frame(maxWidth: 480)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BS.base.ignoresSafeArea())
    }
}

// MARK: The tabs

/// Inicio and the Biblioteca, each with its own stack, so going back in one never moves the
/// other. The Biblioteca is Alabanza's: someone outside it would only meet a refusal there.
/// The profile sheet lives here because both tabs' top bars open the same one.
struct MainTabs: View {
    let me: Me
    @State private var showingProfile = false

    var body: some View {
        Group {
            if me.ministries.contains("worship") || me.role == "super-admin" {
                TabView {
                    HomeView(me: me) { showingProfile = true }
                        .tabItem { Label("Inicio", systemImage: "house") }
                    LibraryView(me: me) { showingProfile = true }
                        .tabItem { Label("Biblioteca", systemImage: "music.note.list") }
                }
            } else {
                // One destination needs no tab bar.
                HomeView(me: me) { showingProfile = true }
            }
        }
        .sheet(isPresented: $showingProfile) {
            ProfileSheet(me: me)
        }
    }
}

// MARK: Inicio

struct HomeView: View {
    @Environment(AppModel.self) private var model
    let me: Me
    let profile: () -> Void
    @State private var onlyMine = false
    @State private var path: [Route] = []
    @State private var refreshes = 0
    @Namespace private var zoom

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                HomeScreen(
                    me: me,
                    banner: model.banner,
                    services: model.services,
                    onlyMine: $onlyMine,
                    zoom: zoom,
                    open: { path.append(.service($0)) },
                    retry: { Task { await model.retryServices() } }
                )
            }
            .background(BS.base.ignoresSafeArea())
            .safeAreaInset(edge: .top, spacing: 0) {
                TopBar(me: me, profile: profile)
            }
            .refreshable {
                await model.reload()
                refreshes += 1
            }
            .sensoryFeedback(.impact(weight: .light), trigger: refreshes)
            .sensoryFeedback(trigger: path) { old, new in
                new.count > old.count ? .impact(weight: .light) : nil
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { route in
                RouteDestination(route: route, today: today, zoom: zoom)
            }
        }
        // On the stack itself, so a service's page pushed onto it inherits both.
        .environment(\.openSong) { path.append(.song($0)) }
        .environment(\.songZoom, zoom)
    }

    /// The server's CDMX today, once the list has loaded.
    private var today: String {
        if case .loaded(let today, _) = model.services { return today }
        return model.lastToday
    }
}

/// The web's navbar: the mark, «BACKSTAGE» in small caps, the avatar that opens the profile.
struct TopBar: View {
    let me: Me
    let profile: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image("BackstageMark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 36, height: 36)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .accessibilityHidden(true)
                Spacer()
                Text("BACKSTAGE")
                    .font(.bsLabel(15))
                    .tracking(3)
                    .foregroundStyle(BS.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button(action: profile) {
                    FaceView(name: me.displayName, photo: me.photoUrl, size: 36)
                }
                .accessibilityLabel("Tu perfil")
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            Rectangle().fill(BS.ink.opacity(0.08)).frame(height: 1)
        }
        // The page shows through, blurred, as it slides under the bar; the navy veil keeps the
        // material from turning the system's grey.
        .background(BS.base.opacity(0.45).background(.ultraThinMaterial).ignoresSafeArea(edges: .top))
    }
}

/// Inicio's content, apart from the model so a test can draw it: the greeting, «Próximo
/// servicio» as the full card, then the services after it as folded cards by month.
struct HomeScreen: View {
    let me: Me
    let banner: String?
    let services: AppModel.Services
    @Binding var onlyMine: Bool
    /// The namespace a card grows out of into its page; none where nothing navigates (a test).
    var zoom: Namespace.ID?
    let open: (AppService) -> Void
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let banner {
                HStack(spacing: 10) {
                    Image(systemName: "wifi.exclamationmark")
                    Text(banner).font(.bsBody(14))
                }
                .foregroundStyle(BS.warning)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .leading) { Rectangle().fill(BS.warning).frame(width: 2) }
                .padding(.top, 16)
            }
            switch services {
            case .loading:
                greetingBlock(HomeGreeting(hello: helloLine, lead: "Hola", day: "", sub: nil, serviceID: nil), hideLead: true)
                ServicesSkeleton()
            case .notInWorship:
                greetingBlock(HomeGreeting(hello: helloLine, lead: "Bienvenido", day: "", sub: nil, serviceID: nil), hideLead: false)
                quiet("Los servicios de Alabanza aparecen aquí cuando formas parte del equipo.")
            case .failed(let message):
                greetingBlock(HomeGreeting(hello: helloLine, lead: "Hola", day: "", sub: nil, serviceID: nil), hideLead: true)
                VStack(alignment: .leading, spacing: 16) {
                    quiet(message)
                    Button("Intentar de nuevo", action: retry)
                        .buttonStyle(BrandButtonStyle())
                }
            case .loaded(let today, let list):
                loaded(today: today, list: list)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 48)
    }

    private var helloLine: String? {
        me.displayName.split(whereSeparator: \.isWhitespace).first.map { "Hola, \($0)" }
    }

    @ViewBuilder
    private func loaded(today: String, list: [AppService]) -> some View {
        let greeting = HomeGreeting.make(name: me.displayName, today: today, services: list)
        greetingBlock(greeting, hideLead: false, showSub: greeting.serviceID != list.first?.id)
        if let next = list.first {
            SheetTitle(text: "Próximo servicio", hairline: true)
                .padding(.top, 28)
                .padding(.bottom, 12)
            ServiceFullCard(service: next, today: today)
            let rest = Array(list.dropFirst()).filter { !onlyMine || $0.isMine }
            HStack(spacing: 12) {
                SheetTitle(text: "Después")
                Rectangle().fill(BS.ink.opacity(0.10)).frame(height: 1)
                MineFilter(onlyMine: $onlyMine)
            }
            .padding(.top, 40)
            .padding(.bottom, 4)
            if rest.isEmpty {
                quiet(onlyMine
                    ? "No tienes más servicios asignados en los próximos tres meses."
                    : "No hay más servicios publicados en los próximos tres meses.")
            }
            ForEach(ServiceMonth.group(rest)) { month in
                SheetTitle(text: month.title, count: month.services.count)
                    .padding(.top, 20)
                    .padding(.bottom, 10)
                VStack(spacing: 12) {
                    ForEach(month.services) { service in
                        Button { open(service) } label: {
                            ServiceFoldedCard(service: service, today: today)
                        }
                        .buttonStyle(CardPressStyle())
                        .zoomSource(id: service.id, in: zoom)
                    }
                }
            }
        } else {
            quiet("Todavía no hay servicios publicados para los próximos tres meses.")
        }
    }

    private func greetingBlock(_ greeting: HomeGreeting, hideLead: Bool, showSub: Bool = true) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let hello = greeting.hello {
                Text(hello)
                    .font(.bsBody(17))
                    .foregroundStyle(BS.inkMuted)
            }
            if !hideLead {
                (Text(greeting.lead).foregroundColor(BS.ink) + Text(greeting.day).foregroundColor(BS.positive))
                    .font(.bsDisplay(52, relativeTo: .largeTitle))
                    .lineSpacing(-6)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if showSub, let sub = greeting.sub, !sub.isEmpty {
                Text(sub)
                    .font(.bsBody(17))
                    .foregroundStyle(BS.ink)
                    .padding(.top, 4)
            }
        }
        .padding(.top, 28)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func quiet(_ text: String) -> some View {
        Text(text)
            .font(.bsBody(15))
            .foregroundStyle(BS.inkMuted)
            .padding(.vertical, 20)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// «Todos / Los míos» as two small-caps pills.
private struct MineFilter: View {
    @Binding var onlyMine: Bool

    var body: some View {
        HStack(spacing: 4) {
            pill("Todos", selected: !onlyMine) { onlyMine = false }
            pill("Los míos", selected: onlyMine) { onlyMine = true }
        }
        .fixedSize()
        .sensoryFeedback(.selection, trigger: onlyMine)
    }

    private func pill(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            withAnimation(.easeOut(duration: 0.2)) { action() }
        } label: {
            Text(title.uppercased())
                .font(.bsLabel(10))
                .tracking(1)
                .foregroundStyle(selected ? BS.accent : BS.inkDim)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Capsule().fill(selected ? BS.accent.opacity(0.12) : .clear))
                .overlay(Capsule().strokeBorder(selected ? BS.accent.opacity(0.35) : BS.ink.opacity(0.12), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A card that sinks a little under the finger.
struct CardPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// A card grows into its page and shrinks back into its place (iOS 18's zoom); on iOS 17 the
/// page slides in as before.
extension View {
    @ViewBuilder
    func zoomSource(id: String, in namespace: Namespace.ID?) -> some View {
        if #available(iOS 18.0, *), let namespace {
            matchedTransitionSource(id: id, in: namespace)
        } else {
            self
        }
    }

    @ViewBuilder
    func zoomDestination(id: String, in namespace: Namespace.ID) -> some View {
        if #available(iOS 18.0, *) {
            navigationTransition(.zoom(sourceID: id, in: namespace))
        } else {
            self
        }
    }
}

// MARK: A pushed page's close

/// A pushed page (a service, a song) has no system bar: an X floats over its top corner and
/// the page scrolls beneath it. No page in the stack shows the system's navigation bar, so
/// there is no bar to bring in and take out with each push — the one that stayed behind,
/// back button and title, when a page was opened and closed quickly through the zoom.
private struct ClosablePage: ViewModifier {
    @Environment(\.dismiss) private var dismiss

    func body(content: Content) -> some View {
        content
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) {
                HStack {
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(BS.ink)
                            .frame(width: 36, height: 36)
                            .background(.ultraThinMaterial, in: Circle())
                            .overlay(Circle().strokeBorder(BS.ink.opacity(0.10), lineWidth: 1))
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Cerrar")
                }
                .padding(.horizontal, 12)
                .padding(.top, 2)
            }
    }
}

extension View {
    func closablePage() -> some View { modifier(ClosablePage()) }
}

// MARK: Loading

/// The list's shape while it loads: the next service's card and two folded ones as quiet
/// blocks that breathe (the web's `Skeleton`), so the page doesn't jump when the data lands.
struct ServicesSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SheetTitle(text: "Próximo servicio", hairline: true)
                .padding(.top, 28)
                .padding(.bottom, 12)
            card(lines: 5)
            SkeletonBlock(width: 120, height: 12)
                .padding(.top, 40)
                .padding(.bottom, 14)
            VStack(spacing: 12) {
                card(lines: 2)
                card(lines: 2)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Cargando servicios")
    }

    private func card(lines: Int) -> some View {
        HStack(alignment: .top, spacing: 14) {
            SkeletonBlock(width: 58, height: 76, radius: 12)
            VStack(alignment: .leading, spacing: 10) {
                SkeletonBlock(width: 140, height: 20)
                SkeletonBlock(width: 70, height: 12)
                ForEach(0..<lines, id: \.self) { line in
                    SkeletonBlock(width: line.isMultiple(of: 2) ? 200 : 150, height: 12)
                }
            }
        }
        .padding(16)
        .cardSurface()
    }
}

struct SkeletonBlock: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var width: CGFloat?
    var height: CGFloat
    var radius: CGFloat = 6
    @State private var lit = false

    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(BS.ink.opacity(lit ? 0.12 : 0.06))
            .frame(width: width, height: height)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { lit = true }
            }
    }
}

// MARK: Profile

private struct ProfileSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let me: Me

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    HStack(spacing: 16) {
                        FaceView(name: me.displayName, photo: me.photoUrl, size: 64)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(me.displayName)
                                .font(.bsDisplay(30))
                                .foregroundStyle(BS.ink)
                            Text(me.roleLabel)
                                .font(.bsBody(15))
                                .foregroundStyle(BS.inkMuted)
                        }
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        SheetTitle(text: "Tus ministerios", hairline: true)
                        ForEach(me.ministryLabels, id: \.self) { label in
                            Text(label)
                                .font(.bsBody(17))
                                .foregroundStyle(BS.ink)
                                .padding(.vertical, 6)
                        }
                    }
                    Button(role: .destructive) {
                        dismiss()
                        Task { await model.signOut() }
                    } label: {
                        Text("Cerrar sesión")
                            .font(.bsBody(17, .semibold))
                            .foregroundStyle(BS.warning)
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .overlay(Capsule().strokeBorder(BS.warning.opacity(0.4), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
                .padding(20)
            }
            .background(BS.base.ignoresSafeArea())
            .navigationTitle("Tu perfil")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(BS.base, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Listo") { dismiss() }
                }
            }
        }
    }
}

// MARK: Offline

struct OfflineView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 32))
                .foregroundStyle(BS.inkDim)
            Text("SIN CONEXIÓN")
                .font(.bsLabel(13))
                .tracking(13 * 0.22)
                .foregroundStyle(BS.sheetTitle)
            Text(model.banner ?? "No pudimos conectar con Backstage.")
                .font(.bsBody(17))
                .multilineTextAlignment(.center)
                .foregroundStyle(BS.inkMuted)
            Button("Intentar de nuevo") { Task { await model.reload() } }
                .buttonStyle(BrandButtonStyle())
                .padding(.top, 8)
        }
        .padding(32)
        .frame(maxWidth: 480)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BS.base.ignoresSafeArea())
    }
}
