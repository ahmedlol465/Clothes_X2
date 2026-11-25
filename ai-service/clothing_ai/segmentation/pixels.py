"""Garment-pixel mosaic: the colour step's view of a photo.

Detects the largest garment, cuts it out with SAM 2 and returns only the
garment's pixels (edges trimmed, shuffled into a square). The Node backend
reads the colour from this image, so skin, hair and background cannot vote.

Measured on 57 hand-labelled worn photos: colour family 67% -> 79%. The models
load on first use and are shared. Any failure returns None and the caller
falls back to the original photo.
"""

from __future__ import annotations

import os
import threading

import numpy as np
from PIL import Image

DETECTOR = "yainage90/fashion-object-detection"
SEGMENTER = "facebook/sam2.1-hiera-tiny"
DETECT_THRESHOLD = 0.35
# Detector input size. 384 px instead of the default 800: detector time 1.8 s -> 0.4 s,
# colour family on 57 labelled photos 45/57 -> 44/57 (within noise).
DETECT_SHORT_EDGE = 384
ERODE_PIXELS = 3
MIN_PIXELS = 200

_lock = threading.Lock()
_models: dict = {}


def _load():
    if _models:
        return _models
    import torch
    from transformers import (
        AutoImageProcessor,
        AutoModelForObjectDetection,
        Sam2Model,
        Sam2Processor,
    )

    # One thread on a 1-core box; more cores make this much faster. Override with GARMENT_THREADS.
    torch.set_num_threads(int(os.environ.get("GARMENT_THREADS", 0)) or min(4, os.cpu_count() or 1))
    _models["torch"] = torch
    _models["dp"] = AutoImageProcessor.from_pretrained(DETECTOR)
    _models["dm"] = AutoModelForObjectDetection.from_pretrained(DETECTOR).eval()
    _models["sp"] = Sam2Processor.from_pretrained(SEGMENTER)
    _models["sm"] = Sam2Model.from_pretrained(SEGMENTER).eval()
    return _models


def preload() -> None:
    """Load the models now, so the first photo does not pay for it."""
    with _lock:
        _load()


def garment_pixel_mosaic(image: Image.Image) -> Image.Image | None:
    """Square image made only of garment pixels, or None when no garment found."""
    from scipy.ndimage import binary_erosion

    with _lock:
        m = _load()
        torch, dp, dm, sp, sm = m["torch"], m["dp"], m["dm"], m["sp"], m["sm"]
        im = image.convert("RGB")
        width, height = im.size
        with torch.no_grad():
            out = dm(
                **dp(
                    images=im,
                    return_tensors="pt",
                    size={"shortest_edge": DETECT_SHORT_EDGE, "longest_edge": DETECT_SHORT_EDGE * 2},
                )
            )
            det = dp.post_process_object_detection(
                out, threshold=DETECT_THRESHOLD, target_sizes=torch.tensor([[height, width]])
            )[0]
        if len(det["boxes"]) == 0:
            return None
        boxes = det["boxes"].numpy()
        areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
        box = boxes[int(areas.argmax())].tolist()
        inputs = sp(images=im, input_boxes=[[box]], return_tensors="pt")
        with torch.no_grad():
            seg = sm(**inputs, multimask_output=True)
        masks = sp.post_process_masks(seg.pred_masks.cpu(), inputs["original_sizes"].cpu())[0][0]
        scores = seg.iou_scores.flatten().tolist()

    in_box = np.zeros((height, width), bool)
    x1, y1, x2, y2 = (int(v) for v in box)
    in_box[max(0, y1):y2, max(0, x1):x2] = True
    best = None
    for k in range(masks.shape[0]):
        mask = masks[k].numpy() > 0
        coverage = (mask & in_box).sum() / max(1, in_box.sum())
        score = scores[k] * (1.0 if 0.08 < coverage < 0.99 else 0.1)
        if best is None or score > best[0]:
            best = (score, mask)
    mask = best[1]
    if mask.sum() < 64:
        return None
    trimmed = binary_erosion(mask, iterations=ERODE_PIXELS)
    if trimmed.sum() < MIN_PIXELS:
        trimmed = mask
    pixels = np.array(im)[trimmed]
    side = int(len(pixels) ** 0.5)
    if side < 8:
        return None
    rng = np.random.default_rng(0)
    rng.shuffle(pixels)
    return Image.fromarray(pixels[: side * side].reshape(side, side, 3))
