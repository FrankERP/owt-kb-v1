"""
owt_solver_v2.py — Monthly worship team scheduler using OR-Tools CP-SAT.

Usage:
  JSON mode (Next.js integration):
    echo '<json_config>' | python3 gcf/owt_solver_v2.py --json-mode

  Test mode (built-in default config):
    python3 gcf/owt_solver_v2.py

Improvements over CGPT_owt_roles.py:
  - Weighted history decay: weights [10, 6, 3] for [most recent, 2nd, oldest]
  - New DSL hard constraint: "<name> !consecutive on <pattern>"
  - JSON stdin/stdout interface (--json-mode flag)
  - Improved infeasibility diagnostics listing all constrained slots
  - Removed: benchmark mode, Sanity push, CSV/JSON export, interactive prompts

Install:
    pip install ortools
"""

from __future__ import annotations

import json
import random
import re
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, List, Sequence, Set, Tuple

from ortools.sat.python import cp_model

# ─── Constants ────────────────────────────────────────────────────────────────

ROLE_ORDER = ["Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir"]
SATURDAY_ROLES = {"Sat.Lead", "Sat.BGV"}
LEAD_BGV_ROLES = {"Sun.Lead", "Sun.BGV", "Sat.Lead", "Sat.BGV"}
ALL_ROLE_TYPES = set(ROLE_ORDER)

# Mandatory vs optional seats for graceful degradation. At least one Lead per
# service is always required; BGV/Choir seats (and the 2nd Lead, as a last resort)
# may go unfilled when availability is too tight. Degradation order is encoded by
# the empty-seat penalty weights: Choir empties first, then BGV, then the 2nd Lead.
LEAD_ROLES = {"Sun.Lead", "Sat.Lead"}
BGV_ROLES = {"Sun.BGV", "Sat.BGV"}
CHOIR_ROLES = {"Sun.Choir"}
# Roles that make up each service — used to decide when a person is fully absent.
SERVICE_ROLES = {
    "Sunday": {"Sun.Lead", "Sun.BGV", "Sun.Choir"},
    "Saturday": {"Sat.Lead", "Sat.BGV"},
}
LEGACY_PATTERN_ALIASES = {
    "Lead.*": "*.Lead",
    "BGV.*": "*.BGV",
    "Choir.*": "*.Choir",
    "LeadBGV.*": "*.LeadBGV",
}
VALID_PATTERNS = (
    ALL_ROLE_TYPES
    | {"Sun.*", "Sat.*", "*.*", "*.LeadBGV"}
    | {f"*.{r.split('.', 1)[1]}" for r in ROLE_ORDER}
    | set(LEGACY_PATTERN_ALIASES.keys())
)
SUNDAY_SERVICE = "Sunday"
SATURDAY_SERVICE = "Saturday"

# History decay: most-recent entry gets weight 10, then 6, then 3 (oldest).
HISTORY_DECAY_WEIGHTS = [10, 6, 3]


# ─── Data structures ──────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Slot:
    week: int
    service: str
    role_type: str
    slot_index: int

    @property
    def key(self) -> str:
        return f"W{self.week}.{self.role_type}.{self.slot_index}"


@dataclass
class ScheduleConfig:
    weeks: int
    weekends_w_sat: List[int]       # 1-based week indexes that have Saturday service
    sunday_leads_pool: List[str]
    saturday_leads_pool: List[str]
    support_pool: List[str]
    dsl_restrictions: List[str]
    history: List[Dict]             # pre-loaded history entries (oldest first)
    seed: int | None = None
    random_tie_break_weight_max: int = 9
    # Per-solve cap. Kept small because the production function runs on a
    # fractional vCPU (~0.33) — CP-SAT finds good solutions fast there but proves
    # optimality slowly, so a short cap returns near-identical quality much sooner.
    solver_max_time_seconds: int = 5
    # 1 worker beats 8 on a sub-1-vCPU container (8 threads thrash one core).
    solver_num_search_workers: int = 1
    # Wall-clock ceiling across ALL internal solves (stage A + relaxation loop);
    # once exceeded, return the best schedule found so far instead of grinding.
    solver_total_budget_seconds: int = 40
    discourage_consecutive_role_repeats: bool = True


@dataclass(frozen=True)
class DslCountRule:
    person: str
    role_types: Set[str]
    operator: str
    value: int
    source: str


@dataclass(frozen=True)
class DslPairRule:
    left: str
    right: str
    role_types: Set[str]
    source: str


@dataclass(frozen=True)
class DslWeeklyPresenceRule:
    people: Tuple[str, ...]
    role_types: Set[str]
    source: str


@dataclass(frozen=True)
class DslWeekExclusionRule:
    person: str
    week: int
    role_types: Set[str]
    source: str


@dataclass(frozen=True)
class DslConsecutiveRule:
    """Hard constraint: person may not appear in matching roles in consecutive weeks."""
    person: str
    role_types: Set[str]
    source: str


@dataclass
class SolveResult:
    fairness_limit_used: int
    sun_lead_fairness_limit_used: int
    sun_bgv_fairness_limit_used: int
    history_runs_used: int
    assignments: Dict[str, List[Slot]]
    total_counts: Dict[str, int]
    role_counts: Dict[str, Dict[str, int]]
    weighted_empty_used: int = 0          # tiered penalty value for unfilled seats
    unfilled: List[str] = None            # human-readable list of empty seats


# ─── Helpers ──────────────────────────────────────────────────────────────────

def expand_pattern(pattern: str) -> Set[str]:
    pattern = LEGACY_PATTERN_ALIASES.get(pattern, pattern)
    if pattern == "*.*":
        return set(ROLE_ORDER)
    if pattern == "Sun.*":
        return {"Sun.Lead", "Sun.BGV", "Sun.Choir"}
    if pattern == "Sat.*":
        return {"Sat.Lead", "Sat.BGV"}
    if pattern == "*.LeadBGV":
        return set(LEAD_BGV_ROLES)
    if pattern.startswith("*."):
        suffix = pattern.split(".", 1)[1]
        matches = {r for r in ROLE_ORDER if r.endswith(f".{suffix}")}
        if matches:
            return matches
    if pattern not in ALL_ROLE_TYPES:
        raise ValueError(f"Unsupported restriction pattern '{pattern}'.")
    return {pattern}


def normalize_weekend_indexes(weeks: int, weekends_w_sat: Sequence[int]) -> List[int]:
    if not weekends_w_sat:
        return []
    unique = sorted(set(weekends_w_sat))
    invalid = [w for w in unique if w < 1 or w > weeks]
    if invalid:
        raise ValueError(
            f"weekends_w_sat must use 1-based indexes 1..{weeks}. Received {invalid}."
        )
    return unique


def resolve_dsl_templates(config: ScheduleConfig) -> ScheduleConfig:
    arithmetic = re.compile(r"\{weeks(?P<op>[+-])(?P<num>\d+)\}")
    word = re.compile(r"\{weeks_(?P<op>minus|plus)_(?P<num>\d+)\}")

    def arith(m: re.Match) -> str:
        n = int(m.group("num"))
        return str(max(0, config.weeks + n if m.group("op") == "+" else config.weeks - n))

    def word_sub(m: re.Match) -> str:
        n = int(m.group("num"))
        return str(max(0, config.weeks + n if m.group("op") == "plus" else config.weeks - n))

    resolved = []
    for expr in config.dsl_restrictions:
        r = expr.replace("{weeks}", str(config.weeks))
        r = arithmetic.sub(arith, r)
        r = word.sub(word_sub, r)
        if "{weeks" in r:
            raise ValueError(f"Unsupported DSL template in '{expr}'.")
        resolved.append(r)
    config.dsl_restrictions = resolved
    return config


def is_eligible(person: str, role_type: str, pools: Dict[str, Set[str]], forbidden: Dict[str, Set[str]]) -> bool:
    return person in pools[role_type] and role_type not in forbidden[person]


# ─── DSL parsing ──────────────────────────────────────────────────────────────

def parse_dsl_rules(
    expressions: Sequence[str],
    known_people: Set[str],
) -> Tuple[
    Dict[str, Set[str]],       # forbidden_roles
    List[DslCountRule],
    List[DslPairRule],
    Set[str],                  # fairness_exempt_people
    Dict[str, int],            # fairness_slack_by_person
    List[DslWeeklyPresenceRule],
    List[DslWeekExclusionRule],
    Dict[str, Set[str]],       # role_fairness_exempt_by_role
    Dict[Tuple[str, str], int],# role_fairness_slack_by_person_role
    List[DslConsecutiveRule],  # NEW: hard consecutive constraints
]:
    forbidden_roles: Dict[str, Set[str]] = defaultdict(set)
    count_rules: List[DslCountRule] = []
    pair_rules: List[DslPairRule] = []
    fairness_exempt: Set[str] = set()
    fairness_slack: Dict[str, int] = {}
    weekly_presence: List[DslWeeklyPresenceRule] = []
    week_exclusions: List[DslWeekExclusionRule] = []
    role_fairness_exempt: Dict[str, Set[str]] = defaultdict(set)
    role_fairness_slack: Dict[Tuple[str, str], int] = {}
    consecutive_rules: List[DslConsecutiveRule] = []

    if not expressions:
        return (forbidden_roles, count_rules, pair_rules, fairness_exempt, fairness_slack,
                weekly_presence, week_exclusions, role_fairness_exempt, role_fairness_slack,
                consecutive_rules)

    # Regex patterns
    re_week_excl       = re.compile(r"^\s*(?P<name>.+?)\s+!in\s+week\s+(?P<week>\d+)\s+(?P<pat>[\w.*]+)\s*$", re.I)
    re_week_excl_s     = re.compile(r"^\s*!in\s+week\s+(?P<week>\d+)\s+(?P<pat>[\w.*]+)\s*$", re.I)
    re_excl            = re.compile(r"^\s*(?P<name>.+?)\s+!in\s+(?P<pat>[\w.*]+)\s*$")
    re_excl_s          = re.compile(r"^\s*!in\s+(?P<pat>[\w.*]+)\s*$")
    re_count           = re.compile(r"^\s*(?P<name>.+?)\s+(?P<pat>[\w.*]+)\s*(?P<op>==|>=|<=)\s*(?P<n>\d+)\s*$")
    re_count_s         = re.compile(r"^\s*(?P<pat>[\w.*]+)\s*(?P<op>==|>=|<=)\s*(?P<n>\d+)\s*$")
    re_pair            = re.compile(r"^\s*(?P<left>.+?)\s+!with\s+(?P<right>.+?)\s+on\s+(?P<pat>[\w.*]+)\s*$")
    re_weekly          = re.compile(r"^\s*any_of\((?P<names>[^)]+)\)\s+on\s+(?P<pat>[\w.*]+)\s+each_week\s*$", re.I)
    re_consec          = re.compile(r"^\s*(?P<name>.+?)\s+!consecutive\s+on\s+(?P<pat>[\w.*]+)\s*$", re.I)
    re_consec_s        = re.compile(r"^\s*!consecutive\s+on\s+(?P<pat>[\w.*]+)\s*$", re.I)
    re_fe              = re.compile(r"^\s*(?P<name>.+?)\s+(?:fairness_exempt|fariness_exempt)\s*$", re.I)
    re_fe_s            = re.compile(r"^\s*(?:fairness_exempt|fariness_exempt)\s*$", re.I)
    re_fs              = re.compile(r"^\s*(?P<name>.+?)\s+fairness_slack\s+(?P<v>\d+)\s*$", re.I)
    re_fs_s            = re.compile(r"^\s*fairness_slack\s+(?P<v>\d+)\s*$", re.I)
    re_rfe             = re.compile(r"^\s*(?P<name>.+?)\s+(?:fairness_exempt|fariness_exempt)\s+on\s+(?P<pat>[\w.*]+)\s*$", re.I)
    re_rfe_s           = re.compile(r"^\s*(?:fairness_exempt|fariness_exempt)\s+on\s+(?P<pat>[\w.*]+)\s*$", re.I)
    re_rfs             = re.compile(r"^\s*(?P<name>.+?)\s+fairness_slack\s+(?P<v>\d+)\s+on\s+(?P<pat>[\w.*]+)\s*$", re.I)
    re_rfs_s           = re.compile(r"^\s*fairness_slack\s+(?P<v>\d+)\s+on\s+(?P<pat>[\w.*]+)\s*$", re.I)

    def require_person(name: str, clause: str) -> None:
        if name.lower() not in {p.lower() for p in known_people}:
            raise ValueError(f"DSL clause references unknown person '{name}': '{clause}'")

    def resolve_person(name: str) -> str:
        """Case-insensitive lookup — returns the canonical spelling."""
        lo = name.lower()
        for p in known_people:
            if p.lower() == lo:
                return p
        raise ValueError(f"Unknown person '{name}' in DSL rule.")

    def require_pattern(pat: str, clause: str) -> None:
        if pat not in VALID_PATTERNS:
            raise ValueError(f"Unsupported pattern '{pat}' in '{clause}'. Valid: {sorted(VALID_PATTERNS)}")

    for expression in expressions:
        subject: str | None = None

        for raw_clause in expression.split("&"):
            clause = raw_clause.strip()
            if not clause:
                continue

            # Pair rule (no subject inheritance)
            m = re_pair.match(clause)
            if m:
                left  = resolve_person(m.group("left").strip())
                right = resolve_person(m.group("right").strip())
                pat   = m.group("pat").strip()
                if left == right:
                    raise ValueError(f"Pair rule must name two different people: '{clause}'")
                require_pattern(pat, clause)
                pair_rules.append(DslPairRule(left=left, right=right,
                                               role_types=expand_pattern(pat), source=clause))
                subject = None
                continue

            # Weekly presence rule
            m = re_weekly.match(clause)
            if m:
                names = tuple(resolve_person(n.strip()) for n in m.group("names").split(",") if n.strip())
                if len(names) < 2:
                    raise ValueError(f"any_of() needs at least 2 names: '{clause}'")
                if len(set(names)) != len(names):
                    raise ValueError(f"Duplicate names in any_of(): '{clause}'")
                pat = m.group("pat").strip()
                require_pattern(pat, clause)
                weekly_presence.append(DslWeeklyPresenceRule(people=names,
                                        role_types=expand_pattern(pat), source=clause))
                subject = None
                continue

            # Role-scoped fairness exempt (must match before plain fairness_exempt)
            m = re_rfe.match(clause) or re_rfe_s.match(clause)
            if m:
                if "name" in m.groupdict() and m.group("name"):
                    subject = resolve_person(m.group("name").strip())
                elif subject is None:
                    raise ValueError(f"'{clause}' omits the subject — add a name or join with '&'.")
                pat = m.group("pat").strip()
                require_pattern(pat, clause)
                for rt in expand_pattern(pat):
                    role_fairness_exempt[rt].add(subject)
                continue

            # Role-scoped fairness slack
            m = re_rfs.match(clause) or re_rfs_s.match(clause)
            if m:
                if "name" in m.groupdict() and m.group("name"):
                    subject = resolve_person(m.group("name").strip())
                elif subject is None:
                    raise ValueError(f"'{clause}' omits the subject — add a name or join with '&'.")
                pat = m.group("pat").strip()
                require_pattern(pat, clause)
                slack = int(m.group("v"))
                for rt in expand_pattern(pat):
                    key = (subject, rt)
                    role_fairness_slack[key] = max(role_fairness_slack.get(key, 0), slack)
                continue

            # Week exclusion
            m = re_week_excl.match(clause) or re_week_excl_s.match(clause)
            if m:
                if "name" in m.groupdict() and m.group("name"):
                    subject = resolve_person(m.group("name").strip())
                elif subject is None:
                    raise ValueError(f"'{clause}' omits the subject.")
                pat  = m.group("pat").strip()
                week = int(m.group("week"))
                require_pattern(pat, clause)
                week_exclusions.append(DslWeekExclusionRule(person=subject, week=week,
                                        role_types=expand_pattern(pat), source=clause))
                continue

            # Exclusion
            m = re_excl.match(clause) or re_excl_s.match(clause)
            if m:
                if "name" in m.groupdict() and m.group("name"):
                    subject = resolve_person(m.group("name").strip())
                elif subject is None:
                    raise ValueError(f"'{clause}' omits the subject.")
                pat = m.group("pat").strip()
                require_pattern(pat, clause)
                forbidden_roles[subject].update(expand_pattern(pat))
                continue

            # Count rule
            m = re_count.match(clause) or re_count_s.match(clause)
            if m:
                if "name" in m.groupdict() and m.group("name"):
                    subject = resolve_person(m.group("name").strip())
                elif subject is None:
                    raise ValueError(f"'{clause}' omits the subject.")
                pat = m.group("pat").strip()
                require_pattern(pat, clause)
                count_rules.append(DslCountRule(person=subject, role_types=expand_pattern(pat),
                                                 operator=m.group("op"), value=int(m.group("n")),
                                                 source=clause))
                continue

            # Consecutive hard constraint (NEW)
            m = re_consec.match(clause) or re_consec_s.match(clause)
            if m:
                if "name" in m.groupdict() and m.group("name"):
                    subject = resolve_person(m.group("name").strip())
                elif subject is None:
                    raise ValueError(f"'{clause}' omits the subject.")
                pat = m.group("pat").strip()
                require_pattern(pat, clause)
                consecutive_rules.append(DslConsecutiveRule(person=subject,
                                          role_types=expand_pattern(pat), source=clause))
                continue

            # Global fairness exempt
            m = re_fe.match(clause) or re_fe_s.match(clause)
            if m:
                if "name" in m.groupdict() and m.group("name"):
                    subject = resolve_person(m.group("name").strip())
                elif subject is None:
                    raise ValueError(f"'{clause}' omits the subject.")
                fairness_exempt.add(subject)
                continue

            # Global fairness slack
            m = re_fs.match(clause) or re_fs_s.match(clause)
            if m:
                if "name" in m.groupdict() and m.group("name"):
                    subject = resolve_person(m.group("name").strip())
                elif subject is None:
                    raise ValueError(f"'{clause}' omits the subject.")
                slack = int(m.group("v"))
                fairness_slack[subject] = max(fairness_slack.get(subject, 0), slack)
                continue

            raise ValueError(
                f"Invalid DSL clause: '{clause}'. "
                "Supported forms: '<name> !in <pat>', '!in week <n> <pat>', "
                "'<name> <pat> ==|>=|<= <n>', '<A> !with <B> on <pat>', "
                "'<name> !consecutive on <pat>', '<name> fairness_exempt', "
                "'<name> fairness_slack <n>', 'any_of(...) on <pat> each_week'."
            )

    return (defaultdict(set, forbidden_roles), count_rules, pair_rules, fairness_exempt,
            fairness_slack, weekly_presence, week_exclusions,
            defaultdict(set, role_fairness_exempt), role_fairness_slack, consecutive_rules)


# ─── Validation ───────────────────────────────────────────────────────────────

def validate_config(config: ScheduleConfig) -> Tuple[List[str], Dict[str, Set[str]]]:
    if not 3 <= config.weeks <= 6:
        raise ValueError(f"weeks must be 3–6. Got {config.weeks}.")

    all_people = sorted(set(config.sunday_leads_pool + config.saturday_leads_pool + config.support_pool))
    if len(all_people) != len(config.sunday_leads_pool) + len(config.saturday_leads_pool) + len(config.support_pool):
        raise ValueError("Pool members must be mutually exclusive (no name in multiple pools).")

    normalize_weekend_indexes(config.weeks, config.weekends_w_sat)

    pools: Dict[str, Set[str]] = {
        "Sun.Lead":  set(config.sunday_leads_pool),
        "Sat.Lead":  set(config.sunday_leads_pool) | set(config.saturday_leads_pool),
        "Sun.BGV":   set(all_people),
        "Sat.BGV":   set(all_people),
        "Sun.Choir": set(all_people),
    }

    known = set(all_people)
    parse_dsl_rules(config.dsl_restrictions, known)
    return all_people, pools


# ─── History with weighted decay ──────────────────────────────────────────────

def build_history_offsets(
    history_entries: Sequence[Dict],
    all_people: Sequence[str],
) -> Tuple[Dict[str, int], Dict[Tuple[str, str], int], int]:
    """
    Build weighted historical counts using decay weights [10, 6, 3] for
    [most recent, second most recent, oldest].  Returns integer offsets suitable
    for CP-SAT integer arithmetic.
    """
    valid = set(all_people)
    recent = list(history_entries[-3:])               # oldest..newest, up to 3
    # Assign decay weights: most recent = 10, then 6, then 3
    weights_for_entries = list(reversed(HISTORY_DECAY_WEIGHTS[:len(recent)]))
    # weights_for_entries[0] = weight for recent[-1] (newest), ... reversed so oldest entry gets smallest weight

    # Actually: recent[0]=oldest, recent[-1]=newest
    # weights_for_entries should be [oldest_weight, ..., newest_weight]
    # HISTORY_DECAY_WEIGHTS = [10, 6, 3] — index 0 is most recent
    # So for 3 entries: recent[0] gets weight 3, recent[1] gets 6, recent[2] gets 10
    entry_weights = list(reversed(HISTORY_DECAY_WEIGHTS[:len(recent)]))  # [3,6,10] for 3 entries

    total_counts: Dict[str, int] = {p: 0 for p in all_people}
    role_counts: Dict[Tuple[str, str], int] = {(p, r): 0 for p in all_people for r in ROLE_ORDER}

    for entry, weight in zip(recent, entry_weights):
        tc = entry.get("total_counts", {})
        rc = entry.get("role_counts", {})
        for person in valid:
            if person in tc:
                total_counts[person] += weight * int(tc[person])
        for person in valid:
            if person in rc and isinstance(rc[person], dict):
                for role_type in ROLE_ORDER:
                    role_counts[(person, role_type)] += weight * int(rc[person].get(role_type, 0))

    return total_counts, role_counts, len(recent)


# ─── Absence-based fairness slack ─────────────────────────────────────────────

def compute_absence_slack(
    week_exclusions: Sequence[DslWeekExclusionRule],
    weeks: int,
    sat_weeks: Sequence[int],
    all_people: Sequence[str],
) -> Dict[str, int]:
    """
    How many SERVICES each person is fully unavailable for, derived from
    ``!in week N <pattern>`` exclusions. A person counts as absent from a service
    only when their exclusions for that week cover *every* role of that service
    (e.g. ``!in week 2 *.*`` covers all of Sunday, and Saturday too if week 2 has
    one). This becomes their automatic fairness slack so an unavoidable shortfall
    never reads as unfairness.
    """
    sat_set = set(sat_weeks)
    # person -> week -> set of excluded role types
    excluded: Dict[str, Dict[int, Set[str]]] = defaultdict(lambda: defaultdict(set))
    for rule in week_exclusions:
        excluded[rule.person][rule.week].update(rule.role_types)

    slack: Dict[str, int] = {p: 0 for p in all_people}
    for person, by_week in excluded.items():
        if person not in slack:
            continue
        for week, roles in by_week.items():
            if 1 <= week <= weeks and SERVICE_ROLES["Sunday"] <= roles:
                slack[person] += 1
            if week in sat_set and SERVICE_ROLES["Saturday"] <= roles:
                slack[person] += 1
    return slack


# ─── Slot building ────────────────────────────────────────────────────────────

def build_slots(config: ScheduleConfig) -> List[Slot]:
    slots: List[Slot] = []
    sat_weeks = set(normalize_weekend_indexes(config.weeks, config.weekends_w_sat))
    for week in range(1, config.weeks + 1):
        for i in range(1, 3):
            slots.append(Slot(week, SUNDAY_SERVICE, "Sun.Lead", i))
        for i in range(1, 4):
            slots.append(Slot(week, SUNDAY_SERVICE, "Sun.BGV", i))
            slots.append(Slot(week, SUNDAY_SERVICE, "Sun.Choir", i))
        if week in sat_weeks:
            for i in range(1, 3):
                slots.append(Slot(week, SATURDAY_SERVICE, "Sat.Lead", i))
            for i in range(1, 4):
                slots.append(Slot(week, SATURDAY_SERVICE, "Sat.BGV", i))
    return slots


def build_candidate_map(
    all_people: Sequence[str],
    pools: Dict[str, Set[str]],
    forbidden: Dict[str, Set[str]],
    slots: Sequence[Slot],
    seed: int | None,
) -> Dict[str, List[str]]:
    rng = random.Random(seed)
    people = list(all_people)
    rng.shuffle(people)
    result: Dict[str, List[str]] = {}
    for slot in slots:
        eligible = [p for p in people if is_eligible(p, slot.role_type, pools, forbidden)]
        # An empty candidate list is allowed: optional seats (BGV/Choir, or the
        # 2nd Lead) simply go unfilled. A mandatory-lead shortfall is caught later
        # by the per-service ">= 1 lead" constraint and reported by the diagnostic.
        result[slot.key] = eligible
    return result


# ─── CP-SAT model ─────────────────────────────────────────────────────────────

def _eq(model: cp_model.CpModel, var: cp_model.IntVar, terms: Sequence) -> None:
    model.Add(var == (sum(terms) if terms else 0))


def compute_priority_weights(
    max_spread: int, max_consec_penalty: int, max_rand: int
) -> Dict[str, int]:
    w: Dict[str, int] = {"tie_break": 1}
    w["consecutive"] = max_rand + 1
    remaining = max_consec_penalty * w["consecutive"] + max_rand
    for name in ["Sun.Choir", "Sat.BGV", "Sun.BGV", "global",
                 "sun_lead_rotation", "sun_lead_weekly_rotation", "Sat.Lead", "Sun.Lead"]:
        w[name] = remaining + 1
        remaining += max_spread * w[name]
    return w


def create_model_and_solve(
    config: ScheduleConfig,
    all_people: Sequence[str],
    global_fairness_people: Sequence[str],
    global_fairness_slack: Dict[str, int],
    pools: Dict[str, Set[str]],
    forbidden: Dict[str, Set[str]],
    dsl_count_rules: Sequence[DslCountRule],
    dsl_pair_rules: Sequence[DslPairRule],
    dsl_weekly_presence_rules: Sequence[DslWeeklyPresenceRule],
    dsl_week_exclusion_rules: Sequence[DslWeekExclusionRule],
    dsl_consecutive_rules: Sequence[DslConsecutiveRule],
    role_fairness_exempt: Dict[str, Set[str]],
    role_fairness_slack: Dict[Tuple[str, str], int],
    slots: Sequence[Slot],
    candidates: Dict[str, List[str]],
    fairness_limit: int,
    sun_lead_limit: int,
    sun_bgv_limit: int,
    hist_total: Dict[str, int],
    hist_role: Dict[Tuple[str, str], int],
    hist_runs: int,
    optimize: bool = True,
    empty_objective_only: bool = False,
    empty_target: int | None = None,
    max_time_override: float | None = None,
) -> SolveResult | None:

    model = cp_model.CpModel()
    slot_by_key = {s.key: s for s in slots}
    rng = random.Random(config.seed)
    dedicated_sat_leads = set(config.saturday_leads_pool)
    sat_weeks = set(normalize_weekend_indexes(config.weeks, config.weekends_w_sat))

    # Decision variables
    x: Dict[Tuple[str, str], cp_model.BoolVar] = {}
    for slot in slots:
        for person in candidates[slot.key]:
            x[(person, slot.key)] = model.NewBoolVar(f"x[{person},{slot.key}]")

    # Seat occupancy: a `filled` bool per slot. Optional seats (BGV/Choir, and the
    # 2nd Lead as a last resort) may go unfilled; every service keeps >= 1 Lead.
    filled: Dict[str, cp_model.BoolVar] = {}
    for slot in slots:
        f = model.NewBoolVar(f"filled[{slot.key}]")
        cand = candidates[slot.key]
        if cand:
            model.Add(sum(x[(p, slot.key)] for p in cand) == f)
        else:
            model.Add(f == 0)
        filled[slot.key] = f

    # At least one Lead per service — never zero leads.
    for week in range(1, config.weeks + 1):
        for _service, lead_role in (("Sunday", "Sun.Lead"), ("Saturday", "Sat.Lead")):
            lead_slots = [s for s in slots if s.week == week and s.role_type == lead_role]
            if lead_slots:
                model.Add(sum(filled[s.key] for s in lead_slots) >= 1)

    # Empty-seat penalties, tiered so degradation goes Choir -> BGV -> 2nd Lead.
    choir_empty = [1 - filled[s.key] for s in slots if s.role_type in CHOIR_ROLES]
    bgv_empty   = [1 - filled[s.key] for s in slots if s.role_type in BGV_ROLES]
    lead_empty  = [1 - filled[s.key] for s in slots if s.role_type in LEAD_ROLES]
    w_choir = 1
    w_bgv = len(choir_empty) + 1
    w_lead = (len(choir_empty) + 1) * (len(bgv_empty) + 1)
    max_weighted_empty = (w_lead * len(lead_empty) + w_bgv * len(bgv_empty)
                          + w_choir * len(choir_empty))
    weighted_empty = model.NewIntVar(0, max_weighted_empty, "weighted_empty")
    model.Add(weighted_empty == sum(
        [w_lead * e for e in lead_empty]
        + [w_bgv * e for e in bgv_empty]
        + [w_choir * e for e in choir_empty]
    ))
    if empty_target is not None:
        model.Add(weighted_empty <= empty_target)

    # Week exclusion hard constraints
    for rule in dsl_week_exclusion_rules:
        if rule.week > config.weeks:
            raise ValueError(
                f"DSL week exclusion references week {rule.week}, "
                f"but month has {config.weeks} weeks: '{rule.source}'"
            )
        for slot in slots:
            if slot.week == rule.week and slot.role_type in rule.role_types:
                if (rule.person, slot.key) in x:
                    model.Add(x[(rule.person, slot.key)] == 0)

    # Saturday lead constraint: exactly one dedicated lead (when available)
    for week in sat_weeks:
        sat_lead_slots = [s for s in slots if s.week == week and s.role_type == "Sat.Lead"]
        dedicated_terms = [
            x[(p, s.key)]
            for s in sat_lead_slots
            for p in candidates[s.key]
            if p in dedicated_sat_leads
        ]
        available_dedicated = {
            p for p in dedicated_sat_leads
            if not any(r.person == p and r.week == week for r in dsl_week_exclusion_rules)
        }
        if dedicated_terms and available_dedicated:
            # At least one dedicated Saturday lead anchors each Saturday (when any
            # is available). Previously "== 1", which made the model infeasible
            # whenever the only remaining lead options were all dedicated.
            model.Add(sum(dedicated_terms) >= 1)

    # Pair exclusion: A and B not in same week/service for matching roles
    for rule in dsl_pair_rules:
        for week in range(1, config.weeks + 1):
            by_service: Dict[str, List[Slot]] = defaultdict(list)
            for slot in slots:
                if slot.week == week and slot.role_type in rule.role_types:
                    by_service[slot.service].append(slot)
            for svc_slots in by_service.values():
                lt = [x[(rule.left,  s.key)] for s in svc_slots if (rule.left,  s.key) in x]
                rt = [x[(rule.right, s.key)] for s in svc_slots if (rule.right, s.key) in x]
                if lt and rt:
                    model.Add(sum(lt) + sum(rt) <= 1)

    # Weekly presence: at least one from group each week. A person week-excluded
    # for the matching role that week can't satisfy it, so we enforce only over
    # still-available group members; if none are available that week, the rule is
    # skipped rather than making the whole month infeasible.
    excluded_pwr = {
        (r.person, r.week, rt)
        for r in dsl_week_exclusion_rules for rt in r.role_types
    }
    for rule in dsl_weekly_presence_rules:
        for week in range(1, config.weeks + 1):
            terms = [
                x[(p, s.key)]
                for p in rule.people
                for s in slots
                if s.week == week and s.role_type in rule.role_types
                and (p, s.key) in x and (p, week, s.role_type) not in excluded_pwr
            ]
            if terms:
                model.Add(sum(terms) >= 1)

    # Consecutive hard constraint (NEW): person not in same role pattern in consecutive weeks
    for rule in dsl_consecutive_rules:
        for week in range(1, config.weeks):
            w1 = [x[(rule.person, s.key)] for s in slots
                  if s.week == week and s.role_type in rule.role_types and (rule.person, s.key) in x]
            w2 = [x[(rule.person, s.key)] for s in slots
                  if s.week == week + 1 and s.role_type in rule.role_types and (rule.person, s.key) in x]
            if w1 and w2:
                model.Add(sum(w1) + sum(w2) <= 1)

    # One slot per service per week per person
    for person in all_people:
        for week in range(1, config.weeks + 1):
            sun = [x[(person, s.key)] for s in slots
                   if s.week == week and s.service == SUNDAY_SERVICE and (person, s.key) in x]
            if sun:
                model.Add(sum(sun) <= 1)
            sat = [x[(person, s.key)] for s in slots
                   if s.week == week and s.service == SATURDAY_SERVICE and (person, s.key) in x]
            if sat:
                model.Add(sum(sat) <= 1)

    # Count variables
    total_slots = len(slots)
    max_hist_total = max(hist_total.values(), default=0)
    overall_limit = total_slots + max_hist_total

    total_vars: Dict[str, cp_model.IntVar] = {}
    for person in all_people:
        v = model.NewIntVar(0, total_slots, f"cur_total[{person}]")
        _eq(model, v, [var for (p, _), var in x.items() if p == person])
        total_vars[person] = v

    overall_total_vars: Dict[str, cp_model.IntVar] = {}
    for person in all_people:
        ov = model.NewIntVar(0, overall_limit, f"ov_total[{person}]")
        model.Add(ov == total_vars[person] + hist_total[person])
        overall_total_vars[person] = ov

    # Global fairness spread
    cur_spread = model.NewIntVar(0, total_slots, "cur_spread")
    if len(global_fairness_people) >= 2:
        gmax = model.NewIntVar(0, total_slots, "g_max")
        gmin = model.NewIntVar(0, total_slots, "g_min")
        for p in global_fairness_people:
            model.Add(total_vars[p] <= gmax)
            model.Add(total_vars[p] >= gmin)
        for p, slack in global_fairness_slack.items():
            model.Add(total_vars[p] <= gmax + slack)
            model.Add(total_vars[p] >= gmin - slack)
        model.Add(gmax - gmin <= fairness_limit)
        model.Add(cur_spread == gmax - gmin)
    else:
        model.Add(cur_spread == 0)

    overall_spread = model.NewIntVar(0, overall_limit, "ov_spread")
    if len(global_fairness_people) >= 2:
        ovmax = model.NewIntVar(0, overall_limit, "ov_max")
        ovmin = model.NewIntVar(0, overall_limit, "ov_min")
        for p in global_fairness_people:
            model.Add(overall_total_vars[p] <= ovmax)
            model.Add(overall_total_vars[p] >= ovmin)
        model.Add(overall_spread == ovmax - ovmin)
    else:
        model.Add(overall_spread == 0)

    # Per-role count variables
    role_vars: Dict[Tuple[str, str], cp_model.IntVar] = {}
    overall_role_vars: Dict[Tuple[str, str], cp_model.IntVar] = {}
    role_spread_vars: Dict[str, cp_model.IntVar] = {}

    for role_type in ROLE_ORDER:
        role_slots = [s for s in slots if s.role_type == role_type]
        max_r = len(role_slots)
        max_hist_r = max((hist_role[(p, role_type)] for p in all_people), default=0)
        ov_r_limit = max_r + max_hist_r
        eligible = [p for p in all_people if is_eligible(p, role_type, pools, forbidden)]

        for person in all_people:
            rv = model.NewIntVar(0, max_r, f"cur_r[{person},{role_type}]")
            _eq(model, rv, [x[(person, s.key)] for s in role_slots if (person, s.key) in x])
            role_vars[(person, role_type)] = rv

            orv = model.NewIntVar(0, ov_r_limit, f"ov_r[{person},{role_type}]")
            model.Add(orv == rv + hist_role[(person, role_type)])
            overall_role_vars[(person, role_type)] = orv

        if not eligible or max_r == 0:
            sv = model.NewIntVar(0, 0, f"spread[{role_type}]")
            role_spread_vars[role_type] = sv
            continue

        rmax = model.NewIntVar(0, ov_r_limit, f"rmax[{role_type}]")
        rmin = model.NewIntVar(0, ov_r_limit, f"rmin[{role_type}]")
        for p in eligible:
            model.Add(overall_role_vars[(p, role_type)] <= rmax)
            model.Add(overall_role_vars[(p, role_type)] >= rmin)
        sv = model.NewIntVar(0, ov_r_limit, f"spread[{role_type}]")
        model.Add(sv == rmax - rmin)
        role_spread_vars[role_type] = sv

    # Sun.Lead hard fairness guard
    sun_lead_eligible = [p for p in all_people if is_eligible(p, "Sun.Lead", pools, forbidden)]
    sun_lead_slots_n = sum(1 for s in slots if s.role_type == "Sun.Lead")
    cur_sun_lead_spread = model.NewIntVar(0, sun_lead_slots_n, "cur_sl_spread")
    sun_lead_constrained = [p for p in sun_lead_eligible if p not in role_fairness_exempt.get("Sun.Lead", set())]
    if len(sun_lead_constrained) >= 2 and sun_lead_slots_n > 0:
        sl_max = model.NewIntVar(0, sun_lead_slots_n, "sl_max")
        sl_min = model.NewIntVar(0, sun_lead_slots_n, "sl_min")
        for p in sun_lead_constrained:
            sl_terms = [x[(p, s.key)] for s in slots if s.role_type == "Sun.Lead" and (p, s.key) in x]
            if sl_terms:
                pv = model.NewIntVar(0, sun_lead_slots_n, f"cur_sl[{p}]")
                _eq(model, pv, sl_terms)
            else:
                pv = model.NewIntVar(0, 0, f"cur_sl[{p}]")
                model.Add(pv == 0)
            rslack = role_fairness_slack.get((p, "Sun.Lead"), 0)
            model.Add(pv <= sl_max + rslack)
            model.Add(pv >= sl_min - rslack)
        model.Add(cur_sun_lead_spread == sl_max - sl_min)
        model.Add(cur_sun_lead_spread <= sun_lead_limit)
    else:
        model.Add(cur_sun_lead_spread == 0)

    # Sun.BGV hard fairness guard
    sun_bgv_eligible = [p for p in all_people if is_eligible(p, "Sun.BGV", pools, forbidden)]
    sun_bgv_slots_n = sum(1 for s in slots if s.role_type == "Sun.BGV")
    cur_sun_bgv_spread = model.NewIntVar(0, sun_bgv_slots_n, "cur_sb_spread")
    sun_bgv_constrained = [p for p in sun_bgv_eligible if p not in role_fairness_exempt.get("Sun.BGV", set())]
    if len(sun_bgv_constrained) >= 2 and sun_bgv_slots_n > 0:
        sb_max = model.NewIntVar(0, sun_bgv_slots_n, "sb_max")
        sb_min = model.NewIntVar(0, sun_bgv_slots_n, "sb_min")
        for p in sun_bgv_constrained:
            rslack = role_fairness_slack.get((p, "Sun.BGV"), 0)
            model.Add(role_vars[(p, "Sun.BGV")] <= sb_max + rslack)
            model.Add(role_vars[(p, "Sun.BGV")] >= sb_min - rslack)
        model.Add(cur_sun_bgv_spread == sb_max - sb_min)
        model.Add(cur_sun_bgv_spread <= sun_bgv_limit)
    else:
        model.Add(cur_sun_bgv_spread == 0)

    # DSL count rules
    for rule in dsl_count_rules:
        terms = [role_vars[(rule.person, rt)] for rt in ROLE_ORDER if rt in rule.role_types]
        if not terms:
            raise ValueError(f"DSL count rule has no matching roles: '{rule.source}'")
        expr = terms[0] if len(terms) == 1 else sum(terms)
        if rule.operator == "==":
            model.Add(expr == rule.value)
        elif rule.operator == ">=":
            model.Add(expr >= rule.value)
        else:
            model.Add(expr <= rule.value)

    if empty_objective_only:
        # Stage A: fill as many seats as possible (availability-limited), in the
        # Choir -> BGV -> 2nd-Lead degradation order, ignoring fairness.
        model.Minimize(weighted_empty)
    elif optimize:
        # Soft consecutive discouragement
        consec_penalties: List[cp_model.BoolVar] = []
        if config.discourage_consecutive_role_repeats:
            for person in all_people:
                for role_type in ROLE_ORDER:
                    assigned: Dict[int, cp_model.BoolVar] = {}
                    for week in range(1, config.weeks + 1):
                        wslots = [s for s in slots if s.week == week and s.role_type == role_type]
                        av = model.NewBoolVar(f"asgn[{person},{role_type},W{week}]")
                        wterms = [x[(person, s.key)] for s in wslots if (person, s.key) in x]
                        if wterms:
                            model.Add(av == sum(wterms))
                        else:
                            model.Add(av == 0)
                        assigned[week] = av
                    for week in range(1, config.weeks):
                        if week not in assigned or week + 1 not in assigned:
                            continue
                        rv = model.NewBoolVar(f"rep[{person},{role_type},W{week}]")
                        a, b = assigned[week], assigned[week + 1]
                        model.Add(rv <= a)
                        model.Add(rv <= b)
                        model.Add(rv >= a + b - 1)
                        consec_penalties.append(rv)

        # Sun lead rotation terms
        sun_lead_eligible = [p for p in all_people if is_eligible(p, "Sun.Lead", pools, forbidden)]
        sun_lead_rotation = []
        sun_lead_weekly_rotation = []
        if sun_lead_eligible:
            pw = {p: rng.randint(0, max(1, config.random_tie_break_weight_max)) for p in sun_lead_eligible}
            sun_lead_rotation = [pw[p] * role_vars[(p, "Sun.Lead")] for p in sun_lead_eligible]
            for week in range(1, config.weeks + 1):
                ws = [s for s in slots if s.week == week and s.role_type == "Sun.Lead"]
                if not ws:
                    continue
                wpw = {p: rng.randint(0, max(1, config.random_tie_break_weight_max)) for p in sun_lead_eligible}
                for p in sun_lead_eligible:
                    wt = [x[(p, s.key)] for s in ws if (p, s.key) in x]
                    if wt:
                        sun_lead_weekly_rotation.append(wpw[p] * sum(wt))

        rand_w = {k: rng.randint(0, max(1, config.random_tie_break_weight_max)) for k in x}
        max_rand = sum(rand_w.values())
        weights = compute_priority_weights(overall_limit, len(consec_penalties), max_rand)

        obj = [weights["global"] * overall_spread]
        if sun_lead_rotation:
            obj.append(weights["sun_lead_rotation"] * sum(sun_lead_rotation))
        if sun_lead_weekly_rotation:
            obj.append(weights["sun_lead_weekly_rotation"] * sum(sun_lead_weekly_rotation))
        for rt in ROLE_ORDER:
            obj.append(weights[rt] * role_spread_vars[rt])
        if consec_penalties:
            obj.append(weights["consecutive"] * sum(consec_penalties))
        obj.append(weights["tie_break"] * sum(rand_w[k] * var for k, var in x.items()))
        model.Minimize(sum(obj))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = (
        max_time_override if max_time_override is not None
        else config.solver_max_time_seconds
    )
    solver.parameters.num_search_workers = config.solver_num_search_workers
    solver.parameters.search_branching = (
        cp_model.RANDOMIZED_SEARCH if optimize else cp_model.AUTOMATIC_SEARCH
    )
    solver.parameters.random_seed = (
        config.seed if config.seed is not None else random.SystemRandom().randint(1, 1_000_000_000)
    )

    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None

    assignments: Dict[str, List[Slot]] = {p: [] for p in all_people}
    for (person, slot_key), var in x.items():
        if solver.Value(var):
            assignments[person].append(slot_by_key[slot_key])

    total_counts = {p: solver.Value(total_vars[p]) for p in all_people}
    rc = {p: {rt: solver.Value(role_vars[(p, rt)]) for rt in ROLE_ORDER} for p in all_people}

    unfilled = [
        f"W{s.week} {s.service} {s.role_type} #{s.slot_index}"
        for s in slots if solver.Value(filled[s.key]) == 0
    ]

    return SolveResult(
        fairness_limit_used=fairness_limit,
        sun_lead_fairness_limit_used=sun_lead_limit,
        sun_bgv_fairness_limit_used=sun_bgv_limit,
        history_runs_used=hist_runs,
        assignments=assignments,
        total_counts=total_counts,
        role_counts=rc,
        weighted_empty_used=int(solver.Value(weighted_empty)),
        unfilled=unfilled,
    )


def diagnose_infeasibility(
    config: ScheduleConfig,
    slots: Sequence[Slot],
    week_exclusions: Sequence[DslWeekExclusionRule],
    pools: Dict[str, Set[str]],
    forbidden: Dict[str, Set[str]],
) -> str:
    """
    Availability-aware diagnosis. With optional BGV/Choir seats, the only true
    infeasibility is a service that cannot field its mandatory Lead — so report
    exactly which week/service has no available lead, accounting for who is marked
    unavailable that week. (Falls back to a generic message if leads are available
    yet some other hard restriction over-constrains the model.)
    """
    excluded_pwr = {
        (r.person, r.week, rt)
        for r in week_exclusions for rt in r.role_types
    }
    problems: List[str] = []
    for week in range(1, config.weeks + 1):
        for service, lead_role in (("Sunday", "Sun.Lead"), ("Saturday", "Sat.Lead")):
            lead_slots = [s for s in slots if s.week == week and s.role_type == lead_role]
            if not lead_slots:
                continue
            available = [
                p for p in pools[lead_role]
                if lead_role not in forbidden.get(p, set())
                and (p, week, lead_role) not in excluded_pwr
            ]
            if not available:
                problems.append(
                    f"  Week {week} {service}: no one available to lead "
                    f"({lead_role}) — every eligible lead is unavailable or excluded.")

    lines = ["The schedule is infeasible: a mandatory Lead seat cannot be filled."]
    if problems:
        lines.extend(problems)
        lines.append("Fix: free up a lead that week, or widen the lead pool.")
    else:
        lines.append(
            "  Leads are available, so a hard restriction (a conflict, pairing, "
            "weekly-presence, or count rule) is over-constraining the model. "
            "Review the rules involved.")
    return "\n".join(lines)


# ─── Main solver orchestration ────────────────────────────────────────────────

def solve_schedule(config: ScheduleConfig) -> SolveResult:
    config = resolve_dsl_templates(config)
    all_people, pools = validate_config(config)

    (forbidden, count_rules, pair_rules, fairness_exempt, fairness_slack,
     weekly_presence, week_exclusions, role_fairness_exempt, role_fairness_slack,
     consecutive_rules) = parse_dsl_rules(config.dsl_restrictions, set(all_people))

    sat_weeks = normalize_weekend_indexes(config.weeks, config.weekends_w_sat)

    # Automatic fairness slack from absences: a person unavailable for K services
    # gets K slack, so their unavoidable shortfall never reads as unfairness.
    absence_slack = compute_absence_slack(week_exclusions, config.weeks, sat_weeks, all_people)
    combined_slack = {p: fairness_slack.get(p, 0) + absence_slack.get(p, 0) for p in all_people}

    # Global fairness groups
    strict = [p for p in all_people if p not in fairness_exempt and combined_slack.get(p, 0) == 0]
    relaxed = {p: combined_slack[p] for p in all_people
               if p not in fairness_exempt and combined_slack.get(p, 0) > 0}
    if len(strict) < 2:
        strict = [p for p in all_people if p not in fairness_exempt]
        relaxed = {}
    global_people = strict
    global_slack = relaxed

    hist_total, hist_role, hist_runs = build_history_offsets(config.history, all_people)
    slots = build_slots(config)
    candidates = build_candidate_map(all_people, pools, forbidden, slots, config.seed)

    common = dict(
        config=config, all_people=all_people,
        global_fairness_people=global_people, global_fairness_slack=global_slack,
        pools=pools, forbidden=forbidden,
        dsl_count_rules=count_rules, dsl_pair_rules=pair_rules,
        dsl_weekly_presence_rules=weekly_presence, dsl_week_exclusion_rules=week_exclusions,
        dsl_consecutive_rules=consecutive_rules,
        role_fairness_exempt=role_fairness_exempt, role_fairness_slack=role_fairness_slack,
        slots=slots, candidates=candidates,
        hist_total=hist_total, hist_role=hist_role, hist_runs=hist_runs,
    )

    big = len(slots) + 1  # a fairness limit so loose it never binds

    # Global wall-clock budget across all internal solves. On a fractional-vCPU
    # container each solve is slow, so we cap total time and return the best
    # schedule found so far rather than letting the HTTP request time out.
    deadline = time.monotonic() + max(1, config.solver_total_budget_seconds)

    def solve_time() -> float:
        return min(config.solver_max_time_seconds, max(1.0, deadline - time.monotonic()))

    # Stage A: fill as many seats as availability allows (Choir → BGV → 2nd-Lead
    # degradation), ignoring fairness entirely. This decouples seat-filling from
    # fairness so a tight fairness cap can never force a seat empty.
    stage_a = create_model_and_solve(
        **common, fairness_limit=big, sun_lead_limit=big, sun_bgv_limit=big,
        optimize=False, empty_objective_only=True, max_time_override=solve_time(),
    )
    if stage_a is None:
        # The only true infeasibility: a service can't field its mandatory lead
        # (or a hard restriction over-constrains the model).
        raise RuntimeError(
            diagnose_infeasibility(config, slots, week_exclusions, pools, forbidden))
    empty_target = stage_a.weighted_empty_used

    # Stage B: among the max-fill solutions, optimize fairness via the relaxation
    # loop (Sun.Lead → Sun.BGV → global). empty_target keeps the fill maximal.
    for sl_limit in (1, 2):
        for sb_limit in (1, 2):
            for g_limit in (1, 2):
                for opt in (True, False):
                    if deadline - time.monotonic() < 1.0:
                        return stage_a  # out of budget — return the max-fill solution
                    result = create_model_and_solve(
                        **common, fairness_limit=g_limit,
                        sun_lead_limit=sl_limit, sun_bgv_limit=sb_limit,
                        optimize=opt, empty_target=empty_target,
                        max_time_override=solve_time(),
                    )
                    if result is not None:
                        return result

    # Every fairness tier was infeasible even at max fill — return the max-fill
    # solution rather than failing. (Fairness simply couldn't be tightened.)
    return stage_a


# ─── Schedule view / output ───────────────────────────────────────────────────

def build_schedule_view(result: SolveResult, weeks: int, sat_weeks: Sequence[int]) -> Dict:
    view: Dict[int, Dict[str, Dict[str, List[str]]]] = {
        w: {SUNDAY_SERVICE: {"Lead": [], "BGV": [], "Choir": []}}
        for w in range(1, weeks + 1)
    }
    for w in sat_weeks:
        view[w][SATURDAY_SERVICE] = {"Lead": [], "BGV": []}

    for person, pslots in result.assignments.items():
        for slot in pslots:
            if slot.service == SUNDAY_SERVICE:
                if slot.role_type == "Sun.Lead":
                    view[slot.week][SUNDAY_SERVICE]["Lead"].append(person)
                elif slot.role_type == "Sun.BGV":
                    view[slot.week][SUNDAY_SERVICE]["BGV"].append(person)
                elif slot.role_type == "Sun.Choir":
                    view[slot.week][SUNDAY_SERVICE]["Choir"].append(person)
            elif slot.service == SATURDAY_SERVICE:
                if slot.role_type == "Sat.Lead":
                    view[slot.week][SATURDAY_SERVICE]["Lead"].append(person)
                elif slot.role_type == "Sat.BGV":
                    view[slot.week][SATURDAY_SERVICE]["BGV"].append(person)

    for week_services in view.values():
        for roles in week_services.values():
            for names in roles.values():
                names.sort()
    return view


# ─── Shared callable interface ────────────────────────────────────────────────

def solve_from_dict(data: Dict) -> Dict:
    """
    Run the solver from a plain dict (used by GCF handler, API routes, etc.).
    Returns a plain dict — no stdin/stdout required.
    """
    try:
        config = ScheduleConfig(
            weeks=int(data.get("weeks", 4)),
            weekends_w_sat=[int(w) for w in data.get("weekends_with_saturday", [])],
            sunday_leads_pool=list(data.get("sunday_leads", [])),
            saturday_leads_pool=list(data.get("saturday_leads", [])),
            support_pool=list(data.get("support", [])),
            dsl_restrictions=list(data.get("dsl_rules", [])),
            history=list(data.get("history", [])),
            seed=data.get("seed"),
            solver_max_time_seconds=int(data.get("solver_max_time_seconds", 5)),
            solver_num_search_workers=int(data.get("solver_num_search_workers", 1)),
            solver_total_budget_seconds=int(data.get("solver_total_budget_seconds", 40)),
            discourage_consecutive_role_repeats=bool(
                data.get("discourage_consecutive", True)
            ),
        )
        result = solve_schedule(config)
    except (ValueError, RuntimeError) as e:
        return {"ok": False, "error": str(e)}

    sat_weeks = normalize_weekend_indexes(config.weeks, config.weekends_w_sat)
    schedule_view = build_schedule_view(result, config.weeks, sat_weeks)

    return {
        "ok": True,
        "schedule": {str(w): v for w, v in schedule_view.items()},
        "fairness_relaxed": result.fairness_limit_used > 1,
        "sun_lead_fairness_relaxed": result.sun_lead_fairness_limit_used > 1,
        "sun_bgv_fairness_relaxed": result.sun_bgv_fairness_limit_used > 1,
        "history_runs_used": result.history_runs_used,
        "total_counts": result.total_counts,
        "role_counts": result.role_counts,
        "unfilled_seats": result.unfilled or [],
    }


# ─── JSON interface (CLI / subprocess mode) ───────────────────────────────────

def run_json_mode() -> None:
    """Read JSON config from stdin, write JSON result to stdout."""
    try:
        raw = sys.stdin.read()
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        sys.stdout.write(json.dumps({"ok": False, "error": f"Invalid JSON input: {e}"}))
        return
    sys.stdout.write(json.dumps(solve_from_dict(data)))


# ─── Default config (test / CLI mode) ─────────────────────────────────────────

def build_default_config() -> ScheduleConfig:
    return ScheduleConfig(
        weeks=4,
        weekends_w_sat=[1, 3],
        sunday_leads_pool=["Frank", "Gaby", "Marianne", "Rachel", "Lali", "Hugo", "Jakey", "Mkz", "Niza"],
        saturday_leads_pool=["Liu", "Lucía"],
        support_pool=["Pau E"],
        dsl_restrictions=[
            "Frank !in Sat.* & !in Sun.BGV & !in Sun.Choir & fairness_exempt",
            "Mkz !in Sat.* & !in Sun.BGV & !in Sun.Choir & fairness_exempt",
            "Gaby !in Sat.*",
            "Gaby !in Sun.Choir & fairness_slack 1 & Sun.BGV <= {weeks-2}",
            "Lucía !with Niza on *.LeadBGV",
            "Hugo !with Lucía on *.Lead",
            "Niza !with Hugo on *.Lead",
            "Jakey !with Hugo on *.BGV & Jakey !with Hugo on *.Lead",
            "any_of(Hugo,Jakey) on Sun.BGV each_week",
        ],
        history=[],
        seed=None,
    )


def run_interactive_mode() -> None:
    config = build_default_config()
    try:
        result = solve_schedule(config)
    except RuntimeError as e:
        print(f"ERROR: {e}")
        return

    sat_weeks = normalize_weekend_indexes(config.weeks, config.weekends_w_sat)
    view = build_schedule_view(result, config.weeks, sat_weeks)

    print(f"Solved (fairness limit used: {result.fairness_limit_used}, "
          f"history runs: {result.history_runs_used})\n")
    for week in range(1, config.weeks + 1):
        print(f"Week {week}:")
        sv = view[week]
        sun = sv[SUNDAY_SERVICE]
        print(f"  Sunday  — Lead: {sun['Lead']}, BGV: {sun['BGV']}, Choir: {sun['Choir']}")
        if SATURDAY_SERVICE in sv:
            sat = sv[SATURDAY_SERVICE]
            print(f"  Saturday — Lead: {sat['Lead']}, BGV: {sat['BGV']}")
    print()
    print("Total assignments:")
    for p, n in sorted(result.total_counts.items(), key=lambda t: (-t[1], t[0])):
        print(f"  {p}: {n}")


if __name__ == "__main__":
    if "--json-mode" in sys.argv:
        run_json_mode()
    else:
        run_interactive_mode()
