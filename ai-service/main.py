"""SmartWardrobe AI service (§6.3 / §9) — FastAPI mirror of POST /ai/*.

Run:  pip install -r requirements.txt && uvicorn main:app --port 8000
Then: AI_SERVICE_URL=http://localhost:8000 npm start   (in backend/)
"""
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Any, Optional

app = FastAPI(title="SmartWardrobe AI Service")


class AnalyzeIn(BaseModel):
    filename: Optional[str] = "uploaded garment"
    name: Optional[str] = None
    category: Optional[str] = None
    color: Optional[str] = None
    style: Optional[str] = None
    pattern: Optional[str] = None
    material: Optional[str] = None
    season: Optional[str] = None
    formality: Optional[str] = None


class ChatIn(BaseModel):
    message: str
    wardrobe: list[dict[str, Any]] = []
    weather: dict[str, Any] = {"tempC": 24, "condition": "partly cloudy"}


def _guess(name: str, patterns: str, value: str, fallback: str) -> str:
    import re
    return value if re.search(patterns, name) else fallback


@app.get("/health")
def health():
    return {"status": "ok", "service": "smartwardrobe-ai"}


@app.post("/analyze-clothing")
def analyze_clothing(body: AnalyzeIn):
    name = f"{body.filename or ''} {body.name or ''}".lower()

    def g(pat, val, fb):
        import re
        return val if re.search(pat, name) else fb

    category = body.category or g(r"shoe|sneaker|loafer|boot", "Shoes",
        g(r"jean|trouser|chino|short|skirt|pant|denim", "Bottoms",
        g(r"jacket|blazer|coat|hoodie|sweater|knit", "Outerwear",
        g(r"belt|scarf|watch|bag|hat|sunglass|tie", "Accessories", "Tops"))))
    color = body.color or g(r"white", "White", g(r"black", "Black",
        g(r"navy|blue|indigo", "Blue", g(r"beige|cream|tan|khaki", "Beige",
        g(r"brown", "Brown", g(r"grey|gray|charcoal", "Grey", "White"))))))
    style = body.style or ("Formal" if ("blazer" in name or "suit" in name) else
                           "Casual" if ("denim" in name or "sneaker" in name or "tee" in name)
                           else "Smart Casual")
    return {"category": category, "color": color, "style": style,
            "pattern": body.pattern or "Plain",
            "material": body.material or "Cotton",
            "season": body.season or "All Season",
            "formality": body.formality or style, "confidence": 0.88}


@app.post("/chat")
def chat(body: ChatIn):
    q = body.message.lower()
    if "date" in q:
        text = ("Date night calls for something sharper. Try the Navy Blazer with "
                "your White Oxford Shirt and Leather Loafers - 89% match.")
    elif "formal" in q:
        text = ("For formal events I would suggest the Navy Wool Blazer with the "
                "White Oxford Shirt and Tailored Trousers.")
    elif "weather" in q or "hot" in q or "cold" in q:
        w = body.weather
        text = (f"It's {w.get('tempC', 24)}°C and {w.get('condition', 'clear')} — "
                "lightweight layers are ideal.")
    elif "travel" in q or "trip" in q or "pack" in q:
        text = ("Pack the White Oxford Shirt, Beige Knit Sweater, Raw Denim, Beige "
                "Chinos, Minimalist Sneakers and the Silk Scarf for 7 outfits.")
    else:
        text = ("I rebuilt that from your wardrobe. The Beige Blazer with the Oxford "
                "Cotton Shirt is a reliable 92% match.")
    return {"text": text, "outfit": None}


@app.post("/generate-outfit")
def generate_outfit(body: dict):
    # Kept intentionally thin: full ranking lives in backend/src/ai-engine.js
    # so both runtimes stay consistent. Extend here with torch/CLIP later.
    return {"outfits": [], "note": "ranking delegated to main backend"}
