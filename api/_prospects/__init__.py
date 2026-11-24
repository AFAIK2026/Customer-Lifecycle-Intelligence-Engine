"""Prospect analysis engine.

Learns what first-time buyers who later bought again looked like at their
first purchase, checks how well that pattern predicts repeat buying, and
scores current single-contract customers.

See docs/design/prospect-analysis-python.md for the approved design.
"""

from .engine import MODEL_VERSION, analyse
from .schema import ValidationError, parse_request

__all__ = ["MODEL_VERSION", "ValidationError", "analyse", "parse_request"]
