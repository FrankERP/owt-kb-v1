"""Rounding, once, half away from zero (C2 LG-13; spec C5-8).

Every input is an exact `Fraction` (or an int) in SEATS. Hundredths and tenths are
each rounded from that exact value — never tenths from hundredths.
"""

import math
from fractions import Fraction


def _round_half_away(x, scale):
    x = Fraction(x)
    magnitude = math.floor(abs(x) * scale + Fraction(1, 2))
    return -magnitude if x < 0 else magnitude


def hundredths(x):
    """sign(x) * floor(|x| * 100 + 1/2)."""
    return _round_half_away(x, 100)


def tenths(x):
    """sign(x) * floor(|x| * 10 + 1/2)."""
    return _round_half_away(x, 10)
