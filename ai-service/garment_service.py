"""Light service: only the garment-cutout route the backend's colour step uses.

    uvicorn garment_service:app --host 127.0.0.1 --port 8000

Loads detector + SAM 2 on the first request (about 330 MB of weights). The full
service (clothing_ai.api.main:app) also serves this route, so run one or the
other on port 8000, not both.
"""

import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI

from clothing_ai.api.garment_pixels import router
from clothing_ai.segmentation.pixels import preload

@asynccontextmanager
async def lifespan(_: FastAPI):
    # Load the models before the first photo arrives (in the background, so the
    # service answers /health at once).
    threading.Thread(target=preload, daemon=True).start()
    yield


app = FastAPI(title="SmartWardrobe garment cutout", lifespan=lifespan)
app.include_router(router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "garment-cutout"}
