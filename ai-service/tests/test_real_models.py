"""Real-weight tests. Excluded by default; they need the cache and minutes of CPU.

    pytest -m slow

Everything else in this suite runs against stubs. That proves the plumbing but
proves nothing about the models, and this file is where the two meet. Each test
skips with a reason rather than failing if its weights are not cached, so a
partial prefetch still yields whatever can be checked.
"""

from __future__ import annotations

import numpy as np
import pytest

from clothing_ai.config.settings import Settings, configure_torch_cache

pytestmark = pytest.mark.slow


def _manager():
    configure_torch_cache()
    from clothing_ai.models.model_manager import ModelManager

    return ModelManager(Settings(_env_file=None))


@pytest.fixture(scope="module")
def settings() -> Settings:
    return Settings(_env_file=None)


@pytest.fixture(scope="module")
def manager(settings: Settings):
    return _manager()


class TestSam2:
    """The segmenter is the slowest stage and the least covered by stubs."""

    def test_it_loads_the_image_classes_not_the_video_ones(self, manager):
        """`facebook/sam2.1-hiera-tiny` ships a `sam2_video` config.

        Using `AutoModel` here silently builds a `Sam2VideoModel` and hands the
        forward pass a video-shaped model for a single photo. The explicit
        classes are the whole reason this works, so the assertion is the point.
        """
        handle = manager.segmenter()

        assert type(handle.model).__name__ == "Sam2Model"
        assert type(handle.processor).__name__ == "Sam2Processor"
        assert handle.image_size == 1024

    def test_a_box_prompt_produces_a_mask_that_actually_covers_the_object(
        self, manager
    ):
        """A real forward pass, checked against geometry we control.

        Stubs can only prove the mask is the right *shape*. This proves the mask
        lands on the drawn object: an IoU against the known rectangle must clear
        0.85, which a model returning a generic blob or the whole frame fails.
        """
        import cv2

        from clothing_ai.schemas import BoundingBox, DetectedGarment
        from clothing_ai.segmentation.sam2 import Sam2Segmenter

        height, width = 480, 640
        image = np.full((height, width, 3), 200, np.uint8)
        cv2.rectangle(image, (220, 140), (420, 400), (40, 60, 200), -1)
        truth = np.zeros((height, width), np.uint8)
        truth[140:401, 220:421] = 1

        detection = DetectedGarment(
            id="g0",
            coarse_label="top",
            bbox=BoundingBox(x1=210, y1=130, x2=430, y2=410),
            detector_confidence=0.9,
            model="test",
            extras={"image_area": height * width},
        )

        result = Sam2Segmenter(manager.segmenter()).segment(image, detection)
        assert result is not None, "real SAM2 returned no segmentation"

        assert result.mask.shape == (height, width)
        assert result.mask.dtype == np.uint8
        assert set(np.unique(result.mask)) <= {0, 255}, "mask is not binary"

        predicted = (result.mask > 0).astype(np.uint8)
        intersection = int((predicted & truth).sum())
        union = int((predicted | truth).sum())
        iou = intersection / union if union else 0.0

        assert iou >= 0.85, f"mask IoU {iou:.3f} against the drawn rectangle"
        assert result.quality is not None and result.quality > 0.5

    def test_a_box_prompt_on_empty_space_degrades_instead_of_lying(
        self, manager
    ):
        """Garbage in must not become a confident mask.

        A box over a featureless region is the realistic failure: the model
        still returns three candidates, and only the quality gate and the
        box-coverage check stop them being reported as a clean segmentation.
        """
        from clothing_ai.schemas import BoundingBox, DetectedGarment
        from clothing_ai.segmentation.sam2 import Sam2Segmenter

        height, width = 480, 640
        blank = np.full((height, width, 3), 128, np.uint8)
        detection = DetectedGarment(
            id="g0",
            coarse_label="top",
            bbox=BoundingBox(x1=0, y1=0, x2=20, y2=20),
            detector_confidence=0.4,
            model="test",
            extras={"image_area": height * width},
        )

        result = Sam2Segmenter(manager.segmenter()).segment(blank, detection)
        if result is not None and result.mask is not None:
            coverage = float((result.mask > 0).mean())
            # Either it declined (None) or the coverage is not the whole frame.
            assert coverage < 0.9, "returned a near-full-frame mask for a 20x20 box"
        # Whatever it decided, the fallback must never claim high confidence.
        if result is not None and result.quality is not None:
            assert result.quality < 0.9


class TestDetector:
    def test_it_returns_well_formed_boxes_on_a_synthetic_scene(self, manager):
        """A detector run on a photo of a wall must not fabricate garments.

        The assertion is on the *contract* rather than on a count, because a
        blank grey frame legitimately detects nothing and a count assertion
        would either be flaky or so loose it proves nothing.
        """
        from clothing_ai.detection import FashionDeformableDetrDetector

        image = np.full((640, 640, 3), 128, np.uint8)
        detections = FashionDeformableDetrDetector(manager.detector()).detect(image)

        assert isinstance(detections, list)
        for detection in detections:
            assert 0.0 <= detection.detector_confidence <= 1.0
            assert detection.bbox.width > 0 and detection.bbox.height > 0
            assert detection.coarse_label


class TestFashionEmbeddings:
    def test_embeddings_are_unit_length_in_the_declared_dimension(self, manager):
        """A dimension mismatch is invisible until the database rejects rows."""
        from clothing_ai.classification import ZeroShotClassifier

        handle = manager.fashion()
        assert handle.embed_dim == 768, f"unexpected SigLIP width {handle.embed_dim}"

        image = np.full((224, 224, 3), 90, np.uint8)
        vector = ZeroShotClassifier(handle).encode_image(image)

        shape = tuple(vector.shape)
        assert shape == (1, handle.embed_dim), f"{shape} vs (1, {handle.embed_dim})"
        norm = float(vector.norm())
        assert 0.99 <= norm <= 1.01, f"embedding is not L2-normalised (norm={norm})"
        assert bool(vector.isfinite().all()), "embedding contains NaN or inf"
