import Foundation
import Security

/// Where the tokens live between launches: the Keychain, this device only, readable after the
/// first unlock (so a background refresh can run). Never `UserDefaults`, never iCloud.
protocol TokenStoring: Sendable {
    func load() -> TokenSet?
    func save(_ tokens: TokenSet) throws
    func clear()
}

struct KeychainTokenStore: TokenStoring {
    var service = "com.owtBackstage.app.session"
    var account = "app-auth"

    struct KeychainError: Error { let status: OSStatus }

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    func load() -> TokenSet? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data else {
            return nil
        }
        return try? JSONDecoder().decode(TokenSet.self, from: data)
    }

    func save(_ tokens: TokenSet) throws {
        let data = try JSONEncoder().encode(tokens)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let add = query.merging(attributes) { _, new in new }
            let added = SecItemAdd(add as CFDictionary, nil)
            guard added == errSecSuccess else { throw KeychainError(status: added) }
        } else if status != errSecSuccess {
            throw KeychainError(status: status)
        }
    }

    func clear() {
        SecItemDelete(query as CFDictionary)
    }
}

/// In-memory store for tests and SwiftUI previews.
final class MemoryTokenStore: TokenStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: TokenSet?

    init(_ tokens: TokenSet? = nil) { self.tokens = tokens }

    func load() -> TokenSet? { lock.withLock { tokens } }
    func save(_ tokens: TokenSet) throws { lock.withLock { self.tokens = tokens } }
    func clear() { lock.withLock { tokens = nil } }
}
