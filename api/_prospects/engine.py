"""End-to-end prospect analysis: features → gate → fit → interpret → score."""

from __future__ import annotations

import numpy as np

from .features import TENURE_YEARS, CustomerRow, FeatureEncoder, Scaler, build_rows
from .interpret import build_drivers, reasons_for, tier_for
from .model import CV_FOLDS, L2_PENALTY, cross_validated_auc, fit_logistic
from .schema import AnalysisRequest

MODEL_VERSION = "prospect-logit-1"
METHOD = "L2 logistic regression (NumPy IRLS)"
MIN_CLASS_SIZE = 30
MIN_CV_AUC = 0.60
MAX_PROSPECTS = 200


def analyse(request: AnalysisRequest) -> dict:
    """Runs the full analysis and returns the response body described in design §10.

    The result is deterministic for a given request; the caller adds timestamps.
    """
    rows = build_rows(request)
    training = [r for r in rows if r.in_training]
    labels = np.array([1.0 if r.is_repeat else 0.0 for r in training])
    n_repeat = int(labels.sum())
    n_single = len(training) - n_repeat

    model: dict = {
        "version": MODEL_VERSION,
        "method": METHOD,
        "trained_on": {"repeat": n_repeat, "single": n_single},
        "excluded_recent": len(rows) - len(training),
        "base_rate": round(n_repeat / len(training), 4) if training else None,
        "cv_auc": None,
        "cv_folds": CV_FOLDS,
        "l2_penalty": L2_PENALTY,
        "reference_project": None,
    }

    if n_repeat < MIN_CLASS_SIZE or n_single < MIN_CLASS_SIZE:
        return _empty("insufficient_data", model)

    encoder = FeatureEncoder.fit(training)
    raw = encoder.transform(training)
    model["reference_project"] = encoder.label_of(encoder.reference_project)

    cv_auc = cross_validated_auc(raw, labels)
    model["cv_auc"] = round(cv_auc, 3)
    if cv_auc < MIN_CV_AUC:
        return _empty("weak_signal", model)

    scaler = Scaler.fit(raw)
    fit = fit_logistic(scaler.transform(raw), labels)
    drivers = build_drivers(fit, scaler.scale, encoder)

    base_rate = n_repeat / len(training)
    tenure_index = encoder.feature_names.index(TENURE_YEARS)
    median_tenure = float(np.median(raw[:, tenure_index]))
    prospects = _score(rows, encoder, scaler, fit, base_rate, median_tenure, {d.feature for d in drivers})

    return {
        "status": "ok",
        "model": model,
        "drivers": [d.to_dict() for d in drivers],
        "prospects": prospects[:MAX_PROSPECTS],
        "summary": {
            "scored": sum(1 for r in rows if not r.is_repeat),
            "high": sum(1 for p in prospects if p["tier"] == "high"),
            "promising": sum(1 for p in prospects if p["tier"] == "promising"),
        },
    }


def _score(
    rows: list[CustomerRow],
    encoder: FeatureEncoder,
    scaler: Scaler,
    fit,
    base_rate: float,
    median_tenure: float,
    supported: set[str],
) -> list[dict]:
    """Scores every single-contract customer, including recent ones (A2).

    Tenure is fixed to the training median (A1) so long-standing customers who
    never bought again are not ranked up merely for having been around longer.
    """
    singles = [r for r in rows if not r.is_repeat]
    if not singles:
        return []
    std = scaler.transform(encoder.transform(singles, fixed_tenure=median_tenure))
    probabilities = fit.predict_proba(std)

    prospects = []
    for row, std_row, probability in zip(singles, std, probabilities):
        lift = float(probability) / base_rate
        tier = tier_for(lift)
        if tier is None:
            continue
        prospects.append(
            {
                "ref": row.ref,
                "probability": round(float(probability), 4),
                "lift": round(lift, 2),
                "tier": tier,
                "reasons": reasons_for(row, std_row, fit, encoder, supported),
            }
        )
    prospects.sort(key=lambda p: (-p["probability"], p["ref"]))
    return prospects


def _empty(status: str, model: dict) -> dict:
    return {
        "status": status,
        "model": model,
        "drivers": [],
        "prospects": [],
        "summary": {"scored": 0, "high": 0, "promising": 0},
    }
