# Semantic FAQ Search

An API for storing short knowledge snippets (title + content) and asking questions in
plain language. Questions are matched by meaning using vector embeddings, and the top
three snippets come back with a similarity score.

Node.js + Express, PostgreSQL with pgvector, and a local embedding model
(`all-MiniLM-L6-v2`). No external API keys or accounts.

## Run it

```bash
docker compose up --build
```

The API is on `http://localhost:3000`. The default API key is `dev-api-key`; set your own
with `cp .env.example .env` and editing `API_KEY`. The first build takes 2–3 minutes
(dependencies and a ~90 MB model download into the image); later builds are cached. The
schema in `migrations/` is applied when the database volume is first created.
`docker compose down -v` resets everything.

A Postman collection is in `postman/` (variables `baseUrl`, `apiKey`).

### Without Docker

```bash
cp .env.example .env          # set DATABASE_URL (use localhost) and API_KEY
npm install
npm run migrate               # creates the tables; safe to re-run
npm start
```

The first start downloads the model into `.model-cache/`; until it loads, `/health` shows
`"model": "loading"` and `/ask` returns `503`.

### Configuration

| Variable | Purpose |
|---|---|
| `API_KEY` | **Required.** Sent as the `x-api-key` header. The service will not start without it. |
| `PORT`, `DATABASE_URL` | Server port and Postgres connection. Compose overrides `DATABASE_URL`. |
| `EMBEDDING_MODEL` | Default `Xenova/all-MiniLM-L6-v2`. Must output 384 dimensions. |
| `EMBEDDING_PROFILE` | Optional override of how vectors are identified (see [Caching](#caching-and-stale-data)). |
| `MODEL_CACHE_DIR` | Where model files are stored. |
| `RATE_LIMIT_PER_MINUTE` | `/ask` requests per client IP per minute. Default 30. |

## API

All endpoints except `/health` need the `x-api-key` header.

- **`POST /documents`**: `{"title", "content"}` (title ≤ 200 characters, content ≤ 1000).
  Returns `201` with `id`, `title`, `content`, `embedding_status` (`ready`, or `pending` if
  embedding failed) and `created_at`.
- **`POST /ask`**: `{"question"}` (≤ 500 characters). Returns the top three `ready`
  documents, best first, with `score` (cosine similarity; higher is closer, can dip
  slightly below 0). An empty store returns `{"results": []}`.
  ```json
  {"results": [{"id": 1, "title": "Reset password", "content": "Click Forgot ...", "score": 0.68}]}
  ```
- **`POST /documents/reembed`**: re-embeds up to 50 documents saved as `pending` because
  embedding failed. Returns `{"reembedded": N, "remaining": M}`; repeat while
  `remaining` > 0. `503` if the model is unavailable.
- **`GET /health`**: always `200` while the process is up, with `model` set to `loading`,
  `ready` or `failed`. A model problem does not return an error status, so an orchestrator
  won't kill a container that is only waiting for the download.

| Code | When |
|---|---|
| 200 / 201 | Success / document created |
| 400 | Invalid fields or malformed JSON |
| 401 | Missing or wrong API key |
| 404 / 413 | Unknown route / body over 100 KB |
| 429 | `/ask` rate limit exceeded |
| 503 | Embedding unavailable (failed or timed out), with `Retry-After` |
| 500 | Anything else, e.g. database down. Generic message; details only in logs. |

## Design decisions

### Embeddings: local `all-MiniLM-L6-v2` (384 dimensions)

- **Why local.** One command to run: no key, cost, provider outage or request-time network
  dependency. Results are deterministic, and the model is baked into the image.
- **Trade-off.** It is a small model: good for short English text, weaker on other
  languages, long text and jargon. It reads a limited number of tokens, so content is
  capped at 1000 characters rather than accepting text it cannot fully represent.
- **Swappable.** The model lives in `src/model.js` behind one `embed(text)` function.

### Caching and stale data

Document embeddings are cached by the sha256 of the embedded text plus the **embedding
profile** (model, pooling, text format). Re-adding or retrying the same text skips the
model. Questions are not cached: they are free text, repeats are rare, and the cache would
grow without bound.

- There is no update endpoint, so a vector cannot go out of date against its text (if one
  were added, an edit would point the document at a new vector and delete the old cache
  entry once no other document uses it).
- A model change changes the profile, and `/ask` only searches the current profile, so old
  and new vectors are never compared. Documents embedded under the old profile drop out of
  search, and nothing migrates them yet. I would extend `POST /documents/reembed` to also
  pick up documents whose vector is from an old profile.
- If weights change under the same model name, or the text format changes, set a new
  `EMBEDDING_PROFILE` by hand (same effect as a model change).
- Vectors no document references (for example after a failed insert, or once old-profile
  documents are re-embedded) are removed by `docker compose exec app npm run
  cleanup:embeddings`, which deletes those unused for 24 hours. It is run by hand today; I
  would run it as a scheduled job (cron or a Compose job).

### Failure handling

| Situation | Behaviour |
|---|---|
| `/ask`: embedding errors or takes over 10 s | `503` + `Retry-After`. An honest error beats a quiet fallback such as keyword search. |
| Adding a document: embedding fails | Saved as `pending`, still `201`; excluded from search until re-embedded. |
| Model fails to load at startup | Server still starts; `/health` shows `failed`, `/ask` returns `503`, the next request retries. |
| Database down or slow | Generic `500`. Connections time out at 5 s and queries at 10 s; a dropped idle connection is logged, not fatal. |
| Process crash | Compose restarts both containers. |

The model call cannot be cancelled, so after a timeout it keeps running in the background.

## Tests and evaluation

```bash
docker compose up -d db   # both need Postgres on localhost:5432
npm test                  # 13 tests
npm run eval              # retrieval metrics
```

Both create and drop their own throwaway databases and use the real model.

**Tests** cover auth, validation, ranking by meaning (top three, scores in order), pending
documents excluded, shared embeddings, orphan cleanup, re-embedding pending documents, the
rate limit, a model that cannot load, and an unreachable
database. **Not covered:** the 10 s timeout, startup with a failed model, the pool error
handler (checked by hand).

**Evaluation.** `evals/run.js` indexes 20 FAQ documents and asks 42 labelled questions (19
paraphrases, 8 that reuse the document's words, 9 hard ones, 6 out-of-domain).

| Questions | n | Hit@1 | Hit@3 | MRR | nDCG@3 |
|---|---|---|---|---|---|
| Paraphrases | 19 | 84% | 95% | 0.89 | 0.91 |
| Reuse the document's words | 8 | 88% | 100% | 0.94 | 0.95 |
| Hard | 9 | 89% | 89% | 0.89 | 0.85 |
| **All answerable** | 36 | 86% | 94% | 0.90 | 0.90 |

Hit@k: a relevant document is in the top k. MRR and nDCG@3 also reward ranking it higher.

- The main error is near-duplicate topics (two-factor setup vs lost device; refund vs
  return). Two questions missed the top three: a typo and one paraphrase.
- Top-1 score averages 0.56 when right, 0.42 when wrong, 0.11 out-of-domain. A minimum
  score of 0.2 would have blocked all 6 out-of-domain questions and kept 94% of the rest.
  **The API has no cutoff today**: it always returns three results, even for "tell me a
  joke".

Caveat: the set is small and I wrote it knowing the documents, so it is friendlier than
real traffic. The 95% interval on 86% Hit@1 is roughly 71–94%. Use it as a regression check,
not a benchmark, and rerun it after changing the model.

## Assumptions and known gaps

- No update, delete or list endpoints; the brief asks only for add and ask.
- Duplicate documents are allowed; identical texts share a vector and can fill result slots.  
- The Dockerfile tolerates a failed model download at build time; it then downloads on first
  start and needs network access.

## What breaks first under load

1. **CPU.** `/ask` runs the model in the app process, so latency climbs before Postgres is
   busy. The rate limit softens this; more instances help but each loads its own model.
2. **Ingestion.** Adding a document waits for embedding, so upload bursts slow everything.
3. **Database pool.** `pg` defaults to 10 connections.
4. **Rate limiter.** Inaccurate once there is more than one instance.

## Improving retrieval quality

- **Reranking.** Fetch the top 20–30 candidates as now, then rescore them with a
  cross-encoder reranker that reads the question and each document together. This targets
  the main error in the evaluation, near-duplicate topics ranked in the wrong order. It
  costs extra CPU and latency per question.
- **Hybrid search with BM25.** Combine vector similarity with keyword scoring (Postgres
  full-text search) and merge the two rankings, for example by reciprocal rank fusion. It
  helps with exact terms the small model handles poorly: product names, error codes and
  jargon. It does not fix typos.
- **Measure first.** Rerun `npm run eval` and keep a change only if it improves the
  numbers; both add cost, and the eval set would need more questions to show a difference.

## What I would change for a million documents

These are estimates, not measurements.

- **Memory.** 1M × 384 floats is about 1.5 GB of raw vectors plus the HNSW index, which
  should fit in RAM. `halfvec` would roughly halve it.
- **Embedding off the request path.** A queue and worker service: ingestion becomes "save as
  pending, enqueue, return" (replacing manual re-embed), and `/ask` stops sharing a CPU.
- **Chunking.** Split long documents, one vector per chunk, deduplicated back to the document.
- **Operations.** PgBouncer, Redis for the rate limit, a migration tool, and a scheduled
  job for embedding cleanup.
