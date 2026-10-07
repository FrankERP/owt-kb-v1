"""The v3 solver's local entry point — C6's local-dev path, the v3 equivalent of
`app/api/admin/solve/route.ts`'s `--json-mode` spawn of v2.

    python gcf_v3/owt_solver_v3.py --json-mode < request.json > response.json

Reads one request on stdin and writes one response on stdout. Exits 0, including for
`ok: false`. Stderr carries the same log lines as the HTTP handler and nothing else.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from owt_v3.service import emit_log, failure, handle_raw  # noqa: E402


def main(argv):
    if argv[1:] != ["--json-mode"]:
        print("usage: owt_solver_v3.py --json-mode < request.json", file=sys.stderr)
        return 2
    try:
        _, body, log = handle_raw(sys.stdin.buffer.read())
    except Exception as e:  # never a message or a traceback
        body, log = failure("internal_error"), {"event": "owt-solver-v3", "http": 500,
                                                "code": "internal_error", "exception": type(e).__name__}
    emit_log(log)
    sys.stdout.write(json.dumps(body))
    sys.stdout.write("\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
