"""The HTTP entry point (spec §11.2): v2's fail-closed guard, reproduced, plus v3's codes.

functions_framework is stubbed so the handler imports without it (CI installs it anyway).
"""

import importlib
import io
import json
import os
import sys
import types
import unittest
from contextlib import redirect_stderr
from unittest import mock

_ff = types.ModuleType("functions_framework")
_ff.http = lambda fn: fn
sys.modules["functions_framework"] = _ff

from tests.test_request import EXAMPLE  # noqa: E402


class FakeRequest:
    def __init__(self, method="POST", headers=None, body=b""):
        self.method = method
        self.headers = headers or {}
        self._body = body

    def get_data(self):
        return self._body


def load_main(api_key):
    if api_key is None:
        os.environ.pop("OWT_SOLVER_API_KEY", None)
    else:
        os.environ["OWT_SOLVER_API_KEY"] = api_key
    import main
    return importlib.reload(main)  # re-reads the key, as a new instance would


def call(main, req):
    with redirect_stderr(io.StringIO()) as err:
        body, status, headers = main.solve(req)
    return status, (json.loads(body) if body else None), err.getvalue()


class ApiKeyGuard(unittest.TestCase):
    def test_fail_closed_when_key_unset(self):
        status, body, _ = call(load_main(None), FakeRequest(headers={"X-Api-Key": "anything"}))
        self.assertEqual((status, body["code"]), (503, "misconfigured"))

    def test_fail_closed_when_key_empty(self):
        status, _, _ = call(load_main(""), FakeRequest(headers={"X-Api-Key": ""}))
        self.assertEqual(status, 503)

    def test_unauthorized_on_wrong_key(self):
        status, body, _ = call(load_main("secret"), FakeRequest(headers={"X-Api-Key": "wrong"}))
        self.assertEqual((status, body["code"]), (401, "unauthorized"))

    def test_unauthorized_on_missing_key(self):
        status, _, _ = call(load_main("secret"), FakeRequest(headers={}))
        self.assertEqual(status, 401)

    def test_method_not_allowed_before_anything(self):
        status, body, _ = call(load_main("secret"), FakeRequest(method="GET", headers={"X-Api-Key": "secret"}))
        self.assertEqual((status, body["code"]), (405, "method_not_allowed"))

    def test_options_is_cors(self):
        body, status, headers = load_main("secret").solve(FakeRequest(method="OPTIONS"))
        self.assertEqual(status, 204)
        self.assertIn("X-Api-Key", headers["Access-Control-Allow-Headers"])

    def test_valid_request_solves(self):
        status, body, _ = call(load_main("secret"), FakeRequest(headers={"X-Api-Key": "secret"},
                                                                  body=json.dumps(EXAMPLE).encode()))
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual((body["contract"], body["engine"]), (3, "v3"))

    def test_the_key_is_compared_in_constant_time(self):
        main = load_main("secret")
        with mock.patch.object(main.hmac, "compare_digest", wraps=main.hmac.compare_digest) as spy:
            call(main, FakeRequest(headers={"X-Api-Key": "wrong"}))
        spy.assert_called_once_with(b"wrong", b"secret")


class Answers(unittest.TestCase):
    def test_unparseable_json_is_400(self):
        status, body, _ = call(load_main("secret"), FakeRequest(headers={"X-Api-Key": "secret"}, body=b"{nope"))
        self.assertEqual((status, body), (400, {"ok": False, "contract": 3, "engine": "v3", "code": "invalid_json",
                                                "params": {}}))

    def test_a_refusal_is_422(self):
        status, body, _ = call(load_main("secret"), FakeRequest(headers={"X-Api-Key": "secret"},
                                                                  body=json.dumps({"contract": 2}).encode()))
        self.assertEqual((status, body["code"]), (422, "contract_mismatch"))

    def test_the_ping_answers_and_builds_no_model(self):
        main = load_main("secret")
        with mock.patch.dict(os.environ, {"OWT_SOLVER_V3_BUILD": "abc1234"}):
            status, body, _ = call(main, FakeRequest(headers={"X-Api-Key": "secret"},
                                                     body=json.dumps({"contract": 3, "ping": True}).encode()))
        self.assertEqual((status, body), (200, {"ok": True, "contract": 3, "engine": "v3", "solver_version": "3.0.0",
                                                "build": "abc1234", "pin_cap": 250}))

    def test_a_500_carries_no_stack_trace(self):
        main = load_main("secret")
        with mock.patch.object(main, "handle_raw", side_effect=RuntimeError("boom at /secret/path")):
            status, body, err = call(main, FakeRequest(headers={"X-Api-Key": "secret"}, body=b"{}"))
        self.assertEqual((status, body["code"]), (500, "internal_error"))
        self.assertNotIn("Traceback", json.dumps(body) + err)
        self.assertNotIn("boom", json.dumps(body) + err)
        self.assertIn('"exception": "RuntimeError"', err)


if __name__ == "__main__":
    unittest.main()
