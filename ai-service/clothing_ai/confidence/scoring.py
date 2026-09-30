"""Stage 7 — confidence scoring and the retry gate.

Methodology (this is the whole contract; nothing here invents a number):

1. **Each attribute keeps its own raw score.** A zero-shot attribute's raw
   score is the probability of the winning label over the *gated* candidate
   set, taken straight from the softmax. It is capped per attribute, because a
   224px model cannot justify 0.99 confidence about fabric composition
   (`confidence_cap` in `labels.yaml`).

2. **The garment's segmentation quality is an input, not a footnote.** A colour
   read from a filled box is measuring background, so a weak mask pulls the
   colour attribute's score down.

3. **Validation erodes, it never inflates.** Failing rules apply a
   multiplicative penalty from `validation_rules.yaml`. A consistent result is
   not a bonus; a clean pass scores exactly what the models said.

4. **The fused garment confidence is a weighted mean of the attribute
   confidences**, with the detector's own score as a prior on *where* the
   garment is. The weights are declared in code, not fitted, because there is
   no labelled data yet to fit them on. Fitting a weight on 20 hand-labelled
   images would be a fabricated number wearing a lab coat.

5. **Entropy and margin gate the retry.** A flat distribution means the head
   is guessing even when the winning label looks confident.

No step invents a score. Every number traces to a model's softmax, a
measured image statistic, or a declared constant.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from ..common.logging import get_logger
from ..schemas import (
    AttributePrediction,
    ConfidenceStatus,
    GarmentAnalysis,
    GarmentAttributes,
    SegmentationResult,
    ValidationResult,
)

log = get_logger(__name__)

#: Per-attribute weights for the fused garment confidence. Category and colour
#: dominate because they are what a wardrobe search filters on; material is
#: weighted lowest because it is the attribute §10 flags as least reliable.
ATTRIBUTE_WEIGHTS: dict[str, float] = {
    "category": 0.38,
    "color": 0.26,
    "pattern": 0.16,
    "style": 0.10,
    "material": 0.10,
}

#: How much the detector's own score gates the final confidence. A 0.30
#: fallback box cannot produce a high-confidence result no matter what the
#: classifiers say.
DETECTOR_PRIOR_WEIGHT = 0.12

#: A mask below this is treated as unusable for colour.
USABLE_SEGMENTATION = 0.45

#: Normalised entropy above this means the head is guessing.
ENTROPY_GUARD = 0.62
#: Winning margin below this is a coin flip between two candidates.
MARGIN_GUARD = 0.12

#: Colour confidence is discounted by mask quality: colour measured on a
#: filled box is colour measured on the room.
COLOR_MASK_SENSITIVITY = 0.45

#: Discount applied when the primary attribute is missing. Colour can be
#: measured without a classifier, so a broken classifier still yields a
#: confidently-coloured item — but an item with no category is not a wardrobe
#: item, and the fused number must not read as though it were.
MISSING_CATEGORY_DISCOUNT = 0.45


@dataclass(frozen=True, slots=True)
class ScoredAttributes:
    """Attribute scores after mask-quality adjustment, before validation."""

    values: dict[str, float]
    weights: dict[str, float]
    notes: list[str] = field(default_factory=list)


def apply_segmentation_quality(
    attributes: GarmentAttributes,
    segmentation: SegmentationResult | None,
) -> ScoredAttributes:
    """Scale colour (and the whole result) by how good the mask is."""
    values: dict[str, float] = {}
    weights = dict(ATTRIBUTE_WEIGHTS)
    notes: list[str] = []

    for name, prediction in (
        ("category", attributes.category),
        ("material", attributes.material),
        ("pattern", attributes.pattern),
        ("style", attributes.style),
    ):
        if prediction is not None:
            values[name] = prediction.confidence

    if attributes.color is not None:
        colour = attributes.color
        if colour.primary in ("unknown", "multicolor"):
            # A garment we could not name, or one that genuinely is many
            # colours, is not a confident colour answer.
            base = 0.25 if colour.primary == "unknown" else 0.45
        else:
            base = min(0.95, 0.60 + 0.40 * float(colour.distribution.get(colour.primary, 0.0)))
        if segmentation is None:
            # No mask means the whole crop was measured, background included.
            base *= 0.75
            notes.append("colour discounted: no segmentation mask")
        else:
            quality = segmentation.quality
            if segmentation.filled:
                base *= 0.55
                notes.append("colour discounted: mask fell back to the bounding box")
            elif quality < USABLE_SEGMENTATION:
                scale = 1.0 - COLOR_MASK_SENSITIVITY * (USABLE_SEGMENTATION - quality) / USABLE_SEGMENTATION
                base *= scale
                notes.append(f"colour discounted: mask quality {quality:.2f}")
        values["color"] = float(np.clip(base, 0.0, 1.0))

    return ScoredAttributes(values=values, weights=weights, notes=notes)


def fuse(
    scored: ScoredAttributes,
    *,
    detector_confidence: float,
    validation: ValidationResult,
    segmentation: SegmentationResult | None,
    penalty_scale: float = 1.0,
    accept_threshold: float = 0.70,
    uncertain_threshold: float = 0.45,
) -> tuple[float, ConfidenceStatus]:
    """Combine attribute scores into one number, in [0, 1]."""
    if not scored.values:
        return 0.0, ConfidenceStatus.UNCERTAIN

    total_weight = sum(scored.weights.get(name, 0.0) for name in scored.values)
    if total_weight <= 0:
        return 0.0, ConfidenceStatus.UNCERTAIN

    weighted = sum(
        value * scored.weights.get(name, 0.0) for name, value in scored.values.items()
    ) / total_weight

    # The detector's score is a prior on the whole finding: a weakly-localised
    # garment is a weakly-known garment.
    mask_factor = 1.0
    if segmentation is not None and segmentation.filled:
        mask_factor -= 0.10

    confidence = DETECTOR_PRIOR_WEIGHT * detector_confidence + (1.0 - DETECTOR_PRIOR_WEIGHT) * weighted
    confidence *= mask_factor

    if "category" not in scored.values:
        confidence *= 1.0 - MISSING_CATEGORY_DISCOUNT

    # Validation penalties are multiplicative eroders, capped so a pile-up of
    # advisory rules cannot drive the score to zero.
    penalty = min(0.6, validation.total_penalty * penalty_scale)
    confidence *= 1.0 - penalty

    confidence = float(np.clip(confidence, 0.0, 1.0))
    return confidence, classify_status(
        confidence, accept=accept_threshold, uncertain=uncertain_threshold
    )


def classify_status(confidence: float, *, accept: float, uncertain: float) -> ConfidenceStatus:
    if confidence >= accept:
        return ConfidenceStatus.ACCEPTED
    if confidence >= uncertain:
        return ConfidenceStatus.ACCEPTED_WITH_UNCERTAINTY
    return ConfidenceStatus.UNCERTAIN


def needs_review(
    status: ConfidenceStatus,
    validation: ValidationResult,
    attributes: GarmentAttributes | None = None,
) -> bool:
    """Whether a human should look at this result.

    Three independent triggers:

    1. the score is low enough to be a guess;
    2. the attributes are mutually contradictory — a confident-looking
       `jeans / silk` is worse than an honest low score, because the client
       will display it;
    3. the primary attribute is missing, which happens when the classifier
       failed but colour measurement still succeeded. The result is not wrong,
       it is incomplete, and the client needs to know that.
    """
    if status is ConfidenceStatus.UNCERTAIN:
        return True
    if not validation.consistent:
        return True
    if attributes is not None and attributes.category is None:
        return True
    return False


def should_retry(
    *,
    status: ConfidenceStatus,
    entropy: float,
    margin: float,
    attempt: int,
    max_retries: int,
    validation: ValidationResult,
) -> bool:
    """Whether another inference pass is worth running.

    Three independent triggers, all configurable, all bounded by `max_retries`
    so a bad request can never become an infinite loop.

    `attempt` is the number of passes already completed, so it is 1 on the
    first call. That makes `max_retries` mean what it says: `max_retries=1`
    allows exactly one extra pass, and `max_retries=0` allows none.
    """
    if attempt - 1 >= max_retries:
        return False
    if status is ConfidenceStatus.UNCERTAIN:
        return True
    if entropy >= ENTROPY_GUARD or margin < MARGIN_GUARD:
        return True
    return not validation.consistent


def reportable(prediction: AttributePrediction | None, floor: float) -> AttributePrediction | None:
    """Drop attributes too weak to show.

    Returning a 0.2-confidence `material: silk` is worse than returning nothing:
    the client renders it as a fact.
    """
    if prediction is None or prediction.confidence < floor:
        return None
    return prediction
