"""Deformable-DETR detector for fashion items.

Model: `yainage90/fashion-object-detection` — a Deformable DETR fine-tuned on
ModaNet + Fashionpedia, MIT licensed, mAP 0.754.

Its vocabulary is only 7 coarse classes (`bag, bottom, dress, hat, shoes,
outer, top`), which is exactly why it is the right first stage: it reliably
answers *is there clothing and roughly where*, and leaves the fine-grained
t-shirt/jeans/jacket split to the zero-shot head. It also fails closed, so a
bottle produces no detections and the pipeline reports "No clothing item
detected" instead of inventing a garment.

Why not YOLO: `ultralytics` (YOLO11, YOLO-World, YOLOE) is AGPL-3.0, which
conflicts with shipping a commercial product, and stock COCO checkpoints have
no clothing classes at all. The `GarmentDetector` protocol keeps that door open
for a commercially licensed model later.
"""

from __future__ import annotations

import time

import cv2
import numpy as np

from ..common.logging import get_logger
from ..models.handles import DetectorHandle
from ..schemas import BoundingBox, DetectedGarment

log = get_logger(__name__)


class FashionDeformableDetrDetector:
    """`GarmentDetector` backed by the MIT fashion Deformable-DETR."""

    def __init__(self, handle: DetectorHandle, *, pad_ratio: float = 0.02) -> None:
        self._handle = handle
        #: Boxes are grown slightly before inference because a garment's
        #: silhouette (sleeves, hems) sits outside its tight object box.
        self._pad_ratio = pad_ratio

    @property
    def name(self) -> str:
        return self._handle.version

    @property
    def labels(self) -> list[str]:
        return self._handle.labels

    # ------------------------------------------------------------------ main --

    def detect(
        self,
        image: np.ndarray,
        *,
        min_score: float = 0.35,
        nms_iou: float = 0.55,
        max_items: int = 8,
        min_area_ratio: float = 0.006,
        max_area_ratio: float = 0.98,
    ) -> list[DetectedGarment]:
        torch = _torch()
        height, width = image.shape[:2]
        image_area = float(height * width)

        boxes, scores, labels = self._forward(image)

        boxes = boxes.cpu().numpy().astype(np.float32)
        scores = scores.cpu().numpy().astype(np.float32)
        labels = labels.cpu().numpy().astype(np.int64)

        # Expand each box toward the frame edges by a small margin.
        if self._pad_ratio:
            pad_x = width * self._pad_ratio
            pad_y = height * self._pad_ratio
            boxes[:, 0] = np.clip(boxes[:, 0] - pad_x, 0, width)
            boxes[:, 1] = np.clip(boxes[:, 1] - pad_y, 0, height)
            boxes[:, 2] = np.clip(boxes[:, 2] + pad_x, 0, width)
            boxes[:, 3] = np.clip(boxes[:, 3] + pad_y, 0, height)

        keep = self._nms(boxes, scores, nms_iou)

        garments: list[DetectedGarment] = []
        for index in keep:
            score = float(scores[index])
            if score < min_score:
                continue
            x1, y1, x2, y2 = (float(v) for v in boxes[index])
            bbox = BoundingBox(x1=x1, y1=y1, x2=x2, y2=y2)
            ratio = bbox.area / image_area
            if ratio < min_area_ratio or ratio > max_area_ratio:
                continue

            label_index = int(labels[index])
            garments.append(
                DetectedGarment(
                    id="",
                    coarse_label=self._handle.id2label.get(label_index, "other"),
                    bbox=bbox,
                    detector_confidence=score,
                    model=self._handle.version,
                    extras={"image_area": image_area, "label_index": label_index},
                )
            )

        garments.sort(key=lambda g: g.bbox.area, reverse=True)
        garments = garments[:max_items]
        for position, garment in enumerate(garments, start=1):
            garment.id = f"garment_{position:03d}"

        if garments:
            log.info(
                "detections",
                model=self._handle.model_id,
                count=len(garments),
                labels=[g.coarse_label for g in garments],
            )
        else:
            log.info("detections", model=self._handle.model_id, count=0)
        return garments

    # -------------------------------------------------------------- internals --

    def _forward(self, image: np.ndarray) -> tuple:
        torch = _torch()
        handle = self._handle
        # The processor expects PIL/array RGB; ours is already RGB uint8.
        inputs = handle.processor(images=image, return_tensors="pt")
        inputs = {key: value.to(handle.device) for key, value in inputs.items()}
        with torch.no_grad():
            outputs = handle.model(**inputs)
        results = handle.processor.post_process_object_detection(
            outputs,
            threshold=0.01,  # throttled later by min_score / NMS / area gates
            target_sizes=torch.tensor([image.shape[:2]], device=handle.device),
        )[0]
        return results["boxes"], results["scores"], results["labels"]

    @staticmethod
    def _nms(boxes: np.ndarray, scores: np.ndarray, iou_threshold: float) -> list[int]:
        """Greedy class-agnostic NMS.

        Deformable DETR is set-prediction and already suppresses duplicates, so
        this only has to merge heavy overlaps the model left behind.
        """
        if boxes.size == 0:
            return []
        order = scores.argsort()[::-1]
        keep: list[int] = []
        while order.size > 0:
            current = int(order[0])
            keep.append(current)
            if order.size == 1:
                break
            rest = order[1:]
            xx1 = np.maximum(boxes[current, 0], boxes[rest, 0])
            yy1 = np.maximum(boxes[current, 1], boxes[rest, 1])
            xx2 = np.minimum(boxes[current, 2], boxes[rest, 2])
            yy2 = np.minimum(boxes[current, 3], boxes[rest, 3])
            inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
            area_current = max(0.0, boxes[current, 2] - boxes[current, 0]) * max(
                0.0, boxes[current, 3] - boxes[current, 1]
            )
            area_rest = np.clip(boxes[rest, 2] - boxes[rest, 0], 0, None) * np.clip(
                boxes[rest, 3] - boxes[rest, 1], 0, None
            )
            union = area_current + area_rest - inter
            iou = np.where(union > 0, inter / np.maximum(union, 1e-6), 0.0)
            order = rest[iou <= iou_threshold]
        return keep


def _torch() -> object:
    import torch

    return torch
