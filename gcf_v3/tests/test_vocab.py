"""Neutral vocabulary and rounding (C2 IF2-1 in request terms, LG-13, C5-8)."""

import unittest
from fractions import Fraction

from owt_v3.rounding import hundredths, tenths
from owt_v3.vocab import (RULE_ID_RE, add_months, is_month, parse_date, day_class, is_canonical_document_id, is_service_time, seat_order_key,
                          time_sort_key, weekend_of)


class Vocabulary(unittest.TestCase):
    def test_day_class_and_weekend(self):
        self.assertEqual(day_class("2026-11-01"), "Sun")  # a Sunday
        self.assertEqual(day_class("2026-11-06"), "Sat")  # a Friday special takes the Sat.* keys
        self.assertEqual(weekend_of("2026-10-31"), "2026-11-01")  # the trailing Saturday's weekend
        self.assertEqual(weekend_of("2026-11-01"), "2026-11-01")

    def test_month_arithmetic(self):
        self.assertEqual(add_months("2026-12", 1), "2027-01")
        self.assertEqual(add_months("2027-01", -1), "2026-12")

    def test_canonical_document_id_mirrors_the_app(self):
        self.assertTrue(is_canonical_document_id("a+b/" + "x" * 196))  # 200 chars, `+` and `/`
        self.assertFalse(is_canonical_document_id("x" * 201))
        self.assertFalse(is_canonical_document_id("has space"))
        self.assertFalse(is_canonical_document_id("nbsp id"))
        self.assertFalse(is_canonical_document_id("bom﻿id"))
        self.assertFalse(is_canonical_document_id("drafts.sundayRole-1"))
        self.assertFalse(is_canonical_document_id(""))
        self.assertFalse(is_canonical_document_id("\U0001F600" * 101))  # 202 UTF-16 code units

    def test_service_time_and_its_order(self):
        self.assertTrue(is_service_time("19:00"))
        self.assertFalse(is_service_time("7:00"))
        self.assertFalse(is_service_time("24:00"))
        keys = sorted([None, "20:00", "19:00"], key=time_sort_key)
        self.assertEqual(keys, ["19:00", "20:00", None])

    def test_floor_seat_order(self):
        a = seat_order_key("2026-11-01", "BGV", "19:00", "z")
        b = seat_order_key("2026-11-01", "Lead", None, "y")
        c = seat_order_key("2026-11-01", "BGV", None, "a")
        self.assertEqual(sorted([a, b, c]), [b, a, c])  # date, then Lead first, then time before none


class StrictShapes(unittest.TestCase):
    """The regexes mirror the JS ones: no trailing newline, ASCII digits only."""

    def test_trailing_newline_refused(self):
        self.assertIsNone(parse_date("2026-11-01\n"))
        self.assertFalse(is_month("2026-11\n"))
        self.assertFalse(is_service_time("19:00\n"))
        self.assertIsNone(RULE_ID_RE.match("abc\n"))

    def test_non_ascii_digits_refused(self):
        self.assertIsNone(parse_date("\u0662\u0660\u0662\u0666-11-01"))
        self.assertIsNone(parse_date("\uff12\uff10\uff12\uff16-11-01"))
        self.assertFalse(is_month("\u0662\u0660\u0662\u0666-11"))
        self.assertFalse(is_service_time("1\u0669:00"))

    def test_valid_still_accepted(self):
        self.assertEqual(parse_date("2026-11-01").isoformat(), "2026-11-01")
        self.assertTrue(is_month("2026-11"))
        self.assertTrue(is_service_time("19:00"))
        self.assertIsNotNone(RULE_ID_RE.match("abc_-9"))


class Rounding(unittest.TestCase):
    def test_half_away_from_zero(self):
        self.assertEqual(hundredths(Fraction(1, 8)), 13)
        self.assertEqual(hundredths(Fraction(-1, 8)), -13)
        self.assertEqual(tenths(Fraction(65, 100)), 7)
        self.assertEqual(tenths(Fraction(-65, 100)), -7)

    def test_tenths_come_from_the_rational_not_the_hundredths(self):
        x = Fraction(11, 17)  # 0.647…
        self.assertEqual((hundredths(x), tenths(x)), (65, 6))
        self.assertEqual(tenths(Fraction(249, 1000)), 2)  # hundredths 25 would round to 3


if __name__ == "__main__":
    unittest.main()
