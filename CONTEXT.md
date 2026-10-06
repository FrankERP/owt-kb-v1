# OWT Backstage

Internal app for the Oasis Worship Team: song library, weekly setlists, role
assignments, availability, and setlist proposals.

## Language

**Registro de elegibilidad** (`fairnessMonth`):
The record, once per calendar month, of who was eligible for which voice role —
each person's six role keys as `in`, `out` or `exact`, her fixed counts, «Mes por
medio», «Exenta», the dates she was unavailable or excluded by a rule, and the
presence rules. It is what the month was planned with; seats are never stored in it.
Written by «Registrar», by Auto's confirm (v3) or by the reconstruction script.
_Avoid_: history, snapshot of the pools

**Saldo**:
A person's balance on one line over a window: the share of the seats she was owed
(«le tocaba») minus the seats she had («tuvo»). Positive = «le deben»; negative =
«de más». Over every person of a service the exact saldos sum to zero.
_Avoid_: deuda, score

**Línea**:
One of the four fairness ledgers a person carries: Dom Lead (`DL`), Sáb Lead (`SL`),
BGV and Coro. Instruments and FOH have none. «Total» is their sum, for display only.
_Avoid_: rol (a role key is finer: Sun.BGV and Sat.BGV are both the BGV line)

**Sub-línea de presencia** (`P:<regla>`):
The line a presence rule opens for its members: at a weekend service the rule covers,
the one seat its members hold is shared among those of them who were eligible and
available, and folded into the BGV tab for display. A rule's key is a private
identifier — never printed outside a manager surface.
_Avoid_: presence line (in Spanish copy), regla de presencia (the rule, not its line)
