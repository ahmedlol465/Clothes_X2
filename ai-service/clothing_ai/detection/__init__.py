"""Stage 2 — garment detection."""

from .base import GarmentDetector
from .fashion_detr import FashionDeformableDetrDetector
from .foreground_fallback import ForegroundBoxDetector
from .registry import DetectorConfig, FallbackDetector, build_detector

__all__ = [
    "DetectorConfig",
    "FallbackDetector",
    "FashionDeformableDetrDetector",
    "ForegroundBoxDetector",
    "GarmentDetector",
    "build_detector",
]
