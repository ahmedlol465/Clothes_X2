"""Typed data models for the clothing analysis pipeline.

Every stage communicates through these Pydantic models, so a component can be
swapped without any other stage noticing. Nothing here imports torch, numpy or
OpenCV, which keeps the schemas importable in tests without the ML stack.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# --------------------------------------------------------------------------- #
# Enumerations
# --------------------------------------------------------------------------- #


class ConfidenceStatus(str, Enum):
    """Outcome of the confidence gate. See `confidence/scoring.py`."""

    ACCEPTED = "accepted"
    ACCEPTED_WITH_UNCERTAINTY = "accepted_with_uncertainty"
    UNCERTAIN = "uncertain"
    REJECTED = "rejected"


class ReviewState(str, Enum):
    NONE = "none"
    SUGGESTED = "suggested"
    REQUIRED = "required"


class Severity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class ColorSpace(str, Enum):
    RGB = "rgb"
    LAB = "lab"
    HSV = "hsv"


# --------------------------------------------------------------------------- #
# Geometry
# --------------------------------------------------------------------------- #


class BoundingBox(BaseModel):
    """Axis-aligned box in pixel coordinates of the source image."""

    model_config = ConfigDict(frozen=True)

    x1: float = Field(..., ge=0, description="Left edge, pixels.")
    y1: float = Field(..., ge=0, description="Top edge, pixels.")
    x2: float = Field(..., ge=0, description="Right edge, pixels.")
    y2: float = Field(..., ge=0, description="Bottom edge, pixels.")

    @property
    def width(self) -> float:
        return max(0.0, self.x2 - self.x1)

    @property
    def height(self) -> float:
        return max(0.0, self.y2 - self.y1)

    @property
    def area(self) -> float:
        return self.width * self.height

    @property
    def center(self) -> tuple[float, float]:
        return (self.x1 + self.x2) / 2.0, (self.y1 + self.y2) / 2.0

    def scaled(self, sx: float, sy: float) -> "BoundingBox":
        return BoundingBox(x1=self.x1 * sx, y1=self.y1 * sy, x2=self.x2 * sx, y2=self.y2 * sy)

    def to_xyxy(self) -> list[float]:
        """Format expected by `Sam2Processor(input_boxes=...)`."""
        return [self.x1, self.y1, self.x2, self.y2]


# --------------------------------------------------------------------------- #
# Stage 1 — image quality
# --------------------------------------------------------------------------- #


class QualityIssue(BaseModel):
    code: str = Field(..., description="Stable machine-readable issue code.")
    message: str
    severity: Severity = Severity.WARNING
    measured: float | None = Field(
        None, description="The measured value that triggered the issue."
    )
    threshold: float | None = Field(None, description="The threshold it crossed.")


class ImageQualityResult(BaseModel):
    score: float = Field(..., ge=0.0, le=1.0)
    issues: list[QualityIssue] = Field(default_factory=list)
    metrics: dict[str, float] = Field(
        default_factory=dict,
        description="Raw measurements: brightness, contrast, sharpness, entropy...",
    )
    usable: bool = Field(
        ..., description="False when analysis is pointless and the request should fail fast."
    )

    @property
    def blocking_issues(self) -> list[QualityIssue]:
        return [i for i in self.issues if i.severity is Severity.ERROR]


# --------------------------------------------------------------------------- #
# Stage 2 — detection
# --------------------------------------------------------------------------- #


class DetectedGarment(BaseModel):
    """One garment region proposed by a detector."""

    id: str = Field(..., description="Stable per-image id, e.g. `garment_001`.")
    coarse_label: str = Field(
        ...,
        description="The detector's own label, e.g. `top`. Never the final category.",
    )
    bbox: BoundingBox
    detector_confidence: float = Field(..., ge=0.0, le=1.0)
    model: str = Field(..., description="Model id + revision that produced this box.")
    extras: dict[str, Any] = Field(default_factory=dict)

    @property
    def area_ratio(self) -> float:
        """Box area as a fraction of the image; guards against degenerate boxes."""
        return self.bbox.area / self.extras["image_area"] if self.extras.get("image_area") else 0.0


# --------------------------------------------------------------------------- #
# Stage 3 — segmentation
# --------------------------------------------------------------------------- #


class SegmentationResult(BaseModel):
    """A binary garment mask plus the evidence for how much to trust it."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    mask: Any = Field(..., description="np.ndarray[H, W] of uint8 in {0, 255}.")
    quality: float = Field(
        ..., ge=0.0, le=1.0, description="Mask trust score in [0, 1]."
    )
    predicted_iou: float | None = Field(
        None, ge=0.0, le=1.0, description="SAM 2's own IoU head prediction."
    )
    coverage: float = Field(
        ..., ge=0.0, le=1.0, description="Mask pixels / bbox pixels."
    )
    filled: bool = Field(
        ..., description="True when the mask came from a crop-with-padding fallback."
    )
    model: str
    elapsed_ms: float = 0.0

    @property
    def mask_pixels(self) -> int:
        import numpy as np

        return int(np.count_nonzero(self.mask))


# --------------------------------------------------------------------------- #
# Stage 4a — colour
# --------------------------------------------------------------------------- #


class ColorSwatch(BaseModel):
    name: str = Field(..., description="Human-readable name, e.g. `navy blue`.")
    hex: str = Field(..., pattern=r"^#[0-9A-Fa-f]{6}$")
    share: float = Field(..., ge=0.0, le=1.0, description="Pixel share in [0, 1].")
    lab: tuple[float, float, float] | None = None


class ColorResult(BaseModel):
    primary: str = Field(..., description="Name of the dominant cluster.")
    primary_hex: str
    secondary: list[str] = Field(default_factory=list)
    distribution: dict[str, float] = Field(
        ..., description="Cluster name -> pixel share, sums to <= 1.0 (rest is `other`)."
    )
    is_multicolor: bool = False
    color_space: ColorSpace = ColorSpace.LAB
    swatches: list[ColorSwatch] = Field(default_factory=list)
    pixel_count: int = 0
    notes: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Stage 4b — classification and the other attributes
# --------------------------------------------------------------------------- #


class AttributePrediction(BaseModel):
    """A single attribute value with its own calibrated confidence.

    Confidence is never invented: for zero-shot heads it is derived from the
    softmax over the candidate set, and every scorer records which model
    produced it so the number can be audited.
    """

    value: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    source: str = Field(..., description="Which model/stage produced this value.")
    scores: dict[str, float] = Field(
        default_factory=dict, description="Full candidate distribution, kept for debugging."
    )
    alternatives: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Stage 5 — validation and confidence
# --------------------------------------------------------------------------- #


class ValidationRule(BaseModel):
    code: str
    description: str
    passed: bool
    detail: str = ""


class ValidationResult(BaseModel):
    consistent: bool = Field(..., description="False if any non-advisory rule failed.")
    rules: list[ValidationRule] = Field(default_factory=list)
    penalties: dict[str, float] = Field(
        default_factory=dict, description="Rule code -> confidence multiplier applied."
    )
    flags: list[str] = Field(default_factory=list)

    @property
    def total_penalty(self) -> float:
        return sum(self.penalties.values())


# --------------------------------------------------------------------------- #
# Final results
# --------------------------------------------------------------------------- #


class GarmentAttributes(BaseModel):
    category: AttributePrediction | None = None
    subcategory: AttributePrediction | None = None
    color: ColorResult | None = None
    material: AttributePrediction | None = None
    pattern: AttributePrediction | None = None
    style: AttributePrediction | None = None


class GarmentAnalysis(BaseModel):
    """Everything known about one garment. Garments are never merged."""

    id: str
    bbox: BoundingBox
    coarse_label: str
    attributes: GarmentAttributes
    confidence: float = Field(..., ge=0.0, le=1.0)
    status: ConfidenceStatus
    needs_review: bool = False
    review_reason: list[str] = Field(default_factory=list)
    validation: ValidationResult | None = None
    segmentation_quality: float | None = None
    mask_png_base64: str | None = Field(
        None,
        description=(
            "Crop-local garment mask as a base64 8-bit PNG, returned only when "
            "`include_mask` is requested. Absent means the mask was not computed."
        ),
    )
    embedding: list[float] | None = Field(
        None, description="L2-normalised, 768-dim, model versioned via `models`."
    )
    embedding_model: str | None = None
    timing_ms: dict[str, float] = Field(default_factory=dict)
    attempts: int = Field(1, ge=1, description="How many inference passes were used.")


class StageTiming(BaseModel):
    model_load_ms: float = 0.0
    decode_ms: float = 0.0
    quality_ms: float = 0.0
    detection_ms: float = 0.0
    segmentation_ms: float = 0.0
    classification_ms: float = 0.0
    color_ms: float = 0.0
    embeddings_ms: float = 0.0
    total_ms: float = 0.0


class ModelVersions(BaseModel):
    detector: str | None = None
    segmenter: str | None = None
    fashion_model: str | None = None
    embedder: str | None = None
    torch: str | None = None
    device: str | None = None
    pipeline_version: str = "0.1.0"


class AnalysisResult(BaseModel):
    """The `success` flag is `False` only when nothing could be analysed."""

    success: bool
    items: list[GarmentAnalysis] = Field(default_factory=list)
    image_quality: ImageQualityResult
    processing: StageTiming = Field(default_factory=StageTiming)
    models: ModelVersions = Field(default_factory=ModelVersions)
    reason: str | None = Field(
        None, description="Set when `success` is False, e.g. 'No clothing item detected'."
    )
    analysis_id: str | None = None
    request_id: str | None = None


class AnalysisOptions(BaseModel):
    """Per-request overrides. Every field is optional and bounded by config."""

    model_config = ConfigDict(extra="forbid")

    include_embedding: bool | None = None
    include_mask: bool = False
    max_items: int | None = Field(None, ge=1, le=20)
    detect_single_item_fallback: bool | None = None
    profile: Literal["fast", "balanced", "thorough"] | None = None
