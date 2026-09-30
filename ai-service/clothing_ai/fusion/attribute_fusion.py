"""Stage 5 — attribute fusion.

The pipeline has several independent opinions about one garment. This stage
decides how they combine, and it is where the "do not blindly trust one model"
rule is actually implemented.

The three decisions it makes:

1. **Candidate gating.** When the detector is confident, the category head is
   restricted to the children of the detected coarse group. This is what stops
   a picture of a bottle from ever being scored as a t-shirt, and it also
   removes most of the confusion between `shirt` / `t-shirt` / `blouse` for a
   `top` box. When the detector is weak, the full vocabulary stays open.

2. **Cross-checking.** The zero-shot colour head and the KMeans measurement are
   compared. Agreement raises nothing on its own — it only prevents an
   unnecessary penalty. Disagreement lowers confidence and flags the result.

3. **Per-attribute confidence.** Every attribute keeps its own number. Nothing
   is averaged into a single "the AI is 94% sure" claim.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from ..color.palette import agreement as colors_agree
from ..common.logging import get_logger
from ..config.vocabulary import AttributeVocabulary
from ..confidence.scoring import (
    ScoredAttributes,
    apply_segmentation_quality,
    fuse,
)
from ..schemas import (
    AttributePrediction,
    ColorResult,
    ConfidenceStatus,
    DetectedGarment,
    GarmentAttributes,
    SegmentationResult,
    ValidationResult,
)

log = get_logger(__name__)

#: Below this the detector's own label is treated as unreliable and the
#: category vocabulary is left ungated.
GATE_MIN_DETECTOR_SCORE = 0.45
#: Minimum candidates a gated set must contain to be worth using; a group with
#: one member would make the zero-shot head meaningless.
MIN_GATED_CANDIDATES = 2


@dataclass(slots=True)
class FusionOutcome:
    """Fused attributes plus the evidence the scorer and validator need."""

    attributes: GarmentAttributes
    confidence: float
    status: ConfidenceStatus
    validation: ValidationResult
    scored: ScoredAttributes
    category_group: str
    detector_group: str
    gate_applied: bool
    zero_shot_color: str | None = None
    flags: list[str] = field(default_factory=list)
    #: Normalised entropy of the category head, 0 = decisive, 1 = uniform.
    category_entropy: float = 0.0
    #: Winning margin of the category head over its runner-up.
    category_margin: float = 1.0

    @property
    def entropy(self) -> float:
        return self.category_entropy

    @property
    def margin(self) -> float:
        return self.category_margin


class AttributeFuser:
    """Merge the detector, the fashion head and the colour measurement."""

    def __init__(
        self,
        vocabulary: AttributeVocabulary,
        validator: object,
        *,
        accept_threshold: float = 0.70,
        uncertain_threshold: float = 0.45,
        penalty_scale: float = 1.0,
        report_floor: float = 0.20,
        gate_min_score: float = GATE_MIN_DETECTOR_SCORE,
    ) -> None:
        self._vocabulary = vocabulary
        self._validator = validator
        self._accept = accept_threshold
        self._uncertain = uncertain_threshold
        self._penalty_scale = penalty_scale
        self._report_floor = report_floor
        self._gate_min_score = gate_min_score

    # ------------------------------------------------------------------ main --

    def fuse(
        self,
        *,
        detection: DetectedGarment,
        segmentation: SegmentationResult | None,
        raw: GarmentAttributes,
        zero_shot_diagnostics: dict[str, float],
        zero_shot_color: AttributePrediction | None = None,
        allow_correction: bool = True,
    ) -> FusionOutcome:
        """Fuse raw per-model outputs for a single garment.

        `raw` is what the classifiers returned before any cross-checking, so a
        retry with different preprocessing can be fused the same way and the two
        attempts compared. `zero_shot_color` is the vision-language head's
        independent colour opinion; it is only ever used to corroborate.
        """
        detector_group = self._vocabulary.detector_to_group(detection.coarse_label)
        category, gate_applied = self._resolve_category(
            detection, raw.category, allow_correction=allow_correction
        )
        category_group = (
            self._vocabulary.group_for("category", category.value)
            if category
            else "other"
        )

        color, color_flags = self._reconcile_color(raw.color, segmentation)
        cross_check_value = zero_shot_color.value if zero_shot_color else None

        attributes = GarmentAttributes(
            category=category,
            subcategory=raw.subcategory,
            color=color,
            material=raw.material,
            pattern=raw.pattern,
            style=raw.style,
        )

        validation: ValidationResult = self._validator.validate(  # type: ignore[attr-defined]
            category=attributes.category,
            material=attributes.material,
            pattern=attributes.pattern,
            style=attributes.style,
            color=attributes.color,
            coarse_label=detection.coarse_label,
            category_group=category_group,
            detector_group=detector_group,
            detector_gate_applied=gate_applied,
            segmentation_filled=bool(segmentation and segmentation.filled),
            zero_shot_color=cross_check_value,
        )

        scored = apply_segmentation_quality(attributes, segmentation)
        confidence, status = fuse(
            scored,
            detector_confidence=detection.detector_confidence,
            validation=validation,
            segmentation=segmentation,
            penalty_scale=self._penalty_scale,
            accept_threshold=self._accept,
            uncertain_threshold=self._uncertain,
        )

        outcome = FusionOutcome(
            attributes=attributes,
            confidence=confidence,
            status=status,
            validation=validation,
            scored=scored,
            category_group=category_group,
            detector_group=detector_group,
            gate_applied=gate_applied,
            zero_shot_color=cross_check_value,
            flags=color_flags,
            category_entropy=float(zero_shot_diagnostics.get("category_entropy", 0.0)),
            category_margin=float(zero_shot_diagnostics.get("category_margin", 1.0)),
        )
        return outcome

    # -------------------------------------------------------------- decisions --

    def _resolve_category(
        self,
        detection: DetectedGarment,
        prediction: AttributePrediction | None,
        *,
        allow_correction: bool,
    ) -> tuple[AttributePrediction | None, bool]:
        """Apply the detector gate to an already-computed category prediction.

        The head is run over the full vocabulary on the first pass so the
        benchmark can measure what it would have said ungated; this method only
        decides whether to keep that answer.
        """
        if prediction is None:
            return None, False
        if not self._vocabulary["category"].gated_by_detector:
            return prediction, False
        if detection.detector_confidence < self._gate_min_score:
            log.info(
                "category_gate_open",
                garment=detection.id,
                detector_score=round(detection.detector_confidence, 3),
            )
            return prediction, False
        if not allow_correction:
            return prediction, False

        detector_group = self._vocabulary.detector_to_group(detection.coarse_label)
        if detector_group == "other":
            return prediction, False
        if self._vocabulary.group_for("category", prediction.value) == detector_group:
            return prediction, True

        # The predicted category is impossible for the detected region. Rather
        # than silently rewriting it, look for the best in-group alternative
        # and keep the original visible in `scores` so the mismatch is auditable.
        scores = prediction.scores
        if not scores:
            return prediction, True

        allowed = {label.value for label in self._vocabulary["category"].by_group(detector_group)}
        candidates = {name: score for name, score in scores.items() if name in allowed}
        if not candidates:
            return prediction, True

        best = max(candidates, key=lambda name: candidates[name])
        if best == prediction.value:
            return prediction, True
        log.info(
            "category_corrected",
            garment=detection.id,
            detected=detection.coarse_label,
            from_value=prediction.value,
            to_value=best,
        )
        corrected = AttributePrediction(
            value=best,
            confidence=prediction.confidence,
            source=prediction.source,
            scores=scores,
            alternatives=prediction.alternatives,
        )
        return corrected, True

    def _reconcile_color(
        self,
        measured: ColorResult | None,
        segmentation: SegmentationResult | None,
    ) -> tuple[ColorResult | None, list[str]]:
        """Record whether the measured colour rests on a real mask.

        The measured value stays authoritative: KMeans over masked pixels is a
        direct observation, whereas a zero-shot colour label is a guess. The
        zero-shot reading is carried separately as corroboration and is
        compared in `AttributeValidator._color_source_disagree`.
        """
        flags: list[str] = []
        if measured is None:
            return None, flags
        if not segmentation or segmentation.filled:
            flags.append("color_measured_without_mask")
        return measured, flags

    def cross_check_color(
        self, measured: ColorResult | None, zero_shot: str | None
    ) -> bool:
        """True when the two colour sources agree closely enough to trust."""
        if not measured or not zero_shot:
            return False
        return colors_agree(measured.primary, zero_shot)

    # ------------------------------------------------------------- reporting --

    def reportable(self, attributes: GarmentAttributes) -> GarmentAttributes:
        """Strip attributes below the reporting floor.

        Showing a 0.18-confidence `material` as a plain string is worse than
        omitting it, so weak attributes are dropped rather than caveated in
        prose the client does not render.
        """
        from ..confidence.scoring import reportable as keep

        return GarmentAttributes(
            category=keep(attributes.category, self._report_floor),
            subcategory=keep(attributes.subcategory, self._report_floor),
            color=attributes.color,
            material=keep(attributes.material, self._report_floor),
            pattern=keep(attributes.pattern, self._report_floor),
            style=keep(attributes.style, self._report_floor),
        )
