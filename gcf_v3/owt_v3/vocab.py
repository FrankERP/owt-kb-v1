"""Neutral vocabulary (C2 IF2-1 read in request terms, spec §5.2) and pure helpers.

Nothing here reads the clock or a time zone: dates are `YYYY-MM-DD` strings on the
CDMX calendar and every weekday comes from `datetime.date`, a civil calendar.
"""

import datetime
import re

ROLES = ("Lead", "BGV", "Choir")  # the seat-order rule: Lead > BGV > Choir
ROLE_RANK = {"Lead": 0, "BGV": 1, "Choir": 2}

# IF2-1's RoleKey, in its canonical order.
ROLE_KEYS = ("Sun.Lead", "Sat.Lead", "Sun.BGV", "Sat.BGV", "Sun.Choir", "Sat.Choir")
LINE_OF_KEY = {
    "Sun.Lead": "DL", "Sat.Lead": "SL",
    "Sun.BGV": "BGV", "Sat.BGV": "BGV",
    "Sun.Choir": "CORO", "Sat.Choir": "CORO",
}
BASE_LINES = ("DL", "SL", "BGV", "CORO")
TAB_KEYS = ("DL", "SL", "BGV", "CORO", "TOTAL")
SERVICE_KINDS = ("sunday", "saturday", "special")

MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# app/utils/serviceTime.ts SERVICE_TIME_RE — keep the two identical.
SERVICE_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
RULE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# JavaScript's `\s` (ECMAScript WhiteSpace + LineTerminator), spelled out so the
# service-id check matches app/utils/roleWriteRequest.ts isCanonicalDocumentId exactly.
_JS_WHITESPACE = re.compile(
    "[\t\n\u000b\u000c\r    -     　﻿]"
)
DOCUMENT_ID_MAX = 200


def utf16_length(text):
    """String length as JavaScript counts it (UTF-16 code units)."""
    return len(text.encode("utf-16-le", "surrogatepass")) // 2


def is_canonical_document_id(value):
    """app/utils/roleWriteRequest.ts isCanonicalDocumentId, mirrored."""
    return (
        isinstance(value, str)
        and len(value) > 0
        and utf16_length(value) <= DOCUMENT_ID_MAX
        and _JS_WHITESPACE.search(value) is None
        and not value.startswith("drafts.")
    )


def parse_date(text):
    """A `datetime.date` for a valid `YYYY-MM-DD`, else None."""
    if not isinstance(text, str) or not DATE_RE.match(text):
        return None
    try:
        return datetime.date(int(text[0:4]), int(text[5:7]), int(text[8:10]))
    except ValueError:
        return None


def is_month(text):
    return isinstance(text, str) and MONTH_RE.match(text) is not None


def weekday(date_text):
    """0 = Monday … 6 = Sunday."""
    return parse_date(date_text).weekday()


def is_sunday(date_text):
    return weekday(date_text) == 6


def day_class(date_text):
    """D14/A13: a Sunday-dated service takes the `Sun.*` keys, any other day `Sat.*`."""
    return "Sun" if is_sunday(date_text) else "Sat"


def role_key(day, role):
    return f"{day}.{role}"


def month_index(month):
    return int(month[0:4]) * 12 + int(month[5:7]) - 1


def month_of_index(index):
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def add_months(month, k):
    return month_of_index(month_index(month) + k)


def add_days(date_text, k):
    return (parse_date(date_text) + datetime.timedelta(days=k)).isoformat()


def weekend_of(date_text):
    """The Sunday on or after a date (spec §5.4 `consecutive`)."""
    d = parse_date(date_text)
    return (d + datetime.timedelta(days=(6 - d.weekday()) % 7)).isoformat()


def is_service_time(value):
    return isinstance(value, str) and SERVICE_TIME_RE.match(value) is not None


def time_sort_key(value):
    """compareServiceTime (app/utils/serviceTime.ts): present times ascending, absent last."""
    return (0, value) if is_service_time(value) else (1, "")


def seat_order_key(date, role, time, service_id):
    """The floor seat's order (spec §6.4): date, Lead > BGV > Choir, time, service id."""
    return (date, ROLE_RANK[role], time_sort_key(time), service_id)
