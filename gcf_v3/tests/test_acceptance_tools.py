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
