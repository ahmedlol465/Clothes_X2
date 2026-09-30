"""Tests for the pure-logic stages: no models, no I/O, fast.

These are the parts where a subtle arithmetic or vocabulary error would quietly
produce confident wrong answers in production, so they are pinned hard.
"""

from __future__ import annotations

import numpy as np
import pytest

from clothing_ai.color.palette import (
    PALETTE,
    REQUIRED_NAMES,
    agreement,
    delta_e,
    family_of,
    hex_to_rgb,
    name_color_lab,
    rgb_to_hex,
    rgb_to_lab,
)
from clothing_ai.config.vocabulary import get_vocabulary
from clothing_ai.confidence.scoring import (
    ATTRIBUTE_WEIGHTS,
    ENTROPY_GUARD,
    MARGIN_GUARD,
    MISSING_CATEGORY_DISCOUNT,
    ScoredAttributes,
    apply_segmentation_quality,
    classify_status,
    fuse,
    needs_review,
    reportable,
    should_retry,
)
from clothing_ai.preprocessing.retry_views import (
    BRIGHTNESS_TRIGGER,
    MIN_CROP_SIDE,
    build_retry_view,
)
from clothing_ai.schemas import (
    AttributePrediction,
    BoundingBox,
    ColorResult,
    ConfidenceStatus,
    DetectedGarment,
    GarmentAttributes,
    ImageQualityResult,
    SegmentationResult,
    ValidationResult,
)
from clothing_ai.validation import AttributeValidator
from clothing_ai.validation.validator import load_material_groups, load_rules


# ============================================================ vocabulary ====


class TestVocabulary:
    def test_loads_and_exposes_every_attribute(self):
        vocab = get_vocabulary()
        assert set(vocab.attributes) >= {"category", "material", "pattern", "style", "color"}

    def test_detector_labels_all_map_to_a_known_group(self):
        vocab = get_vocabulary()
        for label in ("bag", "bottom", "dress", "hat", "shoes", "outer", "top"):
            assert vocab.detector_to_group(label) != "other", label

    def test_unknown_detector_label_degrades_instead_of_raising(self):
        """A different detector must not crash the pipeline."""
        assert get_vocabulary().detector_to_group("spacesuit") == "other"

    def test_every_category_label_belongs_to_a_real_group(self):
        vocab = get_vocabulary()
        groups = set(vocab.detector_group_map.values()) | {"other"}
        for label in vocab["category"]:
            assert label.group in groups, f"{label.value} -> {label.group}"

    def test_category_labels_are_unique(self):
        vocab = get_vocabulary()
        values = vocab["category"].values
        assert len(values) == len(set(values))

    def test_prompts_fit_inside_the_models_context(self):
        """FashionSigLIP truncates at 64 tokens; a long prompt silently
        changes the meaning of the label rather than erroring."""
        for spec in get_vocabulary().active_attributes():
            for label in spec:
                assert len(label.prompt) <= 60, f"{spec.name}/{label.value}"

    def test_by_group_selects_a_subset(self):
        vocab = get_vocabulary()
        top = {label.value for label in vocab["category"].by_group("top")}
        bottom = {label.value for label in vocab["category"].by_group("bottom")}
        assert top and bottom
        assert not top & bottom

    def test_confidence_caps_are_below_one(self):
        """No attribute may claim certainty the 224px model cannot support."""
        for name, spec in get_vocabulary().attributes.items():
            assert spec.confidence_cap <= 0.95, name

    def test_material_is_capped_lowest_as_the_spec_requires(self):
        vocab = get_vocabulary()
        assert vocab["material"].confidence_cap == min(
            s.confidence_cap for s in vocab.attributes.values()
        )

    def test_unknown_attribute_raises_a_helpful_error(self):
        with pytest.raises(KeyError, match="unknown attribute"):
            get_vocabulary()["nonexistent"]


# ================================================================ colour ====


class TestPalette:
    def test_required_names_are_all_present(self):
        names = {entry.name for entry in PALETTE}
        assert set(REQUIRED_NAMES) <= names

    def test_hex_round_trips(self):
        for entry in PALETTE:
            assert entry.hex.startswith("#")
            assert entry.hex == entry.hex.lower()
            assert rgb_to_hex(hex_to_rgb(entry.hex)) == entry.hex

    def test_rgb_to_hex_format(self):
        assert rgb_to_hex((255, 0, 0)) == "#ff0000"
        assert rgb_to_hex((0, 0, 0)) == "#000000"

    def test_rgb_to_hex_matches_the_palette_convention(self):
        """Otherwise the same colour is reported as `#000000` and `#000000`
        depending on which code path produced it."""
        measured = rgb_to_hex(hex_to_rgb(PALETTE[0].hex))
        assert measured == PALETTE[0].hex

    def test_dark_navy_is_not_named_light_blue(self):
        """The failure mode LAB/RGB mixing causes: lightness dominates."""
        navy = name_color_lab(rgb_to_lab((16, 32, 92)))[0]
        pale = name_color_lab(rgb_to_lab((168, 200, 235)))[0]
        assert navy != pale
        assert family_of(navy) == family_of(pale)

    def test_nearest_anchor_is_chosen(self):
        name, distance, hex_value = name_color_lab(rgb_to_lab((250, 250, 248)))
        assert distance < 10.0
        assert hex_value.startswith("#")

    def test_agreement_within_a_family(self):
        assert agreement("navy blue", "sky blue") is True
        assert agreement("blue", "blue") is True

    def test_disagreement_across_families(self):
        assert agreement("blue", "brown") is False
        assert agreement("red", "green") is False

    def test_agreement_with_empty_input_is_false_not_a_crash(self):
        assert agreement("", "blue") is False
        assert agreement("blue", "") is False


class TestColorExtractorNaming:
    """A real, flat, strongly-saturated patch must come back with a real name.

    Regression guard for an encoding mismatch between cv2's 8-bit LAB (a/b
    centred on 128) and `rgb_to_lab` (a/b centred on 0). Comparing the two
    without removing the offset put every saturated colour ~128 apart in `a`,
    past the refusal threshold, so saturated garments were reported as
    `unknown` — which then disagreed with the zero-shot colour and flagged
    essentially every real photo for review. No stub-based test could catch it.
    """

    @staticmethod
    def _extract(rgb: tuple[int, int, int]):
        from clothing_ai.color import ColorExtractor

        image = np.zeros((64, 64, 3), np.uint8)
        image[:, :] = rgb
        return ColorExtractor().extract(image, None)

    @pytest.mark.parametrize(
        "rgb,expected_family",
        [
            ((30, 60, 200), "blue"),
            ((200, 40, 40), "red"),
            ((40, 160, 60), "green"),
        ],
    )
    def test_a_saturated_patch_is_named_not_unknown(self, rgb, expected_family):
        from clothing_ai.color.palette import PALETTE, UNKNOWN, family_of

        result = self._extract(rgb)

        assert result.primary != UNKNOWN, f"{rgb} came back as unknown"
        assert family_of(result.primary) == expected_family
        # `primary_hex` is the palette anchor that goes with the name, not the
        # measured mean, so it must be a real palette entry.
        assert result.primary_hex in {entry.hex for entry in PALETTE}

    def test_a_grey_patch_is_still_named(self):
        from clothing_ai.color.palette import UNKNOWN

        assert self._extract((128, 128, 128)).primary != UNKNOWN

    def test_a_three_colour_image_is_multicolour(self):
        from clothing_ai.color import ColorExtractor

        image = np.zeros((96, 96, 3), np.uint8)
        image[:, :32] = (30, 60, 200)
        image[:, 32:64] = (200, 40, 40)
        image[:, 64:] = (40, 160, 60)
        result = ColorExtractor().extract(image, None)

        assert result.is_multicolor is True
        assert {result.primary, *result.secondary} >= {"blue", "red"}
        assert max(result.distribution.values()) == pytest.approx(1 / 3, abs=0.05)

    def test_a_genuinely_mixed_region_is_allowed_to_stay_unknown(self):
        """The refusal path must still exist, or `unknown` becomes meaningless.

        Two saturated colours sharing one cluster is what the centre-vs-pixels
        check is for; a checkerboard of both should not be confidently named.
        """
        from clothing_ai.color import ColorExtractor
        from clothing_ai.color.palette import UNKNOWN

        image = np.zeros((64, 64, 3), np.uint8)
        image[::2, :] = (30, 60, 200)
        image[1::2, :] = (200, 40, 40)
        result = ColorExtractor().extract(image, None)

        assert result.primary in {UNKNOWN, "blue", "red"}
        if result.primary != UNKNOWN:
            # If it does commit to a name it must be a real, dominant share.
            assert max(result.distribution.values()) > 0.4


# ========================================================== segmentation ====


def segmentation(quality: float = 0.85, filled: bool = False) -> SegmentationResult:
    return SegmentationResult(
        mask=np.zeros((32, 32), dtype=np.uint8),
        quality=quality,
        coverage=0.2,
        filled=filled,
        model="stub",
    )


def prediction(value: str, confidence: float) -> AttributePrediction:
    return AttributePrediction(value=value, confidence=confidence, source="test")


def color(primary: str, share: float = 1.0) -> ColorResult:
    return ColorResult(
        primary=primary,
        primary_hex="#000000",
        distribution={primary: share},
    )


# ============================================================ confidence ====


class TestSegmentationDiscount:
    def test_a_good_mask_does_not_discount_colour(self):
        attributes = GarmentAttributes(color=color("blue", 1.0))
        scored = apply_segmentation_quality(attributes, segmentation(0.85))
        assert scored.values["color"] > 0.9
        assert not scored.notes

    def test_a_filled_box_is_measuring_the_room(self):
        attributes = GarmentAttributes(color=color("blue", 1.0))
        good = apply_segmentation_quality(attributes, segmentation(0.85))
        filled = apply_segmentation_quality(attributes, segmentation(0.85, filled=True))

        assert filled.values["color"] < good.values["color"]
        assert any("bounding box" in note for note in filled.notes)

    def test_no_mask_at_all_is_worse_than_a_poor_mask(self):
        attributes = GarmentAttributes(color=color("blue", 1.0))
        none = apply_segmentation_quality(attributes, None)
        poor = apply_segmentation_quality(attributes, segmentation(0.30))
        assert none.values["color"] < poor.values["color"]

    def test_multicolour_is_not_a_confident_colour(self):
        scored = apply_segmentation_quality(
            GarmentAttributes(color=color("multicolor", 0.5)), segmentation(0.85)
        )
        assert scored.values["color"] < 0.5

    def test_unnamed_colour_is_poorly_confident(self):
        scored = apply_segmentation_quality(
            GarmentAttributes(color=color("unknown", 1.0)), segmentation(0.85)
        )
        assert scored.values["color"] <= 0.25


class TestFusion:
    def _scored(self, **values) -> ScoredAttributes:
        return ScoredAttributes(
            values=values, weights=dict(ATTRIBUTE_WEIGHTS), notes=[]
        )

    def test_no_attributes_at_all_is_maximally_uncertain(self):
        confidence, status = fuse(
            self._scored(),
            detector_confidence=0.99,
            validation=ValidationResult(consistent=True),
            segmentation=None,
        )
        assert confidence == 0.0
        assert status is ConfidenceStatus.UNCERTAIN

    def test_a_weak_detector_caps_a_strong_classifier(self):
        strong = self._scored(category=0.95, color=0.95, pattern=0.95, style=0.95, material=0.95)
        strong_detector, _ = fuse(
            strong, detector_confidence=0.9, validation=ValidationResult(consistent=True), segmentation=None
        )
        weak_detector, _ = fuse(
            strong, detector_confidence=0.1, validation=ValidationResult(consistent=True), segmentation=None
        )
        assert weak_detector < strong_detector

    def test_fusion_is_bounded(self):
        for detector in (0.0, 0.5, 1.0):
            confidence, _ = fuse(
                self._scored(category=1.0, color=1.0),
                detector_confidence=detector,
                validation=ValidationResult(consistent=True),
                segmentation=None,
            )
            assert 0.0 <= confidence <= 1.0

    def test_validation_penalty_only_erodes(self):
        scored = self._scored(category=0.8, color=0.8)
        clean, _ = fuse(
            scored, detector_confidence=0.8, validation=ValidationResult(consistent=True), segmentation=None
        )
        penalised, _ = fuse(
            scored,
            detector_confidence=0.8,
            validation=ValidationResult(consistent=False, penalties={"x": 0.5}),
            segmentation=None,
        )
        assert penalised < clean

    def test_missing_category_is_discounted(self):
        """A colour-only result must not read as a confident garment."""
        with_category, _ = fuse(
            self._scored(category=0.8, color=0.8),
            detector_confidence=0.8,
            validation=ValidationResult(consistent=True),
            segmentation=None,
        )
        without, _ = fuse(
            self._scored(color=0.8),
            detector_confidence=0.8,
            validation=ValidationResult(consistent=True),
            segmentation=None,
        )
        ratio = without / with_category
        assert ratio == pytest.approx(1.0 - MISSING_CATEGORY_DISCOUNT, rel=0.01)

    def test_filled_mask_lowers_the_fused_score(self):
        scored = self._scored(category=0.8, color=0.8)
        good, _ = fuse(
            scored,
            detector_confidence=0.8,
            validation=ValidationResult(consistent=True),
            segmentation=segmentation(0.85),
        )
        filled, _ = fuse(
            scored,
            detector_confidence=0.8,
            validation=ValidationResult(consistent=True),
            segmentation=segmentation(0.85, filled=True),
        )
        assert filled < good


class TestStatusThresholds:
    @pytest.mark.parametrize(
        "confidence,expected",
        [
            (0.95, ConfidenceStatus.ACCEPTED),
            (0.70, ConfidenceStatus.ACCEPTED),
            (0.69, ConfidenceStatus.ACCEPTED_WITH_UNCERTAINTY),
            (0.45, ConfidenceStatus.ACCEPTED_WITH_UNCERTAINTY),
            (0.44, ConfidenceStatus.UNCERTAIN),
            (0.0, ConfidenceStatus.UNCERTAIN),
        ],
    )
    def test_boundaries(self, confidence, expected):
        assert (
            classify_status(confidence, accept=0.70, uncertain=0.45) is expected
        )


class TestReviewAndRetry:
    def test_uncertain_always_needs_review(self):
        assert needs_review(ConfidenceStatus.UNCERTAIN, ValidationResult(consistent=True)) is True

    def test_inconsistent_attributes_always_need_review(self):
        result = ValidationResult(consistent=False, penalties={"x": 0.2})
        assert needs_review(ConfidenceStatus.ACCEPTED, result) is True

    def test_missing_category_needs_review_even_when_scores_are_good(self):
        assert (
            needs_review(
                ConfidenceStatus.ACCEPTED, ValidationResult(consistent=True), GarmentAttributes()
            )
            is True
        )

    def test_clean_result_needs_no_review(self):
        attributes = GarmentAttributes(category=prediction("t-shirt", 0.8))
        assert (
            needs_review(ConfidenceStatus.ACCEPTED, ValidationResult(consistent=True), attributes)
            is False
        )

    def test_retry_stops_at_the_budget(self):
        """`attempt` counts completed passes, so `max_retries=1` buys one more."""
        for attempt in (1, 2, 5):
            retry = should_retry(
                status=ConfidenceStatus.UNCERTAIN,
                entropy=1.0,
                margin=0.0,
                attempt=attempt,
                max_retries=1,
                validation=ValidationResult(consistent=True),
            )
            assert retry is (attempt - 1 < 1)

    def test_max_retries_one_allows_exactly_one_extra_pass(self):
        """The regression this encodes: a budget of 1 used to allow zero."""
        kwargs = dict(
            status=ConfidenceStatus.UNCERTAIN,
            entropy=1.0,
            margin=0.0,
            validation=ValidationResult(consistent=True),
        )
        assert should_retry(attempt=1, max_retries=1, **kwargs) is True
        assert should_retry(attempt=2, max_retries=1, **kwargs) is False

    def test_a_larger_budget_is_respected_exactly(self):
        kwargs = dict(
            status=ConfidenceStatus.UNCERTAIN,
            entropy=1.0,
            margin=0.0,
            validation=ValidationResult(consistent=True),
            max_retries=3,
        )
        assert [should_retry(attempt=n, **kwargs) for n in (1, 2, 3, 4)] == [
            True,
            True,
            True,
            False,
        ]

    def test_high_entropy_triggers_a_retry(self):
        assert should_retry(
            status=ConfidenceStatus.ACCEPTED,
            entropy=ENTROPY_GUARD + 0.01,
            margin=1.0,
            attempt=1,
            max_retries=3,
            validation=ValidationResult(consistent=True),
        )

    def test_tiny_margin_triggers_a_retry(self):
        assert should_retry(
            status=ConfidenceStatus.ACCEPTED,
            entropy=0.0,
            margin=MARGIN_GUARD - 0.01,
            attempt=1,
            max_retries=3,
            validation=ValidationResult(consistent=True),
        )

    def test_zero_retries_means_never(self):
        assert not should_retry(
            status=ConfidenceStatus.UNCERTAIN,
            entropy=1.0,
            margin=0.0,
            attempt=1,
            max_retries=0,
            validation=ValidationResult(consistent=True),
        )


class TestReportFloor:
    def test_weak_attribute_is_dropped_not_caveated(self):
        assert reportable(prediction("silk", 0.19), 0.20) is None

    def test_adequate_attribute_survives(self):
        assert reportable(prediction("cotton", 0.21), 0.20) is not None

    def test_absent_attribute_stays_absent(self):
        assert reportable(None, 0.20) is None


# ============================================================= validation ====


class TestValidator:
    def setup_method(self):
        self.validator = AttributeValidator()
        self.vocab = get_vocabulary()

    def _category(self, value: str, confidence: float = 0.8) -> AttributePrediction:
        return prediction(value, confidence)

    def test_rules_load_from_yaml(self):
        rules = load_rules()
        assert len(rules) >= 8
        for rule in rules:
            assert rule.code
            assert 0.0 < rule.penalty <= 1.0

    def test_a_rule_without_a_require_clause_still_fires(self):
        """`require` is an exception list, not a precondition.

        Regression: an absent `require` used to read as "satisfied", which
        silently disabled every rule that did not declare one.
        """
        from clothing_ai.validation.validator import RuleSpec

        validator = AttributeValidator(
            rules=[
                RuleSpec(
                    code="always",
                    description="fires on its own trigger",
                    severity="error",
                    penalty=0.1,
                    when={"category_in": ["t-shirt"]},
                )
            ]
        )
        result = validator.validate(category=self._category("t-shirt"))
        assert result.flags == ["always"]
        assert not result.consistent

    def test_a_require_clause_listens_the_exceptions(self):
        """`require` names the cases in which the rule must stay quiet."""
        from clothing_ai.validation.validator import RuleSpec

        validator = AttributeValidator(
            rules=[
                RuleSpec(
                    code="suppressible",
                    description="stays quiet for its listed exception",
                    severity="error",
                    penalty=0.1,
                    when={"category_in": ["t-shirt"]},
                    require={"category_in": ["blouse"]},
                )
            ]
        )
        assert validator.validate(category=self._category("t-shirt")).flags == [
            "suppressible"
        ]
        assert validator.validate(category=self._category("blouse")).flags == []

    def test_material_groups_load(self):
        assert isinstance(load_material_groups(), dict)
        assert load_material_groups()

    def test_a_pattern_on_a_flat_colour_is_flagged(self):
        """A measured flat colour plus 'striped' is a contradiction.

        Deliberately advisory: it erodes confidence and is recorded, but a
        striped garment photographed under flat light is common enough that
        rejecting the whole result would be wrong.
        """
        result = self.validator.validate(
            category=self._category("t-shirt"),
            pattern=prediction("striped", 0.8),
            color=color("blue", 1.0),
            category_group="top",
            detector_group="top",
            detector_gate_applied=True,
        )
        assert any("pattern" in flag for flag in result.flags)
        assert "pattern_on_flat_colour" in result.flags
        # Advisory: recorded and visible to the client, but it must not erode
        # the confidence the way an `error` does.
        assert result.consistent is True
        assert result.total_penalty == 0.0

    def test_category_from_the_wrong_group_is_flagged_when_ungated(self):
        """A weak detection leaves the vocabulary open, so `jeans` inside a
        `top` box is possible and must be reported."""
        result = self.validator.validate(
            category=self._category("jeans"),
            coarse_label="top",
            category_group="bottom",
            detector_group="top",
            detector_gate_applied=False,
        )
        assert not result.consistent
        assert "category_outside_detected_group" in result.flags
        assert any("jeans" in rule.detail for rule in result.rules if rule.detail)

    def test_the_gate_makes_a_mismatch_impossible_so_nothing_is_flagged(self):
        """With the gate applied the fusion layer already restricted the
        candidate set, so a mismatch cannot survive to be reported."""
        result = self.validator.validate(
            category=self._category("jeans"),
            coarse_label="top",
            category_group="bottom",
            detector_group="top",
            detector_gate_applied=True,
        )
        assert result.consistent
        assert not any("contradicts" in flag for flag in result.flags)

    def test_colour_source_disagreement_is_surfaced(self):
        """§10: two colour sources that disagree must be reported."""
        result = self.validator.validate(
            category=self._category("t-shirt"),
            color=color("blue", 1.0),
            category_group="top",
            detector_group="top",
            detector_gate_applied=True,
            zero_shot_color="brown",
        )
        assert "color_source_disagreement" in result.flags
        assert not result.consistent

    def test_agreeing_colour_sources_are_quiet(self):
        result = self.validator.validate(
            category=self._category("t-shirt"),
            color=color("navy blue", 1.0),
            category_group="top",
            detector_group="top",
            detector_gate_applied=True,
            zero_shot_color="blue",
        )
        assert "color_source_disagreement" not in result.flags

    def test_penalties_are_bounded(self):
        result = self.validator.validate(
            category=self._category("jeans"),
            coarse_label="top",
            pattern=prediction("striped", 0.9),
            color=color("blue", 1.0),
            category_group="bottom",
            detector_group="top",
            detector_gate_applied=True,
        )
        assert 0.0 <= result.total_penalty <= 1.0

    def test_no_attributes_does_not_crash(self):
        result = self.validator.validate()
        assert result.consistent


# ============================================================ retry views ====


class TestRetryViews:
    def _detection(self, label: str = "top", score: float = 0.3) -> DetectedGarment:
        return DetectedGarment(
            id="g-0",
            coarse_label=label,
            bbox=BoundingBox(x1=10.0, y1=10.0, x2=110.0, y2=110.0),
            detector_confidence=score,
            model="test",
        )

    def test_tightening_shrinks_the_box(self):
        image = np.full((200, 200, 3), 100, dtype=np.uint8)
        detection = self._detection()
        outcome = build_retry_view(image, detection, ImageQualityResult(score=1.0, usable=True), 1)

        assert outcome is not None
        tightened, _ = outcome
        assert tightened.bbox.x1 > detection.bbox.x1
        assert tightened.bbox.x2 < detection.bbox.x2

    def test_tightening_never_inflates_the_detector_score(self):
        """The retry found no new evidence, so the score must not move."""
        image = np.full((400, 400, 3), 100, dtype=np.uint8)
        detection = self._detection(score=0.42)
        tightened, _ = build_retry_view(image, detection, ImageQualityResult(score=1.0, usable=True), 1)
        assert tightened.detector_confidence == detection.detector_confidence

    def test_a_box_filling_the_frame_is_not_tightened(self):
        image = np.full((200, 200, 3), 100, dtype=np.uint8)
        detection = DetectedGarment(
            id="g-0",
            coarse_label="top",
            bbox=BoundingBox(x1=0.0, y1=0.0, x2=200.0, y2=200.0),
            detector_confidence=0.3,
            model="test",
        )
        assert build_retry_view(image, detection, ImageQualityResult(score=1.0, usable=True), 1) is None

    def test_a_tiny_box_is_not_tightened(self):
        image = np.full((400, 400, 3), 100, dtype=np.uint8)
        detection = DetectedGarment(
            id="g-0",
            coarse_label="top",
            bbox=BoundingBox(x1=0.0, y1=0.0, x2=MIN_CROP_SIDE - 10, y2=MIN_CROP_SIDE - 10),
            detector_confidence=0.3,
            model="test",
        )
        assert build_retry_view(image, detection, ImageQualityResult(score=1.0, usable=True), 1) is None

    def test_a_well_lit_photo_is_not_brightened(self):
        image = np.full((200, 200, 3), 200, dtype=np.uint8)
        quality = ImageQualityResult(score=1.0, usable=True, metrics={"mean_luminance": 200.0})
        assert build_retry_view(image, self._detection(), quality, 2) is None

    def test_a_dark_photo_is_brightened(self):
        image = np.full((200, 200, 3), 30, dtype=np.uint8)
        quality = ImageQualityResult(score=0.5, usable=True, metrics={"mean_luminance": 30.0})
        outcome = build_retry_view(image, self._detection(), quality, 2)

        assert outcome is not None
        _, corrected = outcome
        assert corrected.mean() > image.mean()

    def test_brightening_saturates_within_range(self):
        image = np.full((200, 200, 3), 5, dtype=np.uint8)
        quality = ImageQualityResult(score=0.5, usable=True, metrics={"mean_luminance": 5.0})
        _, corrected = build_retry_view(image, self._detection(), quality, 2)
        assert corrected.dtype == np.uint8
        assert 0 <= corrected.min() and corrected.max() <= 255
        assert corrected.mean() < BRIGHTNESS_TRIGGER * 4

    def test_missing_metrics_do_not_crash(self):
        image = np.full((200, 200, 3), 10, dtype=np.uint8)
        outcome = build_retry_view(
            image, self._detection(), ImageQualityResult(score=0.5, usable=True), 2
        )
        assert outcome is None or isinstance(outcome, tuple)
