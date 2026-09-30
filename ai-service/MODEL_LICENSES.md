# Model licenses

Nothing here is fine-tuned and nothing is trained. The service runs four
third-party checkpoints and, optionally, a fifth. Each is listed with the
license it actually ships under, because "open source" and "permissive" are not
the same and the distinction matters if this ever becomes a product.

Licenses were read from each model repository. They are recorded here as found;
re-check before a release, since a repository can change its license.

## In use

### `yainage90/fashion-object-detection` — MIT

Object detection, used to find garments and to assign a coarse group
(`bag`, `bottom`, `dress`, `hat`, `shoes`, `outer`, `top`).

A Deformable-DETR fine-tuned for fashion. Chosen over a general-purpose detector
because the coarse group it emits is exactly the gating signal the fusion layer
needs: it cannot tell a t-shirt from a blouse, but it reliably separates the
categories that should never be confused with each other.

The fine group is never taken from this model. The coarse label is treated as a
constraint, and a fine category that contradicts it is dropped rather than
trusted.

### `facebook/sam2.1-hiera-tiny` — Apache-2.0

Promptable segmentation, used to produce the garment mask.

The mask is load-bearing, not cosmetic: it restricts the crop sent to the
attribute model, the pixels that get clustered for colour, and the area the
embedding is computed over. A mask that includes background produces a colour
that is partly the wall.

Deliberately not SAM3 / SAM3.1. Those are gated behind manual approval on the Hub
and cannot be fetched unattended, which makes the service unreproducible for
anyone who has not filled in a form. This is the newest SAM 2.1 release that
loads from a public repo with no extra steps.

The postprocessing call signature is version-sensitive; it is wrapped in
`clothing_ai/models/` so a signature change breaks one function rather than the
pipeline.

### `hf-hub:Marqo/marqo-fashionSigLIP` — Apache-2.0

Zero-shot attribute classification and embeddings, via `transformers`.

CLIP-family contrastive model, 768-dimensional output, 224px input, 64-token
context. Supplies the fine category, subcategory, colour, pattern, style and
material predictions, plus the vector the wardrobe stores for similarity search.

The 64-token context is a real constraint: prompts are kept short and the
candidate lists are split into chunks that each fit. This is why the vocabulary
is ordered in `labels.yaml` rather than assembled at runtime.

Scored on a zero-shot fashion benchmark by its authors rather than by us. Treat
its headline numbers as an upper bound and rely on the evaluation harness in
`clothing_ai/evaluation/` for numbers that mean something on *our* photos.

### Torch, Transformers and the rest — Apache-2.0 / BSD / MIT

The inference stack itself: PyTorch, `transformers`, OpenCV, FastAPI, NumPy,
scikit-learn, Pillow. All permissive. Pinned exactly in `pyproject.toml`, which
matters more for reproducibility here than the licenses do.

## Available but disabled

### `wargoninnovation/wargon-clothing-classifier` — Apache-2.0

A second opinion on category, gated behind `CLOTHING_AI_ENABLE_SECONDARY_CLASSIFIER`.

Off by default. It is permissively licensed and genuinely decent, but it roughly
doubles inference time on a machine that is already the slowest part of the
system, and a second classifier whose disagreements are not resolved into
something actionable just produces noise. If it is ever turned on, the
disagreement needs a rule in `validation_rules.yaml` to say which one wins.

## Rejected, and why

Recorded so the choice is not silently revisited.

| Model | License | Why not |
| --- | --- | --- |
| `facebook/sam3`, SAM 3.1 variants | Apache-2.0 | Gated behind manual Hub approval. The service would not start unattended on a fresh machine. |
| Ultralytics YOLO weights and the `ultralytics` package | AGPL-3.0 | AGPL obliges anyone offering the service over a network to publish their source. That is a product decision, not a technical one, and it should be made deliberately rather than by picking a convenient detector. |

## Reviewing this

The license claim that actually matters is not any single model. It is that the
service as a whole offers no path to a business-critical end user without
publishing its source. With the set above, that is not true.

If a component with a copyleft or non-commercial license is ever added, update
this file in the same commit, and say so in the PR description rather than
letting a reviewer find it later.
