"""Plain-language interpretation of the fitted model (design §10 steps 5–7).

Coefficients become odds ratios in business units, with 95% confidence
intervals. Only factors whose interval excludes 1.0x are reported, so noise
is never presented as a finding. Tenure is a control variable and is never
reported (amendment A1).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .features import (
    FIRST_PAYMENT_PCT,
    LOG_FIRST_TCP,
    PROJECT_PREFIX,
    REACHED_10,
    TENURE_YEARS,
    CustomerRow,
    FeatureEncoder,
)
from .model import LogisticFit

Z_95 = 1.959964
MAX_DRIVERS = 5
MAX_REASONS = 2
HIGH_LIFT = 2.0
PROMISING_LIFT = 1.25


@dataclass(frozen=True)
class Driver:
    feature: str
    label: str
    odds_ratio: float
    ci_low: float
    ci_high: float

    @property
    def direction(self) -> str:
        return "up" if self.odds_ratio > 1 else "down"

    @property
    def statement(self) -> str:
        return (
            f"{self.label} — {_fmt_ratio(self.odds_ratio)} as likely to buy again "
            f"(95% CI {_fmt_ratio(self.ci_low, suffix=False)}–{_fmt_ratio(self.ci_high)})"
        )

    def to_dict(self) -> dict:
        return {
            "feature": self.feature,
            "label": self.label,
            "odds_ratio": round(self.odds_ratio, 2),
            "ci_low": round(self.ci_low, 2),
            "ci_high": round(self.ci_high, 2),
            "direction": self.direction,
            "statement": self.statement,
        }


def build_drivers(fit: LogisticFit, scale: np.ndarray, encoder: FeatureEncoder) -> list[Driver]:
    """Statistically supported factors, strongest first (at most MAX_DRIVERS)."""
    drivers = []
    reference = encoder.label_of(encoder.reference_project)
    for j, name in enumerate(encoder.feature_names):
        unit_and_label = _unit_and_label(name, encoder, reference)
        if unit_and_label is None:
            continue
        unit, label = unit_and_label
        # Coefficients were fitted on standardised columns; convert to raw units first.
        beta = fit.coef[j] / scale[j] * unit
        err = fit.std_err[j] / scale[j] * unit
        low, high = math.exp(beta - Z_95 * err), math.exp(beta + Z_95 * err)
        if low <= 1.0 <= high:
            continue
        drivers.append(Driver(feature=name, label=label, odds_ratio=math.exp(beta), ci_low=low, ci_high=high))

    drivers.sort(key=lambda d: (-abs(math.log(d.odds_ratio)), d.feature))
    return drivers[:MAX_DRIVERS]


def _unit_and_label(name: str, encoder: FeatureEncoder, reference: str) -> tuple[float, str] | None:
    if name == LOG_FIRST_TCP:
        return math.log(2), "Every doubling of the first contract value"
    if name == FIRST_PAYMENT_PCT:
        return 10.0, "Every 10 percentage points paid on the first contract"
    if name == REACHED_10:
        return 1.0, "Reached 10% payment on the first contract"
    if name == TENURE_YEARS:
        return None
    if name.startswith(PROJECT_PREFIX):
        project = encoder.label_of(name[len(PROJECT_PREFIX) :])
        return 1.0, f"First purchase in {project} (vs {reference})"
    raise ValueError(f"Unknown feature {name}")


def tier_for(lift: float) -> str | None:
    if lift >= HIGH_LIFT:
        return "high"
    if lift >= PROMISING_LIFT:
        return "promising"
    return None


def reasons_for(
    row: CustomerRow,
    std_row: np.ndarray,
    fit: LogisticFit,
    encoder: FeatureEncoder,
    supported: set[str],
) -> list[str]:
    """Up to two short labels for the factors pushing this customer's likelihood up.

    Only statistically supported factors are used, and a project or milestone
    is only cited when the customer actually has it.
    """
    names = encoder.feature_names
    own_project_column = PROJECT_PREFIX + encoder.group_of(row.project_key)
    first = row.first_contract
    candidates: list[tuple[float, str]] = []

    for j, name in enumerate(names):
        if name not in supported:
            continue
        contribution = float(fit.coef[j] * std_row[j])
        if contribution <= 0:
            continue
        if name.startswith(PROJECT_PREFIX):
            if name != own_project_column:
                continue
            candidates.append((contribution, encoder.label_of(encoder.group_of(row.project_key))))
        elif name == REACHED_10:
            if first.payment_percentage >= 10:
                candidates.append((contribution, "10% payment reached"))
        elif name == LOG_FIRST_TCP:
            candidates.append((contribution, f"{format_peso(first.contract_value)} first contract"))
        elif name == FIRST_PAYMENT_PCT:
            candidates.append((contribution, f"{first.payment_percentage:.0f}% paid on first contract"))

    candidates.sort(key=lambda c: -c[0])
    return [label for _, label in candidates[:MAX_REASONS]]


def format_peso(value: float) -> str:
    if value >= 1e9:
        return f"₱{value / 1e9:.1f}B"
    if value >= 1e6:
        return f"₱{value / 1e6:.1f}M".replace(".0M", "M")
    if value >= 1e3:
        return f"₱{value / 1e3:.0f}K"
    return f"₱{value:.0f}"


def _fmt_ratio(value: float, suffix: bool = True) -> str:
    text = f"{value:.1f}" if value >= 1 else f"{value:.2f}"
    return text + ("×" if suffix else "")
