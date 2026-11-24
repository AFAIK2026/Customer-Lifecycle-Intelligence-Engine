"""L2-regularised logistic regression in NumPy, plus cross-validated AUC.

Solved with Newton-Raphson (IRLS). NumPy only, so the Vercel function stays
small (design §1). The inverse of the penalised Hessian at the optimum gives
the coefficient covariance used for confidence intervals.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .features import Scaler

L2_PENALTY = 1.0
MAX_ITERATIONS = 50
TOLERANCE = 1e-8
CV_FOLDS = 5
CV_SEED = 42


class ConvergenceError(RuntimeError):
    pass


@dataclass(frozen=True)
class LogisticFit:
    intercept: float
    coef: np.ndarray
    """Coefficients for the (standardised) feature columns."""
    std_err: np.ndarray
    """Standard errors matching coef."""
    iterations: int

    def predict_proba(self, matrix: np.ndarray) -> np.ndarray:
        return _sigmoid(self.intercept + matrix @ self.coef)


def fit_logistic(matrix: np.ndarray, labels: np.ndarray, l2: float = L2_PENALTY) -> LogisticFit:
    """Fits P(label=1) = sigmoid(b0 + X b). The intercept is not penalised."""
    n_rows, n_features = matrix.shape
    design = np.hstack([np.ones((n_rows, 1)), matrix])
    penalty = np.full(n_features + 1, l2)
    penalty[0] = 0.0

    beta = np.zeros(n_features + 1)
    # Start the intercept at the base rate's log-odds for faster convergence.
    rate = float(np.clip(labels.mean(), 1e-6, 1 - 1e-6))
    beta[0] = np.log(rate / (1 - rate))

    for iteration in range(1, MAX_ITERATIONS + 1):
        prob = _sigmoid(design @ beta)
        weights = prob * (1 - prob)
        gradient = design.T @ (labels - prob) - penalty * beta
        hessian = (design * weights[:, None]).T @ design + np.diag(penalty)
        step = _solve(hessian, gradient)
        beta = beta + step
        if np.max(np.abs(step)) < TOLERANCE:
            break
    else:
        raise ConvergenceError(f"Logistic regression did not converge in {MAX_ITERATIONS} iterations")

    prob = _sigmoid(design @ beta)
    weights = prob * (1 - prob)
    hessian = (design * weights[:, None]).T @ design + np.diag(penalty)
    covariance = np.linalg.pinv(hessian)
    std_err = np.sqrt(np.clip(np.diag(covariance), 0.0, None))

    return LogisticFit(intercept=float(beta[0]), coef=beta[1:], std_err=std_err[1:], iterations=iteration)


def roc_auc(labels: np.ndarray, scores: np.ndarray) -> float:
    """Area under the ROC curve via the rank-sum (Mann-Whitney) formula; ties count half."""
    positives = labels == 1
    n_pos = int(positives.sum())
    n_neg = len(labels) - n_pos
    if n_pos == 0 or n_neg == 0:
        raise ValueError("AUC needs at least one positive and one negative label")
    ranks = _average_ranks(scores)
    return float((ranks[positives].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))


def stratified_folds(labels: np.ndarray, folds: int = CV_FOLDS, seed: int = CV_SEED) -> np.ndarray:
    """Fold number per row, keeping the repeat/single mix about equal in every fold."""
    rng = np.random.default_rng(seed)
    assignment = np.empty(len(labels), dtype=int)
    for value in (0, 1):
        idx = np.flatnonzero(labels == value)
        rng.shuffle(idx)
        assignment[idx] = np.arange(len(idx)) % folds
    return assignment


def cross_validated_auc(raw_matrix: np.ndarray, labels: np.ndarray, folds: int = CV_FOLDS) -> float:
    """Mean ROC-AUC over stratified folds. The scaler is refitted inside each fold."""
    assignment = stratified_folds(labels, folds)
    scores = []
    for fold in range(folds):
        test = assignment == fold
        train = ~test
        scaler = Scaler.fit(raw_matrix[train])
        fit = fit_logistic(scaler.transform(raw_matrix[train]), labels[train])
        scores.append(roc_auc(labels[test], fit.predict_proba(scaler.transform(raw_matrix[test]))))
    return float(np.mean(scores))


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -35.0, 35.0)))


def _solve(matrix: np.ndarray, vector: np.ndarray) -> np.ndarray:
    try:
        return np.linalg.solve(matrix, vector)
    except np.linalg.LinAlgError:
        return np.linalg.lstsq(matrix, vector, rcond=None)[0]


def _average_ranks(values: np.ndarray) -> np.ndarray:
    """1-based ranks; tied values share the average of their positions."""
    _, inverse, counts = np.unique(values, return_inverse=True, return_counts=True)
    upper = np.cumsum(counts)
    lower = upper - counts + 1
    return ((lower + upper) / 2.0)[inverse]
