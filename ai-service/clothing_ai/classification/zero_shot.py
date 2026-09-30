"""Zero-shot classification with Marqo-FashionSigLIP.

Model: `Marqo/marqo-fashionSigLIP` (Apache-2.0), loaded through open_clip.
Fine-tuned from ViT-B-16-SigLIP, 768-d embeddings, 224px input, mean/std 0.5.

This head is deliberately the *second* classifier, not the first. FashionSigLIP
will happily call a bottle a t-shirt if the candidate list is restricted to
garments, so the detector runs first and gates the candidate set. That ordering
is the whole reason the pipeline can say "no clothing item detected".

The candidate labels come from `config/labels.yaml`, never from a literal in
this file.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np

from ..common.logging import get_logger
from ..config.vocabulary import AttributeVocabulary, LabelSpec
from ..models.handles import FashionHandle
from ..schemas import AttributePrediction

log = get_logger(__name__)

#: Softmax temperature applied to cosine similarities. The model card uses 100x
#: logits (`100.0 * image @ text.T`); open_clip SigLIP configs ship
#: `init_logit_bias: -10` for the same reason. This is the logit scale, not an
#: arbitrary sharpness knob.
LOGIT_SCALE = 100.0

#: Keeps `exp` from overflowing on low-precision devices.
_MAX_SIMILARITY = 100.0 - 1e-4


@dataclass(frozen=True, slots=True)
class ZeroShotResult:
    scores: dict[str, float]
    top_k: list[tuple[str, float]]
    entropy: float
    margin: float

    @property
    def best(self) -> tuple[str, float]:
        return self.top_k[0]


class ZeroShotClassifier:
    """Reusable zero-shot head over a FashionSigLIP handle."""

    def __init__(self, handle: FashionHandle) -> None:
        self._handle = handle

    @property
    def name(self) -> str:
        return self._handle.version

    @property
    def embed_dim(self) -> int:
        return self._handle.embed_dim

    # ------------------------------------------------------------------ image --

    def _preprocess(self, image: np.ndarray) -> "object":
        """RGB uint8 HxWx3 -> the model's normalised input tensor.

        open_clip's transform ends in `ToTensor`, which only accepts PIL images.
        Handing it a numpy array raises `TypeError: Unexpected type`, and because
        the pipeline treats an encode failure as "this garment gets no zero-shot
        attributes", the symptom is a silently much worse wardrobe rather than a
        crash. Stubs do not catch this because they never build a real
        transform, so the conversion belongs here rather than at the call site.
        """
        from PIL import Image

        pil = Image.fromarray(np.ascontiguousarray(image), mode="RGB")
        tensor = self._handle.preprocess(pil)
        if tensor.ndim == 3:
            tensor = tensor.unsqueeze(0)
        return tensor.to(self._handle.device)

    def encode_image(self, image: np.ndarray) -> "object":
        """RGB uint8 HxWx3 -> L2-normalised image embedding (1, D)."""
        import torch

        tensor = self._preprocess(image)
        with torch.no_grad():
            features = self._handle.model.encode_image(tensor, normalize=True)
        return features

    def encode_text(self, prompts: Sequence[str]) -> "object":
        """Prompts -> L2-normalised text embeddings, cached per prompt tuple.

        Encoding a 22-label vocabulary takes ~40 ms on CPU; caching it means a
        four-garment image encodes the labels once, not four times.
        """
        import torch

        key = tuple(prompts)
        cached = self._handle._text_cache.get(key)
        if cached is not None:
            return cached
        tokens = self._handle.tokenizer(list(prompts)).to(self._handle.device)
        with torch.no_grad():
            features = self._handle.model.encode_text(tokens, normalize=True)
        self._handle._text_cache[key] = features
        return features

    def clear_text_cache(self) -> None:
        self._handle._text_cache.clear()

    # ------------------------------------------------------------ classify ----

    def classify(
        self,
        image: np.ndarray,
        labels: Sequence[LabelSpec],
        *,
        precomputed_image: "object | None" = None,
        top_k: int = 3,
    ) -> ZeroShotResult:
        """Score `labels` against `image`.

        `precomputed_image` lets a caller embed the crop once and reuse it for
        the category, material, pattern and style heads.
        """
        import torch

        if not labels:
            raise ValueError("zero-shot classification needs at least one label")

        image_features = precomputed_image if precomputed_image is not None else self.encode_image(image)
        text_features = self.encode_text([label.prompt for label in labels])

        with torch.no_grad():
            similarities = (image_features @ text_features.T).clamp(max=_MAX_SIMILARITY)
            probabilities = (LOGIT_SCALE * similarities).softmax(dim=-1)[0]

        values = probabilities.float().cpu().numpy().astype(np.float64)
        total = float(values.sum()) or 1.0
        values = values / total

        scores = {label.value: float(value) for label, value in zip(labels, values)}
        order = np.argsort(values)[::-1]
        top = [(labels[int(i)].value, float(values[int(i)])) for i in order[:top_k]]

        # Entropy over the candidate set, normalised by log(k). A flat
        # distribution means the head is guessing, which is the signal the
        # confidence layer needs to trigger a retry.
        raw_entropy = float(-(values * np.log(values + 1e-12)).sum())
        normalised_entropy = raw_entropy / float(np.log(len(labels))) if len(labels) > 1 else 0.0
        margin = top[0][1] - (top[1][1] if len(top) > 1 else 0.0)

        return ZeroShotResult(
            scores=scores,
            top_k=top,
            entropy=float(np.clip(normalised_entropy, 0.0, 1.0)),
            margin=float(margin),
        )

    def predict(
        self,
        image: np.ndarray,
        attribute: str,
        vocabulary: AttributeVocabulary,
        *,
        allowed: Sequence[str] | None = None,
        precomputed_image: "object | None" = None,
        top_k: int = 3,
    ) -> AttributePrediction:
        """Typed convenience wrapper returning an `AttributePrediction`."""
        spec = vocabulary[attribute]
        labels = [label for label in spec if allowed is None or label.value in allowed]
        if not labels:
            # The gate excluded everything; fall back to the full vocabulary
            # rather than returning nothing.
            labels = list(spec)

        result = self.classify(
            image, labels, precomputed_image=precomputed_image, top_k=top_k
        )
        value, confidence = result.best
        capped = min(confidence, spec.confidence_cap)
        return AttributePrediction(
            value=value,
            confidence=float(capped),
            source=self.name,
            scores={k: round(v, 5) for k, v in result.scores.items()},
            alternatives=[name for name, _ in result.top_k[1:]],
        )


def softmax_confidence(scores: dict[str, float], value: str) -> float:
    """Read a confidence straight out of a stored score distribution."""
    return float(scores.get(value, 0.0))


class SecondaryClassifier:
    """Optional flat supervised classifier used as a second opinion.

    Off by default. `wargoninnovation/wargon-clothing-classifier` reports 73%
    validation accuracy, so it is only ever allowed to *corroborate* a
    FashionSigLIP call, never to override it.
    """

    def __init__(self, handle: object) -> None:
        self._handle = handle

    @property
    def name(self) -> str:
        return getattr(self._handle, "version", "unknown")  # type: ignore[attr-defined]

    def predict(self, image: np.ndarray, top_k: int = 3) -> list[tuple[str, float]]:
        import torch

        handle = self._handle
        from PIL import Image

        pil_image = Image.fromarray(image)
        inputs = handle.processor(images=pil_image, return_tensors="pt")  # type: ignore[attr-defined]
        inputs = {key: value.to(handle.device) for key, value in inputs.items()}  # type: ignore[attr-defined]
        with torch.no_grad():
            logits = handle.model(**inputs).logits  # type: ignore[attr-defined]
        probabilities = torch.softmax(logits, dim=-1)[0].float().cpu().numpy()
        id2label: dict[int, str] = handle.id2label  # type: ignore[attr-defined]
        order = np.argsort(probabilities)[::-1][:top_k]
        return [(id2label[int(i)], float(probabilities[int(i)])) for i in order]
