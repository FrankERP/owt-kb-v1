"""
Tests for the GCF HTTP handler (main.py) — API-key guard fails closed, rejects
bad keys/methods, and still solves on a valid request. Stdlib unittest.

    python3 -m unittest test_main -v

functions_framework is stubbed so the handler imports without that dependency;
owt_solver_v2 (and its ortools import) must be importable to run these.
"""

import importlib
import json
import os
import sys
import types
import unittest

# Stub functions_framework BEFORE importing main (its @http decorator is a no-op).
_ff = types.ModuleType("functions_framework")
_ff.http = lambda fn: fn
sys.modules["functions_framework"] = _ff

from test_owt_solver_v2 import make_config  # a valid solver payload


class FakeRequest:
    def __init__(self, method="POST", headers=None, json_body=None):
        self.method = method
        self.headers = headers or {}
        self._json = {} if json_body is None else json_body

    def get_json(self, force=False, silent=False):
        return self._json


def _load_main(api_key):
    if api_key is None:
        os.environ.pop("OWT_SOLVER_API_KEY", None)
    else:
        os.environ["OWT_SOLVER_API_KEY"] = api_key
    import main
    return importlib.reload(main)  # re-reads _API_KEY from the env


class TestApiKeyGuard(unittest.TestCase):
    def test_fail_closed_when_key_unset(self):
        main = _load_main(None)
        _, status, _ = main.solve(FakeRequest(headers={"X-Api-Key": "anything"}))
        self.assertEqual(status, 503)  # never run unauthenticated

    def test_unauthorized_on_wrong_key(self):
        main = _load_main("secret")
        _, status, _ = main.solve(FakeRequest(headers={"X-Api-Key": "wrong"}))
        self.assertEqual(status, 401)

    def test_unauthorized_on_missing_key(self):
        main = _load_main("secret")
        _, status, _ = main.solve(FakeRequest(headers={}))
        self.assertEqual(status, 401)

    def test_method_not_allowed_before_solving(self):
        main = _load_main("secret")
        _, status, _ = main.solve(FakeRequest(method="GET", headers={"X-Api-Key": "secret"}))
        self.assertEqual(status, 405)

    def test_valid_request_solves(self):
        main = _load_main("secret")
        body, status, _ = main.solve(
            FakeRequest(headers={"X-Api-Key": "secret"}, json_body=make_config())
        )
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body).get("ok"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
