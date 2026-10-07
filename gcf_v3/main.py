"""Google Cloud Function — the OWT solver v3 HTTP endpoint (`owt-solver-v3`, entry `solve`).

Deployed from `gcf_v3/` by `gcf_v3/cloudbuild.yaml` (trigger `owt-solver-v3-deploy`) or
by `scripts/deploy-solver-v3-gcf.sh`. Imports nothing from `gcf/` (v2).

Environment:
    OWT_SOLVER_API_KEY    shared secret, from Secret Manager `owt-solver-api-key`; Vercel
                          sends it as `X-Api-Key`. REQUIRED: unset or empty fails closed (503).
    OWT_SOLVER_V3_BUILD   the deployed commit, echoed as `build` (absent → "unknown").
"""

import hmac
import json
import os
import sys

import functions_framework

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from owt_v3.service import emit_log, failure, handle_raw  # noqa: E402

_API_KEY = os.environ.get("OWT_SOLVER_API_KEY", "")  # read once, at import (spec §11.2)

_CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Api-Key",
}
_JSON = {"Content-Type": "application/json"}


def _answer(status, body, log):
    emit_log(log)
    return (json.dumps(body), status, _JSON)


@functions_framework.http
def solve(request):
    try:
        if request.method == "OPTIONS":
            return ("", 204, _CORS)
        if request.method != "POST":
            return _answer(405, failure("method_not_allowed"), {"event": "owt-solver-v3", "http": 405,
                                                                 "code": "method_not_allowed"})
        # API key guard — FAIL CLOSED: the function is publicly invokable, so the key is the
        # only barrier to a CPU-heavy solve. An unset key rejects everything.
        if not _API_KEY:
            return _answer(503, failure("misconfigured"), {"event": "owt-solver-v3", "http": 503,
                                                            "code": "misconfigured"})
        sent = request.headers.get("X-Api-Key") or ""
        if not hmac.compare_digest(sent.encode("utf-8"), _API_KEY.encode("utf-8")):
            return _answer(401, failure("unauthorized"), {"event": "owt-solver-v3", "http": 401,
                                                           "code": "unauthorized"})
        status, body, log = handle_raw(request.get_data())
        return _answer(status, body, log)
    except Exception as e:  # never a message, an argument or a traceback
        return _answer(500, failure("internal_error"), {"event": "owt-solver-v3", "http": 500,
                                                         "code": "internal_error",
                                                         "exception": type(e).__name__})
