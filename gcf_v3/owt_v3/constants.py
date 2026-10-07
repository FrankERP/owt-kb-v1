"""Constants of the v3 solver function (spec C5 §5, §7.2, §12.4).

The pin cap's assignment line below is the one literal C6's mirror test reads (spec U8,
C5-13): that line must appear exactly once in this package, spelled exactly as it is.
"""

CONTRACT = 3
ENGINE = "v3"
SOLVER_VERSION = "3.0.0"

PIN_CAP = 250

SCALE = 100  # hundredths of a seat: every fairness figure on the wire

MAX_SERVICES = 40
MAX_PEOPLE = 100
MAX_RULES = 500
MAX_SEATS_PER_ROLE = 6
CARRIED_ABS_MAX = 10000
REQUEST_ID_MAX = 64
PERSON_ID_MAX = 64
SEED_MAX = 2147483647

# Budget (spec §5.7, §7.2). Request knobs clamp DOWN only, into [minimum, default].
TOTAL_SECONDS = 25.0
STAGE_SECONDS = 2.5
STAGE_START_FLOOR = 0.1  # a stage is not started with less budget than this left
MIN_TOTAL_SECONDS = 1.0
MIN_STAGE_SECONDS = 0.05
MIN_STAGE_DET_LIMIT = 0.001

# OQ-1: the smallest value at least 5x the largest deterministic time of any proven
# stage in the `full` acceptance matrix, and at most 1.0 (measured, Task 15).
STAGE_DET_LIMIT = 0.6

# F13 (spec §12.4 as amended at the F13 gate): the smallest multiple of 5 hundredths at or above
# the largest |planned - share| over the pinless, all-proven, fully filled runs of the `full`
# matrix and of the private re-run. A pinned run's gap is reported, not bound by it.
FAIRNESS_TOLERANCE = 35
