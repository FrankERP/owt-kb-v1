# Solver v3 — C3: the «Mes por medio» Sunday cadence in the rule set — design spec

**Date:** 2026-10-05 · **Status:** `DRAFT` · **Parent:**
[`2026-10-05-solver-v3-fairness-design.md`](2026-10-05-solver-v3-fairness-design.md) (`APPROVED` by
Frank), which assigns this child L4 (§6), the F7/F8 settings it stores, Q2's default and §14
assumption 4; aligned with the parent's amendments A1–A26 (§3 there; A1, A6, A7, A8, A9, A10,
A11, A14, A22 and A26 touch this child). · **Risk tier: critical** — it changes the validator, the serializer and the
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
  identical for a config and its v2 view (§6.4; parent A8); the resolver returns one id per cadence
  member or names the refusal.

## 3. Evidence

All paths are relative to the repository root; line numbers verified on `3dbc189b`, and no file
under `app/`, `sanity/`, `scripts/`, `docs/DATA_MODEL.md` or `CLAUDE.md` changed between it and
`2d90e4b3` (`git diff --stat 3dbc189b 2d90e4b3 -- …` is empty), so they hold there too.

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
| E15 | The only other writers of `solverConfig`: member DELETE patches the three pool arrays only; a one-off rule-name repair script in `scripts/` patches one `restrictions[_key==…].person` path; the seed creates only when absent | `app/api/admin/members/[id]/route.ts:163-193`; `scripts/` (grep `restrictions[_key==`); `scripts/seed-solver-config.ts:187-220` | No other whole-document writer exists today; targeted patches keep sibling fields |
| E16 | No MCP tool reads or writes `solverConfig`; `solve_month` (P4) is unbuilt | `grep -rln 'solverConfig\|SOLVER_CONFIG\|restrictions' app/mcp app/api/mcp` → no match; `docs/MCP.md:36` | The MCP solve path is untouched by construction |
| E17 | `invalid_request` is HTTP 400 and non-conflict; `stale_revision` is 409 | `app/utils/serviceMutation.ts:17-47`, `:61-65` | Chooses the refusal's code (§6.2) |
| E18 | Preview and production read and write the same `solverConfig` (one dataset); `preview` deploys before `main` | `CLAUDE.md` «Vercel safety»; parent E4 | For the length of the release window, production's pre-C3 route is a live writer of a document that dev may have extended (§11) |
| E19 | The «Equidad» help text already says Exenta/Holgura act on the weekend total band and on the specials filler (exempt = median, slack = load + N) | `MonthGenerator.tsx:733-753`; `localFill.ts:117-151` | Holgura still acts on the filler, and keeps doing so under v3 (parent A10; C6 CTL-2); the v3 note speaks of the solver only |

## 4. Requirements

| ID | Requirement | Rationale | Acceptance criterion |
|---|---|---|---|
| R1 | A restriction may carry `sundayCadence: "alternate"` («Mes por medio»); absence means «Normal». No other value is ever stored, and «Normal» is never stored explicitly | Parent canonical name; no migration; every existing document stays byte-identical | Parser, serializer and reader tests (§13 T1–T3) |
| R2 | Every path that writes the whole document preserves the field, and a body from a client that predates it is refused before any read or write | E3–E6; parent L4 | Route tests T4–T5; client test T6; tripwire T7 |
| R3 | v2 is inert to the setting: its whole solve request and its grid verdicts for a config equal those for the config's v2 view (§6.4) | Parent §9 «v2 path byte-identical» and A8; E9 | Equivalence corpus T8; existing v2 suites unmodified and green |
| R4 | The setting resolves to member ids through one function that returns exactly one id per cadence name or names why not (unresolved, ambiguous); the same exactly-one function resolves any single rule name for C2's v3 eligibility resolver | Parent L4 and A7; E11–E13 | Resolver tests T9 |
| R5 | The rule UI offers «Domingo: Normal / Mes por medio», shows it on the card, allows a restriction that carries only it, and preserves it on edit | Parent U7, §6 L4 | UI tests T11 |
| R6 | A pure predicate names every resolved cadence member outside the effective Sunday pool, with copy; it renders only when the engine is v3 (gate wired by C6) | Parent §14 assumption 4 and A9 | T10 |
| R7 | «Holgura» stays selectable and unchanged under v2; its card says «no aplica con el nuevo solver» | Parent Q2, F8 | T11 |
| R8 | The seed script and the defaults handle the field without behaviour change | Task scope; E15 | T12 |
| R9 | Documentation and the ADR land in the same delivery | `CLAUDE.md` Conventions, Decision records | Docs audit at code review |

## 5. Scope

### In scope

- `sanity/schemas/solverConfig.ts`: the field on `solverRestriction` (Studio inspection only).
- `PersonRestriction` (`plannerModel.ts`): the optional field.
- `parseSolverConfigWrite`, `solverConfigFields`, `solverConfigFromDocument`
  (`solverConfigWriteRequest.ts`): validate, store, read.
- The config version guard: the constant, the POST refusal, the GET/POST echo, the client's send and
  its mapping of the refusal (`route.ts`, `useSolverConfig.ts`, `solverConfigSource.ts`).
- v2 inertness (§6.4), including the one v2 reader that must learn to look past a cadence-only
  restriction (`solverPools`).
- A neutral resolver module (§7) and the «not ticked» predicate.
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
- Moving the cadence members into «Líderes Domingo» and emptying «Líderes Sábado» — C7's single flip
  step (parent A22). Saving their «Mes por medio» on production — Frank, in the UI, once the
  production alias serves C3 (parent A26) and before C4's dry run (parent A22; C4 A2). **No agent
  saves rules on production** (`CLAUDE.md`: production Sanity writes need explicit consent).
- Ambiguity checks for v2's other rules: v2 keeps first-match resolution (E12) unchanged (parent A7).
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
- **The bump rule.** Any later change that adds a field to the stored document that an older client
  would drop bumps `SOLVER_CONFIG_VERSION` in the same change. A tripwire test pins, for the current
  version, the exact key set `solverConfigFields` emits at each of its levels (document, restriction,
  week exclusion, cap, conflict, presence); adding a key without editing that pin and the constant
  together fails the suite.
- **Unchanged:** auth (manager, content-editor excluded, `route.ts:59-64`), create-never
  (`route.ts:135-145`), the `_rev` check and `ifRevisionId`, `sanityConflictKind` classification,
  `updatedAt`/`updatedBy`, the seed's create-only path. The guard is an extra refusal ahead of them,
  never a replacement.

**Validation of the field** (in the parser both the route and the seed use):

- absent ⇒ «Normal», no key in the canonical config or in the stored fields;
- `"alternate"` ⇒ kept and stored;
- anything else, `null` included ⇒ refused with issue path `restrictions[i].sundayCadence`, nothing
  written (the module's rule: reject what the UI cannot produce, `solverConfigWriteRequest.ts:26-35`).

### 6.3 The read path

- The reader returns `sundayCadence: "alternate"` exactly when the stored value is `"alternate"`; any
  other stored value reads as «Normal» (total and defensive, like `fairness` today). A value a future
  version writes is therefore read as «Normal» by this version — and that version's bump refuses this
  version's saves, so the value is never erased by it.
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

- `buildSolveRequest` returns a deep-equal result for `C` and `v2View(C)` — `ok`, `request` (pools,
  `support` injection, `dsl_rules` in order, `history`), `omittedCaps`, `trailing`, and the `reason`
  string of every refusal, including the no-Tipo refusal (E9);
- the planner grid's rule verdicts (`evaluate`, `ruleViolationsForColumn`), `fairnessByMemberId`,
  the pin-violation copy, `priorMonthLeadVisibility` and the Saturday helpers answer identically for
  `C` and `v2View(C)`;
- `allRulesToDs` produces the same strings in the same order.

This is the parent's A8 («the whole v2 solve request and the grid's rule verdicts are identical with
or without `sundayCadence`»), with «without» read as `v2View(C)`: removing only the field would leave a
clause-less restriction that still reaches `solverPools` (E9), so the literal reading is satisfied
by today's code and protects nothing (§14).

**The one deliberate difference.** `unresolvedRuleNames` also reports the name of a cadence-only
restriction that matches nobody. It is a warning, not part of the solve, and an unresolvable cadence
name is a broken rule the admin must fix before v3 (it is the zero-match half of «the existing
rule-name validation» parent L4 cites; the exactly-one half is §6.5).

**Why this needs code, not only a test** (E9): `solverPools` takes the `person` of every restriction,
so a cadence-only restriction naming someone in no pool would inject them into v2's `support`, and one
naming a member with no Tipo would make v2 refuse the month. The plan chooses where the v2 view is
applied; the equivalence corpus (T8) is the guard.

### 6.5 Name resolution (exactly one)

- The cadence is keyed by the restriction's `person`, like every rule. It is resolved to a member id
  by a neutral function (§7) using **the existing matching criterion** (`rulePersonNamesMember`,
  `memberRuleNames.ts:37-45`) and one new condition: **exactly one** member of the roster matches.
  Zero matches ⇒ `unresolved`; two or more ⇒ `ambiguous`, with the matching ids. Neither is guessed.
- The roster passed in is the **unfiltered** worship roster the caller resolves every other rule name
  against — never the `voz`-filtered list the form uses (E13), never a pool. A filtered list can hide
  a namesake and turn an ambiguous name into a resolved one.
- Several restrictions may carry the cadence for the same member (different spellings, or two cards):
  the result is the union, each id once, in a stable order (by id).
- **The same function serves every v3 rule name** (parent A7): C2's single v3 eligibility resolver
  resolves each restriction's `person`, both persons of each conflict and every presence person
  through `resolveRulePersonId`, and the cadence setting through `cadenceMembers`, all over the same
  unfiltered roster (C2 RES-5, RES-7). v2 keeps its first-match resolution (E12; A7).
- **When it refuses** is the consumer's: C2's resolver refuses the whole build and names every
  refused `person` (C2 RES-7), so «Registrar», Auto's confirm (C6 builds both S1's eligibility and
  the record body from C2's output, A7) and C4's reconstruction (which calls the same resolver)
  refuse with it; C6's Auto also refuses before any read on a `cadenceMembers` refusal (C6 WN-2).
  C3's save does **not** refuse: the route holds no roster, and a later rename or new member can make
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
- **Card** (`RestrictionCard`): a chip «Mes por medio» followed by the note «aplica con el nuevo
  solver». The Holgura chip reads «holgura N · no aplica con el nuevo solver». The Holgura help text
  in the form gains the sentence «No aplica con el nuevo solver.»; its specials sentence stays.
- **Ambiguity chip.** On a card carrying «Mes por medio» whose name is `ambiguous` over the unfiltered
  roster: «Nombre ambiguo: coincide con {n} personas». Shown under both engines — it is about the
  data, not behaviour. An `unresolved` name is already reported by the existing banner (§6.4).
- **Engine-neutral copy.** C3 renders «aplica con el nuevo solver» unconditionally — true while v2 is
  the only engine, which it is for C3's whole life. Hiding it under v3 is C6's (§7). «no aplica con el
  nuevo solver» is true under both engines and stays.

### 6.7 The «not in Líderes Domingo» warning

- A pure predicate returns, for each **resolved** cadence member (§6.5) outside the effective Sunday
  pool, `{ id, name, reason }` with `reason` one of:
  - `"not_ticked"` — carries the `sunday_lead` Tipo (`memberFitsPool`) but is not in
    `config.sundayLeads`;
  - `"no_sunday_lead_tipo"` — lacks it, so the checkbox cannot even be shown (E14).
  `name` is the display name (`displayMemberName`). Refused names are not in this list; they have
  their own surfaces.
- Copy, under a heading «Mes por medio fuera de Líderes Domingo»:
  - `not_ticked`: «{nombre} no está en Líderes Domingo: descansa este mes, sin domingo y sin sábado
    de compensación.»
  - `no_sunday_lead_tipo`: «{nombre} no tiene el Tipo «Líder Domingo»: descansa este mes, sin domingo
    y sin sábado de compensación.»
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
  is visible in the output a human reviews.
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
apply).

### 6.12 Failure and recovery

| Situation | Behaviour |
|---|---|
| Pre-C3 tab saves after release | 400 `invalid_request`/`configVersion`; «El servidor rechazó las reglas y no guardó nada.»; stored document unchanged; reloading the page loads the C3 bundle |
| C3 tab after a full rollback (§11) | GET lacks `configVersion` ⇒ save disabled with the reload notice; reload loads the reverted bundle |
| Invalid cadence value in a body | 400 with `restrictions[i].sundayCadence`; nothing written |
| Name unresolved / ambiguous | Saved as written; existing banner / ambiguity chip; C2's resolver (and with it «Registrar», Auto's confirm and C4) and C6's Auto refuse at build time, naming it (§6.5) |
| «Mes por medio» and an exact count covering `Sun.Lead` on one person | Saved as written, no warning in C3 (both are valid v2 data and the field is inert there); under v3 C6 refuses the request naming the person and the rule (parent A11; C6 WN-2), and C5 refuses such a request with `invalid_request` (C5 §5.3) |
| Lost commit race | Unchanged: `stale_revision` |

## 7. Interfaces

**C3 consumes from other children:** nothing (no prerequisites, parent §11). It consumes existing
code only: `rulePersonNamesMember` and `displayMemberName` (`app/utils/memberRuleNames.ts`),
`memberFitsPool` (`plannerModel.ts:813`), `SegmentedControl`.

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
4. **Resolver** — `app/utils/sundayCadence.ts`, neutral (no `"use client"`, no `server-only`, no I/O),
   so a server route (C2), the planner (C6) and C4's script (through C2's resolver) import the same
   code:
   ```ts
   type RosterMember = { _id: string; member_name: string; alias?: string; memberType?: string[] };
   type NameRefusal = { person: string; reason: "unresolved" | "ambiguous"; matches: string[] };

   resolveRulePersonId(person: string, roster: RosterMember[]):
     | { ok: true; id: string }
     | { ok: false; reason: "unresolved" | "ambiguous"; matches: string[] };   // matches: ids, sorted

   cadenceMembers(config: Pick<SolverConfig, "restrictions">, roster: RosterMember[]):
     { ids: string[]; refusals: NameRefusal[] };   // ids: unique, sorted; refusals: one per distinct person text

   cadenceOutsideSundayPool(config: Pick<SolverConfig, "restrictions" | "sundayLeads">, roster: RosterMember[]):
     Array<{ id: string; name: string; reason: "not_ticked" | "no_sunday_lead_tipo" }>;
   ```
   The plan may not rename these without updating C2 and C6 in the same review cycle.
5. **Copy constants** (same module): `CADENCE_V2_NOTE = "aplica con el nuevo solver"`,
   `SLACK_V3_NOTE = "no aplica con el nuevo solver"`, and the two warning sentences of §6.7, so C6
   gates exactly these strings and tests assert one wording.
6. **The warning's gate**: an explicit boolean input on the config panel, default `false`. C6 passes
   `effectiveEngine === "v3"` (the server-resolved prop, C6 ENG-3/ENG-4; the prop's name is C6's — never the raw
   `SOLVER_ENGINE` constant), and C6 decides whether `CADENCE_V2_NOTE` hides under v3 on the same
   prop (C6 CTL-1). C6 also keeps the gate closed for a record-bound month (parent A6; C6 WN-1); the
   predicate itself does not know about records.
7. **The v2-view guarantee** of §6.4 (parent A8): C4, C6 and C7 may rely on «saving «Mes por medio»
   changes nothing v2 does» — the reason it may be saved before C4's dry run and outside C7's flip
   step (parent A22; C4 A2), once the production alias serves C3 (parent A26).

**Obligations stated here, owned by the consumer:**

- **C2** (the single v3 eligibility resolver, parent A7) resolves every rule name it reads with
  `resolveRulePersonId` and the cadence setting with `cadenceMembers`, over the unfiltered worship
  roster, and refuses the whole build on any `unresolved`/`ambiguous` result or non-empty
  `refusals`, naming each `person` (C2 RES-5, RES-7). It stores the setting per member id
  (`sundayCadence: "alternate"` on the record's person), never the state (F7; C2 REC-3).
- **C4** reaches the setting only through C2's resolver (C4 «Consumes from C3»), so the same
  refusals apply to the reconstruction.
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

## 9. Assumptions

A1–A5 below are this spec's assumptions (C7 cites «C3 A5»); the parent's amendments are always
written «parent A…».

| Assumption | Impact if false | Validation | Failure response |
|---|---|---|---|
| A1 Vercel Skew Protection is off for `owt-backstage` (Hobby plan) | An old tab's POST would be routed to the OLD deployment's route, which has no guard and drops the field | Before the merge to `main`: read the project's Skew Protection setting (Vercel → Project → Settings → Advanced, or `get_project`) and record it in the PR | Keep the release rule of §11 (no cadence saved) until the skew window has expired, and record that in the ADR |
| A2 No other whole-document writer of `solverConfig` exists (E15) | That writer drops the field | Plan re-greps `solverConfig\|SOLVER_CONFIG_DOC_ID` for `.set(`/`createOrReplace`/`.patch(` | It must go through `solverConfigFields` and send the version, or patch targeted paths only |
| A3 No MCP tool reads `solverConfig` (E16) | An MCP reader would need the field | Plan re-greps `app/mcp`, `app/api/mcp` | Out of C3's scope; flag to the MCP owner |
| A4 The planner's `members` is the unfiltered worship roster | Ambiguity judged over a subset | Plan reads `ServicesPanel`'s member query and the C2 roster query | C2/C6 pass the unfiltered roster (obligation, §7) |
| A5 The cadence members' names are unique today | v3 refuses until Frank disambiguates | C7 rehearsal runs `cadenceMembers` on the real roster | Frank edits the rule's name to an unambiguous alias |

## 10. Open questions (non-blocking, with bounded defaults)

| Q | Question | Why it matters | Recommendation and why | Owner | Blocking? | Resolution point | Default |
|---|---|---|---|---|---|---|---|
| Q-c | Final wording of the §6.6–§6.7 copy | Transparency is the parent's R4 | Ship as written; Frank reviews at C7's look | Frank | No | C7 | As written |
| Q-d | Should §6.7's predicate also name a cadence member whose `excludedPatterns` cover `Sun.Lead` (`Sun.Lead`, `Sun.*`, `*.Lead`, …)? | C2's resolver makes her `Sun.Lead` status `out` (C2 RES-2), so she is `out` every month (parent A14) while ticked in «Líderes Domingo»; the predicate, keyed on pool and Tipo, never lists her | No: the exclusion is visible on her own rule card, and C6's panel reads `out` as «descansa: no está en la lista de Dom Lead» (C6 §7.7). A third reason would change §7 item 4's union, which C6 WN-1 («its two sentences») and C7 (counts by reason) consume | Frank | No | C7 look | Not in C3's predicate |

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
5. PR to `main`, `gates` green, merge; verify the production alias serves the merge commit.
6. **No «Mes por medio» is saved on any deployment until step 5's verification passes** (parent A26).
   Until then, production runs the pre-C3 route, which has no guard and would erase the field on its
   next save of any rule. After it, pre-C3 tabs are refused (§6.2).
7. Setting the cadence for the real cadence members is Frank's action in the UI, when he chooses
   after step 6 — before C4's dry run, which needs it (parent A22; C4 A2), and independent of C7's
   flip step, which covers only moving the pools and flipping the constant (parent A22). It is inert
   under v2 (§6.4). No agent performs it.

**Safe end state.** The setting is storable, preserved by every writer, resolvable by id, shown as
«aplica con el nuevo solver», and inert under v2 (§6.4). Nothing reads it to change behaviour until
C2/C6.

**Rollback** (parent A26: UI-only, or a full revert only before C2 ships and after listing every
stored setting):

- **Preferred — UI-only rollback.** Remove the control, chip, ambiguity chip and gated warning; keep the
  type, parser, serializer, reader, resolver and the guard. Stored settings survive; v2 is unchanged.
  Safe at any time.
- **Full revert.** Only before C2 ships (C2, and through it C4 and C6, import the resolver and read
  the field); once C2 has shipped, only the UI-only rollback exists. Before it, list every stored
  cadence setting with a read-only query and keep the list with Frank: the reverted route drops the
  field on its next save. v2 behaviour is unchanged either way (§6.4). C3-era
  tabs then see the reload notice (§6.12).

## 12. Documentation in the same delivery

- `docs/DATA_MODEL.md`: the `solverConfig` section (`:345-393`) gains the field, the version guard and
  the bump rule; the `solverRestriction` row (`:431`) gains `sundayCadence?`.
- `CLAUDE.md`, «Don't-break-these invariants»: one bullet — the rules POST refuses a body without the
  current `SOLVER_CONFIG_VERSION`; a field an older client would drop bumps it in the same change; the
  tripwire test is the guard.
- One ADR (numbered when it reaches `main`): the cadence is a restriction setting keyed by name
  (not `teamMembers`, ADR-0029), stored without its state, and protected by a refuse-not-merge
  version guard — with the rejected alternatives of §8.
- `docs/SECRETS.md`: no new secret or environment variable — nothing to add.

## 13. Acceptance and verification

| ID | Requirement | Acceptance evidence | Method |
|---|---|---|---|
| T1 | R1 | Absent ⇒ no key in config or fields; `"alternate"` kept; `"normal"`, `"Alternate"`, `true`, `null`, `1` refused at `restrictions[i].sundayCadence` | Unit, `solverConfigWriteRequest.test.ts` |
| T2 | R1 | Serialised restriction has no `sundayCadence` key for «Normal»; fields for a cadence-free config equal the pre-C3 fields (fixture) | Unit |
| T3 | R1 | Reader: `"alternate"` ⇒ set; unknown value ⇒ «Normal»; write→read round trip keeps field and ids | Unit |
| T4 | R2 | POST with `configVersion` absent / `null` / `"2"` / `1` / `3` ⇒ 400 `invalid_request`, `issues: ["configVersion"]`, stored document never fetched, no patch; with `2` ⇒ today's behaviour (all existing route tests, bodies gaining `configVersion`); GET and POST echo carry `configVersion` | Route tests, `solverConfigRoute.test.ts` |
| T5 | R2 | A body exactly as a pre-C3 client sends it (`{rev, config}`, restriction without the field) against a stored document carrying «Mes por medio» ⇒ refused, document unchanged | Route test |
| T6 | R2 | `useSolverConfig` sends `configVersion`; `saveFailure` maps the refusal to the outdated message with `stale: false` (no «Recargar reglas»); a GET with another or no `configVersion` disables «Guardar reglas» with the reload notice | Hook/source tests |
| T7 | R2 | Tripwire: pinned key sets per level for version 2; adding a key without updating pin and constant fails | Unit |
| T8 | R3 | Corpus: for configs with cadence on a clause-bearing restriction, cadence-only for a pooled member, for an unpooled member, for a no-Tipo member, for an unresolvable name, and with a clause-less «Holgura 0» restriction that never carried it — `buildSolveRequest` (incl. refusals), `allRulesToDs`, `evaluate` over a sample grid, `fairnessByMemberId` deep-equal between `C` and `v2View(C)`; the existing v2 suites (`plannerModel`, `solverPools`, `ruleEnforcement`, `localFill`, `pinViolations`, `saturdayFloors`, `trailingSaturday`, `leadPoolHistory`) pass **unmodified** | Unit + existing suites |
| T9 | R4 | Exactly one ⇒ id; none ⇒ `unresolved`; member_name of one equal to alias of another, or two equal aliases ⇒ `ambiguous` with both ids; case/trim behaviour identical to `rulePersonNamesMember`; union across restrictions, unique, sorted | Unit |
| T10 | R6 | `not_ticked`, `no_sunday_lead_tipo`, ticked ⇒ absent, refused names ⇒ absent; panel renders the warning with the gate open and nothing with it closed (default) | Unit + component |
| T11 | R5, R7 | Segmented «Domingo» renders; cadence-only restriction can be added; edit without changes returns a deep-equal restriction carrying every field; card chip + «aplica con el nuevo solver»; Holgura chip note; ambiguity chip over the unfiltered roster; toggle on and off ⇒ «Guardado» | `MonthGenerator.ruleEdit.test.tsx` and peers |
| T12 | R8 | Seed parses a capture with the field and its summary prints «Mes por medio»; defaults unchanged | Unit / script run without `--apply` against a fixture |
| T13 | R9 | Docs and ADR present; `studioProtection` tests unchanged and green | Code review's docs checklist |
| — | All | `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors | Gates |

## 14. Parent issues

The seven issues this spec raised against the approved parent are settled by its amendments: P1
(L4's inertness covered rule strings only) by A8; P2 (no exactly-one name check) by A7; P3 (the
«not ticked» warning live under v2) by A9; P4 (Holgura and the specials filler) by A10; P5 (cadence
together with an exact `Sun.Lead` count) by A11; P6 (rollback underspecified) and P7 (the
Preview-first release window) by A26. This spec now cites the amendments in their place. Two
wording points remain; the parent is followed meanwhile, as this spec reads it below.

- **P8 — A8's «with or without `sundayCadence`» is satisfied by today's code and protects nothing on
  its own.** v2 never reads the field, so a config compared with itself minus the field always
  yields the same request — yet a restriction carrying **only** the cadence still reaches
  `solverPools`, which injects its `person` into `support` or refuses the month for a member with no
  Tipo (E9). The protection the parent wants needs the cadence-only restriction removed as well.
  **Fix:** A8 reads «… identical for a config and its v2 view (C3 §6.4: the field removed from every
  restriction, and a restriction that carried only it removed)». Followed meanwhile: §6.4's
  `v2View`.
- **P9 — L4 still calls the exactly-one check «the existing rule-name validation».** The existing
  validation (`unresolvedRuleNames`, `ruleEnforcement.ts:225-249`) reports zero matches only and
  v2 resolves by first match (`plannerModel.ts:572-578`); the exactly-one check is C3's
  `resolveRulePersonId` (§6.5). A7 says so, but A7 names §11, not L4, and the amendments' own rule
  makes a row win only over the clause it names. **Fix:** A7 also names L4, or L4 reads «(C3's
  exactly-one resolver; v2 keeps its first-match resolution)». Followed meanwhile: A7's meaning.

## 15. Review handoff

- Review order: after the parent and C1 (parent «Review handoff»); critical tier — two sequential
  fresh `APPROVED` verdicts on byte-identical text; churn cap binding.
- Evidence for reviewers: this file; the repository at `2d90e4b3` (code identical to `3dbc189b`,
  §3); the parent with its amendments A1–A26; C2 RES-5/RES-7, C6 RQ-4/WN-1/WN-2/CTL-1/CTL-2 and
  C6 §7.7 for the cross-references. Prior planning dialogue and the private evidence directory are
  not needed for this child.
- A material change here to §7 propagates to C2, C4, C6 and C7 (each restates §7's shapes) and
  restarts their review; a change to the Parent issues propagates to the parent.
- Implementation authorization: **not granted by this document.**

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW`
