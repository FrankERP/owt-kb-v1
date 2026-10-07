"""Determinism (S5, spec §10): the same request and seed give byte-identical responses apart
from timing fields — in one process, and across processes with different PYTHONHASHSEED —
with and without pins. Only runs where every stage is proven promise it."""

import json
import os
import subprocess
import sys
import unittest

from owt_v3.service import handle
from tests.test_model import random_request

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "owt_solver_v3.py")


def strip(resp):
    out = dict(resp)
    out.pop("total_ms", None)
    out.pop("build", None)
    out["stages"] = [{k: v for k, v in s.items() if k != "ms"} for s in resp["stages"]]
    return json.dumps(out, sort_keys=True)


def bodies():
    with_pins = random_request(5)
    assert with_pins["pins"], "the fixture request must carry pins"
    without = random_request(5)
    without["pins"] = []
    return {"with pins": with_pins, "without pins": without}


class SameProcess(unittest.TestCase):
    def test_two_runs_are_identical(self):
        for label, body in bodies().items():
            _, a, _ = handle(json.loads(json.dumps(body)))
            _, b, _ = handle(json.loads(json.dumps(body)))
            self.assertTrue(a["reproducible"], label)
            self.assertEqual(strip(a), strip(b), label)


class AcrossProcesses(unittest.TestCase):
    def test_hash_seeds_do_not_matter(self):
        for label, body in bodies().items():
            outs = []
            for hash_seed in ("0", "12345"):
                env = dict(os.environ, PYTHONHASHSEED=hash_seed)
                done = subprocess.run([sys.executable, SCRIPT, "--json-mode"], input=json.dumps(body).encode(),
                                      capture_output=True, env=env, timeout=120)
                outs.append(strip(json.loads(done.stdout)))
            self.assertEqual(outs[0], outs[1], label)


if __name__ == "__main__":
    unittest.main()
