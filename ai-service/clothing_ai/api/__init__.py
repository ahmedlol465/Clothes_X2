"""HTTP layer. Kept free of model imports so route wiring is cheap to test."""

from .analyze import router

__all__ = ["router"]
