"""Model lifecycle: one cached instance of each pretrained model."""

from .handles import (
    BackgroundRemovalHandle,
    ClassifierHandle,
    DetectorHandle,
    FashionHandle,
    SegmenterHandle,
)
from .model_manager import (
    LoadStats,
    ModelLoadError,
    ModelManager,
    get_model_manager,
    reset_model_manager,
)

__all__ = [
    "BackgroundRemovalHandle",
    "ClassifierHandle",
    "DetectorHandle",
    "FashionHandle",
    "LoadStats",
    "ModelLoadError",
    "ModelManager",
    "SegmenterHandle",
    "get_model_manager",
    "reset_model_manager",
]
