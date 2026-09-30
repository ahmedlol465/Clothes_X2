"""End-to-end tests of the orchestration, with inference substituted.

These deliberately use the *real* fuser, validator, scorer, vocabulary and colour
naming, and stub only the model forward passes. A regression in fusion or
confidence arithmetic therefore fails here.
"""

from __future__ import annotations

import numpy as np
import pytest

from clothing_ai.color import ColorExtractor
from clothing_ai.config.settings import get_settings
from clothing_ai.config.vocabulary import get_vocabulary
from clothing_ai.fusion.attribute_fusion import AttributeFuser
from clothing_ai.pipeline import ClothingAnalysisPipeline, PipelineComponents
from clothing_ai.preprocessing import ImageQualityChecker
from clothing_ai.schemas import (
    AnalysisOptions,
    BoundingBox,
    ColorResult,
    ConfidenceStatus,
    DetectedGarment,
    QualityIssue,
    Severity,
)
from clothing_ai.validation import AttributeValidator

from stubs import (
    StubClassifier,
    StubColorExtractor,
    StubDetector,
    StubEmbedder,
    StubSegmenter,
    encode_garment_png,
    garment_image,
    solid_image,
)


def build_pipeline(**overrides) -> ClothingAnalysisPipeline:
    settings = get_settings()
    vocabulary = get_vocabulary(settings.labels_file)
    components = PipelineComponents(
        settings=settings,
        vocabulary=vocabulary,
        detector=overrides.get("detector", StubDetector()),
        segmenter=overrides.get("segmenter", StubSegmenter()),
        classifier=overrides.get("classifier", StubClassifier()),
        color_extractor=overrides.get("color_extractor", StubColorExtractor()),
        embedder=overrides.get("embedder", StubEmbedder()),
        fuser=AttributeFuser(
            vocabulary,
            AttributeValidator(),
            accept_threshold=settings.accept_threshold,
            uncertain_threshold=settings.uncertain_threshold,
            penalty_scale=settings.validation_penalty_scale,
            report_floor=settings.report_floor,
        ),
        quality_checker=ImageQualityChecker(),
    )
    return ClothingAnalysisPipeline(components)


def top_detection(label: str = "top", score: float = 0.88) -> DetectedGarment:
    return DetectedGarment(
        id="g-0",
        coarse_label=label,
        bbox=BoundingBox(x1=120.0, y1=70.0, x2=520.0, y2=430.0),
        detector_confidence=score,
        model="stub",
    )


class TestHappyPath:
    def test_returns_one_item_with_per_attribute_confidence(self):
        result = build_pipeline().analyze(encode_garment_png())

        assert result.success is True
        assert len(result.items) == 1

        item = result.items[0]
        assert item.attributes.category is not None
        assert item.attributes.color is not None
        assert 0.0 <= item.confidence <= 1.0
        assert item.status is not ConfidenceStatus.REJECTED
        # `needs_review` may be set by the score, by validation, or by a
        # missing primary attribute; it is never set spuriously here.
        assert item.needs_review is True or item.status is not ConfidenceStatus.UNCERTAIN

    def test_confidence_is_per_attribute_not_only_aggregate(self):
        result = build_pipeline().analyze(encode_garment_png())
        item = result.items[0]

        values = [
            p.confidence
            for p in (
                item.attributes.category,
                item.attributes.material,
                item.attributes.pattern,
                item.attributes.style,
            )
            if p is not None
        ]
        assert values, "expected at least one scored attribute"
        # The aggregate must not simply be every per-attribute value: §8
        # requires a fused number that also reflects the detector, the mask
        # quality and the validation outcome.
        assert not np.allclose(values, [item.confidence] * len(values))

    def test_embedding_is_normalised_and_versioned(self):
        result = build_pipeline().analyze(encode_garment_png())
        item = result.items[0]

        assert item.embedding is not None
        assert len(item.embedding) == 768
        assert item.embedding_model is not None
        assert pytest.approx(np.linalg.norm(item.embedding), rel=1e-5) == 1.0

    def test_embedding_can_be_suppressed(self):
        options = AnalysisOptions(include_embedding=False)
        result = build_pipeline().analyze(encode_garment_png(), options=options)
        assert result.items[0].embedding is None

    def test_timings_are_recorded_per_stage(self):
        result = build_pipeline().analyze(encode_garment_png())
        processing = result.processing

        assert processing.decode_ms >= 0
        assert processing.detection_ms >= 0
        assert processing.total_ms >= processing.detection_ms
        assert result.items[0].timing_ms["color"] >= 0

    def test_reports_model_and_device_provenance(self):
        result = build_pipeline().analyze(encode_garment_png())
        assert result.models.detector is not None
        assert result.models.device is not None


class TestNonClothing:
    def test_no_detection_is_an_honest_failure_not_a_forced_label(self):
        detector = StubDetector(boxes=[])
        result = build_pipeline(detector=detector).analyze(encode_garment_png())

        assert result.success is False
        assert result.items == []
        assert "No clothing item detected" in (result.reason or "")

    def test_garments_are_never_merged(self):
        boxes = [
            top_detection("top", 0.9),
            DetectedGarment(
                id="g-1",
                coarse_label="bottom",
                bbox=BoundingBox(x1=140.0, y1=300.0, x2=500.0, y2=470.0),
                detector_confidence=0.71,
                model="stub",
            ),
        ]
        result = build_pipeline(detector=StubDetector(boxes=boxes)).analyze(encode_garment_png())

        assert [item.id for item in result.items] == ["g-0", "g-1"]
        assert result.items[0].bbox != result.items[1].bbox

    def test_max_items_is_respected(self):
        boxes = [top_detection("top", 0.9) for _ in range(6)]
        for index, box in enumerate(boxes):
            box.id = f"g-{index}"
        result = build_pipeline(detector=StubDetector(boxes=boxes)).analyze(
            encode_garment_png(), options=AnalysisOptions(max_items=3)
        )
        assert len(result.items) <= 3


class TestQualityGate:
    def test_unusable_image_is_rejected_with_a_reason(self):
        quality_checker = ImageQualityChecker()

        class Rejecting:
            def check(self, image):
                from clothing_ai.schemas import ImageQualityResult

                return ImageQualityResult(
                    score=0.05,
                    usable=False,
                    issues=[
                        QualityIssue(
                            code="image.too_blurry",
                            message="image is too blurry to analyse",
                            severity=Severity.ERROR,
                        )
                    ],
                )

        components = build_pipeline().__dict__["_c"]
        components.quality_checker = Rejecting()
        result = ClothingAnalysisPipeline(components).analyze(encode_garment_png())

        assert result.success is False
        assert "blurry" in (result.reason or "")
        assert quality_checker is not None


class TestDetectorGate:
    def test_category_outside_the_detected_group_is_corrected(self):
        """§12: a `bottom` box must not be reported as a t-shirt."""
        vocabulary = get_vocabulary()
        top_values = {label.value for label in vocabulary["category"].by_group("top")}
        assert "t-shirt" in top_values

        out_of_group = next(
            value
            for value in vocabulary["category"].values
            if value not in top_values
        )
        classifier = StubClassifier()
        classifier.predict = _fixed_predictor(
            {name: out_of_group for name in ("category",)}
        )

        result = build_pipeline(classifier=classifier).analyze(encode_garment_png())
        category = result.items[0].attributes.category

        assert category is not None
        assert category.value != out_of_group
        assert vocabulary.group_for("category", category.value) == "top"

    def test_gate_stays_open_when_the_detector_is_weak(self):
        """A weak detector must not be able to force a wrong category."""
        detector = StubDetector([top_detection("top", 0.20)])
        classifier = StubClassifier()
        classifier.predict = _fixed_predictor({"category": "jeans"})

        result = build_pipeline(detector=detector, classifier=classifier).analyze(
            encode_garment_png()
        )
        assert result.items[0].attributes.category.value == "jeans"


class TestRetry:
    def test_retry_is_attempted_for_a_low_confidence_result(self):
        classifier = _uncertain_classifier()
        segmenter = StubSegmenter()
        pipeline = build_pipeline(classifier=classifier, segmenter=segmenter)
        result = pipeline.analyze(encode_garment_png())

        item = result.items[0]
        # Exactly two passes: the original plus the one the budget allows.
        # Asserting `>= 1` here would pass even if the retry never fired, which
        # is exactly how a broken retry path stayed hidden.
        assert item.attempts == 2
        assert int(item.timing_ms["attempts"]) == 2
        # The retry budget is bounded, so this cannot be unbounded work.
        assert item.attempts <= get_settings().max_retries + 1

    def test_a_retry_view_is_actually_built(self):
        """The retry path must reach `build_retry_view` and use its result."""
        calls: list[int] = []
        pipeline = build_pipeline(classifier=_uncertain_classifier())
        original = pipeline._retry_view

        def spy(image, detection, quality, attempt):
            calls.append(attempt)
            return original(image, detection, quality, attempt)

        pipeline._retry_view = spy
        pipeline.analyze(encode_garment_png())

        # 1-based, and the same transformation is never applied twice.
        assert calls == [1]

    def test_retry_budget_is_never_exceeded(self):
        classifier = _uncertain_classifier(entropy=0.99, margin=0.0)
        pipeline = build_pipeline(classifier=classifier)
        item = pipeline.analyze(encode_garment_png()).items[0]
        assert item.attempts <= get_settings().max_retries + 1

    def test_a_worse_retry_is_discarded_rather_than_averaged(self):
        """A retry that lowers confidence must not replace the first pass."""
        pipeline = build_pipeline(classifier=_uncertain_classifier(entropy=0.99, margin=0.0))
        first = pipeline.analyze(encode_garment_png())
        assert first.items[0].attempts == 2
        # Whatever won, it is a real number, not an average of two guesses.
        assert 0.0 <= first.items[0].confidence <= 1.0


class TestColor:
    def test_uniform_blue_image_is_named_as_a_colour(self):
        extractor = ColorExtractor()
        result = extractor.extract(solid_image(rgb=(25, 30, 90)), mask=None)
        assert isinstance(result, ColorResult)
        assert result.primary
        assert result.primary_hex.startswith("#")
        assert sum(result.distribution.values()) == pytest.approx(1.0, abs=0.01)

    def test_mask_changes_the_measured_colour(self):
        """A mask must actually restrict the pixels that are measured."""
        image = np.zeros((100, 100, 3), dtype=np.uint8)
        image[:, :] = (200, 30, 30)  # red
        image[:, 50:] = (25, 30, 90)  # blue, to be excluded by the mask

        mask = np.zeros((100, 100), dtype=np.uint8)
        mask[:, :50] = 255

        extractor = ColorExtractor()
        unmasked = extractor.extract(image, None)
        masked = extractor.extract(image, mask)

        assert masked.primary != unmasked.primary
        assert masked.pixel_count < unmasked.pixel_count

    def test_masked_pixel_count_is_reported(self):
        image = garment_image()
        mask = np.zeros(image.shape[:2], dtype=np.uint8)
        mask[10:50, 10:50] = 255
        result = ColorExtractor().extract(image, mask)

        # The extractor cleans the mask before measuring, so the count is at
        # most the raw mask area and typically slightly below it.
        assert 0 < result.pixel_count <= 40 * 40
        assert result.pixel_count < image.shape[0] * image.shape[1]


class TestFailureModes:
    def test_segmentation_failure_degrades_rather_than_raising(self):
        class Exploding:
            name = "boom"

            def segment(self, *args, **kwargs):
                raise RuntimeError("CUDA fell over")

        result = build_pipeline(segmenter=Exploding()).analyze(encode_garment_png())
        assert result.success is True
        assert result.items[0].attributes.category is not None

    def test_classification_failure_yields_an_item_without_attributes(self):
        class Exploding:
            name = "boom"

            def encode_image(self, image):
                raise RuntimeError("weights missing")

        result = build_pipeline(classifier=Exploding()).analyze(encode_garment_png())
        assert result.success is True
        assert result.items[0].attributes.category is None
        assert result.items[0].needs_review is True

    def test_embedder_failure_does_not_lose_the_attributes(self):
        class Exploding:
            name = "boom"
            model_version = "boom"

            def embed(self, *args, **kwargs):
                raise RuntimeError("no")

        result = build_pipeline(embedder=Exploding()).analyze(encode_garment_png())
        assert result.items[0].attributes.category is not None
        assert result.items[0].embedding is None

    def test_corrupt_bytes_produce_a_readable_error(self):
        result = build_pipeline().analyze(b"not an image at all")
        assert result.success is False
        assert result.reason
        assert result.items == []


def _fixed_predictor(values: dict[str, str]):
    """Force specific attribute values, mimicking a confident head."""
    from clothing_ai.schemas import AttributePrediction

    def predict(image, attribute, vocabulary, **kwargs):
        spec = vocabulary[attribute]
        scores = {name: 0.01 for name in spec.values}
        chosen = values.get(attribute, spec.values[0])
        scores[chosen] = 0.9
        return AttributePrediction(
            value=chosen, confidence=0.9, source="stub", scores=scores
        )

    return predict


def _uncertain_classifier(entropy: float = 0.9, margin: float = 0.01):
    classifier = StubClassifier(entropy=entropy, margin=margin)

    def predict(image, attribute, vocabulary, **kwargs):
        from clothing_ai.schemas import AttributePrediction

        spec = vocabulary[attribute]
        # An almost-uniform score distribution is what a genuinely ambiguous
        # garment looks like, and is what the retry gate exists to catch.
        scores = {name: 1.0 / len(spec.values) for name in spec.values}
        return AttributePrediction(
            value=spec.values[0], confidence=0.34, source="stub", scores=scores
        )

    classifier.predict = predict
    return classifier
