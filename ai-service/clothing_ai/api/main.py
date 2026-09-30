"""FastAPI application factory.

Run with:

    uvicorn clothing_ai.api.main:app --host 127.0.0.1 --port 8000

The service is deliberately single-process and CPU-bound. More workers would
each load their own copy of ~1 GB of weights for no throughput gain, so scale
by putting this behind a queue, not by adding workers.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from ..common.logging import configure_logging, get_logger
from ..config.settings import get_settings
from .analyze import router as clothing_router

log = get_logger(__name__)

API_TITLE = "Clothing Analysis Service"
API_VERSION = "1.0.0"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(
        level=settings.log_level, json_output=settings.log_json
    )
    log.info(
        "service_starting",
        device=settings.resolved_device(),
        detector=settings.detector_model,
        segmenter=settings.segmenter_model,
        fashion=settings.fashion_model,
    )

    from ..models.model_manager import get_model_manager
    from ..pipeline import build_pipeline

    manager = get_model_manager(settings)
    app.state.model_manager = manager

    if settings.eager_load:
        # Load before serving, so the first user request is not the one that
        # pays several minutes of download on a cold cache.
        started = time.perf_counter()
        app.state.pipeline = build_pipeline(settings=settings)
        stats = manager.warm_up()
        log.info(
            "service_ready",
            load_ms=round((time.perf_counter() - started) * 1000.0, 1),
            warm_up_ms=round(getattr(stats, "total_ms", 0.0), 1),
        )
    else:
        app.state.pipeline = build_pipeline(settings=settings)
        log.info("service_ready_lazy", device=manager.device)

    try:
        yield
    finally:
        manager.release()
        log.info("service_stopped")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=API_TITLE,
        version=API_VERSION,
        lifespan=lifespan,
        description=(
            "Structured garment attributes with honest, per-attribute confidence. "
            "Refusing to label an image is a valid, expected outcome."
        ),
    )
    app.include_router(clothing_router)

    @app.get("/health", tags=["ops"], summary="Liveness and readiness")
    async def health(request: Request) -> JSONResponse:
        manager = getattr(request.app.state, "model_manager", None)
        loaded = bool(getattr(manager, "is_loaded", False)) if manager is not None else False
        pipeline_ready = getattr(request.app.state, "pipeline", None) is not None
        # 503 while the weights are still loading, so an orchestrator holds
        # traffic back instead of surfacing a confusing 500.
        return JSONResponse(
            status_code=200 if (loaded and pipeline_ready) else 503,
            content={
                "status": "ok" if (loaded and pipeline_ready) else "starting",
                "models_loaded": loaded,
                "device": str(getattr(manager, "device", settings.resolved_device())),
                "version": API_VERSION,
            },
        )

    @app.get("/", include_in_schema=False)
    async def root() -> dict[str, str]:
        return {"service": API_TITLE, "docs": "/docs", "health": "/health"}

    return app


app = create_app()

__all__ = ["app", "create_app"]
