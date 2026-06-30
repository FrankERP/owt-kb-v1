"""
Google Cloud Function — OWT Solver HTTP endpoint.

Deployment (from project root):
    bash scripts/deploy-solver-gcf.sh

Environment variables (set via --set-env-vars or Cloud Console):
    OWT_SOLVER_API_KEY   — shared secret; Vercel sends it as X-Api-Key header.
                           Leave unset to disable key checks (not recommended).
"""

import json
import os
import sys

import functions_framework

# owt_solver_v2.py lives alongside this file (single source of truth for the solver).
sys.path.insert(0, os.path.dirname(__file__))
from owt_solver_v2 import solve_from_dict  # noqa: E402

_API_KEY = os.environ.get("OWT_SOLVER_API_KEY", "")


@functions_framework.http
def solve(request):
    # CORS preflight (not strictly needed for server-to-server calls, but harmless)
    if request.method == "OPTIONS":
        return ("", 204, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Api-Key",
        })

    if request.method != "POST":
        return (json.dumps({"ok": False, "error": "Method not allowed"}), 405,
                {"Content-Type": "application/json"})

    # API key guard
    if _API_KEY and request.headers.get("X-Api-Key") != _API_KEY:
        return (json.dumps({"ok": False, "error": "Unauthorized"}), 401,
                {"Content-Type": "application/json"})

    try:
        data = request.get_json(force=True, silent=True) or {}
    except Exception:
        return (json.dumps({"ok": False, "error": "Invalid JSON body"}), 400,
                {"Content-Type": "application/json"})

    result = solve_from_dict(data)
    status = 200 if result.get("ok") else 422
    return (json.dumps(result), status, {"Content-Type": "application/json"})
