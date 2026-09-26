// Import specifiers that put an outbound transport (push, email, the outbox
// notifier) within reach of a route handler. Substring-matched against a route's
// own source by the SR-verification coverage scan in
// `srVerificationRunContext.test.ts`: a route that imports any of these must wrap
// every request-taking handler in `withVerificationRunContext`.
//
// Shared here, not declared inside that test, so other suites can pin the same
// list without importing a test file (which would register its whole suite a
// second time) or keeping a copy that drifts.
//
// The `*Commit` names are the service domain modules an admin write route
// delegates to after authorization. Those routes import only the domain module,
// never the side-effect helpers the module calls, so without its name here the
// route would silently drop out of the scan. The scan follows no import: a
// delivery-capable module reached only transitively needs its own entry.

export const DELIVERY_CAPABLE_IMPORTS: readonly string[] = [
  "serviceMutationSideEffects",
  "utils/push",
  "utils/email",
  "assignmentEmail",
  "proposalNotify",
  "setlistSaveCommit",
];
