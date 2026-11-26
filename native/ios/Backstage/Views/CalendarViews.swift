import EventKit
import EventKitUI
import SwiftUI

/// The system's own «Nuevo evento» sheet, filled in with a service. The person reviews it,
/// picks the calendar and saves or cancels there: the app never reads their calendar, so it
/// asks for no permission (the sheet runs outside the app since iOS 17).
struct ServiceEventEditor: UIViewControllerRepresentable {
    let event: ServiceEvent
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator { Coordinator(dismiss: dismiss) }

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let store = EKEventStore()
        let draft = EKEvent(eventStore: store)
        draft.title = event.title
        draft.notes = event.notes
        draft.startDate = event.start
        draft.endDate = event.end
        draft.isAllDay = event.allDay
        // The service is at that hour in Mexico City, wherever the phone travels.
        draft.timeZone = event.allDay ? nil : ServiceEvent.zone
        let editor = EKEventEditViewController()
        editor.eventStore = store
        editor.event = draft
        editor.editViewDelegate = context.coordinator
        return editor
    }

    func updateUIViewController(_ controller: EKEventEditViewController, context: Context) {}

    final class Coordinator: NSObject, EKEventEditViewDelegate {
        let dismiss: DismissAction

        init(dismiss: DismissAction) { self.dismiss = dismiss }

        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            dismiss()
        }
    }
}

extension View {
    /// A long press on a service: a look at it without opening it, and what can be done with it.
    func serviceMenu(_ service: AppService, today: String, open: (() -> Void)?, addToCalendar: ((AppService) -> Void)?) -> some View {
        contextMenu {
            if let open {
                Button(action: open) { Label("Abrir", systemImage: "arrow.up.forward.square") }
            }
            if let addToCalendar, ServiceEvent.make(service) != nil {
                Button { addToCalendar(service) } label: { Label("Agregar al calendario", systemImage: "calendar.badge.plus") }
            }
        } preview: {
            ServiceFullCard(service: service, today: today)
                .frame(width: 360)
                .background(BS.base)
        }
    }
}
