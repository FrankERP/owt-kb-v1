"""The code registry (`codes.json`, spec §9) and the one refusal type.

Every code the function emits goes through `code()` or `Refusal`, which raise on a
name the registry does not list, so an unlisted code cannot reach the wire.
`audit_response` re-checks a finished response the same way (tests, checker).
"""

import json
import os

_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "codes.json")
with open(_PATH, encoding="utf-8") as _f:
    REGISTRY = json.load(_f)

GROUPS = REGISTRY["groups"]


def _template_match(group, name):
    """The registry entry `name` falls under: itself, or a `prefix:{line}` template."""
    entries = GROUPS[group]
    if name in entries:
        return name
    for entry in entries:
        if entry.endswith(":{line}") and name.startswith(entry[: -len("{line}")]):
            if len(name) > len(entry) - len("{line}"):
                return entry
    return None


def is_listed(group, name):
    return group in GROUPS and isinstance(name, str) and _template_match(group, name) is not None


def code(group, name):
    """Return `name` after checking the registry lists it under `group`."""
    if not is_listed(group, name):
        raise AssertionError(f"code not in codes.json: {group}/{name}")
    return name


def params_of(group, name):
    return list(GROUPS[group][_template_match(group, name)])


class Refusal(Exception):
    """An `ok: false` answer with a registered `error` code (HTTP 422 unless stated)."""

    def __init__(self, name, **params):
        code("error", name)
        expected = params_of("error", name)
        if sorted(params) != sorted(expected):
            raise AssertionError(f"params of {name} must be {expected}")
        super().__init__(name)
        self.code = name
        self.params = params


def _check(problems, group, name, where):
    if not is_listed(group, name):
        problems.append(f"{where}: {group}/{name!r} not in codes.json")


def _check_fields(problems, group, name, entry, always, where):
    if not is_listed(group, name):
        return
    allowed = set(params_of(group, name)) | set(always)
    for key in entry:
        if key not in allowed:
            problems.append(f"{where}: field {key!r} not listed for {group}/{name}")


def audit_response(resp):
    """Every code and parameter in a response, checked against the registry."""
    problems = []
    if not resp.get("ok"):
        _check(problems, "error", resp.get("code"), "code")
        if is_listed("error", resp.get("code")):
            if sorted(resp.get("params", {})) != sorted(params_of("error", resp["code"])):
                problems.append(f"params of {resp['code']} do not match codes.json")
        return problems
    for i, st in enumerate(resp.get("stages", [])):
        _check(problems, "stage", st.get("id"), f"stages[{i}].id")
        _check(problems, "stage_status", st.get("status"), f"stages[{i}].status")
        _check(problems, "limit", st.get("limit"), f"stages[{i}].limit")
        if "reason" in st:
            _check(problems, "stage_reason", st["reason"], f"stages[{i}].reason")
    for i, v in enumerate(resp.get("violations", [])):
        _check(problems, "violation", v.get("code"), f"violations[{i}].code")
        _check(problems, "violation_cause", v.get("cause"), f"violations[{i}].cause")
        _check_fields(problems, "violation", v.get("code"), v, ("code",), f"violations[{i}]")
        if v.get("code") == "mandatory_lead":
            _check(problems, "violation_rule", v.get("rule"), f"violations[{i}].rule")
    for i, u in enumerate(resp.get("unfilled", [])):
        _check(problems, "unfilled_reason", u.get("reason"), f"unfilled[{i}].reason")
    for i, m in enumerate(resp.get("missed", [])):
        _check(problems, "missed", m.get("code"), f"missed[{i}].code")
        _check(problems, "missed_cause", m.get("cause"), f"missed[{i}].cause")
        _check_fields(problems, "missed", m.get("code"), m, ("code",), f"missed[{i}]")
    for i, n in enumerate(resp.get("notices", [])):
        _check(problems, "notice", n.get("code"), f"notices[{i}].code")
        if is_listed("notice", n.get("code")):
            if sorted(n.get("params", {})) != sorted(params_of("notice", n["code"])):
                problems.append(f"notices[{i}]: params do not match codes.json")
    for i, c in enumerate(resp.get("cadence", [])):
        _check(problems, "cadence_state", c.get("state"), f"cadence[{i}].state")
        _check(problems, "compensation", c.get("compensation"), f"cadence[{i}].compensation")
    return problems
