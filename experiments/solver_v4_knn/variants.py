"""Ablations of the v4 prototype on the Nov+Dec run (seeds 1..N): which dimension earns its place."""
import statistics
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compare import harness, world_mod, use, run_metrics, knn_v4, ENGINES  # noqa: E402

VARIANTS = {
    "v4 (todo)": {},
    "deuda en medios asientos (0.5)": {"debt_step": 0.5},
    "deuda en asientos enteros (1.0)": {"debt_step": 1.0},
    "sin escasez futura": {"use_scarcity": False},
    "sin obligaciones": {"use_obligations": False},
    "por fecha (no lo más escaso primero)": {"by_constraint": False},
    "1 dimensión (solo conteo total)": {"one_dimension": True},
    "v4 + intercambios (búsqueda local)": {"improve": True},
}


def main(seeds):
    data = world_mod.load_world(harness.WORLD)
    reqs = []
    for seed in range(1, seeds + 1):
        use("v3")
        reqs.append(harness.Env(data).base(seed).request(harness.RUN_A, seed))
    rows = {"v3": [run_metrics(r, ENGINES["v3"](r)[1]) for r in reqs]}
    for name, opts in VARIANTS.items():
        rows[name] = [run_metrics(r, knn_v4.handle(r, **opts)[1]) for r in reqs]
    for name, rs in rows.items():
        m = lambda k: round(statistics.fmean(x[k] for x in rs), 2)
        print(f"{name:40s} vacíos={m('unfilled'):5} reglas={m('rules_broken'):5} protecciones={m('missed_total'):5} "
              f"Σ²líneas={m('sq_lines'):6} Σ²total={m('sq_total'):6} más_debido_total={m('most_owed_total')}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 5)
