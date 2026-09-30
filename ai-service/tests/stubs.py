"""Deterministic stand-ins for every model, so the pipeline can be tested
without weights.

These are not mocks in the mocking-framework sense: each one implements the same
protocol as the real stage and produces structurally valid, deterministic
output. That means a test exercising the pipeline is exercising the real
orchestration, fusion, validation and scoring code — only the inference is
substituted.
"""

from __future__ import annotations

import numpy as np

from clothing_ai.classification.zero_shot import ZeroShotResult
from clothing_ai.embeddings import FASHIONSIGLIP_EMBED_DIM
from clothing_ai.schemas import (
    AttributePrediction,
    BoundingBox,
    ColorResult,
    DetectedGarment,
    SegmentationResult,
)


def solid_image(
    height: int = 480,
    width: int = 640,
    rgb: tuple[int, int, int] = (30, 60, 120),
) -> np.ndarray:
    return np.full((height, width, 3), rgb, dtype=np.uint8)


def garment_image(
    height: int = 480,
    width: int = 640,
    garment: tuple[int, int, int] = (30, 60, 120),
    background: tuple[int, int, int] = (232, 230, 226),
    seed: int = 7,
) -> np.ndarray:
    """A synthetic photo that a real quality checker should accept.

    A flat fill is not a usable test input: it has no foreground, no contrast
    and no high-frequency detail, so the quality gate rejects it — correctly.
    This builds a textured garment on a light background with enough structure
    to pass the same gate a phone photo would.
    """
    rng = np.random.default_rng(seed)
    image = np.empty((height, width, 3), dtype=np.float32)
    image[:, :] = background

    # A centred garment rectangle, inset the way the stub detector expects.
    y1, y2 = int(height * 0.15), int(height * 0.90)
    x1, x2 = int(width * 0.20), int(width * 0.80)
    patch = rng.normal(0.0, 6.0, size=(y2 - y1, x2 - x1, 3)) + np.array(garment)
    # A soft vertical shading gradient so the region is not perfectly uniform.
    rows = np.linspace(-14.0, 14.0, y2 - y1, dtype=np.float32)[:, None, None]
    image[y1:y2, x1:x2] = np.clip(patch + rows, 0, 255)

    # Sensor-like grain across the whole frame.
    image = np.clip(image + rng.normal(0.0, 3.0, size=image.shape), 0, 255)
    return image.astype(np.uint8)


def encode_garment_png(**kwargs) -> bytes:
    import cv2

    ok, buffer = cv2.imencode(".png", garment_image(**kwargs))
    assert ok
    return buffer.tobytes()


def encode_solid_png(rgb: tuple[int, int, int] = (30, 60, 120)) -> bytes:
    import cv2

    ok, buffer = cv2.imencode(".png", solid_image(rgb=rgb))
    assert ok
    return buffer.tobytes()


class StubDetector:
    """Returns a fixed list of boxes, or nothing when configured to."""

    name = "stub-detector"
    model_version = "stub"

    def __init__(self, boxes: list[DetectedGarment] | None = None) -> None:
        self._boxes = boxes
        self.calls: list[dict] = []

    def detect(self, image: np.ndarray, **overrides) -> list[DetectedGarment]:
        self.calls.append(dict(overrides))
        if self._boxes is not None:
            return list(self._boxes)
        height, width = image.shape[:2]
        return [
            DetectedGarment(
                id="stub-0",
                coarse_label="top",
                bbox=BoundingBox(
                    x1=width * 0.2, y1=height * 0.15, x2=width * 0.8, y2=height * 0.9
                ),
                detector_confidence=0.88,
                model="stub",
            )
        ]


class StubSegmenter:
    name = "stub-segmenter"
    model_version = "stub"

    def __init__(self, *, quality: float = 0.82, filled: bool = False) -> None:
        self._quality = quality
        self._filled = filled
        self.calls = 0

    def segment(self, image: np.ndarray, detection: DetectedGarment, **kwargs):
        self.calls += 1
        box = detection.bbox
        height, width = image.shape[:2]
        mask = np.zeros((height, width), dtype=np.uint8)
        x1 = int(max(0, box.x1))
        y1 = int(max(0, box.y1))
        x2 = int(max(x1 + 1, min(width, box.x2)))
        y2 = int(max(y1 + 1, min(height, box.y2)))
        mask[y1:y2, x1:x2] = 255
        return SegmentationResult(
            mask=mask,
            quality=self._quality,
            coverage=float((x2 - x1) * (y2 - y1)) / float(height * width),
            filled=self._filled,
            model="stub",
            predicted_iou=0.9,
            elapsed_ms=12.0,
        )


class StubClassifier:
    """Returns a fixed, valid prediction per attribute."""

    name = "stub-classifier"
    model_version = "stub"

    def __init__(
        self,
        predictions: dict[str, AttributePrediction] | None = None,
        *,
        entropy: float = 0.2,
        margin: float = 0.4,
    ) -> None:
        self._predictions = predictions
        self._entropy = entropy
        self._margin = margin
        self.encodes = 0
        self.predicts: list[str] = []

    def encode_image(self, image: np.ndarray):
        self.encodes += 1
        return np.zeros(FASHIONSIGLIP_EMBED_DIM, dtype=np.float32)

    def predict(
        self,
        image: np.ndarray,
        attribute: str,
        vocabulary,
        *,
        allowed=None,
        precomputed_image=None,
        top_k: int = 3,
    ) -> AttributePrediction:
        self.predicts.append(attribute)
        if self._predictions and attribute in self._predictions:
            return self._predictions[attribute]
        spec = vocabulary[attribute]
        return AttributePrediction(
            value=spec.values[0],
            confidence=0.66,
            source=spec.source,
            scores={name: 1.0 / len(spec.values) for name in spec.values},
        )


class StubEmbedder:
    name = "stub-embedder"

    def embed(self, image: np.ndarray, mask: np.ndarray | None = None) -> np.ndarray:
        return np.ones(FASHIONSIGLIP_EMBED_DIM, dtype=np.float32) / np.sqrt(
            FASHIONSIGLIP_EMBED_DIM
        )

    def to_list(self, embedding: np.ndarray) -> list[float]:
        return [float(x) for x in embedding]

    @property
    def model_version(self) -> str:
        return "stub-v0"


class StubColorExtractor:
    """A uniform-colour stand-in that still runs the real naming logic."""

    name = "stub-color"

    def __init__(self, rgb: tuple[int, int, int] = (25, 30, 90)) -> None:
        self._rgb = rgb

    def extract(self, image: np.ndarray, mask: np.ndarray | None = None) -> ColorResult:
        from clothing_ai.color import rgb_to_lab
        from clothing_ai.color.palette import name_color_lab

        name, _distance, hex_value = name_color_lab(rgb_to_lab(self._rgb))
        counted = int(image.shape[0] * image.shape[1])
        if mask is not None:
            counted = int(np.count_nonzero(mask))
        return ColorResult(
            primary=name,
            primary_hex=hex_value,
            distribution={name: 1.0},
            secondary=[],
            is_multicolor=False,
            pixel_count=counted,
            swatches=[],
        )


def zero_shot_result(value: str, confidence: float = 0.7) -> ZeroShotResult:
    return ZeroShotResult(value=value, confidence=confidence, scores={value: confidence})
