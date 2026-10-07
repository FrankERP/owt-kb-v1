"""The `--json-mode` CLI (spec §11.1): one request on stdin, one response on stdout, exit 0."""

import json
import os
import subprocess
import sys
import unittest

from tests.test_request import EXAMPLE

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "owt_solver_v3.py")


def run(stdin, *args):
    return subprocess.run([sys.executable, SCRIPT, *args], input=stdin, capture_output=True, timeout=120)


class JsonMode(unittest.TestCase):
    def test_solves_one_request(self):
        done = run(json.dumps(EXAMPLE).encode(), "--json-mode")
        self.assertEqual(done.returncode, 0)
        self.assertTrue(json.loads(done.stdout)["ok"])

    def test_a_refusal_still_exits_zero(self):
        done = run(json.dumps({"contract": 2}).encode(), "--json-mode")
        self.assertEqual(done.returncode, 0)
        self.assertEqual(json.loads(done.stdout)["code"], "contract_mismatch")

    def test_unparseable_json_is_invalid_json(self):
        done = run(b"{nope", "--json-mode")
        self.assertEqual((done.returncode, json.loads(done.stdout)["code"]), (0, "invalid_json"))

    def test_without_the_flag_it_prints_usage(self):
        self.assertEqual(run(b"{}").returncode, 2)

    def test_runs_from_the_repository_root(self):
        root = os.path.dirname(os.path.dirname(SCRIPT))
        done = subprocess.run([sys.executable, "gcf_v3/owt_solver_v3.py", "--json-mode"], cwd=root,
                              input=json.dumps({"contract": 3, "ping": True}).encode(), capture_output=True,
                              timeout=60)
        self.assertEqual(json.loads(done.stdout)["pin_cap"], 250)


if __name__ == "__main__":
    unittest.main()
