"""Synthetic teaching data and weighted ZNE fits, independent of IBM credentials."""
import math
import numpy as np
from scipy.optimize import curve_fit

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
    if len(points) < 3 or len(set(x)) != len(x) or not np.all(sigma > 0):
        raise ValueError('Need three distinct factors and positive uncertainties')
    if model == 'linear':
        def function(t, amplitude, slope):
            return amplitude + slope * t
        initial, bounds = [float(y[0]), -0.1], (-np.inf, np.inf)
    elif model == 'exponential':
        def function(t, amplitude, decay):
            return amplitude * np.exp(-decay * t)
        initial, bounds = [float(y[0]), 0.2], ([-np.inf, 0], [np.inf, np.inf])
    else:
        raise ValueError('Unknown model')
    parameters, covariance = curve_fit(function, x, y, p0=initial, bounds=bounds,
        sigma=sigma, absolute_sigma=True, maxfev=10000)
    estimate = float(parameters[0])
    estimate_se = float(np.sqrt(covariance[0, 0]))
    if not math.isfinite(estimate) or not math.isfinite(estimate_se):
        raise ValueError('Fit did not produce finite results')
    curve = [{'x':float(t), 'y':float(function(t, *parameters))} for t in np.linspace(0,5,101)]
    return dict(model=model, estimate=estimate, estimate_standard_error=estimate_se,
        outside_physical_range=abs(estimate)>1, curve=curve,
        uncertainty_note='Local fit uncertainty only; does not include model bias.')
