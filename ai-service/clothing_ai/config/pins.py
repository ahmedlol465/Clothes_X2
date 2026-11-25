"""Exact model versions this project was built and measured with.

Every model is pinned to a Hugging Face commit, so a fresh clone (or a server)
downloads the same weights Karim tested, even if the model author updates the
repo later. To move to a new version: change the commit here, re-run the colour
and type checks, and keep it only if the numbers hold.

    python -m clothing_ai.config.pins        # shows pins and what the local cache holds
"""

from __future__ import annotations

DETECTOR_ID = "yainage90/fashion-object-detection"  # MIT
DETECTOR_REV = "fb0a4ff27adfe56500ab4d36e2586436eb1d2979"

SEGMENTER_ID = "facebook/sam2.1-hiera-tiny"  # Apache-2.0
SEGMENTER_REV = "de431c4043854a71d8101e17995dfe596bf101a5"

FASHION_ID = "Marqo/marqo-fashionSigLIP"  # Apache-2.0
FASHION_REV = "c56244cc94f92419e8369fa71efdaf403b124ce8"

PINS = {
    DETECTOR_ID: DETECTOR_REV,
    SEGMENTER_ID: SEGMENTER_REV,
    FASHION_ID: FASHION_REV,
}


def main() -> int:
    from pathlib import Path

    from .settings import get_settings

    hub = Path(get_settings().model_cache_dir) / "hf" / "hub"
    bad = 0
    for repo, rev in PINS.items():
        snaps = hub / f"models--{repo.replace('/', '--')}" / "snapshots"
        have = sorted(p.name for p in snaps.iterdir()) if snaps.exists() else []
        state = "ok" if rev in have else ("MISSING" if not have else "DIFFERENT")
        bad += state != "ok"
        print(f"{repo}\n  pinned: {rev}\n  cached: {', '.join(have) or '-'}  [{state}]")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
