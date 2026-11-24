import Foundation
import Security

/// Where the tokens live between launches: the Keychain, this device only, readable after the
/// first unlock (so a background refresh can run). Never `UserDefaults`, never iCloud.
protocol TokenStoring: Sendable {
    /// nil when there is no session; throws when the Keychain cannot answer right now.
    func load() throws -> TokenSet?
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

    func load() throws -> TokenSet? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        // errSecInteractionNotAllowed (before the first unlock) and the like: not «no session».
        guard status == errSecSuccess, let data = item as? Data else { throw KeychainError(status: status) }
        // An unreadable item is no usable session; it is replaced at the next sign-in.
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
    /// Test hooks: make the next loads or saves fail like a locked Keychain.
    var failLoads = false
    var failSaves = false

    init(_ tokens: TokenSet? = nil) { self.tokens = tokens }

    func load() throws -> TokenSet? {
        try lock.withLock {
            if failLoads { throw KeychainTokenStore.KeychainError(status: errSecInteractionNotAllowed) }
            return tokens
        }
    }

    func save(_ tokens: TokenSet) throws {
        try lock.withLock {
            if failSaves { throw KeychainTokenStore.KeychainError(status: errSecInteractionNotAllowed) }
            self.tokens = tokens
        }
    }
    func clear() { lock.withLock { tokens = nil } }
}
