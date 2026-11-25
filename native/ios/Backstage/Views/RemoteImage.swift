import SwiftUI
import UIKit

/// Photos and album covers, kept: a decoded copy in memory for this run and the bytes on disk
/// for the next, so a face is there the moment its card is — and with no signal. `AsyncImage`
/// keeps nothing and fetched every picture again on every launch.
///
/// The URLs are Sanity's CDN's, which name an asset by its content hash and its size: the same
/// URL is the same picture for ever, so a kept copy is never stale and is read before the
/// network (`returnCacheDataElseLoad`). A changed photo arrives under a new URL.
final class ImageStore: @unchecked Sendable {
    static let shared = ImageStore()

    private let memory = NSCache<NSURL, UIImage>()
    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 8 << 20, diskCapacity: 256 << 20)
        config.requestCachePolicy = .returnCacheDataElseLoad
        session = URLSession(configuration: config)
        memory.countLimit = 400
    }

    /// The decoded picture, when this run already drew it.
    func cached(_ url: URL) -> UIImage? {
        memory.object(forKey: url as NSURL)
    }

    func image(for url: URL) async -> UIImage? {
        if let hit = cached(url) { return hit }
        guard let (data, response) = try? await session.data(from: url),
              (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true,
              let decoded = UIImage(data: data) else { return nil }
        // Decode off the main thread, so a list of covers scrolls without a hitch.
        let ready = await decoded.byPreparingForDisplay() ?? decoded
        memory.setObject(ready, forKey: url as NSURL)
        return ready
    }
}

/// A remote picture over its placeholder: drawn at once when kept, faded in when fetched.
struct RemoteImage<Placeholder: View>: View {
    private let url: URL?
    private let placeholder: Placeholder
    @State private var image: UIImage?

    init(_ address: String?, @ViewBuilder placeholder: () -> Placeholder) {
        let url = address.flatMap(URL.init(string:))
        self.url = url
        self.placeholder = placeholder()
        _image = State(initialValue: url.flatMap(ImageStore.shared.cached))
    }

    var body: some View {
        ZStack {
            placeholder
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .transition(.opacity)
            }
        }
        .task(id: url) {
            guard let url else {
                image = nil
                return
            }
            if let hit = ImageStore.shared.cached(url) {
                image = hit
                return
            }
            let loaded = await ImageStore.shared.image(for: url)
            if Task.isCancelled { return }
            withAnimation(.easeOut(duration: 0.2)) { image = loaded }
        }
    }
}
