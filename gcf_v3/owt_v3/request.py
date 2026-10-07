"""The request contract v3 (spec §5): parse and validate before any solve.

`parse_request(body)` returns a `Problem` or raises `Refusal` (HTTP 422). It never
compares a month with today (C6 refuses past months, A24) and never logs.
Every list it returns is in a canonical, sorted order (spec §10).
"""

import math
from dataclasses import dataclass, field
from typing import Dict, FrozenSet, Optional, Tuple

from . import constants as C
from .codes import Refusal
from .vocab import (
    ROLES, ROLE_KEYS, RULE_ID_RE, SERVICE_KINDS, add_days, add_months, day_class,
    is_canonical_document_id, is_month, is_service_time, month_index, parse_date,
    role_key, time_sort_key, weekday,
)

RESERVED_RULE_ID = "mandatory_lead"
CARRIED_BASE_KEYS = ("DL", "SL", "BGV", "CORO")
CADENCE_STATES = ("on", "off", "out")
COUNT_OPS = ("==", "<=", ">=")


@dataclass(frozen=True)
class Service:
    id: str
    date: str
    month: str
    kind: str
    time: Optional[str]
    fixed: bool
    counts: bool
    seats: Dict[str, int]  # non-fixed only; {} for a fixed service
    roles: Tuple[str, ...]
    day: str  # "Sun" | "Sat" (day class)

    @property
    def weekend(self):
        return self.kind != "special"

    def key(self, role):
        return role_key(self.day, role)


@dataclass(frozen=True)
class Person:
    id: str
    name: str
    exempt: bool
    eligibility: Dict[str, FrozenSet[str]]
    carried: Dict[str, int]
    cadence: Optional[Dict[str, str]]
    dl_since: Optional[str]
    prev_dl_leads: int


@dataclass(frozen=True)
class CountRule:
    id: str
    person: str
    roles: Tuple[str, ...]
    op: str
    month: str
    value: int
    index: int


@dataclass(frozen=True)
class PairRule:
    id: str
    persons: Tuple[str, str]
    roles: Tuple[str, ...]
    month: Optional[str]
    index: int


@dataclass(frozen=True)
class PresenceRule:
    id: str
    persons: Tuple[str, ...]
    roles: Tuple[str, ...]
    exclusive: bool
    month: Optional[str]
    index: int


@dataclass(frozen=True)
class ConsecutiveRule:
    id: str
    person: str
    roles: Tuple[str, ...]
    index: int


@dataclass(frozen=True)
class Pin:
    service: str
    date: str
    role: str
    person: str


@dataclass(frozen=True)
class PriorService:
    date: str
    kind: str
    counts: bool
    seats: Dict[str, Tuple[str, ...]]
    day: str


@dataclass(frozen=True)
class Prior:
    month: str
    has_services: bool
    services: Tuple[PriorService, ...]


@dataclass(frozen=True)
class Budget:
    total_seconds: float
    stage_seconds: float
    stage_det_limit: float


@dataclass
class Problem:
    request_id: Optional[str]
    seed: int
    months: Tuple[str, ...]
    services: Tuple[Service, ...]
    people: Dict[str, Person]
    counts: Tuple[CountRule, ...]
    pairs: Tuple[PairRule, ...]
    presence: Tuple[PresenceRule, ...]
    consecutive: Tuple[ConsecutiveRule, ...]
    presence_ids: Tuple[str, ...]  # distinct presence ids, by first appearance in `rules`
    pins: Tuple[Pin, ...]
    prior: Prior
    budget: Budget
    service_by_id: Dict[str, Service] = field(default_factory=dict)
    person_ids: Tuple[str, ...] = ()

    @property
    def lines(self):
        """Every stage line, in stage order (spec §7.1)."""
        return ("DL", "SL", "BGV") + tuple(f"P:{i}" for i in self.presence_ids) + ("CORO",)


# ── small validators ─────────────────────────────────────────────────────────


def _fail(field_path, detail):
    raise Refusal("invalid_request", field=field_path, detail=detail)


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _is_number(v):
    if isinstance(v, bool):
        return False
    if isinstance(v, int):
        return True  # arbitrary-precision ints are always finite; never hand them to math.isfinite
    return isinstance(v, float) and math.isfinite(v)


def _object(value, path, required, optional=()):
    if not isinstance(value, dict):
        _fail(path, "type")
    for key in value:
        if key not in required and key not in optional:
            _fail(f"{path}.{key}" if path else key, "unknown_key")
    for key in required:
        if key not in value:
            _fail(f"{path}.{key}" if path else key, "missing")
    return value


def _list(value, path, lo, hi):
    if not isinstance(value, list):
        _fail(path, "type")
    if not lo <= len(value) <= hi:
        _fail(path, "range")
    return value


def _string(value, path, lo, hi):
    if not isinstance(value, str):
        _fail(path, "type")
    if not lo <= len(value) <= hi:
        _fail(path, "range")
    return value


def _bool(value, path):
    if not isinstance(value, bool):
        _fail(path, "type")
    return value


def _int(value, path, lo, hi=None):
    if not _is_int(value):
        _fail(path, "integer")
    if value < lo or (hi is not None and value > hi):
        _fail(path, "range")
    return value


def _month(value, path):
    if not is_month(value):
        _fail(path, "format")
    return value


def _role_keys(value, path):
    _list(value, path, 1, len(ROLE_KEYS))
    seen = []
    for i, k in enumerate(value):
        if k not in ROLE_KEYS:
            _fail(f"{path}[{i}]", "format")
        if k in seen:
            _fail(f"{path}[{i}]", "duplicate")
        seen.append(k)
    return tuple(sorted(seen, key=ROLE_KEYS.index))


# ── the parser ───────────────────────────────────────────────────────────────

TOP_KEYS = ("contract", "ping", "request_id", "seed", "months", "services", "people", "rules",
            "pins", "prior", "budget")


def is_ping(body):
    """Contract 3 and `ping` present: answer §8.4 and ignore every other field."""
    contract = body.get("contract") if isinstance(body, dict) else None
    return _is_int(contract) and contract == C.CONTRACT and "ping" in body


def parse_request(body):
    if not isinstance(body, dict):
        _fail("(root)", "type")
    contract = body.get("contract")
    if not (_is_int(contract) and contract == C.CONTRACT):
        raise Refusal("contract_mismatch", received=contract)
    if "ping" in body:
        if body["ping"] is not True:
            _fail("ping", "type")
        return None
    _object(body, "", ("contract", "seed", "months", "services", "people", "rules", "pins", "prior"),
            ("request_id", "budget"))
    request_id = None
    if "request_id" in body:
        request_id = _string(body["request_id"], "request_id", 1, C.REQUEST_ID_MAX)
    seed = _int(body["seed"], "seed", 0, C.SEED_MAX)
    months = _parse_months(body["months"])
    services = _parse_services(body["services"], months)
    by_id = {s.id: s for s in services}
    people = _parse_people(body["people"], months, by_id)
    counts, pairs, presence, consecutive, presence_ids = _parse_rules(body["rules"], months, people)
    _cross_checks(body, people, counts)
    pins = _parse_pins(body["pins"], by_id, people)
    prior = _parse_prior(body["prior"], months)
    budget = _parse_budget(body.get("budget"))
    ordered = tuple(sorted(services, key=lambda s: (s.date, time_sort_key(s.time), s.id)))
    return Problem(
        request_id=request_id, seed=seed, months=months, services=ordered, people=people,
        counts=counts, pairs=pairs, presence=presence, consecutive=consecutive,
        presence_ids=presence_ids, pins=pins, prior=prior, budget=budget,
        service_by_id=by_id, person_ids=tuple(sorted(people)),
    )


def _parse_months(value):
    _list(value, "months", 1, 2)
    for i, m in enumerate(value):
        _month(m, f"months[{i}]")
    if len(value) == 2 and month_index(value[1]) != month_index(value[0]) + 1:
        _fail("months", "not_consecutive")
    return tuple(value)


def _parse_services(value, months):
    _list(value, "services", 1, C.MAX_SERVICES)
    out, ids, per_date_kind = [], set(), set()
    for i, raw in enumerate(value):
        p = f"services[{i}]"
        _object(raw, p, ("id", "date", "month", "kind", "fixed", "counts"), ("time", "seats"))
        sid = raw["id"]
        if not is_canonical_document_id(sid):
            _fail(f"{p}.id", "format")
        if sid in ids:
            _fail(f"{p}.id", "duplicate")
        ids.add(sid)
        date = raw["date"]
        if parse_date(date) is None:
            _fail(f"{p}.date", "format")
        if date[:7] not in months:
            _fail(f"{p}.date", "not_in_months")
        _month(raw["month"], f"{p}.month")
        if raw["month"] != date[:7]:
            _fail(f"{p}.month", "month_mismatch")
        kind = raw["kind"]
        if kind not in SERVICE_KINDS:
            _fail(f"{p}.kind", "format")
        if kind == "sunday" and weekday(date) != 6:
            _fail(f"{p}.kind", "weekday")
        if kind == "saturday" and weekday(date) != 5:
            _fail(f"{p}.kind", "weekday")
        if kind != "special":
            if (date, kind) in per_date_kind:
                _fail(f"{p}.kind", "one_per_date")
            per_date_kind.add((date, kind))
        time = raw.get("time")
        if "time" in raw and not is_service_time(time):
            _fail(f"{p}.time", "format")
        fixed = _bool(raw["fixed"], f"{p}.fixed")
        counts = _bool(raw["counts"], f"{p}.counts")
        if kind == "special" and not fixed:
            _fail(f"{p}.fixed", "special_fixed")
        if kind == "special" and not counts:
            _fail(f"{p}.counts", "special_counted")
        seats = {}
        if "seats" in raw:
            seats = _parse_seats(raw["seats"], f"{p}.seats", kind, fixed)
        elif not fixed:
            _fail(f"{p}.seats", "missing")
        if fixed:
            roles, seats = ROLES, {}
        elif kind == "saturday":
            roles = ("Lead", "BGV")
            seats.pop("Choir", None)
        else:
            roles = ROLES
        out.append(Service(id=sid, date=date, month=raw["month"], kind=kind,
                           time=time if "time" in raw else None, fixed=fixed, counts=counts,
                           seats=seats, roles=roles, day=day_class(date)))
    return out


def _parse_seats(raw, p, kind, fixed):
    _object(raw, p, (), ROLES)
    seats = {}
    for role in ROLES:
        if role in raw:
            seats[role] = _int(raw[role], f"{p}.{role}", 0, C.MAX_SEATS_PER_ROLE)
    if not fixed:
        need = ("Lead", "BGV") if kind == "saturday" else ROLES
        for role in need:
            if role not in seats:
                _fail(f"{p}.{role}", "missing")
        if kind == "saturday" and seats.get("Choir", 0) != 0:
            _fail(f"{p}.Choir", "saturday_choir")
    return seats


def _parse_people(value, months, by_id):
    _list(value, "people", 1, C.MAX_PEOPLE)
    people = {}
    for i, raw in enumerate(value):
        p = f"people[{i}]"
        _object(raw, p, ("id", "name", "eligibility", "carried", "dl_since", "prev_dl_leads"),
                ("exempt", "cadence"))
        pid = _string(raw["id"], f"{p}.id", 1, C.PERSON_ID_MAX)
        if pid in people:
            _fail(f"{p}.id", "duplicate")
        if not isinstance(raw["name"], str):
            _fail(f"{p}.name", "type")
        exempt = _bool(raw["exempt"], f"{p}.exempt") if "exempt" in raw else False
        elig_raw = raw["eligibility"]
        if not isinstance(elig_raw, dict):
            _fail(f"{p}.eligibility", "type")
        eligibility = {}
        for sid, roles in elig_raw.items():
            if sid not in by_id:
                raise Refusal("unknown_service", field=f"{p}.eligibility", service=sid)
            ep = f'{p}.eligibility["{sid}"]'
            _list(roles, ep, 0, len(ROLES))
            seen = set()
            for j, role in enumerate(roles):
                if role not in ROLES:
                    _fail(f"{ep}[{j}]", "format")
                if role in seen:
                    _fail(f"{ep}[{j}]", "duplicate")
                seen.add(role)
            eligibility[sid] = frozenset(seen)
        carried_raw = raw["carried"]
        if not isinstance(carried_raw, dict):
            _fail(f"{p}.carried", "type")
        carried = {}
        for key, v in carried_raw.items():
            ok = key in CARRIED_BASE_KEYS or (
                isinstance(key, str) and key.startswith("P:") and RULE_ID_RE.match(key[2:]))
            if not ok:
                _fail(f"{p}.carried", "unknown_key")
            if not _is_int(v):
                _fail(f"{p}.carried", "integer")
            if abs(v) > C.CARRIED_ABS_MAX:
                _fail(f"{p}.carried", "range")
            carried[key] = v
        cadence = None
        if "cadence" in raw:
            cad = raw["cadence"]
            if not isinstance(cad, dict) or sorted(cad) != sorted(months):
                _fail(f"{p}.cadence", "cadence_months")
            for m, state in cad.items():
                if state not in CADENCE_STATES:
                    _fail(f"{p}.cadence", "format")
            cadence = dict(cad)
        dl_since = raw["dl_since"]
        if dl_since is not None:
            _month(dl_since, f"{p}.dl_since")
        prev = _int(raw["prev_dl_leads"], f"{p}.prev_dl_leads", 0)
        people[pid] = Person(id=pid, name=raw["name"], exempt=exempt, eligibility=eligibility,
                             carried=carried, cadence=cadence, dl_since=dl_since,
                             prev_dl_leads=prev)
    return people


def _person(value, path, people):
    if not isinstance(value, str):
        _fail(path, "type")
    if value not in people:
        raise Refusal("unknown_person", field=path, person=value)
    return value


def _parse_rules(value, months, people):
    _list(value, "rules", 0, C.MAX_RULES)
    counts, pairs, presence, consecutive, scope, presence_ids = [], [], [], [], {}, []
    for i, raw in enumerate(value):
        p = f"rules[{i}]"
        if not isinstance(raw, dict):
            _fail(p, "type")
        kind = raw.get("kind")
        shapes = {
            "count": (("id", "kind", "person", "roles", "op", "month", "value"), ()),
            "pair": (("id", "kind", "persons", "roles"), ("month",)),
            "presence": (("id", "kind", "persons", "roles", "exclusive"), ("month",)),
            "consecutive": (("id", "kind", "person", "roles"), ()),
        }
        if not isinstance(kind, str) or kind not in shapes:
            _fail(f"{p}.kind", "format")
        _object(raw, p, *shapes[kind])
        rid = raw["id"]
        if not isinstance(rid, str) or not RULE_ID_RE.match(rid):
            _fail(f"{p}.id", "format")
        if rid == RESERVED_RULE_ID:
            _fail(f"{p}.id", "reserved")
        month = raw.get("month")
        if "month" in raw:
            _month(month, f"{p}.month")
            if month not in months:
                _fail(f"{p}.month", "not_in_months")
        roles = _role_keys(raw["roles"], f"{p}.roles")
        if kind == "count":
            person = _person(raw["person"], f"{p}.person", people)
            if raw["op"] not in COUNT_OPS:
                _fail(f"{p}.op", "format")
            v = _int(raw["value"], f"{p}.value", 0)
            counts.append(CountRule(rid, person, roles, raw["op"], month, v, i))
        elif kind == "pair":
            _list(raw["persons"], f"{p}.persons", 2, 2)
            a = _person(raw["persons"][0], f"{p}.persons[0]", people)
            b = _person(raw["persons"][1], f"{p}.persons[1]", people)
            if a == b:
                _fail(f"{p}.persons", "duplicate")
            pairs.append(PairRule(rid, (a, b), roles, month, i))
        elif kind == "presence":
            _list(raw["persons"], f"{p}.persons", 1, C.MAX_PEOPLE)
            members = []
            for j, x in enumerate(raw["persons"]):
                x = _person(x, f"{p}.persons[{j}]", people)
                if x in members:
                    _fail(f"{p}.persons[{j}]", "duplicate")
                members.append(x)
            exclusive = _bool(raw["exclusive"], f"{p}.exclusive")
            presence.append(PresenceRule(rid, tuple(members), roles, exclusive, month, i))
            if rid not in presence_ids:
                presence_ids.append(rid)
        else:
            person = _person(raw["person"], f"{p}.person", people)
            consecutive.append(ConsecutiveRule(rid, person, roles, i))
        entries = scope.setdefault(rid, [])
        if (month is None and entries) or (month is not None and any(m is None for m in entries)):
            _fail(f"{p}.id", "scope_mixed")
        if month is not None and month in entries:
            _fail(f"{p}.id", "duplicate")
        entries.append(month)
    return tuple(counts), tuple(pairs), tuple(presence), tuple(consecutive), tuple(presence_ids)


def _cross_checks(body, people, counts):
    order = list(people)
    for rule in counts:
        if rule.op == "==" and "Sun.Lead" in rule.roles and people[rule.person].cadence is not None:
            _fail(f"people[{order.index(rule.person)}].cadence", "cadence_exact_lead")
    exact = sorted((r for r in counts if r.op == "=="), key=lambda r: r.id)
    for i, a in enumerate(exact):
        for b in exact[i + 1:]:
            if a.person == b.person and a.month == b.month and set(a.roles) & set(b.roles):
                _fail(f"rules[{b.index}]", "exact_overlap")


def _parse_pins(value, by_id, people):
    if not isinstance(value, list):
        _fail("pins", "type")
    if len(value) > C.PIN_CAP:
        raise Refusal("too_many_pins", count=len(value), cap=C.PIN_CAP)
    pins, seen = set(), {}
    for i, raw in enumerate(value):
        p = f"pins[{i}]"
        _object(raw, p, ("service", "date", "role", "person"))
        sid = raw["service"]
        if not isinstance(sid, str):
            _fail(f"{p}.service", "type")
        if sid not in by_id:
            raise Refusal("unknown_service", field=f"{p}.service", service=sid)
        person = _person(raw["person"], f"{p}.person", people)
        service = by_id[sid]
        if raw["date"] != service.date:
            _fail(f"{p}.date", "date_mismatch")
        if raw["role"] not in service.roles:
            _fail(f"{p}.role", "role_not_in_service")
        pin = Pin(sid, service.date, raw["role"], person)
        other = seen.get((sid, person))
        if other is not None and other != pin.role:
            raise Refusal("pin_conflict", person=person, service=sid)
        seen[(sid, person)] = pin.role
        pins.add(pin)
    return tuple(sorted(pins, key=lambda x: (x.service, x.role, x.person)))


def _parse_prior(value, months):
    _object(value, "prior", ("month", "has_services", "services"))
    month = _month(value["month"], "prior.month")
    if month != add_months(months[0], -1):
        _fail("prior.month", "prior_month")
    has_services = _bool(value["has_services"], "prior.has_services")
    if not isinstance(value["services"], list):
        _fail("prior.services", "type")
    first = f"{months[0]}-01"
    lo, hi = add_days(first, -14), add_days(first, -1)
    services = []
    for i, raw in enumerate(value["services"]):
        p = f"prior.services[{i}]"
        _object(raw, p, ("date", "kind", "counts", "seats"))
        date = raw["date"]
        if parse_date(date) is None:
            _fail(f"{p}.date", "format")
        if not lo <= date <= hi:
            _fail(f"{p}.date", "prior_window")
        kind = raw["kind"]
        if kind not in SERVICE_KINDS:
            _fail(f"{p}.kind", "format")
        if (kind == "sunday" and weekday(date) != 6) or (kind == "saturday" and weekday(date) != 5):
            _fail(f"{p}.kind", "weekday")
        counts = _bool(raw["counts"], f"{p}.counts")
        _object(raw["seats"], f"{p}.seats", (), ROLES)
        seats = {}
        for role in ROLES:
            ids = raw["seats"].get(role, [])
            if not isinstance(ids, list) or not all(isinstance(x, str) for x in ids):
                _fail(f"{p}.seats.{role}", "type")
            seats[role] = tuple(ids)
        services.append(PriorService(date, kind, counts, seats, day_class(date)))
    services.sort(key=lambda s: (s.date, s.kind))
    return Prior(month=month, has_services=has_services, services=tuple(services))


def _parse_budget(value):
    knobs = (
        ("total_seconds", C.MIN_TOTAL_SECONDS, C.TOTAL_SECONDS),
        ("stage_seconds", C.MIN_STAGE_SECONDS, C.STAGE_SECONDS),
        ("stage_det_limit", C.MIN_STAGE_DET_LIMIT, C.STAGE_DET_LIMIT),
    )
    out = {name: default for name, _, default in knobs}
    if value is None:
        return Budget(**out)
    _object(value, "budget", (), tuple(n for n, _, _ in knobs))
    for name, lo, hi in knobs:
        if name in value:
            v = value[name]
            if not _is_number(v):
                _fail(f"budget.{name}", "type")
            out[name] = float(min(max(v, lo), hi))  # clamp BEFORE float(): a 10**400 int must not overflow
    return Budget(**out)
