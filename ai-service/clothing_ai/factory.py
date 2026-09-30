"""Assembles the production pipeline from configuration.

This is the only place that knows which concrete class backs each role. The
pipeline itself takes `PipelineComponents`, so tests can substitute a stub
detector without loading a 300 MB checkpoint.
"""

from __future__ import annotations

from .classification import ZeroShotClassifier
from .color import ColorExtractor, ColorExtractorConfig
from .common.logging import get_logger
from .config.settings import Settings, get_settings
from .config.vocabulary import get_vocabulary
from .detection import DetectorConfig, build_detector
from .embeddings import SiglipFashionEmbedder
from .fusion.attribute_fusion import AttributeFuser
from .models.model_manager import ModelManager, get_model_manager
from .pipeline import PipelineComponents
from .preprocessing import ImageQualityChecker
from .segmentation import build_segmenter
from .validation import AttributeValidator

log = get_logger(__name__)


def build_default_components(settings: Settings | None = None) -> PipelineComponents:
    settings = settings or get_settings()
    vocabulary = get_vocabulary(settings.labels_file)
    manager: ModelManager = get_model_manager(settings)

    detector_config = DetectorConfig(
        min_score=float(vocabulary.default("detector_min_score", 0.35)),
        nms_iou=float(vocabulary.default("detector_nms_iou", 0.55)),
        max_items=settings.max_garments,
        min_area_ratio=float(vocabulary.default("detector_min_area_ratio", 0.006)),
        max_area_ratio=float(vocabulary.default("detector_max_area_ratio", 0.98)),
        enable_fallback=bool(vocabulary.default("detector_fallback_enabled", True)),
    )

    fashion_handle = manager.fashion()
    detector = build_detector(manager.detector(), config=detector_config)
    segmenter = build_segmenter(manager.segmenter())
    classifier = ZeroShotClassifier(fashion_handle)

    components = PipelineComponents(
        settings=settings,
        vocabulary=vocabulary,
        detector=detector,
        segmenter=segmenter,
        classifier=classifier,
        color_extractor=ColorExtractor(
            ColorExtractorConfig(
                max_secondary=int(vocabulary.default("color_max_secondary", 2)),
            )
        ),
        embedder=SiglipFashionEmbedder(fashion_handle),
        fuser=AttributeFuser(
            vocabulary,
            AttributeValidator(),
            accept_threshold=settings.accept_threshold,
            uncertain_threshold=settings.uncertain_threshold,
            penalty_scale=settings.validation_penalty_scale,
            report_floor=settings.report_floor,
        ),
        quality_checker=ImageQualityChecker(),
        model_manager=manager,
        detector_config=detector_config,
    )
    log.info("pipeline_components_built", device=manager.device)
    return components


__all__ = ["build_default_components"]
