"""Fetch every model weight into the local cache.

Run this separately from the service so a slow download does not look like a hung
server, and so a failure names the model that failed instead of surfacing as a
boot timeout.

    python -m clothing_ai.models.prefetch

Each component is attempted independently: a failure on one is reported and the
rest continue, because a partial cache is still useful and the point of the run
is to find out exactly what is missing.

Safe to interrupt. The Hugging Face cache resumes rather than restarting.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

from ..common.logging import configure_logging, get_logger
from ..config.settings import get_settings

log = get_logger(__name__)

#: Same order the pipeline needs them, cheapest-risk first.
COMPONENTS = ("segmenter", "detector", "fashion")


def cache_size_bytes(root: Path) -> int:
    """Total bytes on disk, so progress is measurable rather than guessed."""
    if not root.exists():
        return 0
    return sum(p.stat().st_size for p in root.rglob("*") if p.is_file())


def prefetch(components: tuple[str, ...] = COMPONENTS) -> int:
    settings = get_settings()
    configure_logging(level=settings.log_level, json_output=False)

    from .model_manager import ModelManager, ModelLoadError

    root = Path(settings.model_cache_dir)
    before = cache_size_bytes(root)
    log.info(
        "prefetch_start",
        cache=str(root),
        cache_mb=round(before / 1e6, 1),
        components=list(components),
    )

    manager = ModelManager(settings)
    failed: list[tuple[str, str]] = []

    for name in components:
        started = time.perf_counter()
        log.info("prefetch_begin", component=name)
        try:
            manager._get(name, getattr(manager, f"_load_{name}"))  # noqa: SLF001
        except ModelLoadError as exc:
            failed.append((name, str(exc)))
            log.error("prefetch_failed", component=name, error=str(exc))
        except Exception as exc:  # noqa: BLE001 - one bad model must not stop the rest
            failed.append((name, f"{type(exc).__name__}: {exc}"))
            log.error("prefetch_failed", component=name, error=f"{type(exc).__name__}: {exc}")
        else:
            log.info(
                "prefetch_ok",
                component=name,
                seconds=round(time.perf_counter() - started, 1),
            )

    after = cache_size_bytes(root)
    log.info(
        "prefetch_done",
        cached_mb=round(after / 1e6, 1),
        added_mb=round((after - before) / 1e6, 1),
        failed=[name for name, _ in failed],
    )
    manager.release()

    if failed:
        log.error("prefetch_incomplete")
        for name, reason in failed:
            log.error("prefetch_component_failed", component=name, error=reason)
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    args = list(argv if argv is not None else sys.argv[1:])
    components = tuple(args) if args else COMPONENTS
    return prefetch(components)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
