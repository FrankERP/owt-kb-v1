# ADR-0054: The fairness balance starts in November 2026

**Date:** 2026-10-12 · **Status:** Accepted

## Context

v3 carries each person's per-line balance over the three months before a plan
(ADR-0050) and its per-line stage pays the whole of it back in one plan: most-owed first,
then the sum of squares (ADR-0051). Those three months are August, September and October
2026, and v2 planned all three with no fairness history at all (ADR-0046): each month was
balanced within itself and the pool checkboxes decided across months. Their records exist
(C4 reconstructed August and September, October was registered from dev on 2026-10-12), so
the ledger now measures three months of v2 plans against recorded eligibility, and the gaps
it finds are what a solver that never tried to balance across months leaves behind. Nobody
was promised them.

The November + December rehearsal on dev (2026-10-12, October counting) showed the cost.
The C5 checker passed the plan, and no line inside it was more than 0.09 seats apart, but
paying August–October back in full left two members with two seats in two months and one
member with no BGV seat at all. Every complaint had that one cause.

## Decision

Balances count from **`FAIRNESS_BALANCE_START = "2026-11"`** (`app/utils/fairnessVocabulary.ts`),
the first month v3 plans. `computeFairnessLedger` takes it as `balanceStart`; the ledger GET
(`app/utils/fairnessLedgerRead.ts`) is the one caller that passes it, so the «Equidad · vista
previa» panel and Auto's carried balances (`v3People.ts`) read the same figures.

A record before the start is still read, for what it says about people and not as a debt:
who is listed (RD-5), `firstRecordedIn` (the new-lead protection's `dl_since`), the exemption,
`countedSundayLeads` («Mes por medio» and `prev_dl_leads`) and the seats `held`. It adds
nothing to `window`, `cumulative`, `tabs`, `sang` or `notInRecordSeats`. Its month carries the
`before_balance_start` note, and the panel's chip reads «antes del inicio, no cuenta».
`recordsSince` is the first *counted* recorded month, and the GET returns `balanceStart`.
No record is deleted or rewritten.

## Rejected

- **Pay the balance back in part, a share per plan.** This changes C5's approved stage design,
  its spec, the golden fixture and a review cycle. That takes days, so November would be planned
  on v2. It would also still collect, more slowly, debts v2 created.
- **Per-person minimums at the cutover.** They patch the cases someone noticed, keyed by name
  text (rules match by alias, and an alias edit already broke one rule). Everyone else would
  still pay back in one plan.
- **Accept it.** The window would even out by February, but November and December would be
  planned to pay for v2's months.
- **Delete or rewrite the August–October records.** Only the reconstruction actor deletes. The
  records are true, and the new-lead protection and «Mes por medio» need them.
- **Make the start a default inside the ledger, or a solver constant.**
  `fixtures/fairness/golden.json` (the contract with C5) is August–October with target
  November, and C4's reconstruction preview judges August and September themselves. A default
  would empty both, so the cut is an input that only the GET passes. The solver never sees
  records, only the carried balances the GET already cut.
- **An environment variable or a Sanity setting.** It is one fixed date. Preview and
  production read the same records, so they must agree, and nothing calls for changing it
  per deployment.

## Consequences

Whoever was owed seats in August–October also starts at zero. The largest such balance, 4.8
seats, belongs to someone who already sings every Sunday. A plan for January
balances against November and December only, and the window holds three counted months again
from the February plan on. Moving the constant later reopens every balance before it, so
treat it as fixed history. Removing the cut, or passing no `balanceStart` from the GET, brings
back the rehearsal's result: November and December paying for v2's months.
