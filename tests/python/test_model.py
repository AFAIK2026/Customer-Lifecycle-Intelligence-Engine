import numpy as np
import pytest

from _prospects.model import fit_logistic, roc_auc, stratified_folds


def test_auc_known_values():
    labels = np.array([0, 0, 1, 1])
    assert roc_auc(labels, np.array([0.1, 0.2, 0.8, 0.9])) == 1.0
    assert roc_auc(labels, np.array([0.9, 0.8, 0.2, 0.1])) == 0.0
    assert roc_auc(labels, np.array([0.5, 0.5, 0.5, 0.5])) == 0.5
    assert roc_auc(labels, np.array([0.1, 0.6, 0.4, 0.9])) == 0.75


def test_auc_requires_both_classes():
    with pytest.raises(ValueError):
        roc_auc(np.array([1, 1]), np.array([0.1, 0.2]))


def test_fit_recovers_known_coefficients():
    rng = np.random.default_rng(1)
    x = rng.normal(size=(20_000, 2))
    true = np.array([1.0, -0.5])
    labels = (rng.random(20_000) < 1 / (1 + np.exp(-(-0.3 + x @ true)))).astype(float)

    fit = fit_logistic(x, labels, l2=0.0)
    assert fit.intercept == pytest.approx(-0.3, abs=0.06)
    for estimate, err, expected in zip(fit.coef, fit.std_err, true):
        assert abs(estimate - expected) < 3 * err


def test_penalty_shrinks_coefficients_and_handles_separation():
    x = np.array([[-2.0], [-1.0], [1.0], [2.0]])
    labels = np.array([0.0, 0.0, 1.0, 1.0])  # perfectly separable: unpenalised MLE diverges
    fit = fit_logistic(x, labels, l2=1.0)
    assert np.isfinite(fit.coef).all()
    assert 0 < fit.coef[0] < 5


def test_stratified_folds_balance_classes_and_are_deterministic():
    labels = np.array([1] * 50 + [0] * 250)
    folds = stratified_folds(labels, 5, seed=42)
    for k in range(5):
        assert (labels[folds == k] == 1).sum() == 10
        assert (folds == k).sum() == 60
    assert (folds == stratified_folds(labels, 5, seed=42)).all()
