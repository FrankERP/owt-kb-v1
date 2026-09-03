# ADR-0030: The browser floor is iOS 15, so client code avoids Safari 16 APIs

**Date:** 2026-09-03 · **Status:** Accepted

## Context

The app ships an iOS wrap through Capacitor, and
`ios/App/App.xcodeproj/project.pbxproj` sets `IPHONEOS_DEPLOYMENT_TARGET = 15.0`
in all four build configurations. The WebView on such a device is Safari 15.

Nothing recorded that floor. There is no `browserslist` in `package.json`, no
`.browserslistrc`, and Next's `polyfill-module` covers only a fixed, small set
(`Array.prototype.flat`, `Promise.prototype.finally`, `String.prototype.trimStart`
and a few more) which includes none of the APIs below. So a Safari-16-only API
compiles, type-checks, passes every test in jsdom and node, and throws only on a
real old iPhone.

The instance that forced the decision: `AbortSignal.timeout` (Safari 16.0) was
used to bound four admin mutations whose dialogs block every dismissal route.
On iOS 15 the call throws a `TypeError` **inside** the `try`, so
`submitPublication` would record an unknown outcome — "a publish may have
committed and we could not confirm it" — for a request that was never sent. That
record is retired only by a verification which throws the same way. Every
subsequent publish is refused until a page reload, and again after it: a dead
end reachable by nothing worse than an old phone.

## Decision

**Client code targets Safari 15.** When a newer API is convenient, use the older
spelling that works everywhere rather than a feature check.

Concretely: `mutationSignal()` in `app/components/admin/serviceMutationErrors.ts`
builds an `AbortController` (Safari 11.1) with a plain `setTimeout` instead of
`AbortSignal.timeout`. `servicesPanelInFlight.test.ts` fails on any reappearance
of the call form **in the three Servicios mutation files it reads** — narrower
than `clientBoundary.test.ts`, which really is repo-wide, so the same call
elsewhere under `app/**` would still ship silently.

## Rejected

**A feature check at each call site** — `typeof AbortSignal.timeout === "function"
? … : …`. It works, and it is what a reader reaches for first. Against it: the
fallback has to exist anyway, so the check buys nothing but a second path that
only executes on the devices hardest to test, which is the worst possible place
for a branch nobody exercises.

**Raising the deployment target to 16.** A real option, and cheap in code — but
it is a product decision about which phones the worship team may use, not a
decision a mutation timeout gets to make on its own.

**A `browserslist` entry.** Worth adding, and it would help the bundler, but it
would not have caught this: `browserslist` governs transpilation and autoprefix,
not runtime API availability. It would have created a false sense of coverage.

## Consequences

**Every new client-side Web API needs a Safari-15 check before use.** The list
that bites in practice: `AbortSignal.timeout`, `Array.prototype.findLast`,
`structuredClone` in some paths, `Object.groupBy`, `Intl.supportedValuesOf`.
None of the three gates will tell you — `tsc` types them from `lib.dom.d.ts`
irrespective of the target, and jsdom and node have them.

**The floor moves when the deployment target moves.** If
`IPHONEOS_DEPLOYMENT_TARGET` is raised, this ADR is what says the constraint was
deliberate rather than accidental, and can be lifted deliberately too.
