# Clothing analysis service

Takes a photo of clothing and returns structured attributes with a per-attribute
confidence, and refuses to answer when it cannot support an answer.

The refusal is the point. A wardrobe feature that confidently stores
`material: silk, confidence 0.91` on a cotton shirt is worse than one that
stores nothing, because the user has no way to tell the difference. So this
service reports uncertainty explicitly, drops attributes below a floor, and
flags the rest for review.

```
POST /api/v1/clothing/analyze   multipart/form-data: image
GET  /api/v1/clothing/vocabulary what this build can say
GET  /api/v1/clothing/models    which weights are loaded
GET  /health                    503 until the weights are ready
```

## Quick start

```bash
python -m venv .venv
.venv\Scripts\activate          # . .venv/bin/activate on POSIX
pip install -e ".[dev]"

# First run downloads ~1 GB of weights. See "Offline and caching" below.
# Warm the cache deliberately instead of discovering the cost on first request:
python -m clothing_ai.models.prefetch

uvicorn clothing_ai.api.main:app --host 127.0.0.1 --port 8000
```

`prefetch` fetches each model independently and reports the one that failed
rather than aborting, and it is safe to interrupt — the Hugging Face cache
resumes rather than restarting. `python -m scripts.smoke_real` then runs a
complete real analysis and prints the response, including the parts that went
badly.

```bash
curl -F "image=@shirt.jpg" http://127.0.0.1:8000/api/v1/clothing/analyze
```

Health returns 503 until the models finish loading, so an orchestrator holds
traffic back instead of surfacing a confusing 500. Watch the log for
`service_ready`.

## What comes back

```json
{
  "success": true,
  "items": [
    {
      "id": "<opaque detector id>",
      "bbox": { "x1": 128.0, "y1": 72.0, "x2": 512.0, "y2": 432.0 },
      "coarse_label": "top",
      "attributes": {
        "category": { "value": "t-shirt", "confidence": 0.66, "source": "fashion" },
        "color":    { "primary": "blue", "primary_hex": "#2e5aac",
                      "distribution": { "blue": 1.0 }, "is_multicolor": false },
        "pattern":  { "value": "solid", "confidence": 0.66, "source": "fashion" },
        "style":    { "value": "casual", "confidence": 0.66, "source": "fashion" },
        "material": { "value": "cotton", "confidence": 0.66, "source": "fashion" }
      },
      "confidence": 0.66,
      "status": "accepted_with_uncertainty",
      "needs_review": true,
      "review_reason": ["color_source_disagreement"],
      "segmentation_quality": 0.82,
      "embedding": [ ... 768 floats, omit with include_embedding=false ... ],
      "attempts": 1
    }
  ],
  "request_id": "…",
  "processing": { "total_ms": 168.9, "detection_ms": 12.0, "…": 0 }
}
```

An attribute is **absent** from `attributes` when confidence fell below
`report_floor`. An absent attribute is not a bug and not a zero; it means the
service declined to claim it.

### Reading `status`

| Status | Meaning | What the client should do |
| --- | --- | --- |
| `accepted` | at or above `accept_threshold` | store it |
| `accepted_with_uncertainty` | usable, but something disagreed | store it, keep the confidence |
| `uncertain` | below `uncertain_threshold` | ask the user, or store it as a guess |
| `rejected` | not credible | do not store |
| `needs_review` | true when a validation rule fired or category is missing | surface for confirmation |

`needs_review` is not the same as low confidence. A result can be confident about
the wrong thing — which is precisely what a conflicting colour source is — and
that is the case worth a human glance.

## How it decides

```
decode → quality gate → detect → gate categories by detector group
      → segment → attribute (zero-shot) → measure colour from the mask
      → validate against rules → score → retry once if unconfident
```

Two ideas do most of the work.

**The detector constrains, it does not decide.** It emits only coarse groups.
A category that contradicts its group is dropped, not trusted, so a bad
fine-grained guess cannot escape into a confident wrong answer.

**Independent sources cross-check.** Colour is measured from the mask in LAB
space and named independently of the zero-shot model's colour word. When the two
disagree, a validation rule fires and the item is flagged. This is the main
reason `needs_review` appears on a result the model was sure about.

If the confidence gate is not met, one bounded retry runs: a tighter crop if the
garment was small in frame, or a brightness correction if the photo was dim. The
retry is kept only if it is *more* confident than the first pass — a worse second
opinion is discarded rather than averaged in, because averaging two guesses is
still a guess. `max_retries` is a hard bound.

## Configuration

Copy `.env.example` to `.env`. Every variable is optional; the defaults are
sensible and the file documents what each one trades against what.

The two files that actually change behaviour:

- `clothing_ai/config/labels.yaml` — vocabulary, per-attribute confidence caps,
  detector thresholds.
- `clothing_ai/config/validation_rules.yaml` — the cross-checks, as data rather
  than code. A rule that fires is visible in the response's `review_reason`.

Tuning order that works: fix vocabulary and caps first, then thresholds, then
rules. Rules are the most powerful and the easiest to overfit to a handful of
photos.

## Using it as a library

```python
from clothing_ai import analyze

result = analyze("shirt.jpg")
for item in result.items:
    if item.needs_review:
        continue
    print(item.attributes.category.value, item.attributes.category.confidence)
```

The pipeline is built once and reused, since loading the models costs seconds
and there is nothing per-request about them. `clothing_ai.clear_pipeline()`
releases it. `import clothing_ai` stays cheap — the model stack is imported only
when the pipeline is actually built.

## Evaluating

The service has no opinion about its own accuracy. `clothing_ai/evaluation/`
does, and it is deliberately pessimistic.

```bash
clothing-ai-evaluate --check-dataset          # what is labelled, what is missing
clothing-ai-evaluate --split val              # score it
clothing-ai-evaluate --split val --json       # machine-readable
```

Annotations are a JSON file of images and what a human said was in them:

```json
{
  "version": 1,
  "images": [
    {
      "id": "shirt-001",
      "file": "raw/shirt-001.jpg",
      "split": "val",
      "coarse_label": "top",
      "expected": { "category": "t-shirt", "color": "blue" }
    }
  ]
}
```

Two rules keep the numbers from flattering the service:

- **An unlabelled attribute is excluded from the denominator.** `null` means
  "not labelled", not "wrong". Counting it as a miss would reward being
  unhelpfully eager and would let a set with fewer labels look better.
- **Deliberate negatives are scored.** A photo with `no_clothing: true` that comes
  back with an item is a false positive, and false positives are the failure users
  actually notice.

The report gives detection precision/recall, per-attribute accuracy,
rejection rate on negatives, calibration error, and latency — then an error
analysis that groups failures by cause and suggests what to change, because a
number nobody can act on is not a result.

Honest caveat: **this harness has been tested against a stubbed pipeline, not
real weights.** The accounting is verified; the accuracy figures do not exist
yet. The first real run is when the vocabulary and the caps get their actual
numbers.

## Offline and caching

`CLOTHING_AI_MODEL_CACHE_DIR` holds the weights. Point it at a drive with several
GB free, and expect the first download to be slow on a poor connection.

After the cache is warm, set `CLOTHING_AI_OFFLINE=true` and the service makes no
network calls at all. Worth doing in production: it turns a slow-link stall into
a startup failure you notice immediately.

## Using it from the backend

`backend/src/modules/ai/` proxies this service when `AI_MODE=http`.

```env
AI_SERVICE_URL=http://localhost:8000
AI_MODE=http
AI_SERVICE_TIMEOUT_MS=20000
```

Three contract points, because breaking any of them fails quietly:

1. **`success: false` is HTTP 200, not an error.** "No clothing found" is an
   answer. Treating it as a failure makes every ordinary photo look like an
   outage.
2. **An attribute the service omits stays `null`.** Not `''`, not `'unknown'`. A
   blank category in the database reads as "we checked and it has none", which
   is a different and false claim. The client maps this to nulls precisely so a
   second, less certain analysis cannot erase a value the user typed.
3. **The service being down does not break uploads.** The backend catches
   transport failures and returns `success: false` with a warning. An item with
   no attributes is a storable item; a 500 on upload is not.

`needs_review` and `review_reason` are returned but not persisted —
`WardrobeItem` has no column for them. Adding one is a schema change and should
be a deliberate decision, not a side effect of wiring up a client.

## Tests

```bash
pytest
```

172 tests, no weights required. The stubs in `tests/stubs.py` implement the same
protocols as the real stages, so the pipeline, fusion, validation, scoring,
evaluation and HTTP layers all run for real; only the forward passes are
substituted. A regression in confidence arithmetic fails here.

`tests/test_config_docs.py` fails the build if `.env.example` and the `Settings`
model disagree in either direction, so a documented-but-nonexistent variable
cannot rot in unnoticed.

`tests/test_real_models.py` is the other half. Marked `slow` and excluded by
default because it needs the weights and roughly half a minute of CPU:

```bash
pytest -m slow
```

Five tests, all passing against the real checkpoints. They are the reason the
service is trustworthy at all, because every one of them found a real defect that
the stub suite could not see:

- SAM2 loads `Sam2Model`/`Sam2Processor`, **not** the video classes. The
  `sam2.1-hiera-tiny` repo publishes a `sam2_video` config, so `AutoModel` here
  silently builds a video model for a still photo.
- A box prompt produces a mask that overlaps a drawn rectangle at IoU ≥ 0.85.
  Stubs can only prove the mask has the right *shape*; this proves it lands on the
  garment.
- A box over empty space does not come back as a confident near-full-frame mask.
- The detector returns well-formed boxes on a scene containing nothing.
- FashionSigLIP embeddings are 768-dimensional, L2-normalised and finite.

Two further bugs were only visible on a real run and are fixed:
`Marqo/marqo-fashionSigLIP` declares no `embed_dim` and wraps its vision tower in
a timm `TimmModel`, so the width had to be probed rather than read; and both
`encode_image` and the embedder passed numpy arrays to open_clip's transform,
which only accepts PIL. Because the pipeline treats an encode failure as "this
garment gets no attributes", both would have degraded a wardrobe silently instead
of crashing.

Still unverified: accuracy on real photographs. `pytest -m slow` proves the model
code paths work; it cannot tell you whether a given photo is described correctly.
For that, build a labelled set and use `clothing-ai-evaluate`.

The backend side has its own 27 tests in `backend/src/modules/ai/ai.service.spec.ts`.

## Deployment notes

Deliberately single-process. More uvicorn workers would each load their own
~1 GB of weights for no throughput gain on a CPU-bound workload. Scale by
queueing in front of it, not by adding workers.

Inference is off the event loop: a request is handed to a worker thread, so a
25-second analysis does not block the health check.

Measured cost on the 8-thread CPU this was built on, one 720×900 image with three
garments, no retry:

| stage | ms |
| --- | --- |
| decode | 248 |
| detection (Deformable-DETR) | 4,280 |
| segmentation (SAM 2.1, per garment) | 6,076 |
| classification (FashionSigLIP, per garment) | 11,756 |
| colour | 1,386 |
| embeddings | 685 |
| **total** | **≈24,400** |

Classification dominates because it re-encodes the crop per garment. A retry
roughly doubles the total, which is why `max_retries` defaults to 1. Expect
25 seconds for a single garment and scale linearly with the count.

Warm model load is ~45–75 s, which is why it happens once in the lifespan hook
rather than per request.

## Layout

```
clothing_ai/
  schemas/      the wire contract — start here
  config/       settings, vocabulary, validation rules
  models/       model manager, detector, segmenter, embedding, colour model
  preprocessing/ decode, quality gate, retry views
  color/        LAB clustering, palette naming
  classification/ zero-shot attribute model
  validation/   declarative cross-checks
  confidence/   scoring, floors, caps, retry and review policy
  fusion/       combines the sources into one honest answer
  evaluation/   the benchmark
  api/          FastAPI
```

Dependencies point inward: `fusion` knows about `validation` and `confidence`,
never the reverse. `api` depends on `pipeline`, and nothing depends on `api`.
