"""Image decoding, resizing and EXIF handling."""

from __future__ import annotations

import io
from dataclasses import dataclass

import cv2
import numpy as np

from ..common.logging import get_logger

log = get_logger(__name__)


class ImageDecodeError(ValueError):
    """Raised when the uploaded bytes are not a decodable image."""


@dataclass(frozen=True, slots=True)
class DecodedImage:
    """A ready-to-analyse RGB uint8 image plus the geometry that produced it."""

    image: np.ndarray
    original_size: tuple[int, int]  # (width, height) before any resize
    scale: float = 1.0

    @property
    def size(self) -> tuple[int, int]:
        return self.original_size

    @property
    def shape(self) -> tuple[int, int, int]:
        return self.image.shape  # type: ignore[return-value]

    @property
    def area(self) -> int:
        return int(self.image.shape[0] * self.image.shape[1])

    def crop(self, x1: float, y1: float, x2: float, y2: float, pad: int = 0) -> np.ndarray:
        """Crop with clamping. `pad` grows the box, then re-clamps."""
        height, width = self.image.shape[:2]
        x1 = int(max(0, min(width - 1, np.floor(x1) - pad)))
        y1 = int(max(0, min(height - 1, np.floor(y1) - pad)))
        x2 = int(max(x1 + 1, min(width, np.ceil(x2) + pad)))
        y2 = int(max(y1 + 1, min(height, np.ceil(y2) + pad)))
        return self.image[y1:y2, x1:x2]


def decode_image(
    data: bytes,
    *,
    max_dimension: int = 2048,
    enforce_aspect: bool = True,
) -> DecodedImage:
    """Decode bytes to RGB, applying EXIF rotation and bounding the long edge.

    Mobile uploads are routinely portrait with an EXIF orientation tag; ignoring
    it rotates the garment 90 degrees and quietly destroys detection accuracy.
    """
    if not data:
        raise ImageDecodeError("empty upload")

    buffer = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise ImageDecodeError("file is not a decodable image (jpg, png, webp or heic)")

    # IMREAD_COLOR yields BGR.
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    original_w, original_h = rgb.shape[1], rgb.shape[0]
    scale = 1.0
    if max_dimension and max(rgb.shape[:2]) > max_dimension:
        ratio = max_dimension / float(max(rgb.shape[:2]))
        new_w = max(1, int(round(original_w * ratio)))
        new_h = max(1, int(round(original_h * ratio)))
        interpolation = cv2.INTER_AREA if ratio < 1.0 else cv2.INTER_CUBIC
        rgb = cv2.resize(rgb, (new_w, new_h), interpolation=interpolation)
        scale = ratio

    if enforce_aspect:
        rgb = apply_exif_orientation(rgb, data)

    log.debug(
        "image_decoded",
        original=f"{original_w}x{original_h}",
        analysed=f"{rgb.shape[1]}x{rgb.shape[0]}",
        scale=round(scale, 4),
    )
    return DecodedImage(image=rgb, original_size=(original_w, original_h), scale=scale)


def apply_exif_orientation(image: np.ndarray, data: bytes) -> np.ndarray:
    """Rotate to match the EXIF Orientation tag, if PIL can read one."""
    try:
        from PIL import Image, ExifTags

        with Image.open(io.BytesIO(data)) as pil_image:
            exif = pil_image.getexif()
            if not exif:
                return image
            orientation = exif.get(ExifTags.Base.Orientation)
    except Exception:  # pragma: no cover - EXIF is best-effort metadata
        return image

    # Normalise any EXIF orientation to the equivalent cv2 rotation.
    operations = {
        2: cv2.flip,
        3: cv2.rotate,
        4: cv2.flip,
        5: cv2.rotate,
        6: cv2.rotate,
        7: cv2.rotate,
        8: cv2.rotate,
    }
    if orientation not in operations:
        return image
    if orientation == 2:
        return cv2.flip(image, 1)
    if orientation == 4:
        return cv2.flip(image, 0)
    if orientation == 3:
        return cv2.rotate(image, cv2.ROTATE_180)
    if orientation == 6:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    if orientation == 8:
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    if orientation == 5:  # transpose
        return cv2.rotate(cv2.flip(image, 1), cv2.ROTATE_90_COUNTERCLOCKWISE)
    if orientation == 7:  # transverse
        return cv2.rotate(cv2.flip(image, 0), cv2.ROTATE_90_CLOCKWISE)
    return image


def encode_png(image: np.ndarray) -> bytes:
    """Encode an RGB array as PNG bytes (used to ship crops to the detector)."""
    ok, buffer = cv2.imencode(".png", cv2.cvtColor(image, cv2.COLOR_RGB2BGR))
    if not ok:  # pragma: no cover - cv2 only fails on malformed arrays
        raise ImageDecodeError("failed to encode image")
    return buffer.tobytes()
