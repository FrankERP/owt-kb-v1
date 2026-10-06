"""The OWT solver v3 package (`owt-solver-v3`; spec
docs/superpowers/specs/2026-10-05-solver-v3-c5-solver-function-design.md).

Imported as `owt_v3`: `gcf_v3/` is the top-level directory of its test job
(`python -m unittest discover -s gcf_v3 -t gcf_v3 -v`). Nothing here may import
the v2 tree (`gcf/`); `scripts/__tests__/ciLayout.test.ts` enforces that, because
the start directory alone does not.

Modules, in dependency order: constants, codes (+ codes.json), vocab, rounding,
request, formula, facts, plan, instances, report, model, stages, solver, service.
"""
