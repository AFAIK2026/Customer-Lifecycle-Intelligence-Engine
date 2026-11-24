"""Shared fixtures: import path and a synthetic customer generator with known effects."""

from __future__ import annotations

import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "scripts"))

AS_OF = datetime(2026, 11, 24, tzinfo=timezone.utc)

PROJECTS = {
    "TWR": "Aspire Tower",
    "RES": "Bayview Residences",
    "LOT": "Hillcrest Estates",
    "SUI": "Marina Suites",
}


def synthetic_payload(
    n: int = 2000,
    seed: int = 0,
    project_effect: float = math.log(3.0),
    tenure_effect: float = 0.4,
    shuffle_labels: bool = False,
    recent_share: float = 0.0,
) -> dict:
    """Customers whose repeat buying follows a known logistic model.

    True log-odds = -2.6 + project_effect * [first project is RES] + tenure_effect * tenure_years.
    Contract value and payment have no true effect.
    """
    rng = np.random.default_rng(seed)
    codes = list(PROJECTS)
    projects = rng.choice(codes, size=n, p=[0.4, 0.25, 0.2, 0.15])
    tenure_years = rng.uniform(0.6, 5.0, size=n)
    if recent_share:
        recent = rng.random(n) < recent_share
        tenure_years[recent] = rng.uniform(0.0, 0.4, size=recent.sum())
    log_odds = -2.6 + project_effect * (projects == "RES") + tenure_effect * tenure_years
    repeat = rng.random(n) < 1 / (1 + np.exp(-log_odds))
    if shuffle_labels:
        repeat = rng.permutation(repeat)

    customers = []
    for i in range(n):
        first_date = AS_OF - timedelta(days=float(tenure_years[i]) * 365.25)
        contracts = [_contract(f"K{i:05d}-1", projects[i], first_date, rng)]
        if repeat[i]:
            gap = timedelta(days=float(rng.uniform(1, max(2.0, tenure_years[i] * 365.25 - 1))))
            contracts.append(_contract(f"K{i:05d}-2", rng.choice(codes), min(first_date + gap, AS_OF), rng))
        customers.append({"ref": f"R{i:05d}", "contracts": contracts})
    return {"as_of": AS_OF.isoformat(), "customers": customers}


def _contract(number: str, code: str, credit_date: datetime, rng: np.random.Generator) -> dict:
    return {
        "contract_number": number,
        "project_code": str(code),
        "project_name": PROJECTS[str(code)],
        "credit_date": credit_date.isoformat(),
        "contract_value": float(round(rng.lognormal(math.log(6e6), 0.5), -3)),
        "payment_percentage": float(round(rng.uniform(1, 40), 2)),
    }


@pytest.fixture
def as_of() -> datetime:
    return AS_OF
