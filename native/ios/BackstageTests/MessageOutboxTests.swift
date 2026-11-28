import XCTest
@testable import Backstage

/// The conversation as a messaging app (`MessageOutbox`): a message is in the chat at once, sends
/// go one at a time, and a lost answer is never sent again before the thread has been read.
final class MessageOutboxTests: XCTestCase {
    private func message(_ key: String, _ body: String, mine: Bool = true) -> ThreadMessage {
        ThreadMessage(key: key, authorName: "A", authorRole: "admin", kind: nil, body: body, at: nil, editedAt: nil, mine: mine)
    }

    private let before: [ThreadMessage] = [ThreadMessage(key: "old", authorName: "A", authorRole: "admin", kind: nil, body: "Hola", at: nil, editedAt: nil, mine: true)]

    func testAMessageIsInTheChatAtOnceAndSendsOneAtATime() {
        var box = MessageOutbox()
        let a = box.enqueue("Uno", thread: before)
        let b = box.enqueue("Dos", thread: before)
        XCTAssertEqual(box.items.map(\.state), [.queued, .queued])
        XCTAssertEqual(box.next?.id, a)
        box.markSending(a)
        XCTAssertNil(box.next, "the second waits for the first")
        box.resolve(a, .posted(ProposalMessageResponse()), thread: nil)
        XCTAssertEqual(box.next?.id, b)
    }

    func testASentMessageLeavesWhenTheThreadShowsItAndKeepsItsMark() {
        var box = MessageOutbox()
        let a = box.enqueue("Hola", thread: before)
        box.markSending(a)
        box.resolve(a, .posted(ProposalMessageResponse()), thread: before + [message("new", "Hola")])
        XCTAssertTrue(box.items.isEmpty)
        XCTAssertEqual(box.sentKeys, ["new"], "the same text already in the thread is not this message")
    }

    func testASentMessageStaysAsSentUntilTheThreadShowsIt() {
        var box = MessageOutbox()
        let a = box.enqueue("Uno", thread: before)
        box.markSending(a)
        box.resolve(a, .posted(ProposalMessageResponse()), thread: nil)
        XCTAssertEqual(box.items.first?.state, .sent)
        box.reconcile(before + [message("k1", "Uno")])
        XCTAssertTrue(box.items.isEmpty)
    }

    func testALostAnswerIsCheckedBeforeAnythingElse() {
        var box = MessageOutbox()
        let a = box.enqueue("Uno", thread: before)
        let b = box.enqueue("Dos", thread: before)
        box.markSending(a)
        box.resolve(a, .failed, thread: nil)
        XCTAssertEqual(box.items.first?.state, .checking)
        XCTAssertNil(box.next, "nothing goes while a lost answer is being checked")
        // It landed after all: no resend.
        box.checked(a, thread: before + [message("k1", "Uno")])
        XCTAssertEqual(box.items.map(\.id), [b])
        XCTAssertEqual(box.sentKeys, ["k1"])
    }

    func testOnlyAMessageProvablyNotThereCanBeSentAgain() {
        var box = MessageOutbox()
        let a = box.enqueue("Uno", thread: before)
        box.markSending(a)
        box.resolve(a, .failed, thread: nil)
        box.retry(a)
        XCTAssertEqual(box.items.first?.state, .checking, "no retry while it may have landed")
        XCTAssertTrue(box.checked(a, thread: before), "one read that misses it is not proof")
        XCTAssertEqual(box.items.first?.state, .checking)
        box.retry(a)
        XCTAssertEqual(box.items.first?.state, .checking)
        XCTAssertFalse(box.checked(a, thread: before))
        XCTAssertEqual(box.items.first?.state, .notDelivered)
        box.retry(a)
        XCTAssertEqual(box.items.first?.state, .queued)
    }

    func testAThreadThatCannotBeReadLeavesItUnconfirmed() {
        var box = MessageOutbox()
        let a = box.enqueue("Uno", thread: before)
        box.markSending(a)
        box.resolve(a, .failed, thread: nil)
        box.checked(a, thread: nil)
        XCTAssertEqual(box.items.first?.state, .unconfirmed)
        box.retry(a)
        XCTAssertEqual(box.items.first?.state, .unconfirmed, "unknown is not «not there»")
        box.recheck(a)
        XCTAssertEqual(box.items.first?.state, .checking)
        // A reload that shows it settles it too.
        box.reconcile(before + [message("k1", "Uno")])
        XCTAssertTrue(box.items.isEmpty)
    }

    func testARefusalSaysWhyAndIsNeverResent() {
        var box = MessageOutbox()
        let a = box.enqueue("Uno", thread: before)
        box.markSending(a)
        box.resolve(a, .closed, thread: nil)
        XCTAssertEqual(box.items.first?.state, .refused("La conversación de este servicio ya cerró."))
        box.retry(a)
        XCTAssertNil(box.next)
        XCTAssertEqual(box.remove(a), "Uno", "«Editar» gets the text back")
        XCTAssertTrue(box.items.isEmpty)
    }

    func testAMessageTheScreenCouldNotSendWaitsInLine() {
        var box = MessageOutbox()
        let a = box.enqueue("Uno", thread: before)
        box.markSending(a)
        box.resolve(a, .notSent, thread: nil)
        XCTAssertEqual(box.next?.id, a)
    }

    func testAMessageOnItsWayCannotBeRemoved() {
        var box = MessageOutbox()
        let a = box.enqueue("Uno", thread: before)
        box.markSending(a)
        XCTAssertNil(box.remove(a))
        XCTAssertEqual(box.items.count, 1)
    }

    func testTwoMessagesWithTheSameTextClaimTwoKeys() {
        var box = MessageOutbox()
        let a = box.enqueue("Sí", thread: before)
        let b = box.enqueue("Sí", thread: before)
        box.markSending(a)
        box.resolve(a, .posted(ProposalMessageResponse()), thread: before + [message("k1", "Sí")])
        XCTAssertEqual(box.items.map(\.id), [b], "the second is still to send")
        box.markSending(b)
        box.resolve(b, .posted(ProposalMessageResponse()), thread: before + [message("k1", "Sí")])
        XCTAssertEqual(box.items.first?.state, .sent, "k1 is the first one's")
        box.reconcile(before + [message("k1", "Sí"), message("k2", "Sí")])
        XCTAssertTrue(box.items.isEmpty)
        XCTAssertEqual(box.sentKeys, ["k1", "k2"])
    }

    func testSomeoneElsesMessageWithTheSameTextIsNotMine() {
        var box = MessageOutbox()
        let a = box.enqueue("Ok", thread: before)
        box.markSending(a)
        box.resolve(a, .failed, thread: nil)
        let others = before + [message("k1", "Ok", mine: false)]
        box.checked(a, thread: others)
        box.checked(a, thread: others)
        XCTAssertEqual(box.items.first?.state, .notDelivered)
    }

    // MARK: The server trims

    func testAMessageIsKeptAndSentTrimmed() {
        var box = MessageOutbox()
        box.enqueue("  Listo \n", thread: before)
        XCTAssertEqual(box.items.first?.body, "Listo")
    }

    func testALandedMessageWithOuterSpacesIsRecognisedAfterALostAnswer() {
        var box = MessageOutbox()
        let a = box.enqueue("Listo ", thread: before)
        box.markSending(a)
        box.resolve(a, .failed, thread: nil)
        box.checked(a, thread: before + [message("k1", "Listo")])
        XCTAssertTrue(box.items.isEmpty, "it landed: never offered again")
    }

    func testAPostedMessageWithOuterSpacesLeavesTheOutbox() {
        var box = MessageOutbox()
        let a = box.enqueue("Gracias\n", thread: before)
        box.markSending(a)
        box.resolve(a, .posted(ProposalMessageResponse()), thread: before + [message("k1", "Gracias")])
        XCTAssertTrue(box.items.isEmpty)
    }

    func testThePostedMessageClaimsItsKeyBeforeAnEarlierUnconfirmedTwin() {
        var box = MessageOutbox()
        let a = box.enqueue("Sí", thread: before)
        box.markSending(a)
        box.resolve(a, .failed, thread: nil)
        box.checked(a, thread: nil)
        XCTAssertEqual(box.items.first?.state, .unconfirmed)
        let b = box.enqueue("Sí", thread: before)
        box.markSending(b)
        box.resolve(b, .posted(ProposalMessageResponse()), thread: before + [message("k2", "Sí")])
        XCTAssertEqual(box.items.map(\.id), [a], "k2 is the posted one's; the unconfirmed one stays to be checked")
    }

    func testARecheckStartsCountingAgain() {
        var box = MessageOutbox()
        let a = box.enqueue("Uno", thread: before)
        box.markSending(a)
        box.resolve(a, .failed, thread: nil)
        box.checked(a, thread: before)
        box.checked(a, thread: nil)
        box.recheck(a)
        XCTAssertTrue(box.checked(a, thread: before), "a fresh check needs its own two misses")
    }

    func testAMessageCalledNotSentThatLandsLateLeavesWithTheNextThread() {
        var box = MessageOutbox()
        let a = box.enqueue("Uno", thread: before)
        box.markSending(a)
        box.resolve(a, .failed, thread: nil)
        box.checked(a, thread: before)
        box.checked(a, thread: before)
        XCTAssertEqual(box.items.first?.state, .notDelivered)
        // The write reached the database after both reads; a save's answer shows it.
        box.reconcile(before + [message("k1", "Uno")])
        XCTAssertTrue(box.items.isEmpty, "«Reintentar» must not stay under a message that is there")
        XCTAssertEqual(box.sentKeys, ["k1"])
    }

    func testAConfirmedMessageClaimsItsKeyBeforeAnEarlierTwinCalledNotSent() {
        var box = MessageOutbox()
        let a = box.enqueue("Ok", thread: before)
        box.markSending(a)
        box.resolve(a, .failed, thread: nil)
        box.checked(a, thread: before)
        box.checked(a, thread: before)
        let b = box.enqueue("Ok", thread: before)
        box.markSending(b)
        box.resolve(b, .posted(ProposalMessageResponse()), thread: nil)
        box.reconcile(before + [message("k1", "Ok")])
        XCTAssertEqual(box.items.map(\.id), [a], "k1 is the confirmed one's")
        XCTAssertEqual(box.items.first?.state, .notDelivered)
    }

    func testAByteOrderMarkIsTrimmedAsTheServerDoes() {
        var box = MessageOutbox()
        let a = box.enqueue("\u{FEFF}Listo\u{FEFF}", thread: before)
        XCTAssertEqual(box.items.first?.body, "Listo")
        box.markSending(a)
        box.resolve(a, .failed, thread: nil)
        box.checked(a, thread: before + [message("k1", "Listo")])
        XCTAssertTrue(box.items.isEmpty)
    }

    func testAWaitingMessageNeverGoesOnceTheConversationCloses() {
        var box = MessageOutbox()
        let a = box.enqueue("Uno", thread: before)
        let b = box.enqueue("Dos", thread: before)
        box.markSending(a)
        box.strand()
        XCTAssertEqual(box.items.map(\.state), [.sending, .refused(MessageOutbox.strandedReason)])
        box.resolve(a, .posted(ProposalMessageResponse()), thread: nil)
        XCTAssertNil(box.next, "the stranded one stays unsent")
        box.retry(b)
        XCTAssertNil(box.next)
        XCTAssertEqual(box.remove(b), "Dos")
    }
}
