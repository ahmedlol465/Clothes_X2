"""The pipeline: one call that turns image bytes into structured attributes.

Every stage is injected, so this class contains no model knowledge at all — it
sequences the stages, measures them, applies the retry policy and assembles the
final result. Swapping the detector, the segmenter or the fashion model is a
change to `build_pipeline`, not to this file.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Sequence

import numpy as np

from .color import ColorExtractor
from .common.logging import get_logger
from .config.settings import Settings, get_settings
from .config.vocabulary import AttributeVocabulary, get_vocabulary
from .confidence.scoring import needs_review, should_retry
from .fusion.attribute_fusion import AttributeFuser
from .models.model_manager import ModelManager
from .preprocessing import ImageQualityChecker, decode_image
from .schemas import (
    AnalysisOptions,
    AnalysisResult,
    AttributePrediction,
    ColorResult,
    DetectedGarment,
    GarmentAnalysis,
    GarmentAttributes,
    ImageQualityResult,
    ModelVersions,
    SegmentationResult,
    StageTiming,
)
from .validation import AttributeValidator

log = get_logger(__name__)


@dataclass
class PipelineComponents:
    """Everything the pipeline needs, injected rather than constructed here."""

    settings: Settings
    vocabulary: AttributeVocabulary
    detector: Any
    segmenter: Any
    classifier: Any
    color_extractor: ColorExtractor
    embedder: Any
    fuser: AttributeFuser
    quality_checker: ImageQualityChecker
    model_manager: ModelManager | None = None
    secondary_classifier: Any | None = None
    detector_config: Any | None = None


@dataclass
class _Observation:
    """One inference pass over one garment."""

    detection: DetectedGarment
    segmentation: SegmentationResult | None
    attributes: GarmentAttributes
    outcome: Any
    embedding: np.ndarray | None = None
    entropy: float = 0.0
    margin: float = 1.0
    timings: dict[str, float] = field(default_factory=dict)


class ClothingAnalysisPipeline:
    """`analyze(image_bytes)` -> `AnalysisResult`."""

    def __init__(self, components: PipelineComponents) -> None:
        self._c = components
        self._settings = components.settings

    # ------------------------------------------------------------------ public --

    def analyze(
        self,
        image_bytes: bytes,
        *,
        options: AnalysisOptions | None = None,
        request_id: str | None = None,
    ) -> AnalysisResult:
        options = options or AnalysisOptions()
        analysis_id = uuid.uuid4().hex
        request_id = request_id or analysis_id
        started = time.perf_counter()
        timing = StageTiming()

        log.info("analysis_started", analysis_id=analysis_id, bytes=len(image_bytes))

        # ---------------------------------------------------- decode + validate
        step = time.perf_counter()
        try:
            decoded = decode_image(
                image_bytes,
                max_dimension=self._settings.max_image_dimension,
            )
        except Exception as exc:
            log.warning("decode_failed", analysis_id=analysis_id, error=str(exc))
            return self._failure(
                reason=f"Could not read the image: {exc}",
                quality=ImageQualityResult(score=0.0, usable=False, issues=[]),
                analysis_id=analysis_id,
                request_id=request_id,
                timing=timing,
            )

        image = decoded.image
        quality = self._c.quality_checker.check(image)
        timing.decode_ms = round((time.perf_counter() - step) * 1000.0, 2)

        if not quality.usable:
            reasons = "; ".join(i.message for i in quality.blocking_issues) or "image unusable"
            log.info("analysis_rejected_quality", analysis_id=analysis_id, score=quality.score)
            return self._failure(
                reason=reasons,
                quality=quality,
                analysis_id=analysis_id,
                request_id=request_id,
                timing=timing,
            )

        # ------------------------------------------------------------ detection
        step = time.perf_counter()
        overrides = self._detector_overrides(options)
        detections = self._c.detector.detect(image, **overrides)
        timing.detection_ms = round((time.perf_counter() - step) * 1000.0, 2)

        if not detections:
            # This is the documented behaviour: no clothing is a valid, honest
            # answer, not a cue to force a label onto the image.
            log.info("no_garment_detected", analysis_id=analysis_id)
            result = self._failure(
                reason="No clothing item detected",
                quality=quality,
                analysis_id=analysis_id,
                request_id=request_id,
                timing=timing,
            )
            result.processing.total_ms = round((time.perf_counter() - started) * 1000.0, 2)
            return result

        max_items = options.max_items or self._settings.max_garments
        detections = detections[:max_items]

        # ------------------------------------------------- per-garment analysis
        include_embedding = (
            self._settings_includes_embedding(options) if self._c.embedder else False
        )
        items: list[GarmentAnalysis] = []
        for detection in detections:
            observation = self._analyze_garment(
                image,
                detection,
                quality=quality,
                include_embedding=include_embedding,
                options=options,
            )
            items.append(self._to_analysis(observation, options))

        # An item that was rejected by the confidence gate but is the only item
        # is still returned — with `needs_review` — because dropping it would
        # leave the user with an empty result and no explanation.
        timing.model_load_ms = round(
            (self._c.model_manager.load_stats().total_ms if self._c.model_manager else 0.0), 2
        )
        timing.classification_ms = round(sum(i.timing_ms.get("classification", 0.0) for i in items), 2)
        timing.color_ms = round(sum(i.timing_ms.get("color", 0.0) for i in items), 2)
        timing.embeddings_ms = round(sum(i.timing_ms.get("embeddings", 0.0) for i in items), 2)
        timing.segmentation_ms = round(sum(i.timing_ms.get("segmentation", 0.0) for i in items), 2)
        timing.total_ms = round((time.perf_counter() - started) * 1000.0, 2)

        result = AnalysisResult(
            success=True,
            items=items,
            image_quality=quality,
            processing=timing,
            models=self._model_versions(),
            analysis_id=analysis_id,
            request_id=request_id,
        )
        log.info(
            "analysis_complete",
            analysis_id=analysis_id,
            items=len(items),
            total_ms=timing.total_ms,
        )
        return result

    # ------------------------------------------------------------ per-garment --

    def _analyze_garment(
        self,
        image: np.ndarray,
        detection: DetectedGarment,
        *,
        quality: ImageQualityResult,
        include_embedding: bool,
        options: AnalysisOptions,
    ) -> _Observation:
        segmentation = self._segment(image, detection)
        observation = self._observe(
            image,
            detection,
            segmentation=segmentation,
            include_embedding=include_embedding,
            allow_correction=True,
        )

        # ------------------------------------------------------------ retry --
        # `attempt` counts completed inference passes, so it starts at 1.
        # `max_retries` therefore means extra passes beyond the first, which is
        # what the setting claims to mean.
        max_retries = max(0, self._settings.max_retries)
        attempt = 1
        while should_retry(
            status=observation.outcome.status,
            entropy=observation.entropy,
            margin=observation.margin,
            attempt=attempt,
            max_retries=max_retries,
            validation=observation.outcome.validation,
        ):
            # The retry view is 1-based so a garment never has the same
            # transformation applied to it twice.
            retry_number = attempt
            attempt += 1
            alternative = self._retry_view(image, detection, quality, retry_number)
            if alternative is None:
                break
            retry_detection, retry_image = alternative
            retry_segmentation = self._segment(retry_image, retry_detection)
            candidate = self._observe(
                retry_image,
                retry_detection,
                segmentation=retry_segmentation,
                include_embedding=include_embedding,
                allow_correction=True,
            )
            candidate.timings["retry"] = attempt
            # Keep whichever pass the confidence gate liked better. A second
            # opinion that is worse than the first is discarded, not averaged
            # in, because averaging two guesses is still a guess.
            if candidate.outcome.confidence > observation.outcome.confidence:
                log.info(
                    "retry_improved",
                    garment=detection.id,
                    attempt=attempt,
                    before=round(observation.outcome.confidence, 3),
                    after=round(candidate.outcome.confidence, 3),
                )
                candidate.detection = detection
                observation = candidate
            else:
                log.info(
                    "retry_not_better",
                    garment=detection.id,
                    attempt=attempt,
                    before=round(observation.outcome.confidence, 3),
                    after=round(candidate.outcome.confidence, 3),
                )
                break

        observation.timings["attempts"] = float(attempt)
        return observation

    def _observe(
        self,
        image: np.ndarray,
        detection: DetectedGarment,
        *,
        segmentation: SegmentationResult | None,
        include_embedding: bool,
        allow_correction: bool,
    ) -> _Observation:
        timings: dict[str, float] = {}

        step = time.perf_counter()
        attributes, diagnostics, zero_shot_color = self._classify(image, detection)
        timings["classification"] = round((time.perf_counter() - step) * 1000.0, 2)

        step = time.perf_counter()
        # Colour is measured on the original crop, mask applied inside the
        # extractor, so the retry view can change the crop without changing how
        # colour is measured.
        attributes.color = self._measure_color(image, detection, segmentation)
        timings["color"] = round((time.perf_counter() - step) * 1000.0, 2)

        outcome = self._c.fuser.fuse(
            detection=detection,
            segmentation=segmentation,
            raw=attributes,
            zero_shot_diagnostics=diagnostics,
            zero_shot_color=zero_shot_color,
            allow_correction=allow_correction,
        )

        embedding = None
        if include_embedding:
            step = time.perf_counter()
            embedding = self._embed(image, detection, segmentation)
            timings["embeddings"] = round((time.perf_counter() - step) * 1000.0, 2)

        if segmentation is not None:
            timings["segmentation"] = round(segmentation.elapsed_ms, 2)

        return _Observation(
            detection=detection,
            segmentation=segmentation,
            attributes=outcome.attributes,
            outcome=outcome,
            embedding=embedding,
            entropy=outcome.category_entropy,
            margin=outcome.category_margin,
            timings=timings,
        )

    # ------------------------------------------------------------------ stages --

    def _segment(self, image: np.ndarray, detection: DetectedGarment) -> SegmentationResult | None:
        try:
            return self._c.segmenter.segment(image, detection)
        except Exception as exc:
            log.error("segmentation_failed", garment=detection.id, error=str(exc), exc_info=True)
            return None

    def _classify(
        self, image: np.ndarray, detection: DetectedGarment
    ) -> tuple[GarmentAttributes, dict[str, float], AttributePrediction | None]:
        """Run every zero-shot head over one crop.

        The crop is embedded once and reused by all heads, which is the
        difference between four vision passes and one.
        """
        vocabulary = self._c.vocabulary
        crop = self._crop(image, detection)

        try:
            image_features = self._c.classifier.encode_image(crop)
        except Exception as exc:
            log.error("encode_failed", garment=detection.id, error=str(exc), exc_info=True)
            return GarmentAttributes(), {}, None

        attributes = GarmentAttributes()
        diagnostics: dict[str, float] = {}
        zero_shot_color: AttributePrediction | None = None

        for spec in vocabulary.active_attributes():
            if spec.name == "subcategory":
                continue  # enabled only for a second, targeted pass
            try:
                prediction = self._c.classifier.predict(
                    crop,
                    spec.name,
                    vocabulary,
                    precomputed_image=image_features,
                )
            except Exception as exc:
                log.error(
                    "classify_failed",
                    attribute=spec.name,
                    garment=detection.id,
                    error=str(exc),
                    exc_info=True,
                )
                continue

            if spec.name == "color":
                # Corroboration only; the measured colour is what gets reported.
                zero_shot_color = prediction
                continue
            setattr(attributes, spec.name, prediction)

        if attributes.category is not None:
            diagnostics["category_entropy"] = self._category_entropy(attributes.category)
            diagnostics["category_margin"] = self._category_margin(attributes.category)
        return attributes, diagnostics, zero_shot_color

    def _measure_color(
        self,
        image: np.ndarray,
        detection: DetectedGarment,
        segmentation: SegmentationResult | None,
    ) -> ColorResult:
        crop = self._crop(image, detection)
        mask = None
        if segmentation is not None:
            mask = _mask_for_crop(segmentation.mask, detection, image.shape[:2], crop.shape[:2])
        return self._c.color_extractor.extract(crop, mask)

    def _embed(
        self,
        image: np.ndarray,
        detection: DetectedGarment,
        segmentation: SegmentationResult | None,
    ) -> np.ndarray | None:
        crop = self._crop(image, detection)
        mask = None
        if segmentation is not None:
            mask = _mask_for_crop(segmentation.mask, detection, image.shape[:2], crop.shape[:2])
        try:
            return self._c.embedder.embed(crop, mask)
        except Exception as exc:
            log.error("embed_failed", garment=detection.id, error=str(exc), exc_info=True)
            return None

    def _crop(self, image: np.ndarray, detection: DetectedGarment) -> np.ndarray:
        box = detection.bbox
        return image[
            int(max(0, box.y1)) : int(max(1, box.y2)),
            int(max(0, box.x1)) : int(max(1, box.x2)),
        ]

    # --------------------------------------------------------------- fallback --

    def _retry_view(
        self,
        image: np.ndarray,
        detection: DetectedGarment,
        quality: ImageQualityResult,
        attempt: int,
    ) -> tuple[DetectedGarment, np.ndarray] | None:
        """Alternative preprocessing for a low-confidence garment.

        Two views, both cheap and both bounded by `max_retries`: a tighter crop
        (removes surrounding scene) and a brightness/contrast correction
        (recovers a dim photo). Nothing here is unbounded — there is no loop
        that "keeps trying" until a threshold is met.

        `attempt` is the 1-based retry number, which selects the view so the
        same transformation is never applied twice to one garment.
        """
        from .preprocessing.retry_views import build_retry_view

        return build_retry_view(image, detection, quality, attempt)

    # -------------------------------------------------------------- reporting --

    def _to_analysis(self, observation: _Observation, options: AnalysisOptions) -> GarmentAnalysis:
        outcome = observation.outcome
        attributes = self._c.fuser.reportable(outcome.attributes)

        mask_png = None
        if options.include_mask and observation.segmentation is not None:
            mask_png = _encode_crop_mask(
                observation.segmentation.mask, observation.detection
            )

        embedding_list = None
        embedding_model = None
        if observation.embedding is not None and self._c.embedder is not None:
            embedding_list = self._c.embedder.to_list(observation.embedding)
            embedding_model = self._c.embedder.model_version

        review = needs_review(outcome.status, outcome.validation, outcome.attributes)
        reasons = list(outcome.validation.flags) + outcome.flags
        if outcome.attributes.category is None:
            reasons.append("category_missing")

        return GarmentAnalysis(
            id=observation.detection.id,
            bbox=observation.detection.bbox,
            coarse_label=observation.detection.coarse_label,
            attributes=attributes,
            confidence=outcome.confidence,
            status=outcome.status,
            needs_review=review,
            review_reason=sorted(set(reasons)),
            validation=outcome.validation,
            segmentation_quality=(
                observation.segmentation.quality if observation.segmentation else None
            ),
            mask_png_base64=mask_png,
            embedding=embedding_list,
            embedding_model=embedding_model,
            timing_ms=observation.timings,
            attempts=int(observation.timings.get("attempts", 1)),
        )

    def _model_versions(self) -> ModelVersions:
        manager = self._c.model_manager
        return ModelVersions(
            detector=self._component_version(self._c.detector),
            segmenter=self._component_version(self._c.segmenter),
            fashion_model=self._component_version(self._c.classifier),
            embedder=self._component_version(self._c.embedder),
            torch=manager.torch_version if manager else None,
            device=manager.device if manager else self._settings.resolved_device(),
        )

    @staticmethod
    def _component_version(component: Any) -> str | None:
        if component is None:
            return None
        return getattr(component, "name", None) or getattr(component, "model_version", None) or "unknown"

    def _settings_includes_embedding(self, options: AnalysisOptions) -> bool:
        if options.include_embedding is not None:
            return options.include_embedding
        return True

    def _detector_overrides(self, options: AnalysisOptions) -> dict[str, Any]:
        config = self._c.detector_config
        if config is None:
            return {}
        profile = options.profile
        base = {
            "min_score": config.min_score,
            "nms_iou": config.nms_iou,
            "max_items": options.max_items or config.max_items,
            "min_area_ratio": config.min_area_ratio,
            "max_area_ratio": config.max_area_ratio,
        }
        if options.detect_single_item_fallback is False:
            # Only the primary detector; used by the benchmark so the fallback
            # cannot inflate measured recall.
            base["enable_fallback"] = False
        if profile == "fast":
            base["max_items"] = min(base["max_items"], 4)
        elif profile == "thorough":
            base["min_score"] = max(0.15, base["min_score"] - 0.15)
            base["max_items"] = max(base["max_items"], 8)
        return base

    @staticmethod
    def _category_entropy(prediction: AttributePrediction) -> float:
        if not prediction.scores:
            return 0.0
        values = np.array(list(prediction.scores.values()), dtype=np.float64)
        if values.size < 2:
            return 0.0
        values = values / max(values.sum(), 1e-12)
        raw = float(-(values * np.log(values + 1e-12)).sum())
        return float(np.clip(raw / float(np.log(values.size)), 0.0, 1.0))

    @staticmethod
    def _category_margin(prediction: AttributePrediction) -> float:
        if not prediction.scores:
            return 1.0
        ordered = sorted(prediction.scores.values(), reverse=True)
        if len(ordered) < 2:
            return 1.0
        return float(ordered[0] - ordered[1])

    def _failure(
        self,
        *,
        reason: str,
        quality: ImageQualityResult,
        analysis_id: str,
        request_id: str,
        timing: StageTiming,
    ) -> AnalysisResult:
        timing.total_ms = timing.total_ms or 0.0
        return AnalysisResult(
            success=False,
            items=[],
            image_quality=quality,
            processing=timing,
            models=self._model_versions(),
            reason=reason,
            analysis_id=analysis_id,
            request_id=request_id,
        )


def _mask_for_crop(
    mask: np.ndarray,
    detection: DetectedGarment,
    image_shape: tuple[int, int],
    crop_shape: tuple[int, int],
) -> np.ndarray:
    """Slice the full-image mask down to the garment's crop.

    The extractor and embedder both operate on the crop, so the mask has to be
    expressed in crop coordinates. Any mismatch in size is resolved by nearest
    resize rather than by assuming the shapes already line up.
    """
    box = detection.bbox
    height, width = image_shape
    if mask.shape[:2] != (height, width):
        import cv2

        mask = cv2.resize(mask, (width, height), interpolation=cv2.INTER_NEAREST)

    x1 = int(max(0, box.x1))
    y1 = int(max(0, box.y1))
    x2 = int(max(x1 + 1, min(width, box.x2)))
    y2 = int(max(y1 + 1, min(height, box.y2)))
    cropped = mask[y1:y2, x1:x2]

    if cropped.shape[:2] != crop_shape:
        import cv2

        cropped = cv2.resize(cropped, (crop_shape[1], crop_shape[0]), interpolation=cv2.INTER_NEAREST)
    return cropped


def build_pipeline(
    components: PipelineComponents | None = None,
    *,
    settings: Settings | None = None,
) -> ClothingAnalysisPipeline:
    """Construct the production pipeline, loading every model once."""
    from .factory import build_default_components

    return ClothingAnalysisPipeline(components or build_default_components(settings=settings))


def _encode_crop_mask(mask: np.ndarray, detection: DetectedGarment) -> str | None:
    """Base64 PNG of the crop-local mask, for clients that want to show it."""
    import base64

    from .preprocessing import encode_png

    try:
        cropped = _mask_for_crop(
            mask, detection, mask.shape[:2], _crop_shape(mask, detection)
        )
        return base64.b64encode(encode_png((cropped > 0).astype("uint8") * 255)).decode("ascii")
    except Exception as exc:  # pragma: no cover - the mask is optional output
        log.warning("mask_encode_failed", garment=detection.id, error=str(exc))
        return None


def _crop_shape(image: np.ndarray, detection: DetectedGarment) -> tuple[int, int]:
    box = detection.bbox
    height, width = image.shape[:2]
    rows = int(max(1, min(height, box.y2))) - int(max(0, box.y1))
    cols = int(max(1, min(width, box.x2))) - int(max(0, box.x1))
    return max(1, rows), max(1, cols)


__all__ = [
    "ClothingAnalysisPipeline",
    "PipelineComponents",
    "build_pipeline",
]
