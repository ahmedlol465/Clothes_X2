"""Stage 4c — fashion embeddings."""

from .fashion_embedder import (
    FASHIONSIGLIP_EMBED_DIM,
    FashionEmbedder,
    SiglipFashionEmbedder,
    cosine_similarity,
)

__all__ = [
    "FASHIONSIGLIP_EMBED_DIM",
    "FashionEmbedder",
    "SiglipFashionEmbedder",
    "cosine_similarity",
]
