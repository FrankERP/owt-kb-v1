# Solver v3 — C3: the «Mes por medio» Sunday cadence in the rule set — design spec

**Date:** 2026-10-05 · **Status:** `DRAFT` · **Parent:**
[`2026-10-05-solver-v3-fairness-design.md`](2026-10-05-solver-v3-fairness-design.md) (`APPROVED` by
Frank), which assigns this child L4 (§6), the F7/F8 settings it stores, Q2's default and §14
assumption 4; aligned with the parent's amendments A1–A40 (§3 there; A1, A6, A7, A8, A9, A10,
A11, A14, A22, A26, A28, A29, A31, A34, A35 and A38 touch this child; A40, a confirm that crosses a
month boundary, does not). · **Risk tier: critical** — it changes the validator, the serializer and the
whole-document writer of `solverConfig`, the one document that drives the planner's hard blocks for
every admin on production and on Preview alike. A field that an older writer drops silently is the
failure class this spec exists to close. Requirement: two sequential fresh `APPROVED` verdicts on
byte-identical text before implementation; the churn cap applies.

**Contracts, not prescriptions.** This spec states what must be true and what must never happen.
Helper names, file layouts and loop shapes belong to the implementation plan — except the names in
§7, which other children import and which therefore are part of the contract.

**Names.** This repository is public. Examples use fictitious people (Ana, Bruno, Carla). The real
members the setting is for are «the cadence members» (parent §Names).

## 1. Original request

Parent (redacted there, quoted here unchanged):

> Necesitamos arreglar en solver.
> Tiene que tomar en cuenta el historial, pero debe de considerar a personas "especiales" como el caso
> que te platique de [REDACTED: three member names] que solo dirigen un mes sí y un mes no.
> Y mantener el fariness en ventanas más grandes, siempre siendo claro y transparente con el admin al
> respecto.
> […]
> — and, mid-session: «Y la participación total también»

And, approving the parent and opening the children:

> Aprobado, sigue con los specs de las entregas

## 2. Outcome

- **Primary outcome.** The admin can mark a person's Sunday lead as «Mes por medio» in the rule set,
  the setting is stored safely in the shared `solverConfig` document, no writer can drop it
  silently, and it resolves to exactly one member id for the children that use it (C2's record and
  cadence-state function, C6's v3 request). Under v2 it changes nothing.
- **Operator.** The worship admin (today Frank), in «Configuración del Solver» → «Reglas».
- **Current behaviour and gap.**
  - The rule set has no way to say «leads Sundays every other month»; ADR-0046 leaves that to
    ticking and unticking the pool checkboxes by hand, which records nothing (parent §1).
  - `POST /api/admin/solver-config` replaces the whole document (`route.ts:154-163`), and the
    validator deliberately **drops unknown fields** (`solverConfigWriteRequest.ts:32-35`, pinned by
    the test «drops unknown extra fields rather than refusing a newer client's body»). The client
    reader rebuilds every restriction from an explicit field list (`solverConfigWriteRequest.ts:354-399`,
    used client-side by `sourceFromGet`, `solverConfigSource.ts:97`), and the edit form rebuilds the
    restriction from its own state (`MonthGenerator.tsx:675`). So a tab whose bundle predates a new
    field reads it away, and its next «Guardar reglas» — about any rule — erases it for everyone.
  - Rule names resolve by the FIRST member that matches (`plannerModel.ts:572-578`); nothing detects
    a name that matches two members.
- **Success measure.** A «Mes por medio» saved by a current tab survives every save path; a body from
  an older tab is refused with nothing written; v2's whole solve request and grid verdicts are
  identical for a config and its v2 view (§6.4; parent A8, A34); the resolver returns one id per
  cadence member or names the refusal; a body giving one rule person two exact counts for one role
  is refused with nothing written, naming the rule (§6.2; parent A38).

## 3. Evidence

All paths are relative to the repository root; line numbers verified on `3dbc189b`, and no file
under `app/`, `sanity/`, `scripts/`, `docs/DATA_MODEL.md` or `CLAUDE.md` changed between it and
`c2c444fd` (`git diff --stat 3dbc189b c2c444fd -- app sanity scripts docs/DATA_MODEL.md CLAUDE.md`
is empty), so they hold there too.

| # | Fact | Source | Implication |
|---|---|---|---|
| E1 | `solverConfig` is one document at a fixed id; restrictions are `{id, person, excludedPatterns[], fairness, fairnessSlack, weekExclusions[], caps[]}` with `_key == id` | `sanity/schemas/solverConfig.ts:58-136`; `app/utils/solverConfigWriteRequest.ts:271-318` | The setting is one more restriction field; `_key` minting is untouched |
| E2 | `PersonRestriction` lists exactly those fields | `app/components/admin/plannerModel.ts:264-272` | The type gains one optional field |
| E3 | The POST takes `{rev, config}`, checks `_rev`, then `set()`s every field of the parsed config | `app/api/admin/solver-config/route.ts:111-163` | It is a whole-document serializer: whatever the body omits is erased |
| E4 | The validator drops unknown fields on purpose («refusing to save because the client is newer helps nobody») | `app/utils/solverConfigWriteRequest.ts:32-35`; `app/utils/__tests__/solverConfigWriteRequest.test.ts:204-209` | Leniency is why an OLDER client loses data silently; a version check is the counterweight |
| E5 | The client normalises every GET through the shared reader, which keeps only known fields | `app/components/admin/solverConfigSource.ts:88-98`; `app/utils/solverConfigWriteRequest.ts:351-399` | A pre-C3 bundle cannot hold the field even after re-reading from a C3 server |
| E6 | The edit form commits a freshly built restriction from its own state | `app/components/admin/MonthGenerator.tsx:646-676` | The form must carry every field, or editing drops it |
| E7 | `saveFailure` maps `stale_revision` to «Alguien más cambió las reglas primero…» with `stale: true`, which shows «Recargar reglas»; `invalid_request` to «El servidor rechazó las reglas y no guardó nada.» with `stale: false`; anything else to «No se pudieron guardar las reglas. (error N)» | `app/components/admin/solverConfigSource.ts:104-111`; `MonthGenerator.tsx:1370-1378` | The refusal code decides what a pre-C3 tab says; `stale_revision` would loop through a reader that drops the field |
| E8 | `restrictionToDs` emits nothing for a restriction with no clause; `allRulesToDs` spreads the restriction | `plannerModel.ts:710-721`, `:733-761` | v2 rule strings are unaffected by an extra field |
| E9 | `solverPools` puts the `person` of **every** restriction — clauses or not — into the DSL-person list: absent from every pool ⇒ injected into `support` with their availability exclusions; resolved with no Tipo ⇒ `buildSolveRequest` refuses the month | `plannerModel.ts:887-927`, `:1308-1314` | A restriction carrying only the cadence would change v2's request; the inertness contract must cover the whole request, not only rule strings (parent A8; §6.4) |
| E10 | Other readers of `restrictions` read clause fields only: `saturdayAccess`, `trailingVerdict`, `saturdayFloorOmissions`, `fairnessByMemberId`, `pinViolations`, `isExcludedFromLead`, `evaluate` | `plannerModel.ts:976`, `:1037`, `:1215`; `localFill.ts:141-151`; `pinViolations.ts:95`; `leadPoolHistory.ts:37`; `ruleEnforcement.ts:355-374` | Unaffected by a field they never read; the equivalence test still covers them |
| E11 | `unresolvedRuleNames` reports names matching nobody, over every restriction, conflict and presence person; it does not detect a name matching two members | `app/components/admin/ruleEnforcement.ts:225-249` | «The existing rule-name validation» covers zero matches only; exactly-one is new, and is C3's resolver (parent A7; §6.5) |
| E12 | The matching criterion is case-insensitive, trimmed equality with `member_name` or `alias` | `app/utils/memberRuleNames.ts:37-45`; `plannerModel.ts:572-578` | The resolver reuses it; only the count of matches is new |
| E13 | The rule form's person list is the `voz`-filtered roster | `MonthGenerator.tsx:1751` | An ambiguity check fed that list could miss a namesake without `voz` |
| E14 | Pool checkbox lists are built from Tipo (`memberFitsPool`); the stale-tick banner is the existing pattern for a pool warning | `MonthGenerator.tsx:1642-1651`, `:1708-1734`; `plannerModel.ts:813-818` | The «not ticked» warning reuses `memberFitsPool` and the banner style |
| E15 | The only other writers of `solverConfig` in this repository: member DELETE patches the three pool arrays only; a one-off rule-name repair script in `scripts/` patches one `restrictions[_key==…].person` path; the seed creates only when absent. Outside it, two one-off scripts kept in the private log repository (`owt-agent-logs/backups/`, run 2026-09-29 and 2026-10-01, both already applied) wrote caps and whole restrictions with `insert`/`append`/`setIfMissing`, never through the parser | `app/api/admin/members/[id]/route.ts:163-193`; `scripts/` (grep `restrictions[_key==`); `scripts/seed-solver-config.ts:187-220`; private scripts read, not copied | No other whole-document writer exists today; targeted patches keep sibling fields. The two private scripts are the precedent §7 item 8 supersedes: a repeat of that pattern would bypass the A38 check and the field's validation |
| E16 | No MCP tool reads or writes `solverConfig`; `solve_month` (P4) is unbuilt | `grep -rln 'solverConfig\|SOLVER_CONFIG\|restrictions' app/mcp app/api/mcp` → no match; `docs/MCP.md:36` | The MCP solve path is untouched by construction |
| E17 | `invalid_request` is HTTP 400 and non-conflict; `stale_revision` is 409 | `app/utils/serviceMutation.ts:17-47`, `:61-65` | Chooses the refusal's code (§6.2) |
| E18 | Preview and production read and write the same `solverConfig` (one dataset); `preview` deploys before `main` | `CLAUDE.md` «Vercel safety»; parent E4 | For the length of the release window, production's pre-C3 route is a live writer of a document that dev may have extended (§11) |
| E19 | The «Equidad» help text already says Exenta/Holgura act on the weekend total band and on the specials filler (exempt = median, slack = load + N) | `MonthGenerator.tsx:733-753`; `localFill.ts:117-151` | Holgura still acts on the filler, and keeps doing so under v3 (parent A10; C6 CTL-2); the v3 note speaks of the solver only |
| E20 | Caps are `{id, pattern, op ∈ {"<=", ">=", "=="}, value, relative, relOffset}`; the parser accepts any non-empty pattern label (`normalizeLabel`) and checks nothing across caps, so two `==` caps covering one role for one person are stored today | `app/utils/solverConfigWriteRequest.ts:57`, `:187-217`; `app/utils/normalizeLabel.ts:31-35` | The A38 check is new code in the parser, not a tightening of an existing one |
| E21 | `rolesOfPattern` is the one neutral, solver-synced pattern → role map, over the **five** v2 keys (no `Sat.Choir`); the form's cap patterns are eleven labels, none of them `*.Choir`, `Choir.*` or `Sat.Choir` | `app/components/admin/plannerModel.ts:613`, `:637-650`; `MonthGenerator.tsx:310-322` | C3's save check can use it; the only overlap it cannot see (one on `Sat.Choir` alone) needs a hand-written body, and C2's six-key validator closes it (§6.2) |
| E22 | Adding a restriction appends a new card; nothing merges two cards that name the same person | `MonthGenerator.tsx:1096` | Two cards with the same `person` text are reachable from the UI, so the A38 check must look across restrictions, not only within one |
| E23 | «No Tipo» is `(memberType ?? []).length === 0`; v2 refuses the month for a rule person so judged | `plannerModel.ts:917-924`, `:1308-1314` | The §6.7 predicate uses the same definition to leave such a member out |
| E24 | The 2026-10-05 read-only recon of production's `solverConfig`, with the 2026-09-29 snapshot: some people carry two `==` caps (`Sun.*` and `Sat.*`), and no two `==` caps on one `person` text share a role under `rolesOfPattern` | private evidence (`u_real-data.md`; never copied here) | No stored document is expected to start failing A38's check; §9 A6 re-verifies before the merge |
| E25 | The planner's `members` comes from `GET /api/admin/members`, filtered by `WORSHIP_MEMBER_GROQ_FILTER` = `($all \|\| worship-predicate)` with `$all` bound to `role === "super-admin"`: a worship admin receives worship members only, a super-admin (Frank, §2) receives **every** member, kids-only included. The route projects `ministries`; nothing downstream filters by ministry; the planner's `MemberOption` types omit the field | `app/api/admin/members/route.ts:20-32`; `app/ministries.ts:41-44`, `:74-77`; `ServicesPanel.tsx:435`, `:990`, `:1041`; `MonthGenerator.tsx:129-137`; `serviceCardModel.ts:96-110` | The roster the planner holds differs by viewer role. The resolver applies the worship predicate itself (§6.5), so one config gives one answer for every viewer |

## 4. Requirements

| ID | Requirement | Rationale | Acceptance criterion |
|---|---|---|---|
| R1 | A restriction may carry `sundayCadence: "alternate"` («Mes por medio»); absence means «Normal». No other value is ever stored, and «Normal» is never stored explicitly | Parent canonical name; no migration; every existing document stays byte-identical | Parser, serializer and reader tests (§13 T1–T3) |
| R2 | Every path that writes the whole document preserves the field, and a body from a client that predates it is refused before any read or write | E3–E6; parent L4 | Route tests T4–T5; client test T6; tripwire T7 |
| R3 | v2 is inert to the setting: its whole solve request and its grid verdicts for a config equal those for the config's v2 view (§6.4) | Parent §9 «v2 path byte-identical», A8 and A34; E9 | Equivalence corpus T8; existing v2 suites unmodified and green |
| R4 | The setting resolves to member ids through one function that returns exactly one id per cadence name or names why not (unresolved, ambiguous); the same exactly-one function resolves any single rule name for C2's v3 eligibility resolver | Parent L4, A7 and A35; E11–E13 | Resolver tests T9 |
| R5 | The rule UI offers «Domingo: Normal / Mes por medio», shows it on the card, allows a restriction that carries only it, and preserves it on edit | Parent U7, §6 L4 | UI tests T11 |
| R6 | A pure predicate names every resolved cadence member with a Tipo who is outside the effective Sunday pool, with copy; it renders only when the engine is v3 (gate wired by C6) | Parent §14 assumption 4 and A9; E23 | T10 |
| R7 | «Holgura» stays selectable and unchanged under v2; its card says «no aplica con el nuevo solver» | Parent Q2, F8 | T11 |
| R8 | The seed script and the defaults handle the field without behaviour change | Task scope; E15 | T12 |
| R9 | Documentation and the ADR land in the same delivery | `CLAUDE.md` Conventions, Decision records; parent A31 | Docs audit at code review |
| R10 | A rule person has at most one exact (`==`) count per role key: the parser refuses a body that gives one `person` text two `==` caps covering a common role, the form does not produce one, and the client names the rule when the server refuses a stored one | Parent A38; E20–E22 | T14 |

## 5. Scope

### In scope

- `sanity/schemas/solverConfig.ts`: the field on `solverRestriction` (Studio inspection only).
- `PersonRestriction` (`plannerModel.ts`): the optional field.
- `parseSolverConfigWrite`, `solverConfigFields`, `solverConfigFromDocument`
  (`solverConfigWriteRequest.ts`): validate, store, read; the one-exact-count-per-role check of
  parent A38 in the same parser, its neutral predicate shared with the form, and the client's
  mapping of its refusal.
- The config version guard: the constant, the POST refusal, the GET/POST echo, the client's send and
  its mapping of the refusal (`route.ts`, `useSolverConfig.ts`, `solverConfigSource.ts`).
- v2 inertness (§6.4), including the one v2 reader that must learn to look past a cadence-only
  restriction (`solverPools`).
- A neutral resolver module (§7) and the «not ticked» predicate; the resolver applies the worship
  predicate to its roster itself (§6.5, E25). The planner's two `MemberOption` types
  (`MonthGenerator.tsx:129`, `serviceCardModel.ts:96`) gain `ministries?: unknown` — a type widening
  only: the members route already projects the field (E25), so the runtime objects carry it and the
  type stops erasing it at the resolver's boundary.
- UI: `PersonRestrictionForm`, `RestrictionCard`, `canAdd`, the ambiguity chip, the Holgura note,
  the gated warning in `SolverConfigPanel`.
- `scripts/seed-solver-config.ts` summary; `DEFAULT_SOLVER_CONFIG` stays as it is.
- Docs: `docs/DATA_MODEL.md`, `CLAUDE.md` (one invariant), one ADR.

### Non-goals

- The monthly record, the cadence STATE (X1) and the ledger — C2. This spec stores the setting, never
  the state (F7).
- The engine switch and any rendering decision keyed on the engine. Parent A1 splits it: C1 creates
  `app/components/admin/solverEngine.ts` with the constant `SOLVER_ENGINE` only; C2 adds the pure
  resolver of the effective engine and the Preview-only `OWT_SOLVER_ENGINE` override; C6 adds the
  solve route's 409 and passes the server-resolved engine to the planner (C6 ENG-3/ENG-4). C3 never
  imports `SOLVER_ENGINE` or C2's resolver and never reads the effective engine: every
  engine-dependent surface of C3 is either engine-neutral or behind an input C6 drives with that
  prop.
- The v3 eligibility resolution (pools + rules + members → per-role statuses) — C2 (parent A7,
  C2 RES-1–RES-7) — and the v3 request — C6.
- The solver's handling of the cadence — C5.
- C7's single flip step (parent A28, which supersedes A22's wording): flipping the constant, then
  moving the cadence members into «Líderes Domingo», emptying «Líderes Sábado», and removing a cadence
  member's exact `Sun.Lead` rule or `Sun.Lead` exclusion — every `solverConfig` edit v3 needs that v2
  would read differently. Its rollback (parent A29) restores only those paths, through C3's parser and
  serializer (§7 item 8). Saving the cadence members' «Mes por medio» on production — Frank, in the
  UI, once the production alias serves C3 (parent A26) and before C4's dry run (parent A22, A28;
  C4 A2); it alone may precede the flip. **No agent saves rules on production** (`CLAUDE.md`:
  production Sanity writes need explicit consent).
- Ambiguity checks for v2's other rules: v2 keeps first-match resolution (E12) unchanged (parent A7, A35).
  Under v3, every other rule name goes through `resolveRulePersonId` inside C2's resolver
  (C2 RES-7); C3 provides the function, not that check.
- Rule names becoming ids in storage (deferred ruling «D4 Reglas del solver por id»). Storage stays
  name-keyed like every other rule (parent L4).
- MCP: no tool changes; `solve_month` stays unbuilt (parent §10).
- Changing «Exenta» (D13: today's meaning) or the specials filler's use of Holgura, which keeps
  today's Exenta/Holgura ordering for uncounted specials under v3 too (parent A10; C6 CTL-2).

## 6. Behaviour and invariants

### 6.1 Stored shape

- `solverConfig.restrictions[i].sundayCadence` is either **absent** («Normal») or the string
  `"alternate"` («Mes por medio»). It is never `null`, never `"normal"`, never any other string.
- A document written by C3 code for a config with no cadence is byte-identical to what pre-C3 code
  writes for the same config: no key appears for «Normal».
- No migration. Every existing document already means «Normal» everywhere.
- The `_key`/`id` identity at all five array levels is unchanged (E1).

### 6.2 The write path and the config version guard

**The guard.** A neutral constant `SOLVER_CONFIG_VERSION` names the document shape a client
understands. Every body sent before C3 is version 1 (it carries no version). C3 sets it to **2**.

- The POST body becomes `{ rev, config, configVersion }`. The route checks `configVersion` **first**,
  before reading the stored document and before parsing `config`: anything other than exactly
  `SOLVER_CONFIG_VERSION` (absent, `null`, a string `"2"`, `1`, `3`) is refused with HTTP 400,
  `error: "invalid_request"`, `conflict: false`, `details: { issues: ["configVersion"], expected,
  received }` and the Spanish `message` «Esta pestaña tiene una versión anterior de las reglas.
  Recarga la página; no se guardó nada.» Nothing is read from Sanity and nothing is written.
- **Why `invalid_request` and not `stale_revision`** (E7, E17): a pre-C3 tab maps `invalid_request` to
  «El servidor rechazó las reglas y no guardó nada.» — honest, and with no button. `stale_revision`
  would show «Recargar reglas», whose re-read goes through that tab's own field-dropping reader and
  can never produce a body the route accepts. A new conflict code would print «(error 409)» there.
- The GET response and the POST success echo both carry `configVersion: SOLVER_CONFIG_VERSION`.
- **The current client** sends `configVersion` on every save; maps the refusal (`invalid_request`
  whose `details.issues` contains `"configVersion"`) to «Esta pestaña tiene una versión anterior del
  planificador y no guardó nada. Recarga la página y vuelve a aplicar tu cambio.», `stale: false`;
  and, when a GET or POST echo carries a `configVersion` different from its own — or none, which reads
  as 1 — shows «El planificador se actualizó. Recarga la página para poder guardar las reglas.» and
  disables «Guardar reglas» (its title says why). For C3's own release this path is reached only in
  tests (a C3 bundle always meets a C3 server); it is what makes the NEXT bump, or a rollback, humane.
- **The bump rule.** Any later change that adds a field **or an allowed value** to the stored
  document that an older client would drop or rewrite bumps `SOLVER_CONFIG_VERSION` in the same
  change — a second `sundayCadence` value or a new `fairness` value is read by this version as
  «Normal» / `"none"` (§6.3) and erased by its next save exactly like an unknown field. A tripwire
  test pins, for the current version, the exact key set `solverConfigFields` emits at each of its
  levels (document, restriction, week exclusion, cap, conflict, presence) **and** the exact set of
  values the parser accepts for each enumerated field (`sundayCadence`, `fairness`, cap `op`);
  adding a key or an accepted value without editing that pin and the constant together fails the
  suite. Free-text fields (`person`, pattern labels) are read back verbatim by every version and are
  not enumerated.
- **Unchanged:** auth (manager, content-editor excluded, `route.ts:59-64`), create-never
  (`route.ts:135-145`), the `_rev` check and `ifRevisionId`, `sanityConflictKind` classification,
  `updatedAt`/`updatedBy`, the seed's create-only path. The guard is an extra refusal ahead of them,
  never a replacement.

**Validation of the field** (in the parser both the route and the seed use):

- absent ⇒ «Normal», no key in the canonical config or in the stored fields;
- `"alternate"` ⇒ kept and stored;
- anything else, `null` included ⇒ refused with issue path `restrictions[i].sundayCadence`, nothing
  written (the module's rule: reject what the UI cannot produce, `solverConfigWriteRequest.ts:26-35`).

**One exact count per person per role (parent A38).** Two `==` caps that cover a common role for the
same person are refused when saved. The contract:

- **Covering.** A cap covers the role keys `rolesOfPattern(cap.pattern)` returns (E21) — the existing
  ONE v2 map, neutral and solver-synced. Op `==` only: a `<=` or `>=` cap beside an `==` cap on the
  same role is accepted, as today. The value plays no part: two `==` caps on one role are refused even
  with equal values, relative or absolute, and even if one resolves to 0 in some month.
- **Same person, at save time, means the same `person` text** under the existing matching criterion's
  normalisation (case-insensitive, trimmed — E12). The check runs within one restriction and across
  every restriction whose `person` text is equal so (two cards for one person are reachable, E22).
  The route holds no roster (§6.5), so two **spellings** of one member (a `member_name` on one card,
  the alias on another) are outside what a save can see. They are refused at build time by C2's
  record validator and eligibility resolver, which judge by resolved member id (parent A38; §7
  obligations). This is the save's blind spot by construction, stated so no reviewer reads the save
  check as the whole guarantee.
- **The `Sat.Choir` gap.** `rolesOfPattern` has no `Sat.Choir` (E21), so an overlap on `Sat.Choir`
  alone (e.g. `Sat.*` with `*.Choir`) passes the save. The form cannot produce it: of its cap
  patterns only `Sat.*` and `*.*` cover Saturday chorus, and those two also share `Sat.Lead` (E21).
  Only a hand-written or legacy body (`Choir.*`, `*.Choir`, `Sat.Choir`) can, and C2's six-key
  validator and resolver refuse it at build time. C3 does not add a second, six-key pattern map
  (that expansion is C2's, RES-2).
- **Refusal.** The parser pushes the issue path of the **later** cap of each overlapping pair, in
  document order (restrictions by index, then caps by index), once per cap however many caps it
  overlaps: `restrictions[i].caps[j]:exact_overlap` — the suffix follows the module's
  `.id:missing`/`.id:duplicate` convention, because `mapItems` already pushes the bare
  `restrictions[i].caps[j]` for a cap that is not an object. Like every parser issue it yields HTTP 400 `invalid_request`, `conflict: false`, nothing written. The seed
  goes through the same parser and refuses likewise (§6.9).
- **The predicate is shared.** One neutral exported function (§7 item 3) returns every overlapping
  pair; the parser and the client both call it, so the form's check and the route's refusal cannot
  disagree.
- **The form does not produce it.** In `PersonRestrictionForm`, a cap row whose `==` covers a role
  another `==` cap already fixes — on this card, or on another card with the same `person` text —
  shows «Ya hay un número fijo para {rol} de {persona} («{regla}»). Quita uno de los dos.» (`{regla}`
  is the other cap's `capLabel`; `{rol}` the first common role as the cap chips name it) and `canAdd`
  is false while any such row remains.
- **A stored overlap is not a dead end.** A document saved before C3 may already hold a pair (E24
  says none is expected). The panel runs the same predicate over the on-screen config and, while it
  reports a pair, shows on each affected card «Dos números fijos para {rol}: quita uno para poder
  guardar.» The client maps a server refusal whose `details.issues` contains a
  `restrictions[i].caps[j]:exact_overlap` path (no other issue carries that suffix) to
  «Hay dos números fijos para {rol} de {persona} («{regla}»). Quita uno y guarda de nuevo; no se
  guardó nada.», `stale: false`, naming the pair by running the shared predicate over the config it
  sent — never the bare «El servidor rechazó las reglas…». Removing either cap makes the next save
  pass.
- **Not a version bump.** The check adds no field, so `SOLVER_CONFIG_VERSION` stays 2 (§6.2's bump
  rule concerns fields and values an older client would drop or rewrite). A pre-C3 tab is already refused by the version
  guard before the parser runs.

### 6.3 The read path

- The reader returns `sundayCadence: "alternate"` exactly when the stored value is `"alternate"`; any
  other stored value reads as «Normal» (total and defensive, like `fairness` today). A value a future
  version writes is therefore read as «Normal» by this version — and that version's bump (§6.2: a new
  allowed value bumps like a new field) refuses this version's saves, so the value is never erased
  by it.
- Write → read round trip preserves the field and every id.
- `sameSolverConfig` (`solverConfigSource.ts:147-149`) treats «Normal» set by the form and «Normal»
  read from the server as equal, so toggling «Mes por medio» on and back off settles to «Guardado».

### 6.4 v2 is inert to the setting

**The v2 view.** For a config `C`, `v2View(C)` is `C` with `sundayCadence` removed from every
restriction and, in addition, every restriction removed that **carried** the cadence and, without it,
has no `excludedPatterns`, no `weekExclusions`, no `caps` and `fairness === "none"` — exactly the
restrictions today's `canAdd` (`MonthGenerator.tsx:664`) could not have produced. A restriction that
never carried the cadence is never removed, even if it is clause-less (a «Holgura 0» one is kept,
as today).

**The invariant.** For every config `C` and every other input held equal:

- `solverPools` itself returns a deep-equal result for `C` and `v2View(C)` — every pool, the
  injected `extraSupport` and the no-Tipo block (E9). It has two callers, and both must see one
  answer: `buildSolveRequest`, and the pin board (`MonthGenerator.tsx:2572` → `pinConflicts`,
  `pinModel.ts:261-270`, which flags `outsidePool` against pools that include the injected support
  names);
- `buildSolveRequest` returns a deep-equal result for `C` and `v2View(C)` — `ok`, `request` (pools,
  `support` injection, `dsl_rules` in order, `history`), `omittedCaps`, `trailing`, and the `reason`
  string of every refusal, including the no-Tipo refusal (E9);
- `pinConflicts`, fed the pools `solverPools` returns, answers identically for `C` and `v2View(C)`;
- the planner grid's rule verdicts (`evaluate`, `ruleViolationsForColumn`), `fairnessByMemberId`,
  the pin-violation copy, `priorMonthLeadVisibility` and the Saturday helpers answer identically for
  `C` and `v2View(C)`;
- `allRulesToDs` produces the same strings in the same order.

This is the parent's A8 as A34 states it: «the v2 request built from a config equals the one built
from the same config with `sundayCadence` removed (and any restriction that carried only the cadence
removed)». `v2View` is exactly that removal — a restriction «carried only the cadence» when, without
it, it has no `excludedPatterns`, no `weekExclusions`, no `caps` and `fairness === "none"`. Removing
only the field would leave a clause-less restriction that still reaches `solverPools` (E9).

**A38 is a different, deliberate change and is not covered by this invariant.** The one-exact-count
check (§6.2) changes what the v2 writer accepts — a config with an overlapping `==` pair can no longer
be saved — not what v2 does with a config it holds. It is v2-visible by the parent's ruling (A38); the
cadence field's inertness (A8, A34) is untouched by it.

**The one deliberate difference.** `unresolvedRuleNames` also reports the name of a cadence-only
restriction that matches nobody. It is a warning, not part of the solve, and an unresolvable cadence
name is a broken rule the admin must fix before v3 (it is the zero-match half of «the existing
rule-name validation» parent L4 cites; the exactly-one half is §6.5).

**Why this needs code, not only a test** (E9): `solverPools` takes the `person` of every restriction,
so a cadence-only restriction naming someone in no pool would inject them into v2's `support`, and one
naming a member with no Tipo would make v2 refuse the month. The v2 view is applied at or before
`solverPools`, never only inside `buildSolveRequest`: applied there alone, an unpooled member with
only a cadence rule, pinned to a BGV seat, would not be flagged `outsidePool` by the pin board while
the request left her out. How it is applied at that point is the plan's; the equivalence corpus (T8),
which asserts `solverPools`' own output, is the guard.

### 6.5 Name resolution (exactly one)

- The cadence is keyed by the restriction's `person`, like every rule. It is resolved to a member id
  by a neutral function (§7) using **the existing matching criterion** (`rulePersonNamesMember`,
  `memberRuleNames.ts:37-45`) and one new condition: **exactly one** member of the roster matches.
  Zero matches ⇒ `unresolved`; two or more ⇒ `ambiguous`, with the matching ids. Neither is guessed.
- **The roster is the unfiltered worship roster**: every member whose normalized ministries include
  worship (`normalizeMinistries(m.ministries).includes("worship")`, `app/ministries.ts:41-44` — absent
  or empty means worship, the storage contract), with **no** `voz`, pool or Tipo filter — never the
  `voz`-filtered list the form uses (E13), never a pool. A `voz`, pool or Tipo filter can hide a true
  namesake and turn an ambiguous name into a resolved one; the ministry predicate is the opposite
  case — it removes members who can never hold a worship rule, so a kids volunteer is never a false
  namesake and never the id a rule name resolves to.
- **The resolver applies the ministry predicate itself.** Callers pass whatever member list they
  hold; all three functions of §7 item 4 drop every member the predicate excludes before matching.
  This is not optional, because the list callers hold is not one set: the planner's `members` is
  worship-only for a worship admin and everyone, kids-only included, for a super-admin (E25). Applied
  inside, one config resolves identically for every viewer, the ambiguity chip (§6.6) and
  `cadenceOutsideSundayPool` (§6.7) included, with no third open-coded reader of the storage contract
  (`normalizeMinistries` is the one TypeScript reader, CLAUDE.md). The one caller obligation left is
  to pass each member's stored `ministries` as read: a list stripped of the field would read as
  all-worship (absent = worship), turning the filter into a no-op: a kids-only namesake would again
  read as `ambiguous`, and a name matching only a kids-only member would resolve to her (C2's
  writer still refuses a non-worship id at commit, C2 WR-5). The planner's route projects the field
  (E25) and C2's resolver input already declares it (C2 §7); every other roster read that feeds
  these functions (C4's script, C7's rehearsal) must project it too (§7 obligations). T9 pins the
  behaviour.
- Several restrictions may carry the cadence for the same member (different spellings, or two cards):
  the result is the union, each id once, in a stable order (by id).
- **The same function serves every v3 rule name** (parent A7, A35 — the exactly-one check is new,
  is this resolver, and applies wherever v3 resolves a rule name: the record, the request, the
  reconstruction): C2's single v3 eligibility resolver
  resolves each restriction's `person`, both persons of each conflict and every presence person
  through `resolveRulePersonId`, and the cadence setting through `cadenceMembers`, all over the same
  unfiltered roster (C2 RES-5, RES-7). v2 keeps its first-match resolution (E12; A7).
- **When it refuses** is the consumer's: C2's resolver refuses the whole build and names every
  refused `person` (C2 RES-7), so «Registrar», Auto's confirm (C6 builds both S1's eligibility and
  the record body from C2's output, A7) and C4's reconstruction (which calls the same resolver)
  refuse with it; C6's Auto also refuses before any read on a `cadenceMembers` refusal (C6 WN-2).
  C3's save does **not** refuse a name (its one cross-rule refusal is A38's exact-count check by `person` text, §6.2): the route holds no roster, and a later rename or new member can make
  a saved name ambiguous anyway, so only a build-time check is sound. C3 warns at edit time instead
  (§6.6).

### 6.6 The rule UI

All strings Spanish, as written here. Styling follows the existing chips and house components.

- **Form** (`PersonRestrictionForm`): below «Equidad», a `SegmentedControl` (CLAUDE.md: every
  one-of-N choice) labelled «Domingo» with «Normal» and «Mes por medio». Initialised from the edited
  restriction; «Normal» for a new one. With «Mes por medio» selected, help text:
  «Si el mes anterior no dirigió domingo, está en Líderes Domingo y puede al menos un domingo, ese mes
  le toca uno; en otro caso descansa y, si no dirige domingo, de preferencia dirige un sábado. Fuera
  de Líderes Domingo no le toca ni domingo ni sábado de compensación. Aplica con el nuevo solver; el
  solver actual no lo usa.» It follows X1 (all three «on» conditions; a Sunday she is rule-excluded
  from does not count, A14), X2 (the Saturday only in a month she leads no Sunday) and A14 (outside
  the Sunday line the state is `out`: no Sunday, no compensation Saturday).
- **`canAdd`**: true when a person is chosen and at least one of today's clauses is set **or**
  «Mes por medio» is selected. A restriction may carry the cadence alone.
- **Edit preserves everything.** Saving the form without touching it returns a restriction deep-equal
  to the one it opened — for a restriction carrying every field the type has. «Normal» leaves no key.
  This is a property of the form, not of the «Domingo» control: the form carries `sundayCadence`
  from `initialValues` to `onAdd`, and it keeps doing so after the UI-only rollback removes the
  control (§11).
- **Card** (`RestrictionCard`): a chip «Mes por medio» followed by the note «aplica con el nuevo
  solver». The Holgura chip reads «holgura N · no aplica con el nuevo solver». The Holgura help text
  in the form gains the sentence «No aplica con el nuevo solver.»; its specials sentence stays.
- **Ambiguity chip.** On a card carrying «Mes por medio» whose name is `ambiguous` over the unfiltered
  worship roster (§6.5 — the planner's `members`, which the resolver filters by ministry, so a kids
  volunteer never counts toward {n}, whoever is viewing): «Nombre ambiguo: coincide con {n} personas». Shown under both engines — it is about the
  data, not behaviour. An `unresolved` name is already reported by the existing banner (§6.4).
- **Engine-neutral copy.** C3 renders «aplica con el nuevo solver» unconditionally — true while v2 is
  the only engine, which it is for C3's whole life. Hiding it under v3 is C6's (§7). «no aplica con el
  nuevo solver» is true under both engines and stays.

### 6.7 The «not in Líderes Domingo» warning

- A pure predicate returns, for each **resolved** cadence member (§6.5) **whose Tipo is not empty**
  and who is outside the effective Sunday pool, `{ id, name, reason }` with `reason` one of:
  - `"not_ticked"` — carries the `sunday_lead` Tipo (`memberFitsPool`) but is not in
    `config.sundayLeads`;
  - `"no_sunday_lead_tipo"` — has a Tipo, but does not fit the Sunday pool: `memberFitsPool` needs
    `voz` **and** `sunday_lead` (`plannerModel.ts:806-818`), and she lacks one or both, so the
    checkbox cannot even be shown (E14). Ticked or not: a stale tick does not put her in the
    effective pool (C2 RES-1 below).
  `name` is the display name (`displayMemberName`). Refused names are not in this list; they have
  their own surfaces.
- **A cadence member with no Tipo is never in the list.** «No Tipo» is E23's definition
  (`(memberType ?? []).length === 0`). For her the outcome is not «descansa este mes»: C2's resolver
  refuses the whole v3 build (`no_tipo`, C2 RES-7), and C6 shows that refusal before any solve
  (C6 RQ-2, «… no tiene Tipo. Corrige …»). The predicate lists only what its two sentences describe
  truthfully, so the union of §7 item 4 stays two reasons.
- **A cadence member with a Tipo that lacks `voz`** is listed as `no_sunday_lead_tipo` — whether or
  not she carries `sunday_lead`, since the Tipo checkboxes are independent and «Líder Domingo» without
  «Voz» is reachable. Its sentence names both required Tipos and says she lacks them together, so it
  is true whichever one is missing. C2's resolver gives her no `people` item and records nothing — no
  refusal (C2 RES-5) — so she holds no voice seat at all that month, Sunday or Saturday.
- Copy, under a heading «Mes por medio fuera de Líderes Domingo»:
  - `not_ticked`: «{nombre} no está en Líderes Domingo: descansa este mes, sin domingo y sin sábado
    de compensación.»
  - `no_sunday_lead_tipo`: «{nombre} no tiene «Voz» y «Líder Domingo» a la vez en su Tipo: descansa
    este mes, sin domingo y sin sábado de compensación.» (the labels are `MEMBER_TYPE_LABEL`'s, the
    one Tipo display map)
  Both describe the `out` wire state of parent A14 (not eligible: no Sunday, no compensation
  Saturday), never `off`: either reason makes her `Sun.Lead` status `out` in C2's resolver (C2 RES-1:
  `Sun.Lead` is `in` iff she is in the Sunday pool and her Tipo fits), and C6 maps that to `out`
  (C6 RQ-4), which its panel reads «descansa: no está en la lista de Dom Lead» (C6 §7.7).
- **It renders only when the engine is v3.** Until C7, the cadence members sit in «Líderes Sábado»
  by design (parent D9, E4); under v2 the warning would list them every month and invite the one
  action that changes v2's behaviour — ticking them into «Líderes Domingo» makes v2 schedule them as
  regular Sunday leads every month. C3 ships the predicate, the copy and the rendering behind an
  explicit input that defaults to **closed**; C6 opens it when its server-resolved
  `effectiveEngine === "v3"` prop says so (parent A9; C6 ENG-3/ENG-4, WN-1) — never by comparing the
  `SOLVER_ENGINE` constant, which under a Preview override is not the effective engine (parent A1).
  The predicate reads the on-screen config only; C6 also leaves it closed for a record-bound month,
  whose cadence setting and eligibility are the record's (parent A6; C6 WN-1).

### 6.8 «Holgura» (Q2)

- Under v2: unchanged in storage, validation, request (`fairness_slack N`), filler and form.
- Under v3: the solver ignores it (parent A10; C6 RQ-4 sends none). The uncounted-specials filler
  keeps today's Exenta (median) / Holgura (load + N) ordering under v3 too (parent A10; C6 CTL-2;
  E19), so the form's specials sentence stays true and stays. C3's part is the copy of §6.6, which
  speaks of the solver only.

### 6.9 Seed and defaults

- `scripts/seed-solver-config.ts` keeps going through the same parser and `buildSolverConfigDocument`,
  so a capture containing the field is validated and stored identically to the route. It is not
  subject to the version guard (it has no envelope and only creates). Its dry-run summary and its
  REFUSING diff print «Mes por medio» for a restriction that carries it, so a difference in cadence
  is visible in the output a human reviews. A capture holding two `==` caps on one role for one
  `person` text is refused by the parser (§6.2, parent A38) and the script prints the issue path and
  writes nothing.
- `DEFAULT_SOLVER_CONFIG` (`solverConfigDefaults.ts:49-98`) does not change: no restriction there
  carries the cadence, and the optional field keeps it type-correct.

### 6.10 Studio

`solverRestriction` declares `sundayCadence` (string, title «Domingo», one listed value «Mes por
medio» = `alternate`, description «Interno: vacío = Normal»). The type stays hidden, read-only and in
both protection lists (`app/utils/studioProtection.ts:56`, `:165`); no action is added. The Content
Lake is schemaless (`solverConfig.ts:54-56`), so reading and writing do not depend on a schema
deploy.

### 6.11 Preserved

The `_key` invariant; create-never; `_rev` concurrency; the four client source states; Tipo as the
only eligibility axis (ADR-0029 — the cadence never makes anyone eligible, it only shapes a share);
v2's first-match name resolution; every MCP tool; `gcf/**` (untouched, so the Python gate does not
apply). The one change to what the v2 writer accepts is parent A38's exact-count check (§6.2, §6.4).

### 6.12 Failure and recovery

| Situation | Behaviour |
|---|---|
| Pre-C3 tab saves after release | 400 `invalid_request`/`configVersion`; «El servidor rechazó las reglas y no guardó nada.»; stored document unchanged; reloading the page loads the C3 bundle |
| C3 tab after a full rollback (§11) | A C3 tab that loaded **before** the revert writes once: the reverted route ignores the unknown `configVersion` key and its parser drops the field, so that first save erases every stored «Mes por medio»; its echo then lacks `configVersion` ⇒ save disabled with the reload notice. A C3 tab that loads after the revert sees a GET without `configVersion` and is disabled at once. Reloading loads the reverted bundle. The one lost write is the loss the full revert already plans for: §11 lists every stored setting before reverting |
| Invalid cadence value in a body | 400 with `restrictions[i].sundayCadence`; nothing written |
| Name unresolved / ambiguous | Saved as written; existing banner / ambiguity chip; C2's resolver (and with it «Registrar», Auto's confirm and C4) and C6's Auto refuse at build time, naming it (§6.5) |
| «Mes por medio» and an exact count covering `Sun.Lead` on one person | Saved as written, no warning in C3 (both are valid v2 data and the field is inert there); on production the pair exists only until C7's flip step, which removes the exact `Sun.Lead` rule (parent A28); under v3 C6 refuses the request naming the person and the rule (parent A11; C6 WN-2), and C5 refuses such a request with `invalid_request` (C5 §5.3) |
| Two `==` caps covering one role for one `person` text, in a body | 400 `invalid_request` at `restrictions[i].caps[j]:exact_overlap` (the later cap); nothing written; the client names the pair (§6.2, parent A38) |
| Such a pair already stored | The panel marks both cards; every save is refused, naming the pair, until one cap is removed; then the save passes |
| Such a pair spread over two spellings of one member | Saved (the save cannot see it); C2's validator and resolver refuse at build time by member id (parent A38; §7 obligations) |
| Cadence member with no Tipo | Not in the §6.7 warning; C2's resolver refuses the v3 build (`no_tipo`) and C6 names her before any solve |
| Lost commit race | Unchanged: `stale_revision` |

## 7. Interfaces

**C3 consumes from other children:** nothing (no prerequisites, parent §11). It consumes existing
code only: `rulePersonNamesMember` and `displayMemberName` (`app/utils/memberRuleNames.ts`),
`memberFitsPool` (`plannerModel.ts:813`), `rolesOfPattern` and `capLabel` (`plannerModel.ts:637`,
`:661`), `SegmentedControl`.

**C3 provides:**

1. **Stored field.** `solverConfig.restrictions[].sundayCadence?: "alternate"` — present only for
   «Mes por medio»; absent = «Normal»; never `null` or another string.
2. **Type.** `PersonRestriction.sundayCadence?: "alternate"` in `app/components/admin/plannerModel.ts`.
3. **Version guard** (`app/utils/solverConfigWriteRequest.ts`, neutral):
   - `export const SOLVER_CONFIG_VERSION = 2`;
   - POST body `{ rev: string; config: SolverConfig; configVersion: number }`;
   - GET and POST-success body `{ present: boolean; rev: string | null; config: SolverConfig | null;
     configVersion: number }`;
   - refusal: HTTP 400 `{ error: "invalid_request", conflict: false, message: string,
     details: { issues: ["configVersion"], expected: number, received: unknown } }`.
   - **Exact-count overlap** (parent A38), same module, neutral:
     ```ts
     type CapRef = { restriction: number; cap: number };   // indices in document order
     exactCapOverlaps(config: Pick<SolverConfig, "restrictions">):
       Array<{ first: CapRef; later: CapRef; person: string; roles: string[] }>;
       // every pair of `==` caps whose `rolesOfPattern` sets intersect, on one restriction or on two
       // whose `person` texts are equal case-insensitively after trimming; `roles` = the intersection,
       // in `rolesOfPattern`'s order; `person` = the earlier restriction's text; pairs in document order
     ```
     The parser refuses each distinct `later` once, with issue
     `restrictions[later.restriction].caps[later.cap]:exact_overlap` (HTTP 400 `invalid_request`, as
     any parser issue). The form, the panel and the client's
     refusal mapping call the same function (§6.2).
4. **Resolver** — `app/utils/sundayCadence.ts`, neutral (no `"use client"`, no `server-only`, no I/O),
   so a server route (C2), the planner (C6) and C4's script (through C2's resolver) import the same
   code:
   ```ts
   type RosterMember = { _id: string; member_name: string; alias?: string; memberType?: string[];
                         ministries?: unknown };   // stored value as read; absent/empty = worship
   type NameRefusal = { person: string; reason: "unresolved" | "ambiguous"; matches: string[] };

   resolveRulePersonId(person: string, roster: RosterMember[]):
     | { ok: true; id: string }
     | { ok: false; reason: "unresolved" | "ambiguous"; matches: string[] };   // matches: ids, sorted

   cadenceMembers(config: Pick<SolverConfig, "restrictions">, roster: RosterMember[]):
     { ids: string[]; refusals: NameRefusal[] };   // ids: unique, sorted; refusals: one per distinct person text

   cadenceOutsideSundayPool(config: Pick<SolverConfig, "restrictions" | "sundayLeads">, roster: RosterMember[]):
     Array<{ id: string; name: string; reason: "not_ticked" | "no_sunday_lead_tipo" }>;
     // resolved cadence members only, and only those whose Tipo is non-empty (§6.7)
   ```
   All three first drop every roster member for whom
   `normalizeMinistries(m.ministries).includes("worship")` is false (`app/ministries.ts`, neutral),
   then match over what remains (§6.5): a kids-only member is never a match, never counted toward
   `ambiguous`, never in `matches`, never in `ids`. `roster` may therefore be any superset of the
   worship roster that carries each member's stored `ministries` — the planner's `members` for any
   viewer role included (E25).
   The plan may not rename these without updating C2 and C6 in the same review cycle.
5. **Copy constants** (same module): `CADENCE_V2_NOTE = "aplica con el nuevo solver"`,
   `SLACK_V3_NOTE = "no aplica con el nuevo solver"`, and the two warning sentences of §6.7, so C6
   gates exactly these strings and tests assert one wording.
6. **The warning's gate**: an explicit boolean input on the config panel, default `false`. C6 passes
   `effectiveEngine === "v3"` (the server-resolved prop, C6 ENG-3/ENG-4; the prop's name is C6's — never the raw
   `SOLVER_ENGINE` constant), and C6 decides whether `CADENCE_V2_NOTE` hides under v3 on the same
   prop (C6 CTL-1). C6 also keeps the gate closed for a record-bound month (parent A6; C6 WN-1); the
   predicate itself does not know about records.
7. **The v2-view guarantee** of §6.4 (parent A8, A34): C4, C6 and C7 may rely on «saving «Mes por
   medio» changes nothing v2 does» — the reason it alone may be saved before C4's dry run and before
   C7's flip step (parent A22, A28; C4 A2), once the production alias serves C3 (parent A26). It does
   not cover the pool moves or the removal of a cadence member's exact `Sun.Lead` rule or `Sun.Lead`
   exclusion, which change v2 and therefore belong to the flip (A28).
8. **The one parser and serializer, for any other writer of rule values** (parent A29).
   `parseSolverConfigWrite`, `solverConfigFields` and `solverConfigFromDocument` are neutral and are
   the only way a restriction, cap, week exclusion, conflict, presence or cadence value reaches
   `solverConfig` with C3's guarantees (the field kept, «Normal» stored as absence, the A38 check,
   `_key == id`). Any writer other than the rules POST that **sets or restores** such a value — C7's
   rollback of the flip's paths included — reads the stored document through `solverConfigFromDocument`, changes only its target
   paths on that config, runs the result through `parseSolverConfigWrite` (refusing, and writing
   nothing, on any issue — an overlapping `==` pair a restore would reintroduce included), and writes
   only values `solverConfigFields` produced, under `ifRevisionId`. Whether it then POSTs the whole
   config (with `configVersion`) or patches only the changed paths is the writer's choice; a
   whole-document write from any other source is never sound (E3). The existing targeted writers of
   E15 stay as they are: the member DELETE patches only the three pool arrays, and the one-off repair
   script patches one `restrictions[_key==…].person` string — neither sets a value the parser
   validates beyond what it already holds.

**Obligations stated here, owned by the consumer:**

- **C2** (the single v3 eligibility resolver, parent A7) resolves every rule name it reads with
  `resolveRulePersonId` and the cadence setting with `cadenceMembers`, over the unfiltered worship
  roster, and refuses the whole build on any `unresolved`/`ambiguous` result or non-empty
  `refusals`, naming each `person` (C2 RES-5, RES-7). It stores the setting per member id
  (`sundayCadence: "alternate"` on the record's person), never the state (F7; C2 REC-3).
  **Parent A38, by member id:** C3's save check sees `person` text only (§6.2), so C2's record
  validator refuses two exact rules covering a common role for one person, and C2's eligibility
  resolver returns `ok: false`, naming the person, whenever the `==` caps of the restrictions that
  resolve to one member cover a common role over the six role keys — two spellings of one member
  and an overlap on `Sat.Choir` alone included — so its `ok: true` body always passes the validator
  (A38). The refusal reason's name is C2's.
- **C7** restores the flip's `solverConfig` paths through §7 item 8 (parent A29). Its rehearsal
  check that every cadence member is ready under v3 runs C2's resolver as well as
  `cadenceOutsideSundayPool`: a cadence member with no Tipo is absent from the latter by design
  (§6.7) and refused by the former (`no_tipo`).
- **C4** reaches the setting only through C2's resolver (C4 «Consumes from C3»), so the same
  refusals apply to the reconstruction. Its roster read projects each member's `ministries`
  (§6.5).
- **Every caller** of item 4's functions (C2's resolver, C6's planner, C4 and C7 through C2) passes
  members with their stored `ministries` as read, never stripped; the worship predicate is applied
  inside the functions, so no caller filters by ministry itself.
- **C6** builds the request's cadence members with `cadenceMembers` over the same roster (C6 RQ-4)
  and S1's eligibility and the confirm's record body from C2's resolver output (parent A7); refuses
  Auto before any read on a `cadenceMembers` refusal and on «Mes por medio» together with an exact
  count covering `Sun.Lead` (parent A11; C6 WN-2; Spanish copy is C6's); and opens the §6.7 gate
  under v3 (parent A9; C6 WN-1).
- **C5** receives cadence only as C6 sends it — a per-month `on` / `off` / `out` state per cadence
  member (parent A14; C5 §5.3), derived from C2's function and mapped to the wire by C6 (RQ-4); it
  never reads `solverConfig`.

## 8. Decisions

| Decision | Choice | Why | Tradeoffs / rejected | Owner |
|---|---|---|---|---|
| Field shape | Optional `"alternate"`, absence = Normal | Parent canonical; no migration; existing documents byte-identical | Required enum `"normal"\|"alternate"`: every stored restriction would change on the next save, for nothing | Parent (name); C3 (shape) |
| Protecting the field | Refuse a body without the current `configVersion` | E3–E6: an old tab cannot hold the field at all | **Server-side merge** of fields the body lacks: indistinguishable from a deliberate «Normal», which is also absence. **Requiring the field on every restriction**: guards this one field only; a version guards the next one too | C3 |
| Refusal code | `invalid_request` 400 with issue `configVersion` | E7: the only existing code a pre-C3 tab renders honestly without a dead-end reload | `stale_revision`: reload loop through a field-dropping reader. New code: «(error 409)» | C3 |
| v2 inertness | Whole-request and grid-verdict equivalence to `v2View` (parent A8) | E9 | Equivalence with only the field stripped: holds trivially and lets a cadence-only restriction inject into `support` (§6.4, §14) | C3 |
| When names are refused | At record/request build (C2's resolver; C6's Auto), warned at edit | No roster on the save route; renames make any save-time check stale | Refusing at save: a roster read on a critical writer, still unsound later | C3 |
| Ambiguity chip scope | Cadence restrictions only; under v3 every rule name is checked at build time by C2's resolver with C3's function (parent A7) | Under v2 an ambiguous non-cadence name has a defined first-match meaning that must not change (§6.4, A7); a chip there would alarm about behaviour v2 handles | A chip on every card: a v2-visible warning about a v3-only refusal, which C6 already names at Auto | C3 |
| «Not ticked» warning | Built in C3, rendered only under v3 | Under v2 it invites a v2-changing action (§6.7) | Rendering it under v2 with «don't tick yet» copy: noisy for months and easy to misread | C3; gate C6 |
| Engine-dependent copy | Rendered unconditionally in C3; C6 adapts on its effective-engine prop | C3 lands before C2's resolver exists (parent A1, §13), and no server-resolved engine reaches the rules panel until C6 passes it (C6 ENG-3, CTL-1); v2 is the only engine meanwhile, so unconditional copy is true. Reading `SOLVER_ENGINE` instead would be one more constant comparison C6 must find and rewire (ENG-4) | Gating on `SOLVER_ENGINE` now (C1's choice for its note): equivalent until C6, wrong under a Preview override after | C3 / C6 |
| Defaults | Unchanged | Shown only where no document exists; adding cadence there names people | — | C3 |
| A38 at save: identity | Same `person` text (case-insensitive, trimmed), within and across restrictions; two spellings of one member left to C2's build-time check by id | The route holds no roster (§6.5); a text match needs none and is exactly what the form can show | **Roster read on save**: a read on a critical writer, and still unsound after a rename. **Within one restriction only**: two cards for one person are reachable (E22) | Parent (rule); C3 (save half) |
| A38 at save: role coverage | `rolesOfPattern` (five keys) | Exists, neutral, solver-synced (E21); C3 lands before C2's six-key expansion | **Waiting for `rolesOfPatternV3`**: C3 has no prerequisites (parent §11). **A second six-key map in C3**: two expansions that can drift. The `Sat.Choir`-only gap is unreachable from the form and closed by C2 at build time | C3 |
| A stored overlap | Every save refused, naming the pair; both cards marked | Matches A38 («refused when saved»); removing one cap unblocks the next save | Accepting a stored pair until it is edited: a save path that bypasses the rule | C3 |
| Roster's ministry filter | Inside §7 item 4's functions (`normalizeMinistries`), over an optional `ministries` on `RosterMember` | E25: the planner's `members` differs by viewer role; filtering inside gives one answer per config for every viewer and every child, and adds no open-coded reader of the storage contract | **Caller-side filter as an obligation**: each of the planner, C2, C4 and C7 would have to remember it, and a forgotten one shows false «Nombre ambiguo» chips and v3 refusals for a super-admin only. **Narrowing the members route**: changes a super-admin's admin lists (they are the only role that edits `ministries`, `route.ts:20-21`) | C3 |
| Cadence member with no Tipo in the §6.7 warning | Left out | Its copy («descansa este mes») would be false: the v3 build refuses (C2 RES-7 `no_tipo`), and C6 RQ-2 names her before any solve | A third reason with «Auto no correrá…» copy: duplicates C6's refusal and changes §7 item 4's union that C6 (IF-C3, WN-1) and C7 consume | C3 |

## 9. Assumptions

A1–A6 below are this spec's assumptions (C7 cites «C3 A5»); the parent's amendments are always
written «parent A…».

| Assumption | Impact if false | Validation | Failure response |
|---|---|---|---|
| A1 Vercel Skew Protection is off for `owt-backstage` (Hobby plan) | An old tab's POST would be routed to the OLD deployment's route, which has no guard and drops the field | Before the merge to `main`: read the project's Skew Protection setting (Vercel → Project → Settings → Advanced, or `get_project`) and record it in the PR | Keep the release rule of §11 (no cadence saved) until the skew window has expired, and record that in the ADR |
| A2 No other whole-document writer of `solverConfig` exists (E15) | That writer drops the field | Plan re-greps `solverConfig\|SOLVER_CONFIG_DOC_ID` for `.set(`/`createOrReplace`/`.patch(` | If it sets or restores rule values: through §7 item 8 (parser, `solverConfigFields`, `ifRevisionId`; the version when it POSTs). A pool-array or single-`person` patch like E15's stays targeted |
| A3 No MCP tool reads `solverConfig` (E16) | An MCP reader would need the field | Plan re-greps `app/mcp`, `app/api/mcp` | Out of C3's scope; flag to the MCP owner |
| A4 Every roster handed to §7 item 4 carries each member's stored `ministries` and is a **superset** of the worship roster — never a `voz`, pool or Tipo subset. For the planner this is a fact (E25: worship-only for a worship admin, everyone for a super-admin; both supersets once the resolver filters) | A stripped `ministries` lets a kids-only namesake read as `ambiguous` and a kids-only-only name resolve (§6.5); a subset can hide a true namesake | Plan reads `ServicesPanel`'s member query, the planner's `MemberOption` types and C2's/C4's roster queries | The caller projects `ministries` and drops its subset filter (obligation, §7) |
| A5 The cadence members' names are unique today | v3 refuses until Frank disambiguates | C7 rehearsal runs `cadenceMembers` on the real roster | Frank edits the rule's name to an unambiguous alias |
| A6 No stored restriction set holds two `==` caps covering one role for one `person` text (E24) | After release every «Guardar reglas» is refused, naming the pair, until one cap is removed | Before the merge to `main`: a read-only query of the stored `solverConfig` run through `exactCapOverlaps`, result (count only, no names) recorded in the PR | Frank removes one cap of each pair in the UI after release; the save after that passes. No agent edits the rules |

## 10. Open questions (non-blocking, with bounded defaults)

| Q | Question | Why it matters | Recommendation and why | Owner | Blocking? | Resolution point | Default |
|---|---|---|---|---|---|---|---|
| Q-c | Final wording of the §6.6–§6.7 copy | Transparency is the parent's R4 | Ship as written; Frank reviews at C7's look | Frank | No | C7 | As written |
| Q-d | Should §6.7's predicate also name a cadence member whose `excludedPatterns` cover `Sun.Lead` (`Sun.Lead`, `Sun.*`, `*.Lead`, …)? | C2's resolver makes her `Sun.Lead` status `out` (C2 RES-2), so she is `out` every month (parent A14) while ticked in «Líderes Domingo»; the predicate, keyed on pool and Tipo, never lists her | No: the exclusion is visible on her own rule card, and C6's panel reads `out` as «descansa: no está en la lista de Dom Lead» (C6 §7.7). A third reason would change §7 item 4's union, which C6 WN-1 («its two sentences») and C7 (counts by reason) consume. On production the case does not survive the flip: C7's step removes a cadence member's `Sun.Lead` exclusion (parent A28) | Frank | No | C7 look | Not in C3's predicate |

Two earlier questions are closed by the parent and no longer open here: Q-a («Mes por medio» together
with an exact count covering `Sun.Lead`) by A11 — §6.12 — and Q-b (the exactly-one check for every v3
rule name) by A7 — §6.5.

## 11. Release, safe end state, rollback

**Release** (the `CLAUDE.md` order, plus one rule this change needs):

1. Feature branch, gates green (`tsc`, vitest, eslint 0 errors; `gcf/**` untouched).
2. Fresh code review of the diff; fixes re-verified.
3. Merge into `preview`, push, verify `dev-owt-backstage` serves the commit (alias + SHA).
4. **Look on dev without saving.** Open the rules, set «Mes por medio» on screen, see the chip, the
   help text and the Holgura note, then discard. A save on dev writes the production document (E18).
5. PR to `main`, `gates` green, merge; verify the production alias serves the merge commit. Before
   the merge, §9 A1's Skew Protection reading and A6's overlap count are recorded in the PR.
6. **No «Mes por medio» is saved on any deployment until step 5's verification passes** (parent A26).
   Until then, production runs the pre-C3 route, which has no guard and would erase the field on its
   next save of any rule. After it, pre-C3 tabs are refused (§6.2).
7. Setting the cadence for the real cadence members is Frank's action in the UI, when he chooses
   after step 6 — before C4's dry run, which needs it (parent A22; C4 A2), and independent of C7's
   flip step. It alone may precede the flip because it is inert under v2 (§6.4; parent A28). The
   flip covers flipping the constant and then every `solverConfig` edit v3 needs that v2 would read
   differently — moving the pools and removing a cadence member's exact `Sun.Lead` rule or `Sun.Lead`
   exclusion (parent A28) — and is C7's. No agent performs either.

**Safe end state.** The setting is storable, preserved by every writer, resolvable by id, shown as
«aplica con el nuevo solver», and inert under v2 (§6.4). Nothing reads it to change behaviour until
C2/C6.

**Rollback** (parent A26: UI-only, or a full revert only before C2 ships and after listing every
stored setting):

- **Preferred — UI-only rollback.** Remove the «Domingo» control, the «Mes por medio» chip, the
  ambiguity chip and the gated warning. Keep the type, parser, serializer, reader, resolver, the
  guard (`SOLVER_CONFIG_VERSION` stays 2) and the A38 check with its form and refusal copy (removing
  the check would let the v2 writer accept a pair C2 refuses). **Keep the form's data path:**
  `PersonRestrictionForm` still carries the edited restriction's `sundayCadence` from `initialValues`
  to `onAdd` unchanged — it can no longer set the value, only carry it — and `canAdd` still accepts a
  restriction whose only setting is that carried cadence, so a cadence-only card stays editable and
  its save keeps the field. Without this, the form builds its result from its own state
  (`MonthGenerator.tsx:675`, E6), so the first edit of any cadence card would write a restriction
  without the field; the client still sends version 2 and the guard would not stop it. After the
  rollback a cadence-only card shows no chip; the setting is still stored and still saved. T11's
  deep-equal preserve-on-edit test (fixture carrying every field the type has) and its cadence-only
  `canAdd` test on the edit path (`initialValues` carrying the cadence, the control never touched), with T7, T8 and T14, stay and pass **unmodified** on the rollback; a rollback change
  that removes or edits them is a full revert and follows that procedure. With those conditions met,
  stored settings survive and v2 is unchanged, at any time.
- This child's rollback is distinct from C7's rollback of the flip, which restores `solverConfig`
  paths through §7 item 8 (parent A29) and leaves C3 in place.
- **Full revert.** Only before C2 ships (C2, and through it C4 and C6, import the resolver and read
  the field); once C2 has shipped, only the UI-only rollback exists. Before it, list every stored
  cadence setting with a read-only query and keep the list with Frank: the reverted route drops the
  field on its next save. v2 behaviour is unchanged either way (§6.4). A C3-era tab loaded before
  the revert writes once, dropping the field, and then sees the reload notice (§6.12).
- **A deployment-level rollback is a full revert.** A Vercel Instant Rollback, or a promote, of
  production to a deployment older than C3 runs the pre-C3 route against the stored document, and so
  is the full revert above with the same conditions: only before C2 ships, and only after listing
  every stored cadence setting. Pointing `dev-owt-backstage` at a pre-C3 deployment is the same,
  because dev writes the same document (E18). Once C2 has shipped, a rollback that far is not one of
  this child's rollbacks (parent A26); an incident that forces it lists the stored settings first all
  the same.

## 12. Documentation in the same delivery

- `docs/DATA_MODEL.md`: the `solverConfig` section (`:345-393`) gains the field, the version guard,
  the bump rule and the one-exact-count-per-role rule; the `solverRestriction` row (`:431`) gains
  `sundayCadence?`.
- `CLAUDE.md`, «Don't-break-these invariants»: one bullet — the rules POST refuses a body without the
  current `SOLVER_CONFIG_VERSION`; a field or an allowed value an older client would drop or rewrite
  bumps it in the same change; the tripwire test is the guard; any other writer that sets or restores a rule value goes through the
  same parser and serializer (§7 item 8; E15's pool-array and single-`person` patches excepted —
  never again an `insert`/`append` of caps or restrictions as in the two private one-off scripts of
  E15); and a rule person has at most one `==` count per role key, refused at save by
  `exactCapOverlaps` (by text) and at v3 build by C2 (by member id).
- One ADR (numbered when it reaches `main`; C3 owns it, parent A31): the cadence is a restriction
  setting keyed by name (not `teamMembers`, ADR-0029), stored without its state, and protected by a
  refuse-not-merge version guard; the A38 save check's text-only identity and five-key coverage —
  with the rejected alternatives of §8; the rule that any other writer of rule values goes through
  the parser and serializer (§7 item 8), recording the two private one-off scripts of E15
  (2026-09-29, 2026-10-01: caps and restrictions appended with no parser) as the precedent it
  supersedes; the resolver's own worship filter (§6.5, E25); and the rollback rules of §11 (the UI-only rollback keeps the
  form's data path; an Instant Rollback or promote past C3 is a full revert). Amendments to existing
  ADRs are C7's (A31).
- `docs/SECRETS.md`: no new secret or environment variable — nothing to add.

## 13. Acceptance and verification

| ID | Requirement | Acceptance evidence | Method |
|---|---|---|---|
| T1 | R1 | Absent ⇒ no key in config or fields; `"alternate"` kept; `"normal"`, `"Alternate"`, `true`, `null`, `1` refused at `restrictions[i].sundayCadence` | Unit, `solverConfigWriteRequest.test.ts` |
| T2 | R1 | Serialised restriction has no `sundayCadence` key for «Normal»; fields for a cadence-free config equal the pre-C3 fields (fixture) | Unit |
| T3 | R1 | Reader: `"alternate"` ⇒ set; unknown value ⇒ «Normal»; write→read round trip keeps field and ids | Unit |
| T4 | R2 | POST with `configVersion` absent / `null` / `"2"` / `1` / `3` ⇒ 400 `invalid_request`, `issues: ["configVersion"]`, stored document never fetched, no patch; with `2` ⇒ today's behaviour (all existing route tests, bodies gaining `configVersion`); GET and POST echo carry `configVersion` | Route tests, `solverConfigRoute.test.ts` |
| T5 | R2 | A body exactly as a pre-C3 client sends it (`{rev, config}`, restriction without the field) against a stored document carrying «Mes por medio» ⇒ refused, document unchanged | Route test |
| T6 | R2, R10 | `useSolverConfig` sends `configVersion`; `saveFailure` maps the refusal to the outdated message with `stale: false` (no «Recargar reglas»); a GET with another or no `configVersion` disables «Guardar reglas» with the reload notice; a refusal carrying a `restrictions[i].caps[j]:exact_overlap` issue maps (a bare `restrictions[i].caps[j]` — a non-object cap — does not) to the two-exact-counts message naming the pair, `stale: false` | Hook/source tests |
| T7 | R2 | Tripwire: pinned key sets per level and pinned accepted-value sets for `sundayCadence`, `fairness` and cap `op` for version 2; adding a key or an accepted value without updating pin and constant fails | Unit |
| T8 | R3 | Corpus: for configs with cadence on a clause-bearing restriction, cadence-only for a pooled member, for an unpooled member (also pinned to a BGV seat), for a no-Tipo member, for an unresolvable name, and with a clause-less «Holgura 0» restriction that never carried it — `solverPools` (pools, `extraSupport`, no-Tipo block), `buildSolveRequest` (incl. refusals), `pinConflicts` over those pools, `allRulesToDs`, `evaluate` over a sample grid, `fairnessByMemberId` deep-equal between `C` and `v2View(C)`; the existing v2 suites (`plannerModel`, `solverPools`, `ruleEnforcement`, `localFill`, `pinViolations`, `saturdayFloors`, `trailingSaturday`, `leadPoolHistory`) pass **unmodified** | Unit + existing suites |
| T9 | R4 | Exactly one ⇒ id; none ⇒ `unresolved`; member_name of one equal to alias of another, or two equal aliases ⇒ `ambiguous` with both ids; case/trim behaviour identical to `rulePersonNamesMember`; union across restrictions, unique, sorted. Ministry filter, for all three functions: a worship member plus a kids-only (`ministries: ["kids"]`) namesake ⇒ the worship id, not `ambiguous`; a name matching only a kids-only member ⇒ `unresolved` and absent from `cadenceOutsideSundayPool`; `ministries` absent, `[]` and `["worship","kids"]` ⇒ kept; the same config over a worship-only roster and over that roster plus kids-only members (the two viewer roles of E25) ⇒ identical results | Unit |
| T10 | R6 | `not_ticked`, `no_sunday_lead_tipo`, ticked with a fitting Tipo ⇒ absent, ticked with «Líder Domingo» but no «Voz» ⇒ `no_sunday_lead_tipo`, refused names ⇒ absent, `memberType` absent or `[]` ⇒ absent (ticked or not), a Tipo without `voz` ⇒ `no_sunday_lead_tipo`; panel renders the warning with the gate open and nothing with it closed (default) | Unit + component |
| T11 | R5, R7 | Segmented «Domingo» renders and selecting «Mes por medio» on a new restriction with no clause makes `canAdd` true (removed with the control on the UI-only rollback); **edit path, no control touched:** the form opened with `initialValues` carrying `sundayCadence: "alternate"` and no clause has `canAdd` true and returns it unchanged, and the form opened with a restriction carrying every field the type has returns a deep-equal restriction (these two survive the UI-only rollback unmodified, §11 — neither selects anything in the «Domingo» control); card chip + «aplica con el nuevo solver»; Holgura chip note; ambiguity chip over the unfiltered worship roster, and no chip for a name shared only with a kids-only member; toggle on and off ⇒ «Guardado» | `MonthGenerator.ruleEdit.test.tsx` and peers |
| T12 | R8, R10 | Seed parses a capture with the field and its summary prints «Mes por medio»; a capture with an overlapping `==` pair is refused with its issue path and nothing written; defaults unchanged | Unit / script run without `--apply` against a fixture |
| T13 | R9 | Docs and ADR present; `studioProtection` tests unchanged and green | Code review's docs checklist |
| T14 | R10 | `exactCapOverlaps` and the parser: two `==` caps on one restriction covering `Sun.Lead` ⇒ refused at the later cap with `:exact_overlap`; three mutually overlapping caps ⇒ each later cap reported once; same on two restrictions whose `person` differs only in case and surrounding spaces ⇒ refused; `Sat.* == 1` with `*.Lead == 1` ⇒ refused on `Sat.Lead`; equal values and relative values ⇒ still refused; `==` beside `>=`/`<=` on the same role ⇒ accepted; two different `person` texts (a name and an alias of one member) ⇒ accepted at save; `Sat.* ==` with `*.Choir ==` ⇒ accepted (five-key map, the documented gap); every existing parser fixture and `DEFAULT_SOLVER_CONFIG` ⇒ no overlap. Form: an overlapping cap row shows its message and `canAdd` is false; panel marks both cards of a stored pair; removing one cap lets the save through | Unit + `MonthGenerator.ruleEdit.test.tsx` |
| — | All | `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors | Gates |

## 14. Parent issues

None open. The nine issues this spec raised against the approved parent are settled by its
amendments: P1 (L4's inertness covered rule strings only) by A8; P2 (no exactly-one name check) by
A7; P3 (the «not ticked» warning live under v2) by A9; P4 (Holgura and the specials filler) by A10;
P5 (cadence together with an exact `Sun.Lead` count) by A11; P6 (rollback underspecified) and P7 (the
Preview-first release window) by A26; P8 (A8's «with or without `sundayCadence`» protected nothing on
its own) by A34, whose wording is §6.4's `v2View`; P9 (L4 called the exactly-one check «the existing
rule-name validation») by A35. This spec cites the amendments in their place.

One reading is recorded rather than raised: A38 says the save refuses two exact rules «for the same
person»; a save holds no roster, so C3 reads «person» there as the rule's `person` text and leaves the
by-id half to C2's validator and resolver, which A38 names too (§6.2, §8).

## 15. Review handoff

- Review order: after the parent and C1 (parent «Review handoff»); critical tier — two sequential
  fresh `APPROVED` verdicts on byte-identical text; churn cap binding.
- Evidence for reviewers: this file; the repository at `c2c444fd` (code identical to `3dbc189b`,
  §3); the parent with its amendments A1–A40; C2 RES-5/RES-7/WR-4, C6 RQ-2/RQ-4/WN-1/WN-2/CTL-1/CTL-2,
  C6 §7.7 and C7 K3 for the cross-references. Prior planning dialogue is not needed; the private
  evidence directory backs one count (E24), which §9 A6 re-verifies before the merge, so reviewers
  need not open it.
- A material change here to §7 propagates to C2, C4, C6 and C7 (each restates §7's shapes) and
  restarts their review; a change to the Parent issues propagates to the parent. The previous
  revision changed §7: item 3 gains `exactCapOverlaps` and the A38 refusal; item 4's predicate
  excludes a cadence member with no Tipo (union unchanged); item 7 follows A28; item 8 (the parser and
  serializer for any other writer, A29) and the obligations on C2 (A38 by member id) and C7 (A29
  restore path; rehearsal runs C2's resolver too) are new. The round-1 revision changed
  no name or shape in §7: §11's UI-only rollback keeps the form's data path and retains T11's
  preserve-on-edit tests; §11 and §12 name a deployment-level rollback past C3 as a full revert; §6.4
  and T8 assert `solverPools`' own output and the pin board; §6.6 states edit preservation as a form
  property; §6.7 rewords the `no_sunday_lead_tipo` sentence (a value of an item-5 constant, not its
  name) and its reason definition, with T10's added case; the §6.12 rollback row states the one write
  a pre-revert tab makes; the amendment count is A1–A40.
- **This revision** (round-2 fixes) **changes §7 item 4's shape**: `RosterMember` gains
  `ministries?: unknown`, and all three functions apply the worship predicate
  (`normalizeMinistries`) to the roster before matching, because the planner's `members` includes
  kids-only members for a super-admin (E25). Names are unchanged; the field is optional, so C2's
  member shape (which already declares it) stays compatible. A new obligation asks every caller to
  pass `ministries` as read. It propagates to C2 (RES-5, §7's C3 row), C4, C6 and C7, which restate
  item 4's shape. Also: the bump rule and T7 cover allowed values as well as fields (§6.2, §6.3,
  §12); E15 and the ADR name the two private one-off writers as the precedent §7 item 8 supersedes;
  E24 is reworded to what the snapshot shows; T11's rollback-surviving tests are pinned to the edit
  path.
- Implementation authorization: **not granted by this document.**

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`
