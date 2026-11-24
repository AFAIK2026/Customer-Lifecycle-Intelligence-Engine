"""Feature extraction (design §9, amendments A1 and A2).

Every feature comes from a customer's *first* contract, so repeat buyers and
single buyers are compared at the same moment: their first purchase. Using
customer totals would leak the label (repeat buyers have bigger totals
because they bought twice).
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass

import numpy as np

from .schema import AnalysisRequest, Contract, Customer

REPEAT_MIN_CONTRACTS = 2
# A2: customers must have had at least this long to buy again before they
# count as training examples.
MIN_TRAINING_TENURE_DAYS = 182
# Projects with fewer first purchases than this are grouped as OTHER so
# tiny groups don't produce unstable estimates.
MIN_PROJECT_SIZE = 15
OTHER_PROJECT = "OTHER"
DAYS_PER_YEAR = 365.25

# Column order of the continuous / binary features. Project dummies follow.
LOG_FIRST_TCP = "log_first_tcp"
FIRST_PAYMENT_PCT = "first_payment_pct"
REACHED_10 = "reached_10"
TENURE_YEARS = "tenure_years"
BASE_FEATURES = (LOG_FIRST_TCP, FIRST_PAYMENT_PCT, REACHED_10, TENURE_YEARS)
PROJECT_PREFIX = "project_"


@dataclass(frozen=True)
class CustomerRow:
    """One customer reduced to first-purchase facts."""

    ref: str
    is_repeat: bool
    contract_count: int
    first_contract: Contract
    project_key: str
    tenure_years: float
    in_training: bool


def first_contract(customer: Customer) -> Contract:
    """Earliest credit date; ties broken by contract number so the choice is deterministic."""
    return min(customer.contracts, key=lambda c: (c.credit_date, c.contract_number))


def build_rows(request: AnalysisRequest) -> list[CustomerRow]:
    rows = []
    for customer in request.customers:
        first = first_contract(customer)
        tenure_days = (request.as_of - first.credit_date).total_seconds() / 86_400
        rows.append(
            CustomerRow(
                ref=customer.ref,
                is_repeat=len(customer.contracts) >= REPEAT_MIN_CONTRACTS,
                contract_count=len(customer.contracts),
                first_contract=first,
                project_key=first.project_code or first.project_name or OTHER_PROJECT,
                tenure_years=tenure_days / DAYS_PER_YEAR,
                in_training=tenure_days >= MIN_TRAINING_TENURE_DAYS,
            )
        )
    return rows


@dataclass(frozen=True)
class FeatureEncoder:
    """Turns rows into a numeric matrix with a fixed column layout.

    Fitted on training rows only. The reference category (no column) is the
    most *typical* project: the one whose repeat-buyer rate is closest to the
    overall rate (ties go to the larger project). Each project coefficient then
    reads as "compared with a typical project", so a standout project appears
    as its own factor and can be cited as a prospect's reason. (Using the most
    common project instead made every factor read backwards whenever the most
    common project was also the strongest — design amendment A4.)
    """

    reference_project: str
    project_columns: tuple[str, ...]
    has_other_group: bool
    project_labels: dict[str, str]

    @property
    def feature_names(self) -> list[str]:
        return [*BASE_FEATURES, *(PROJECT_PREFIX + p for p in self.project_columns)]

    @classmethod
    def fit(cls, rows: list[CustomerRow]) -> "FeatureEncoder":
        counts = Counter(r.project_key for r in rows)
        kept = {p for p, n in counts.items() if n >= MIN_PROJECT_SIZE}
        has_other = any(p not in kept for p in counts)

        groups = [r.project_key if r.project_key in kept else OTHER_PROJECT for r in rows]
        group_counts = Counter(groups)
        repeat_counts = Counter(g for g, r in zip(groups, rows) if r.is_repeat)
        overall_rate = sum(repeat_counts.values()) / len(rows) if rows else 0.0

        def typicality(group: str) -> tuple[float, int, str]:
            rate = repeat_counts[group] / group_counts[group]
            return (abs(rate - overall_rate), -group_counts[group], group)

        reference = min(group_counts, key=typicality)
        columns = tuple(sorted(p for p in group_counts if p != reference))

        labels = _project_labels(rows)
        labels[OTHER_PROJECT] = "other projects"
        return cls(
            reference_project=reference,
            project_columns=columns,
            has_other_group=has_other,
            project_labels=labels,
        )

    def group_of(self, project_key: str) -> str:
        if project_key == self.reference_project or project_key in self.project_columns:
            return project_key
        # Projects unseen in training fall into OTHER when that group exists,
        # otherwise into the reference group (all project columns zero).
        return OTHER_PROJECT if self.has_other_group else self.reference_project

    def label_of(self, project_key: str) -> str:
        return self.project_labels.get(project_key, project_key)

    def transform(self, rows: list[CustomerRow], fixed_tenure: float | None = None) -> np.ndarray:
        """Builds the raw (unscaled) feature matrix.

        fixed_tenure (A1): when given, every row gets this tenure, so scoring
        ranks customers on first-purchase traits only.
        """
        matrix = np.zeros((len(rows), len(self.feature_names)))
        column_of = {p: len(BASE_FEATURES) + i for i, p in enumerate(self.project_columns)}
        for i, row in enumerate(rows):
            first = row.first_contract
            matrix[i, 0] = math.log(first.contract_value)
            matrix[i, 1] = first.payment_percentage
            matrix[i, 2] = 1.0 if first.payment_percentage >= 10 else 0.0
            matrix[i, 3] = row.tenure_years if fixed_tenure is None else fixed_tenure
            group = self.group_of(row.project_key)
            if group in column_of:
                matrix[i, column_of[group]] = 1.0
        return matrix


def _project_labels(rows: list[CustomerRow]) -> dict[str, str]:
    """Display name per project key: the most frequent project name seen for it."""
    names: dict[str, Counter[str]] = {}
    for row in rows:
        names.setdefault(row.project_key, Counter())[row.first_contract.project_name or row.project_key] += 1
    return {key: counter.most_common(1)[0][0] for key, counter in names.items()}


@dataclass(frozen=True)
class Scaler:
    """Standardises columns to mean 0, standard deviation 1."""

    mean: np.ndarray
    scale: np.ndarray

    @classmethod
    def fit(cls, matrix: np.ndarray) -> "Scaler":
        mean = matrix.mean(axis=0)
        scale = matrix.std(axis=0)
        # Constant columns stay as they are instead of dividing by zero.
        scale = np.where(scale > 1e-12, scale, 1.0)
        return cls(mean=mean, scale=scale)

    def transform(self, matrix: np.ndarray) -> np.ndarray:
        return (matrix - self.mean) / self.scale
