"""Typed handles for the loaded models.

Stages receive these rather than reaching for `from_pretrained` themselves, so
there is exactly one instance of each model in the process and a stage can be
pointed at a different handle in tests without touching disk.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np


@dataclass(frozen=True, slots=True)
class DetectorHandle:
    """A loaded object detector."""

    model_id: str
    revision: str
    processor: Any
    model: Any
    id2label: dict[int, str]
    device: str
    kind: str = "transformers-object-detection"

    @property
    def version(self) -> str:
        return f"{self.model_id}@{self.revision}"

    @property
    def labels(self) -> list[str]:
        return [self.id2label[index] for index in sorted(self.id2label)]


@dataclass(frozen=True, slots=True)
class SegmenterHandle:
    """A promptable segmentation model."""

    model_id: str
    revision: str
    processor: Any
    model: Any
    device: str
    kind: str = "sam2"
    image_size: int = 1024

    @property
    def version(self) -> str:
        return f"{self.model_id}@{self.revision}"


@dataclass(frozen=True, slots=True)
class FashionHandle:
    """A zero-shot-capable vision-language model (open_clip)."""

    model_id: str
    revision: str
    model: Any
    preprocess: Any
    tokenizer: Any
    embed_dim: int
    device: str
    kind: str = "open_clip"
    #: Cached token embeddings keyed by tuple of prompts, so a label set is
    #: encoded once per process rather than once per garment.
    _text_cache: dict[tuple[str, ...], Any] = field(default_factory=dict, repr=False)

    @property
    def version(self) -> str:
        return f"{self.model_id}@{self.revision}"


@dataclass(frozen=True, slots=True)
class ClassifierHandle:
    """A flat supervised image classifier (optional secondary voter)."""

    model_id: str
    revision: str
    processor: Any
    model: Any
    id2label: dict[int, str]
    device: str
    kind: str = "transformers-image-classification"

    @property
    def version(self) -> str:
        return f"{self.model_id}@{self.revision}"

    @property
    def labels(self) -> list[str]:
        return [self.id2label[index] for index in sorted(self.id2label)]


@dataclass(frozen=True, slots=True)
class BackgroundRemovalHandle:
    """Optional rembg session."""

    model_id: str
    revision: str
    session: Any
    device: str = "cpu"
    kind: str = "rembg"

    @property
    def version(self) -> str:
        return f"{self.model_id}@{self.revision}"


ModelLoader = Callable[[], Any]
