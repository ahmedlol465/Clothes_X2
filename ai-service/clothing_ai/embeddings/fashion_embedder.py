"""Stage 4c — fashion embeddings.

Marqo-FashionSigLIP produces 768-d L2-normalised vectors. They are stored
separately from the textual attributes because they serve a different purpose:
similarity search, duplicate detection, clustering and eventual fine-tuning
data all consume the vector without ever needing the words.

Embeddings are computed from the *masked* garment, not the raw crop. That is
what makes the same jacket photographed on a hanger and on a person produce
vectors close enough to be recognised as a duplicate.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np

from ..common.logging import get_logger

log = get_logger(__name__)

#: Verified from open_clip_config.json (`"embed_dim": 768`) for
#: Marqo/marqo-fashionSigLIP, a ViT-B-16-SigLIP fine-tune.
FASHIONSIGLIP_EMBED_DIM = 768


@runtime_checkable
class FashionEmbedder(Protocol):
    @property
    def model_version(self) -> str: ...

    @property
    def dimension(self) -> int: ...

    def embed(self, image: np.ndarray, mask: np.ndarray | None = None) -> np.ndarray: ...


class SiglipFashionEmbedder:
    """`FashionEmbedder` backed by the FashionSigLIP image tower."""

    def __init__(self, handle: object, *, background: tuple[int, int, int] = (127, 127, 127)) -> None:
        self._handle = handle
        self._background = background
        self._dimension = int(getattr(handle, "embed_dim", FASHIONSIGLIP_EMBED_DIM))

    @property
    def model_version(self) -> str:
        return str(getattr(self._handle, "version", "unknown"))

    @property
    def dimension(self) -> int:
        return self._dimension

    def embed(self, image: np.ndarray, mask: np.ndarray | None = None) -> np.ndarray:
        """Return an L2-normalised embedding of shape `(dimension,)`."""
        prepared = self._apply_mask(image, mask)
        features = self._encode(prepared)
        return self.normalise(features)

    def embed_batch(self, images: list[np.ndarray], masks: list[np.ndarray | None] | None = None) -> np.ndarray:
        """Embed several garments, returning `(n, dimension)`."""
        if not images:
            return np.zeros((0, self._dimension), dtype=np.float32)
        prepared = [
            self._apply_mask(image, masks[index] if masks else None)
            for index, image in enumerate(images)
        ]
        features = self._encode_batch(prepared)
        return self.normalise(features)

    # -------------------------------------------------------------- internals --

    def _apply_mask(self, image: np.ndarray, mask: np.ndarray | None) -> np.ndarray:
        """Flatten the background to a neutral grey.

        The models are trained on square product shots, so compositing the
        garment onto a flat background is closer to the training distribution
        than leaving a cluttered room in frame. It also stops the embedding
        from encoding the photographer's kitchen.
        """
        if mask is None:
            return image
        import cv2

        binary = (np.asarray(mask) > 127).astype(np.uint8)
        if binary.shape[:2] != image.shape[:2]:
            binary = cv2.resize(
                binary, (image.shape[1], image.shape[0]), interpolation=cv2.INTER_NEAREST
            )
        # Feather the edge by a few pixels so the model does not see a hard
        # aliased cut, which reads as a sharp garment boundary.
        feathered = cv2.GaussianBlur(binary.astype(np.float32), (0, 0), sigmaX=2.0)
        alpha = feathered[:, :, None]
        background = np.array(self._background, dtype=np.float32)[None, None, :]
        return (image.astype(np.float32) * alpha + background * (1.0 - alpha)).astype(np.uint8)

    @staticmethod
    def _to_pil(image: np.ndarray):
        """open_clip's transform ends in `ToTensor`, which only accepts PIL.

        Passing a numpy array raises deep inside torchvision's resize. Callers
        swallow encode failures, so the visible symptom is silently missing
        embeddings and worse matching rather than a crash, which is why the
        conversion is made explicit instead of left to the transform.
        """
        from PIL import Image

        return Image.fromarray(np.ascontiguousarray(image), mode="RGB")

    def _encode(self, image: np.ndarray):
        import torch

        tensor = self._handle.preprocess(self._to_pil(image))  # type: ignore[attr-defined]
        if tensor.ndim == 3:
            tensor = tensor.unsqueeze(0)
        with torch.no_grad():
            return self._handle.model.encode_image(  # type: ignore[attr-defined]
                tensor.to(self._handle.device),  # type: ignore[attr-defined]
                normalize=True,
            )

    def _encode_batch(self, images: list[np.ndarray]):
        import torch

        tensors = [
            self._handle.preprocess(self._to_pil(image))  # type: ignore[attr-defined]
            for image in images
        ]
        batch = torch.stack(tensors).to(self._handle.device)  # type: ignore[attr-defined]
        with torch.no_grad():
            return self._handle.model.encode_image(  # type: ignore[attr-defined]
                batch, normalize=True
            )

    @staticmethod
    def normalise(features) -> np.ndarray:
        """Re-normalise after a `tolist()` round trip.

        open_clip already normalises, but the value that gets persisted to
        `wardrobe_items.embeddings` as JSON loses precision and the cosine
        similarity of two stored vectors drifts. Re-normalising at the boundary
        keeps similarity search honest.
        """
        array = features.float().cpu().numpy().astype(np.float32)
        if array.ndim == 2:
            norms = np.linalg.norm(array, axis=1, keepdims=True)
            return array / np.maximum(norms, 1e-8)
        norm = float(np.linalg.norm(array))
        return array / max(norm, 1e-8)

    def to_list(self, vector: np.ndarray, *, round_to: int = 6) -> list[float]:
        """Serialise for storage. 6 decimals is well inside float32 noise."""
        return [round(float(value), round_to) for value in np.asarray(vector, dtype=np.float32).ravel()]


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity of two embeddings; 1.0 means identical."""
    a = np.asarray(a, dtype=np.float32).ravel()
    b = np.asarray(b, dtype=np.float32).ravel()
    denominator = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denominator <= 0:
        return 0.0
    return float(np.dot(a, b) / denominator)
