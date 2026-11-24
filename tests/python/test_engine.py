import copy
import math

import pytest
from conftest import synthetic_payload

from _prospects import analyse, parse_request


def run(payload):
    return analyse(parse_request(payload))


@pytest.fixture(scope="module")
def strong_result():
    return run(synthetic_payload(n=3000, seed=3))


def test_recovers_injected_project_effect():
    # The planted effect is 3.0x. Across repeated samples the estimate must
    # centre on it, and the 95% CI must contain it most of the time (a single
    # sample can miss by chance, so one seed alone would be a flaky test).
    runs = [run(synthetic_payload(n=3000, seed=seed)) for seed in range(20)]
    drivers = [next(d for d in r["drivers"] if d["feature"] == "project_RES") for r in runs]

    mean_ratio = sum(d["odds_ratio"] for d in drivers) / len(drivers)
    coverage = sum(d["ci_low"] <= 3.0 <= d["ci_high"] for d in drivers) / len(drivers)
    assert mean_ratio == pytest.approx(3.0, rel=0.1)
    assert coverage >= 0.8
    assert all(d["ci_low"] > 1 and d["direction"] == "up" for d in drivers)
    assert drivers[0]["statement"].startswith("First purchase in Bayview Residences (vs Aspire Tower)")


def test_null_factors_are_rarely_reported(strong_result):
    # Contract value and payment have no true effect in the synthetic data.
    reported = {d["feature"] for d in strong_result["drivers"]}
    assert not reported & {"log_first_tcp", "first_payment_pct", "reached_10"}


def test_reports_accuracy_and_model_metadata(strong_result):
    model = strong_result["model"]
    assert model["cv_auc"] >= 0.6
    assert model["cv_folds"] == 5
    assert model["reference_project"] == "Aspire Tower"
    assert model["trained_on"]["repeat"] >= 30


def test_tenure_is_never_a_driver_or_reason(strong_result):
    # Tenure has a strong true effect in the synthetic data (A1 says hide it anyway).
    assert all(d["feature"] != "tenure_years" for d in strong_result["drivers"])
    for prospect in strong_result["prospects"]:
        assert all("year" not in reason.lower() for reason in prospect["reasons"])


def test_prospects_are_single_buyers_with_consistent_tiers(strong_result):
    base_rate = strong_result["model"]["base_rate"]
    prospects = strong_result["prospects"]
    assert prospects, "expected some prospects"
    assert [p["probability"] for p in prospects] == sorted((p["probability"] for p in prospects), reverse=True)
    for p in prospects:
        assert 0 < p["probability"] < 1
        assert p["lift"] == pytest.approx(p["probability"] / base_rate, rel=0.01)
        assert p["tier"] == ("high" if p["lift"] >= 2.0 else "promising")
        assert p["lift"] >= 1.25
    summary = strong_result["summary"]
    assert summary["high"] + summary["promising"] >= len(prospects)


def test_reasons_only_cite_the_customers_own_project(strong_result):
    for p in strong_result["prospects"]:
        for reason in p["reasons"]:
            assert reason in {"Bayview Residences", "Aspire Tower", "Hillcrest Estates", "Marina Suites"} or "first contract" in reason or "10% payment" in reason


def test_no_signal_yields_weak_signal():
    result = run(synthetic_payload(n=1500, seed=5, shuffle_labels=True))
    assert result["status"] == "weak_signal"
    assert result["model"]["cv_auc"] < 0.6
    assert result["drivers"] == [] and result["prospects"] == []


def test_too_few_repeat_buyers_yields_insufficient_data():
    result = run(synthetic_payload(n=80, seed=2))
    assert result["status"] == "insufficient_data"
    assert result["model"]["cv_auc"] is None


def test_recent_customers_are_excluded_from_training_but_scored():
    payload = synthetic_payload(n=2500, seed=7, recent_share=0.2)
    result = run(payload)
    total = len(payload["customers"])
    trained = result["model"]["trained_on"]
    assert result["model"]["excluded_recent"] > 0
    assert trained["repeat"] + trained["single"] + result["model"]["excluded_recent"] == total
    singles = sum(1 for c in payload["customers"] if len(c["contracts"]) == 1)
    assert result["summary"]["scored"] == singles


def test_scores_ignore_tenure_differences(monkeypatch):
    from _prospects import engine

    monkeypatch.setattr(engine, "MAX_PROSPECTS", 100_000)
    payload = synthetic_payload(n=2500, seed=11)
    template = next(c for c in payload["customers"] if len(c["contracts"]) == 1 and c["contracts"][0]["project_code"] == "RES")
    old, new = copy.deepcopy(template), copy.deepcopy(template)
    old["ref"], new["ref"] = "TWIN-OLD", "TWIN-NEW"
    old["contracts"][0]["credit_date"] = "2021-11-24T00:00:00+00:00"
    new["contracts"][0]["credit_date"] = "2026-03-01T00:00:00+00:00"
    payload["customers"] += [old, new]

    prospects = {p["ref"]: p for p in run(payload)["prospects"]}
    # Same first purchase, 4+ years apart: A1 says they must score identically.
    assert prospects["TWIN-OLD"]["probability"] == prospects["TWIN-NEW"]["probability"]


def test_is_deterministic():
    payload = synthetic_payload(n=1200, seed=9)
    assert run(payload) == run(copy.deepcopy(payload))


def test_statement_formats_ratios():
    from _prospects.interpret import Driver

    up = Driver("x", "Label", 2.14, 1.42, 3.21)
    down = Driver("y", "Other", 0.55, 0.38, 0.81)
    assert up.statement == "Label — 2.1× as likely to buy again (95% CI 1.4–3.2×)"
    assert down.statement == "Other — 0.55× as likely to buy again (95% CI 0.38–0.81×)"
    assert down.direction == "down" and not math.isnan(down.odds_ratio)
