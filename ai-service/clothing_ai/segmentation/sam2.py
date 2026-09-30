"""SAM 2.1 box-prompted segmentation.

Model: `facebook/sam2.1-hiera-tiny` (Apache-2.0). The `tiny` tier is the right
default here: on CPU it costs a fraction of `small`/`base-plus` and the input is
a single garment crop, not a whole scene.

SAM 3 was rejected: `facebook/sam3` and `facebook/sam3.1` are `gated: manual`
behind a Meta licence agreement, which cannot be satisfied by an unattended
local pipeline. SAM 2.1 needs no approval and is Apache-2.0.

Two fallbacks guard the pipeline, because a mask is not optional — without one,
colour extraction has to run on the whole crop and the results are noise:

1. `multimask_output=True` picks the candidate whose box-coverage best matches
   the detector box, which is far more stable than trusting rank 0.
2. If SAM 2 fails or returns a degenerate mask, `filled` is set and the mask
   becomes the padded box itself, flagged so confidence scoring can discount it.
"""

from __future__ import annotations

import time

import cv2
import numpy as np

from ..common.logging import get_logger
from ..models.handles import SegmenterHandle
from ..schemas import BoundingBox, DetectedGarment, SegmentationResult

log = get_logger(__name__)

#: A mask covering less than this fraction of its box is usually a sliver of
#: fabric rather than the garment.
MIN_COVERAGE = 0.08
#: ...and one covering more than this is the background.
MAX_COVERAGE = 0.99
MIN_MASK_AREA_PX = 64


class Sam2Segmenter:
    """`GarmentSegmenter` backed by SAM 2.1."""

    def __init__(self, handle: SegmenterHandle) -> None:
        self._handle = handle

    @property
    def name(self) -> str:
        return self._handle.version

    def segment(
        self,
        image: np.ndarray,
        detection: DetectedGarment,
        *,
        quality_floor: float = 0.0,
    ) -> SegmentationResult | None:
        started = time.perf_counter()
        box = detection.bbox
        mask, predicted_iou = self._predict_mask(image, box)

        elapsed_ms = (time.perf_counter() - started) * 1000.0

        if mask is None:
            fallback = self._box_mask(image, box)
            log.warning(
                "segmentation_fallback",
                garment=detection.id,
                reason="sam2_returned_no_usable_mask",
            )
            return SegmentationResult(
                mask=fallback,
                quality=0.25,
                predicted_iou=None,
                coverage=1.0,
                filled=True,
                model=f"{self._handle.version}|box-fill",
                elapsed_ms=elapsed_ms,
            )

        coverage = float(mask.sum() / 255.0) / max(1.0, box.area)
        if coverage < MIN_COVERAGE or coverage > MAX_COVERAGE:
            fallback = self._box_mask(image, box)
            log.warning(
                "segmentation_fallback",
                garment=detection.id,
                reason="degenerate_coverage",
                coverage=round(coverage, 4),
            )
            return SegmentationResult(
                mask=fallback,
                quality=0.25,
                predicted_iou=predicted_iou,
                coverage=1.0,
                filled=True,
                model=f"{self._handle.version}|box-fill",
                elapsed_ms=elapsed_ms,
            )

        quality = self._quality(predicted_iou, coverage, mask)
        if quality < quality_floor:
            log.info(
                "segmentation_below_floor",
                garment=detection.id,
                quality=round(quality, 3),
                floor=quality_floor,
            )

        return SegmentationResult(
            mask=mask,
            quality=quality,
            predicted_iou=predicted_iou,
            coverage=float(np.clip(coverage, 0.0, 1.0)),
            filled=False,
            model=self._handle.version,
            elapsed_ms=elapsed_ms,
        )

    # -------------------------------------------------------------- internals --

    def _predict_mask(
        self, image: np.ndarray, box: BoundingBox
    ) -> tuple[np.ndarray | None, float | None]:
        import torch

        handle = self._handle
        height, width = image.shape[:2]
        try:
            inputs = handle.processor(
                images=image, input_boxes=[[list(box.to_xyxy())]], return_tensors="pt"
            )
            inputs = {key: value.to(handle.device) for key, value in inputs.items()}
            with torch.no_grad():
                outputs = handle.model(**inputs, multimask_output=True)

            masks = handle.processor.post_process_masks(
                outputs.pred_masks.cpu(), inputs["original_sizes"].cpu()
            )[0]  # (num_masks, 3, H, W)
            scores = outputs.iou_scores.flatten().float().cpu().tolist()
        except Exception as exc:  # pragma: no cover - defensive
            log.error("segmentation_forward_failed", error=str(exc), exc_info=True)
            return None, None

        candidates = masks[0]
        best_index, best_iou = self._select_candidate(candidates, scores, box, image.shape[:2])
        if best_index is None:
            return None, None

        binary = (candidates[best_index].numpy() > 0.0).astype(np.uint8) * 255
        # Drop specks so colour clustering is not dragged by single pixels.
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=1)
        binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)
        return binary, best_iou

    def _select_candidate(
        self,
        candidates: "np.ndarray",
        scores: list[float],
        box: BoundingBox,
        shape: tuple[int, int],
    ) -> tuple[int | None, float | None]:
        """Choose the mask that best explains the detector's box.

        SAM returns 3 candidates (whole / part / sub-part). Rank-0 is usually
        right for a prompt that lands on a small object, but for clothing the
        part-level masks are frequently the better fit for a box, so the box
        itself decides.
        """
        height, width = shape
        box_mask = np.zeros((height, width), dtype=np.uint8)
        x1, y1, x2, y2 = (int(round(v)) for v in box.to_xyxy())
        box_mask[max(0, y1) : min(height, y2), max(0, x1) : min(width, x2)] = 1
        box_area = float(box_mask.sum())
        if box_area <= 0:
            return None, None

        best_index: int | None = None
        best_score = -1.0
        best_iou: float | None = None
        for index in range(candidates.shape[0]):
            candidate = (candidates[index].numpy() > 0.0)
            area = float(candidate.sum())
            if area < MIN_MASK_AREA_PX:
                continue
            intersection = float((candidate & (box_mask > 0)).sum())
            union = area + box_area - intersection
            iou = intersection / union if union > 0 else 0.0
            # Blend agreement with the box against SAM's own IoU head, so a
            # mask that matches the box but SAM is unsure about is not blindly
            # preferred over a confident one.
            head = float(scores[index]) if index < len(scores) else 0.0
            combined = 0.7 * iou + 0.3 * head
            if combined > best_score:
                best_index, best_score, best_iou = index, combined, head
        return best_index, best_iou

    @staticmethod
    def _quality(predicted_iou: float | None, coverage: float, mask: np.ndarray) -> float:
        """Blend SAM's IoU head with how well the mask fills its box.

        A mask that covers 30% of the box may be excellent (a shirt inside a
        person-wide box) or terrible (half a sleeve), so coverage alone is not
        trustworthy. Blending keeps either signal from dominating alone.
        """
        head = 0.5 if predicted_iou is None else float(np.clip(predicted_iou, 0.0, 1.0))
        # Prefer coverage near 0.6-0.9; penalise both extremes softly.
        coverage_term = 1.0 - min(1.0, abs(coverage - 0.75) / 0.75)
        solidity = float(np.count_nonzero(mask)) / max(1.0, float(mask.size))
        return float(np.clip(0.55 * head + 0.30 * coverage_term + 0.15 * solidity, 0.0, 1.0))

    @staticmethod
    def _box_mask(image: np.ndarray, box: BoundingBox) -> np.ndarray:
        height, width = image.shape[:2]
        mask = np.zeros((height, width), dtype=np.uint8)
        x1, y1, x2, y2 = (int(round(v)) for v in box.to_xyxy())
        mask[max(0, y1) : min(height, y2), max(0, x1) : min(width, x2)] = 255
        return mask
