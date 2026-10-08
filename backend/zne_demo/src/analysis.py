"""Synthetic teaching data and weighted ZNE fits, independent of IBM credentials."""
import math
import numpy as np
from scipy.optimize import curve_fit
from scipy.stats import chi2

FACTORS = (1, 3, 5)

def summarize(counts, factor, bit_index=0):
    """Qiskit strings are little-endian: logical classical bit 0 is rightmost."""
    shots = sum(counts.values())
    if shots < 2:
        raise ValueError('At least two shots are required')
    zeros = sum(n for bits, n in counts.items() if bits.replace(' ', '')[-1-bit_index] == '0')
    mean = (2 * zeros - shots) / shots
    # Jeffreys smoothing prevents zero estimated uncertainty for all-equal outcomes.
    p = (zeros + 0.5) / (shots + 1)
    se = 2 * math.sqrt(p * (1-p) / shots)
    return dict(factor=factor, shots=shots, zeros=zeros, ones=shots-zeros, mean=mean, standard_error=se)

def simulate(level, shots, seed):
    rng = np.random.default_rng(seed)
    points = []
    for factor in FACTORS:
        mean = 0.9 - 0.1 * factor if level == 'linear' else 0.9 * 0.8 ** factor
        zeros = int(rng.binomial(shots, (1+mean)/2))
        points.append(summarize({'0': zeros, '1': shots-zeros}, factor))
    return points

def fit(points, model):
    x = np.array([p['factor'] for p in points], dtype=float)
    y = np.array([p['mean'] for p in points], dtype=float)
    sigma = np.array([p['standard_error'] for p in points], dtype=float)
    if (len(points) < 3 or len(set(x)) != len(x)
        or not np.all(np.isfinite(x)) or not np.all(x >= 1)
        or not np.all(np.isfinite(y)) or not np.all(np.abs(y) <= 1)
        or not np.all(np.isfinite(sigma)) or not np.all(sigma > 0)):
        raise ValueError('Need three distinct factors and positive uncertainties')
    if model == 'linear':
        def function(t, amplitude, slope):
            return amplitude + slope * t
        # Exact weighted least squares: no nonlinear optimizer or starting guess.
        design = np.column_stack((np.ones_like(x), x))
        whitened = design / sigma[:, None]
        covariance = np.linalg.inv(whitened.T @ whitened)
        parameters = np.linalg.lstsq(whitened, y / sigma, rcond=None)[0]
    elif model == 'exponential':
        def function(t, amplitude, decay):
            return amplitude * np.exp(-decay * t)
        initial, bounds = [float(y[0]), 0.2], ([-np.inf, 0], [np.inf, np.inf])
        parameters, covariance = curve_fit(function, x, y, p0=initial, bounds=bounds,
            sigma=sigma, absolute_sigma=True, maxfev=10000)
    else:
        raise ValueError('Unknown model')
    estimate = float(parameters[0])
    estimate_se = float(np.sqrt(covariance[0, 0]))
    if not math.isfinite(estimate) or not math.isfinite(estimate_se):
        raise ValueError('Fit did not produce finite results')
    curve = []
    for t in np.linspace(0,5,101):
        if model == 'linear':
            jacobian = np.array([1., t])
        else:
            e = np.exp(-parameters[1]*t)
            jacobian = np.array([e, -parameters[0]*t*e])
        local_se = float(np.sqrt(max(0., jacobian @ covariance @ jacobian)))
        curve.append(dict(x=float(t), y=float(function(t, *parameters)), standard_error=local_se))
    # Approximate tests conditional on independent sampling and this chosen model.
    # They cannot diagnose SPAM, drift or errors in noise amplification.
    weights = 1 / sigma**2
    constant = float(np.average(y, weights=weights))
    trend_chi2 = float(np.sum(((y-constant)/sigma)**2))
    trend_p = float(chi2.sf(trend_chi2, len(points)-1))
    residual_chi2 = float(np.sum(((y-function(x, *parameters))/sigma)**2))
    fit_p = float(chi2.sf(residual_chi2, len(points)-2))
    raw_index = int(np.argmin(x))
    warnings = []
    if trend_p >= 0.05:
        warnings.append('The measurements do not resolve a noise trend at the 5% threshold. The intercept is weak evidence of mitigation.')
    if fit_p < 0.01:
        warnings.append('The chosen model is inconsistent with the measured points under the sampling-error assumption.')
    if abs(estimate) > 1:
        warnings.append('The extrapolated value is outside the physical range; do not treat it as a recovered signal.')
    if estimate_se > 2 * float(sigma[raw_index]):
        warnings.append('Extrapolation more than doubles the estimated sampling uncertainty of the original measurement.')
    if model == 'exponential' and parameters[1] < 1e-6:
        warnings.append('The exponential decay reached its lower bound. This model may not describe the noise response.')
    return dict(model=model, estimate=estimate, estimate_standard_error=estimate_se,
        outside_physical_range=abs(estimate)>1, curve=curve,
        warnings=warnings, trend_p_value=trend_p, fit_p_value=fit_p,
        reliable_under_model=not warnings,
        uncertainty_note='Local fit uncertainty only; does not include model bias.')
