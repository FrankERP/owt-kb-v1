"""The acceptance tools that need no chain (spec §11.5, §13): the smoke request and the
timing-gate shapes A–D."""

import json
import os
import tempfile
import unittest

from acceptance import run
from owt_v3.request import parse_request
from owt_v3.service import handle

ACCEPTANCE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "acceptance")


class Smoke(unittest.TestCase):
    def test_the_smoke_request_proves_every_stage(self):
        with open(os.path.join(ACCEPTANCE, "smoke.json"), encoding="utf-8") as f:
            body = json.load(f)
        status, resp, _ = handle(body)
        self.assertEqual(status, 200)
        self.assertTrue(resp["reproducible"])
        self.assertTrue(all(s["status"] == "proven" for s in resp["stages"]))


class TimingShapes(unittest.TestCase):
    def test_emit_requests_writes_shapes_a_to_d(self):
        with tempfile.TemporaryDirectory() as d:
            names = run.emit_requests(run.WORLD, d)
            self.assertEqual(names, ["A", "B", "C", "D"])
            shapes = {}
            for n in names:
                with open(os.path.join(d, f"shape-{n}.json"), encoding="utf-8") as f:
                    shapes[n] = json.load(f)
        months = {n: parse_request(b).months for n, b in shapes.items()}
        self.assertEqual(months, {"A": ("2026-11",), "B": ("2026-11", "2026-12"), "C": ("2026-10", "2026-11"),
                                  "D": ("2026-11", "2026-12")})
        sundays = sum(1 for s in shapes["C"]["services"] if s["kind"] == "sunday")
        saturdays = sum(1 for s in shapes["C"]["services"] if s["kind"] == "saturday")
        self.assertEqual((sundays, saturdays), (9, 9))  # 4+5 Sundays, a Saturday every week incl. Oct 31
        self.assertTrue(90 <= len(shapes["D"]["pins"]) <= 100)  # «about 100»: every seat of B, pinned


if __name__ == "__main__":
    unittest.main()


class HarnessGuards(unittest.TestCase):
    def test_report_exact_rejects_an_unexpected_extra(self):
        from acceptance import scenarios
        resp = {"ok": True, "violations": [], "notices": [],
                "missed": [{"code": "sunday_cap_exceeded", "cause": "higher_priority"}]}
        self.assertTrue(scenarios._exact([({}, resp)], [{"m": [("sunday_cap_exceeded", "higher_priority")]}]))
        self.assertFalse(scenarios._exact([({}, resp)], [{}]))
        self.assertFalse(scenarios._exact([({}, {**resp, "ok": False})], [{}]))

    def test_a_failed_setup_solve_is_a_harness_error(self):
        from acceptance import x1
        self.assertEqual(run._setup(({}, {"ok": True}), "x"), ({}, {"ok": True}))
        with self.assertRaises(x1.HarnessError):
            run._setup(({}, {"ok": False, "code": "timeout"}), "base")


class EmitChecksX1First(unittest.TestCase):
    """§12.3: the timing shapes stand on a base chain the X1 double drove, so `--emit-requests`
    checks the double against the fixture's cadence cases first and refuses on a mismatch."""

    def _disagreeing_fixture(self, d):
        from acceptance import x1
        with open(x1.FIXTURE, encoding="utf-8") as f:
            fixture = json.load(f)
        case = next(c for c in fixture["cases"] if c.get("kind") == "cadence")
        case["expected"][0]["state"] = "off" if case["expected"][0]["state"] == "on" else "on"
        path = os.path.join(d, "golden.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(fixture, f)
        return path

    def test_a_disagreeing_double_emits_nothing(self):
        from unittest import mock
        from acceptance import x1
        real = x1.check_against_fixture
        with tempfile.TemporaryDirectory() as d:
            bad = self._disagreeing_fixture(d)
            out = os.path.join(d, "shapes")
            with mock.patch.object(x1, "check_against_fixture", side_effect=lambda: real(bad)), \
                    mock.patch.object(run, "load_world", side_effect=AssertionError("a chain ran")):
                with self.assertRaises(x1.HarnessError):
                    run.emit_requests(run.WORLD, out)
            self.assertFalse(os.path.exists(out))

    def test_main_reports_the_harness_error_and_exits_2(self):
        import contextlib
        import io
        from unittest import mock
        from acceptance import x1
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "shapes")
            stdout = io.StringIO()
            with mock.patch.object(x1, "check_against_fixture",
                                   side_effect=x1.HarnessError("the test double disagrees")), \
                    contextlib.redirect_stdout(stdout):
                code = run.main(["--emit-requests", out])
            self.assertEqual(code, 2)
            self.assertEqual(json.loads(stdout.getvalue()), {"harness_error": "the test double disagrees"})
            self.assertFalse(os.path.exists(out))
