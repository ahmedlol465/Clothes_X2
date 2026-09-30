"""Runtime settings.

Every knob is an environment variable with a safe default, so the service runs
with no configuration at all. Values that must never be guessed (model ids,
paths, thresholds) live here rather than scattered through the stages.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: The levels `log_level` may name, after normalisation.
LOG_LEVELS = ("debug", "info", "warning", "error", "critical")

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = PACKAGE_ROOT.parent


class Settings(BaseSettings):
    """Environment-driven configuration, prefixed with ``CLOTHING_AI_``."""

    model_config = SettingsConfigDict(
        env_prefix="CLOTHING_AI_",
        env_file=os.getenv("CLOTHING_AI_ENV_FILE", str(PROJECT_ROOT / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )
    # ------------------------------------------------------------- runtime --

    # Accepts any case: `LOG_LEVEL=INFO` is what everyone writes, and failing
    # at startup over the capitalisation of a log level is a bad trade for
    # strictness here. Normalised in the validator below.
    log_level: str = Field(default="info", description="debug|info|warning|error|critical")
    log_json: bool = False
    device: Literal["auto", "cpu", "cuda"] = "auto"
    torch_threads: int = 0  # 0 = leave torch's own default alone.
    deterministic: bool = Field(
        True, description="Fix RNG seeds so KMeans and sampling are reproducible."
    )
    seed: int = 20260929

    # ------------------------------------------------------------- storage --
    # Absolute paths are never hard-coded; these resolve relative to the
    # ai-service directory unless overridden.
    data_dir: Path = PROJECT_ROOT / "data"
    model_cache_dir: Path = PROJECT_ROOT / ".model-cache"
    annotations_file: Path = PROJECT_ROOT / "data" / "annotations" / "dataset.json"
    labels_file: Path = PACKAGE_ROOT / "config" / "labels.yaml"
    validation_rules_file: Path = PACKAGE_ROOT / "config" / "validation_rules.yaml"

    # -------------------------------------------------------------- models --
    detector_model: str = "yainage90/fashion-object-detection"
    segmenter_model: str = "facebook/sam2.1-hiera-tiny"
    fashion_model: str = "hf-hub:Marqo/marqo-fashionSigLIP"
    # Optional secondary category voter, off by default. It self-reports 73%
    # validation accuracy, so it is a weak signal by construction.
    secondary_classifier_model: str | None = None
    enable_secondary_classifier: bool = False

    offline: bool = False
    eager_load: bool = Field(
        True,
        description="Load every model at startup. Models load once either way; "
        "this only moves the cost from first request to boot.",
    )

    # ------------------------------------------------------------- limits --
    max_upload_bytes: int = 12 * 1024 * 1024
    max_image_dimension: int = 2048
    max_garments: int = 8
    max_retries: int = 1
    request_timeout_s: float = 120.0

    # ---------------------------------------------------------- confidence --
    accept_threshold: float = 0.7
    uncertain_threshold: float = 0.45
    # Attributes below this confidence are dropped from the final output rather
    # than presented as if they were reliable.
    report_floor: float = 0.2
    # How much a failing validation rule erodes the fused confidence.
    validation_penalty_scale: float = 1.0

    def resolved_device(self) -> str:
        """`auto` becomes `cuda` when a GPU is present, otherwise `cpu`."""
        if self.device != "auto":
            return self.device
        try:
            import torch

            if torch.cuda.is_available():
                return "cuda"
            mps = getattr(torch.backends, "mps", None)
            if mps is not None and mps.is_available():
                return "mps"
        except Exception:  # pragma: no cover - torch always present at runtime
            pass
        return "cpu"

    @field_validator("log_level", mode="before")
    @classmethod
    def _normalise_log_level(cls, value: object) -> str:
        """Lower-case the level, and name the options when it is wrong.

        An unknown level is a typo, and the error that helps is the list of valid
        ones rather than pydantic's generic literal complaint.
        """
        text = str(value or "info").strip().lower()
        if text not in LOG_LEVELS:
            raise ValueError(
                f"log_level must be one of {', '.join(LOG_LEVELS)}, got {value!r}"
            )
        return text

    def hf_cache_env(self) -> dict[str, str]:
        """Env vars that keep every downloaded artefact on the D: volume.

        Torch and HuggingFace both default to `~/.cache`, which sits on the
        boot volume. This project keeps weights beside the venv instead.
        """
        hf = self.model_cache_dir / "hf"
        torch_home = self.model_cache_dir / "torch"
        return {
            "HF_HOME": str(hf),
            "TORCH_HOME": str(torch_home),
            "HF_HUB_DISABLE_TELEMETRY": "1",
            "HF_HUB_DISABLE_SYMLINKS_WARNING": "1",
            **({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"} if self.offline else {}),
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached singleton. Tests can call `get_settings.cache_clear()`."""
    return Settings()


def configure_torch_cache() -> None:
    """Point torch/HF at the project cache. Must run before any model import."""
    for key, value in get_settings().hf_cache_env().items():
        os.environ.setdefault(key, value)
