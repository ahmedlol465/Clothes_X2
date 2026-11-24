/** Sanitisers for client-supplied outfit scores. */
'use strict';
const { str } = require('./style-profile');

/**
 * The compatibility score a caller may hand us when saving an existing
 * recommendation. A recommendation already carries the 11-factor score the user
 * was shown, so re-scoring it from the same items with different inputs (the old
 * hardcoded `tempC: 24`, no StyleMemory) could publish a different number under
 * the same look. Returns a whole 0..100 number, null when absent, or NaN when
 * present but malformed (the caller then rejects the request).
 */
function suppliedCompatibilityScore(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    return Number.NaN;
  }
  return Math.round(value);
}

/**
 * Sanitise a supplied 11-factor breakdown so only the documented fields survive.
 * Anything malformed is dropped; each surviving row keeps the shape the Flutter
 * `MatchFactor` model reads. Arbitrary client keys are never trusted through.
 */
function sanitizeBreakdown(value) {
  if (!Array.isArray(value)) return null;
  const rows = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const label = str(raw.label, 80);
    const val = Number(raw.value);
    if (!label || !Number.isFinite(val)) continue;
    const row = {
      key: str(raw.key, 60) || label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      label,
      value: Math.min(100, Math.max(0, Math.round(val))),
      applied: raw.applied !== false,
    };
    if (Number.isFinite(Number(raw.weight))) {
      row.weight = Math.min(1, Math.max(0, Number(raw.weight)));
    }
    if (Number.isFinite(Number(raw.contribution))) {
      row.contribution = Number(raw.contribution);
    }
    rows.push(row);
    if (rows.length >= 16) break;
  }
  return rows.length ? rows : null;
}

/** A bounded, non-empty explanation string, or null. */
function sanitizeExplanation(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().slice(0, 1000);
  return text || null;
}

module.exports = { suppliedCompatibilityScore, sanitizeBreakdown, sanitizeExplanation };
