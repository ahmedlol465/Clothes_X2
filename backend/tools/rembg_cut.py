"""Garment cutout for the daily collage: reads an image on stdin, writes the
RGBA cutout PNG on stdout. Uses rembg's u2netp model (~4 MB, downloaded once
per machine). Optional: when rembg is not installed the collage service
falls back to its flood-fill cutout. Install: pip install rembg onnxruntime.
"""
import sys

from rembg import new_session, remove


def main() -> None:
    session = new_session("u2netp")
    data = sys.stdin.buffer.read()
    sys.stdout.buffer.write(remove(data, session=session))


if __name__ == "__main__":
    main()
