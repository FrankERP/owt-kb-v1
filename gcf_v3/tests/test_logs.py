"""Request and response contents stay off every log (C5-17, spec §11.2, §12.1 «Handler»).

A request whose request_id, rule ids, carried P: keys, person ids, names and service ids
each carry a marker is run to success, to a stage stopped inside a `balance_max:P:<id>`
stage, to a `timeout`, to a refusal whose field names a marked id, and to an unexpected
KeyError whose key is a marked id. No log line (handler or CLI stderr) may contain the
marker. The checker and the harness summary over the same pairs: test_public_outputs.py.
"""

import io
import json
import os
import subprocess
import sys
import unittest
from contextlib import redirect_stderr

from ortools.sat.python import cp_model

from owt_v3.service import emit_log, handle
from tests.builders import NOV_SUNDAYS, person, request, service
from tests.test_stages import stub

MARK = "zq7marker"
GCF_V3 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def marked():
    s = [service(f"svc-{MARK}-1", NOV_SUNDAYS[0]), service(f"svc-{MARK}-2", NOV_SUNDAYS[1])]
    ids = [f"m-{MARK}-{i}" for i in range(6)]
    people = [person(pid, {x["id"]: ["Lead", "BGV", "Choir"] for x in s}, name=f"Name {MARK} {i}",
                     carried={f"P:pres-{MARK}": 10}) for i, pid in enumerate(ids)]
    rules = [{"id": f"pres-{MARK}", "kind": "presence", "persons": ids[:2], "roles": ["Sun.BGV"], "exclusive": False},
             {"id": f"cap-{MARK}", "kind": "count", "person": ids[2], "roles": ["Sun.Lead"], "op": "<=",
              "month": "2026-11", "value": 1},
             {"id": f"pair-{MARK}", "kind": "pair", "persons": ids[3:5], "roles": ["Sun.Lead"]}]
    return request(s, people, rules=rules, request_id=f"req-{MARK}")


def logged(body, **kw):
    status, resp, log = handle(body, **kw)
    with redirect_stderr(io.StringIO()) as err:
        emit_log(log)
    return status, resp, err.getvalue()


class Hygiene(unittest.TestCase):
    def assertClean(self, text):
        self.assertNotIn(MARK, text)

    def test_success_logs_counts_timings_and_public_labels(self):
        status, resp, line = logged(marked())
        self.assertEqual(status, 200)
        self.assertIn(MARK, json.dumps(resp))  # the wire carries ids by design
        self.assertClean(line)
        self.assertIn("balance_max:P#1", line)

    def test_a_stopped_presence_stage_logs_its_public_label(self):
        status, resp, line = logged(marked(), solver_for=stub({f"balance_max:P:pres-{MARK}"}))
        self.assertEqual(status, 200)
        self.assertClean(line)
        self.assertIn('"label": "balance_max:P#1", "limit"', line)

    def test_a_timeout_logs_code_stage_label_and_seconds(self):
        status, resp, line = logged(marked(), solver_for=stub({"rules"}))
        self.assertEqual((status, resp["code"]), (422, "timeout"))
        self.assertClean(line)

    def test_a_refusal_logs_its_code_only(self):
        body = marked()
        body["people"][0]["eligibility"][f"nope-{MARK}"] = ["Lead"]
        status, resp, line = logged(body)
        self.assertEqual((status, resp["code"]), (422, "unknown_service"))
        self.assertIn(MARK, json.dumps(resp))
        self.assertClean(line)

    def test_an_unexpected_key_error_logs_its_class_alone(self):
        class Boom(cp_model.CpSolver):
            def Solve(self, model, *a, **k):
                raise KeyError(f"m-{MARK}-0")
        status, resp, line = logged(marked(), solver_for=lambda stage: Boom())
        self.assertEqual((status, resp["code"]), (500, "internal_error"))
        self.assertClean(line)
        self.assertIn('"exception": "KeyError"', line)

    def test_the_cli_stderr_carries_no_marker(self):
        for body in (marked(), dict(marked(), contract=9)):
            done = subprocess.run([sys.executable, os.path.join(GCF_V3, "owt_solver_v3.py"), "--json-mode"],
                                  input=json.dumps(body).encode(), capture_output=True, timeout=120)
            self.assertEqual(done.returncode, 0)
            self.assertClean(done.stderr.decode())
            json.loads(done.stdout)


if __name__ == "__main__":
    unittest.main()
