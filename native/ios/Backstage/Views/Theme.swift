import SwiftUI
import UIKit

// Backstage's design system, ported from the web (app/brand.css, app/brandFonts.ts, ADR-0070,
// ADR-0071, ADR-0088) so the app and the web read as one product:
// - the navy surfaces and their light counterparts (the app follows the device, like the web);
// - three faces: Advent Pro for display, Urbanist for body, Jura for small-caps labels;
// - cyan for navigation and the Sunday, amber the Saturday, violet a special service — a DAY's
//   colour on its rail and its date leaf only; green is «tú» and nothing else; rose is the
//   musical key and nothing else (and inside a day card the key stays ink).

enum BS {
    private static func rgb(_ c: (Double, Double, Double)) -> UIColor {
        UIColor(red: c.0 / 255, green: c.1 / 255, blue: c.2 / 255, alpha: 1)
    }

    /// One role with its dark and light values (brand.css `:root` and its light branch).
    private static func role(dark: (Double, Double, Double), light: (Double, Double, Double)) -> Color {
        Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .light ? rgb(light) : rgb(dark)
        })
    }

    static let base = role(dark: (1, 11, 23), light: (245, 247, 250))
    /// `--surface-card`: the raised-alt navy in dark, white in light.
    static let card = role(dark: (10, 25, 41), light: (255, 255, 255))
    static let raised = role(dark: (13, 34, 52), light: (255, 255, 255))
    static let ink = role(dark: (215, 231, 246), light: (10, 25, 41))
    static let inkMuted = role(dark: (200, 216, 235), light: (31, 50, 71))
    static let inkDim = role(dark: (127, 148, 168), light: (74, 92, 114))
    static let accent = role(dark: (0, 191, 255), light: (0, 53, 114))
    static let warning = role(dark: (245, 158, 11), light: (120, 53, 15))
    static let info = role(dark: (167, 139, 250), light: (76, 29, 149))
    static let positive = role(dark: (55, 245, 138), light: (15, 107, 52))
    static let key = role(dark: (227, 155, 198), light: (163, 63, 117))

    /// `SHEET_TITLE`'s ink: ink-muted at 50 % in dark, 70 % in light.
    static let sheetTitle = Color(uiColor: UIColor { traits in
        let light = traits.userInterfaceStyle == .light
        return rgb(light ? (31, 50, 71) : (200, 216, 235)).withAlphaComponent(light ? 0.7 : 0.5)
    })

    /// `--brand-radius-panel`.
    static let panelRadius: CGFloat = 16
}

extension Font {
    /// Advent Pro 600, the display face: page titles, the day on a card, the date's number.
    static func bsDisplay(_ size: CGFloat, relativeTo style: Font.TextStyle = .title) -> Font {
        .custom("AdventPro-SemiBold", size: size, relativeTo: style)
    }

    enum BodyWeight { case regular, semibold, extrabold }

    /// Urbanist, the body face.
    static func bsBody(_ size: CGFloat, _ weight: BodyWeight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        let name: String
        switch weight {
        case .regular: name = "Urbanist-Regular"
        case .semibold: name = "Urbanist-SemiBold"
        case .extrabold: name = "Urbanist-ExtraBold"
        }
        return .custom(name, size: size, relativeTo: style)
    }

    /// Jura 600, the label face: small caps, widely tracked.
    static func bsLabel(_ size: CGFloat, relativeTo style: Font.TextStyle = .caption) -> Font {
        .custom("Jura-SemiBold", size: size, relativeTo: style)
    }
}

/// A day's colour (`SERVICE_TONE`): the rail and the date leaf's band, never anything else.
enum ServiceTone {
    case sunday, saturday, special

    init(_ kind: AppService.Kind) {
        switch kind {
        case .sunday: self = .sunday
        case .saturday: self = .saturday
        case .special: self = .special
        }
    }

    var color: Color {
        switch self {
        case .sunday: BS.accent
        case .saturday: BS.warning
        case .special: BS.info
        }
    }

    var wash: Color { color.opacity(self == .special ? 0.16 : 0.14) }
}

/// The section title of a sheet («SETLIST», «EQUIPO», «PRÓXIMO SERVICIO»): Jura, uppercase,
/// tracked 0.22 em, with an optional hairline to the edge and a count after it.
struct SheetTitle: View {
    let text: String
    var hairline = false
    var count: Int?

    var body: some View {
        HStack(spacing: 12) {
            Text(text.uppercased())
                .font(.bsLabel(12))
                .tracking(12 * 0.22)
                .foregroundStyle(BS.sheetTitle)
            if hairline {
                Rectangle()
                    .fill(BS.ink.opacity(0.10))
                    .frame(height: 1)
            }
            if let count {
                Text("\(count)")
                    .font(.bsLabel(12))
                    .monospacedDigit()
                    .foregroundStyle(BS.sheetTitle)
            }
        }
        .accessibilityAddTraits(.isHeader)
    }
}

/// `.brand-surface`: the opaque card with a hairline edge, a soft shadow and the panel radius,
/// with the day's 3 pt rail on its leading edge when a tone is given.
struct CardSurface: ViewModifier {
    var tone: ServiceTone?

    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(BS.card)
            .overlay(alignment: .leading) {
                if let tone {
                    Rectangle().fill(tone.color).frame(width: 3)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: BS.panelRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: BS.panelRadius, style: .continuous)
                    .strokeBorder(BS.ink.opacity(0.08), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.06), radius: 1, y: 1)
            .shadow(color: .black.opacity(0.05), radius: 6, y: 4)
    }
}

extension View {
    func cardSurface(tone: ServiceTone? = nil) -> some View { modifier(CardSurface(tone: tone)) }
}

/// The house button: cyan fill, base-coloured ink, the body face.
struct BrandButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.bsBody(17, .semibold))
            .foregroundStyle(BS.base)
            .padding(.horizontal, 20)
            .frame(minHeight: 50)
            .frame(maxWidth: .infinity)
            .background(Capsule().fill(BS.accent))
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
