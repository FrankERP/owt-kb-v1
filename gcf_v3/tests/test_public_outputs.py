"""Public outputs carry no request identifier (C5-17 (2)): the independent checker's result and
the harness's summary over the marked pairs of test_logs.py hold counts, codes and public labels."""

import json
import unittest

from acceptance import checker
from acceptance.run import Summary
from owt_v3.service import handle
from tests.test_logs import MARK, marked
from tests.test_stages import stub


class PublicOutputs(unittest.TestCase):
    def test_the_checker_and_the_summary_carry_no_marker(self):
        summary = Summary("ci")
        for kw in ({}, {"solver_for": stub({f"balance_max:P:pres-{MARK}"})}, {"solver_for": stub({"rules"})}):
            body = marked()
            resp = handle(body, **kw)[1]
            self.assertNotIn(MARK, json.dumps(checker.check(body, resp)))
            summary.add_run(body, resp)
        text = json.dumps(summary.as_dict())
        self.assertNotIn(MARK, text)
        self.assertIn("balance_max:P#1", text)


if __name__ == "__main__":
    unittest.main()
