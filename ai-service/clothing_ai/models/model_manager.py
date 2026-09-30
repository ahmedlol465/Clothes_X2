"""Single owner of every pretrained model in the process.

Rules enforced here:

* each model is loaded at most once, even under concurrent requests;
* weights are downloaded once into the project cache and reused across restarts;
* CUDA is used when present, CPU otherwise, and nothing assumes a GPU exists;
* the resolved version strings are returned alongside every result so a
  prediction can be reproduced later.

`configure_torch_cache()` runs at import time, before any model library loads,
so the HuggingFace and torch caches land on the D: volume rather than the boot
drive.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any, Literal

from ..common.logging import get_logger
from ..config import configure_torch_cache, get_settings

configure_torch_cache()

from .handles import (  # noqa: E402  (must follow the cache configuration)
    BackgroundRemovalHandle,
    ClassifierHandle,
    DetectorHandle,
    FashionHandle,
    SegmenterHandle,
)

log = get_logger(__name__)

ComponentName = Literal["detector", "segmenter", "fashion", "secondary", "background"]


class ModelLoadError(RuntimeError):
    """Raised when a model cannot be loaded. The cause is always logged."""


@dataclass(slots=True)
class LoadStats:
    """Milliseconds spent loading, keyed by component. Reported in timings."""

    ms: dict[str, float]

    @property
    def total_ms(self) -> float:
        return sum(self.ms.values())


class ModelManager:
    """Lazy, thread-safe, one-instance-per-model registry."""

    def __init__(self, settings: Any | None = None) -> None:
        self._settings = settings or get_settings()
        self._handles: dict[str, Any] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._global_lock = threading.Lock()
        self._load_ms: dict[str, float] = {}
        self._device = self._settings.resolved_device()
        self._torch: Any | None = None
        self._torch_version = "unavailable"

    # ------------------------------------------------------------------ torch --

    @property
    def device(self) -> str:
        return self._device

    @property
    def torch_version(self) -> str:
        if self._torch is None:
            self._torch = self._import_torch()
        return self._torch_version

    def _import_torch(self) -> Any:
        import torch

        self._torch_version = torch.__version__
        if self._settings.torch_threads > 0:
            torch.set_num_threads(self._settings.torch_threads)
        if self._settings.deterministic:
            torch.use_deterministic_algorithms(False)  # keeps CPU kernels fast
            torch.manual_seed(self._settings.seed)
            np = _numpy()
            np.random.seed(self._settings.seed)
        return torch

    def _lock_for(self, name: str) -> threading.Lock:
        with self._global_lock:
            return self._locks.setdefault(name, threading.Lock())

    def _revision_for(self, model_id: str) -> str:
        """Best-effort commit sha, so results name an exact weight set."""
        try:
            from huggingface_hub import HfApi

            info = HfApi().model_info(model_id)
            return (info.sha or "unknown")[:12]
        except Exception:
            # Offline mode, a local path, or a repo with no public sha.
            return "local"

    # ------------------------------------------------------------- accessors --

    def detector(self) -> DetectorHandle:
        return self._get("detector", self._load_detector)

    def segmenter(self) -> SegmenterHandle:
        return self._get("segmenter", self._load_segmenter)

    def fashion(self) -> FashionHandle:
        return self._get("fashion", self._load_fashion)

    def secondary_classifier(self) -> ClassifierHandle | None:
        if not self._settings.enable_secondary_classifier:
            return None
        return self._get("secondary", self._load_secondary)

    def background_removal(self) -> BackgroundRemovalHandle | None:
        return None  # opt-in only; see `rembg_loader` for the wiring

    def _get(self, name: str, loader: Any) -> Any:
        if name in self._handles:
            return self._handles[name]
        with self._lock_for(name):
            if name in self._handles:  # another thread won the race
                return self._handles[name]
            started = time.perf_counter()
            try:
                handle = loader()
            except Exception as exc:
                log.error("model_load_failed", component=name, error=str(exc), exc_info=True)
                raise ModelLoadError(
                    f"failed to load {name} ({self._settings_for(name)}): {exc}"
                ) from exc
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            self._load_ms[name] = elapsed_ms
            self._handles[name] = handle
            log.info(
                "model_loaded",
                component=name,
                version=handle.version,
                device=self._device,
                load_ms=round(elapsed_ms, 1),
            )
            return handle

    def _settings_for(self, name: str) -> str:
        return {
            "detector": self._settings.detector_model,
            "segmenter": self._settings.segmenter_model,
            "fashion": self._settings.fashion_model,
            "secondary": self._settings.secondary_classifier_model or "?",
        }.get(name, name)

    # --------------------------------------------------------------- loaders --

    def _load_detector(self) -> DetectorHandle:
        torch = self._import_torch()
        from transformers import AutoImageProcessor, AutoModelForObjectDetection

        model_id = self._settings.detector_model
        processor = AutoImageProcessor.from_pretrained(model_id)
        model = AutoModelForObjectDetection.from_pretrained(model_id)
        model.eval()
        model.to(self._device)
        return DetectorHandle(
            model_id=model_id,
            revision=self._revision_for(model_id),
            processor=processor,
            model=model,
            id2label=dict(model.config.id2label),
            device=self._device,
        )

    def _load_segmenter(self) -> SegmenterHandle:
        torch = self._import_torch()
        from transformers import Sam2Model, Sam2Processor

        model_id = self._settings.segmenter_model
        processor = Sam2Processor.from_pretrained(model_id)
        model = Sam2Model.from_pretrained(model_id)
        model.eval()
        model.to(self._device)
        image_size = int(getattr(processor, "image_size", None) or 1024)
        return SegmenterHandle(
            model_id=model_id,
            revision=self._revision_for(model_id),
            processor=processor,
            model=model,
            device=self._device,
            image_size=image_size,
        )

    def _load_fashion(self) -> FashionHandle:
        torch = self._import_torch()
        import open_clip

        model_id = self._settings.fashion_model
        model, _, preprocess = open_clip.create_model_and_transforms(
            model_id, cache_dir=str(self._settings.model_cache_dir / "open_clip")
        )
        model.eval()
        model.to(self._device)
        tokenizer = open_clip.get_tokenizer(model_id)

        embed_dim = int(getattr(model, "embed_dim", 0) or _infer_embed_dim(model))
        return FashionHandle(
            model_id=model_id,
            revision=self._revision_for(_hf_repo_from(model_id)),
            model=model,
            preprocess=preprocess,
            tokenizer=tokenizer,
            embed_dim=embed_dim,
            device=self._device,
        )

    def _load_secondary(self) -> ClassifierHandle:
        self._import_torch()
        from transformers import AutoImageProcessor, AutoModelForImageClassification

        model_id = self._settings.secondary_classifier_model
        if not model_id:
            raise ModelLoadError("secondary_classifier_model is not configured")
        processor = AutoImageProcessor.from_pretrained(model_id)
        model = AutoModelForImageClassification.from_pretrained(model_id)
        model.eval()
        model.to(self._device)
        return ClassifierHandle(
            model_id=model_id,
            revision=self._revision_for(model_id),
            processor=processor,
            model=model,
            id2label=dict(model.config.id2label),
            device=self._device,
        )

    # ------------------------------------------------------------ warm-up ----

    def warm_up(self, components: tuple[ComponentName, ...] = ("detector", "segmenter", "fashion")) -> LoadStats:
        """Force the given components to load, timing each one."""
        accessors: dict[str, Any] = {
            "detector": self.detector,
            "segmenter": self.segmenter,
            "fashion": self.fashion,
            "secondary": self.secondary_classifier,
        }
        for name in components:
            accessors[name]()
        return LoadStats(ms=dict(self._load_ms))

    def load_stats(self) -> LoadStats:
        return LoadStats(ms=dict(self._load_ms))

    def release(self) -> None:
        """Drop every handle. Only used by tests and by the offline switch."""
        self._handles.clear()

    def is_loaded(self, name: str) -> bool:
        return name in self._handles


def _numpy() -> Any:
    import numpy as np

    return np


def _hf_repo_from(model_id: str) -> str:
    """`hf-hub:owner/name` -> `owner/name`; anything else passes through."""
    return model_id.split(":", 1)[1] if model_id.startswith("hf-hub:") else model_id


def _infer_embed_dim(model: Any) -> int:
    """Determine the embedding width for a model that does not declare it.

    `Marqo/marqo-fashionSigLIP` has no `embed_dim`, and its vision tower is a
    timm `TimmModel` rather than open_clip's usual `VisionTransformer`, so the
    obvious attribute probes all miss. Each path below is checked in order of
    how directly it answers the question; the last resort runs one real forward
    pass, because a measured width is better than a plausible-looking guess and
    this runs once per process.
    """
    for holder, attribute in (
        (model, "text_projection"),
        (model, "visual"),
        (model.visual if hasattr(model, "visual") else None, "trunk"),
    ):
        if holder is None:
            continue
        weight = getattr(getattr(holder, attribute, None), "weight", None)
        if weight is not None and hasattr(weight, "shape"):
            shape = tuple(weight.shape)
            # A `Linear(in, out)` is stored as (out, in), so the *input* side is
            # the projection width. A bare `Parameter` is already the vector.
            return int(shape[1]) if len(shape) == 2 else int(shape[0])

    # SigLIP via timm: the pooled trunk output is the embedding, and the head is
    # an empty `Sequential`, so the trunk width is the model's width.
    trunk = getattr(getattr(model, "visual", None), "trunk", None)
    for attribute in ("embed_dim", "num_features"):
        value = getattr(trunk, attribute, None)
        if isinstance(value, int) and value > 0:
            return value

    width = _probe_embed_dim(model)
    if width:
        return width
    raise ModelLoadError("could not determine the embedding dimension of the fashion model")


def _probe_embed_dim(model: Any) -> int | None:
    """Encode a blank image and read the width off the result."""
    try:
        import torch

        with torch.no_grad():
            output = model.encode_image(torch.zeros(1, 3, 224, 224))
        return int(output.shape[-1])
    except Exception:  # noqa: BLE001 - probing is best-effort by definition
        return None


_manager: ModelManager | None = None
_manager_lock = threading.Lock()


def get_model_manager(settings: Any | None = None) -> ModelManager:
    """Process-wide singleton."""
    global _manager
    if _manager is None:
        with _manager_lock:
            if _manager is None:
                _manager = ModelManager(settings)
    return _manager


def reset_model_manager() -> None:
    """Testing hook: drop the singleton so the next call re-reads settings."""
    global _manager
    with _manager_lock:
        if _manager is not None:
            _manager.release()
        _manager = None
