"""Index a subset of historical CLOSED benchmark cases into Qdrant for the
"AI assisted similar case retrieval" feature.

WHAT THIS DOES
    Reads closed NYC 311 benchmark records from Supabase `municipal_complaints`
    (closed_at IS NOT NULL AND resolution_description IS NOT NULL), embeds a
    combined text field with Cohere (embed-english-v3.0), and upserts the vectors
    + a small non-PII payload into a Qdrant collection. The Netlify function
    netlify/functions/similar-cases.ts then queries this collection at request
    time (embed query -> Qdrant top 50 -> Cohere Rerank -> top N).

    This deliberately indexes a CONTROLLED SUBSET (default 15,000; cap 25,000),
    NOT the full ~3.4M closed records. That is enough to demonstrate retrieval
    quality without a large/expensive bulk load. Raise --max-rows to scale.

    No Claude here. This is the first AI feature and is intentionally limited to
    embeddings + rerank. The resident closure message stays rules based and
    supervisor approved; this only supports staff reference.

CREDENTIALED STEP — run this in a stable environment, not the ephemeral POC
sandbox. All credentials are server-side only and must never be VITE_-prefixed.

Environment:
    SUPABASE_URL                 e.g. https://YOUR-ref.supabase.co
    SUPABASE_SERVICE_ROLE_KEY    service-role key (read access under RLS)
    COHERE_API_KEY               Cohere key (embeddings)
    QDRANT_URL                   e.g. https://YOUR-cluster.qdrant.io:6333
    QDRANT_API_KEY               Qdrant key (optional for a local instance)
    QDRANT_COLLECTION            collection name (default: nyc_closed_cases)

Usage:
    pip install supabase requests
    python scripts/index_closed_cases_qdrant.py                  # 15k records
    python scripts/index_closed_cases_qdrant.py --max-rows 25000 # cap
    python scripts/index_closed_cases_qdrant.py --recreate       # drop+remake
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import uuid
from datetime import datetime

import requests  # type: ignore

# Cohere embed-english-v3.0 is a 1024-dim model; the Qdrant collection vector
# size must match. Documents are embedded with input_type=search_document and
# queries (in the Netlify function) with input_type=search_query.
EMBED_MODEL = "embed-english-v3.0"
EMBED_DIM = 1024
COHERE_EMBED_URL = "https://api.cohere.com/v1/embed"

# Cohere embed accepts up to 96 texts per call; keep batches comfortably under.
COHERE_BATCH = 90
# Qdrant upsert batch size.
QDRANT_BATCH = 256

# Stable namespace so re-running produces the SAME point id for a given case_id
# (idempotent upserts instead of duplicates).
POINT_NAMESPACE = uuid.UUID("a3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d")

DEFAULT_MAX_ROWS = 15_000
HARD_CAP = 100_000

# Columns pulled from municipal_complaints. `complaint_type` is the generic
# column (populated from NYC complaint_type); `request_detail` is the descriptor.
SELECT_COLUMNS = (
    "case_id,complaint_type,request_detail,resolution_description,"
    "borough,council_district,agency,submitted_at,created_at,closed_at"
)


def env(name: str, *, required: bool = True, default: str | None = None) -> str | None:
    value = os.getenv(name) or default
    if required and not value:
        print(f"{name} must be set. See the script header for required env vars.", file=sys.stderr)
        sys.exit(2)
    return value


def get_supabase():
    url = env("SUPABASE_URL")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    try:
        from supabase import create_client  # type: ignore
    except ImportError:
        print("Install the client first: pip install supabase requests", file=sys.stderr)
        sys.exit(2)
    return create_client(url, key)


def closure_days(submitted_at: str | None, closed_at: str | None) -> int | None:
    """Whole days between submission and closure, or None if unparseable."""
    if not submitted_at or not closed_at:
        return None
    try:
        start = datetime.fromisoformat(submitted_at.replace("Z", "+00:00"))
        end = datetime.fromisoformat(closed_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    delta = (end - start).days
    return max(0, delta)


def clean(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def compose_text(row: dict) -> str:
    """Combine the fields we embed, in a fixed order. Mirrors the query side in
    netlify/functions/similar-cases.ts: complaint type, request detail/descriptor,
    resolution description, borough, agency."""
    parts = [
        clean(row.get("complaint_type")),
        clean(row.get("request_detail")),
        clean(row.get("resolution_description")),
        clean(row.get("borough")),
        clean(row.get("agency")),
    ]
    return "\n".join(p for p in parts if p)


def to_payload(row: dict) -> dict:
    submitted = clean(row.get("submitted_at")) or clean(row.get("created_at"))
    closed = clean(row.get("closed_at"))
    payload = {
        "case_id": clean(row.get("case_id")),
        "complaint_type": clean(row.get("complaint_type")),
        "request_detail": clean(row.get("request_detail")),
        "resolution_description": clean(row.get("resolution_description")),
        "borough": clean(row.get("borough")),
        "council_district": clean(row.get("council_district")),
        "agency": clean(row.get("agency")),
        "submitted_at": submitted,
        "closed_at": closed,
        "closure_days": closure_days(submitted, closed),
    }
    # Drop None values to keep the Qdrant payload tidy.
    return {k: v for k, v in payload.items() if v is not None}


# ---------------------------------------------------------------------------
# Supabase read (paginated)
# ---------------------------------------------------------------------------

def fetch_closed_cases(client, max_rows: int):
    """Yield closed, resolved rows in pages, capped at max_rows."""
    page = 1000
    fetched = 0
    start = 0
    while fetched < max_rows:
        end = start + page - 1
        resp = (
            client.table("municipal_complaints")
            .select(SELECT_COLUMNS)
            .not_.is_("closed_at", "null")
            .not_.is_("resolution_description", "null")
            .order("closed_at", desc=True)
            .range(start, end)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            break
        for row in rows:
            yield row
            fetched += 1
            if fetched >= max_rows:
                return
        start += page


# ---------------------------------------------------------------------------
# Cohere embeddings
# ---------------------------------------------------------------------------

def embed_documents(api_key: str, texts: list[str]) -> list[list[float]]:
    resp = requests.post(
        COHERE_EMBED_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": EMBED_MODEL,
            "texts": texts,
            "input_type": "search_document",
            "truncate": "END",
        },
        timeout=60,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Cohere embed failed (status {resp.status_code}): {resp.text[:300]}")
    embeddings = resp.json().get("embeddings")
    if not embeddings or len(embeddings) != len(texts):
        raise RuntimeError("Cohere embed returned an unexpected number of vectors.")
    return embeddings


# ---------------------------------------------------------------------------
# Qdrant
# ---------------------------------------------------------------------------

def qdrant_headers(api_key: str | None) -> dict:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["api-key"] = api_key
    return headers


def ensure_collection(base_url: str, api_key: str | None, collection: str, recreate: bool) -> None:
    base = base_url.rstrip("/")
    headers = qdrant_headers(api_key)
    url = f"{base}/collections/{collection}"

    if recreate:
        requests.delete(url, headers=headers, timeout=30)

    existing = requests.get(url, headers=headers, timeout=30)
    if existing.status_code == 200 and not recreate:
        print(f"Collection '{collection}' already exists — upserting into it.")
        return

    resp = requests.put(
        url,
        headers=headers,
        json={"vectors": {"size": EMBED_DIM, "distance": "Cosine"}},
        timeout=30,
    )
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Qdrant create collection failed (status {resp.status_code}): {resp.text[:300]}")
    print(f"Created collection '{collection}' (dim={EMBED_DIM}, distance=Cosine).")


def upsert_points(base_url: str, api_key: str | None, collection: str, points: list[dict]) -> None:
    base = base_url.rstrip("/")
    resp = requests.put(
        f"{base}/collections/{collection}/points",
        headers=qdrant_headers(api_key),
        json={"points": points},
        timeout=60,
    )
    if resp.status_code not in (200, 202):
        raise RuntimeError(f"Qdrant upsert failed (status {resp.status_code}): {resp.text[:300]}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Index closed benchmark cases into Qdrant.")
    parser.add_argument(
        "--max-rows",
        type=int,
        default=DEFAULT_MAX_ROWS,
        help=f"How many closed records to index (default {DEFAULT_MAX_ROWS:,}, cap {HARD_CAP:,}).",
    )
    parser.add_argument(
        "--recreate",
        action="store_true",
        help="Drop and recreate the Qdrant collection before indexing.",
    )
    args = parser.parse_args()

    max_rows = min(max(1, args.max_rows), HARD_CAP)
    if args.max_rows > HARD_CAP:
        print(f"--max-rows capped at {HARD_CAP:,} (subset, not the full ~3.4M).")

    cohere_key = env("COHERE_API_KEY")
    qdrant_url = env("QDRANT_URL")
    qdrant_key = env("QDRANT_API_KEY", required=False)
    collection = env("QDRANT_COLLECTION", required=False, default="nyc_closed_cases")

    client = get_supabase()
    ensure_collection(qdrant_url, qdrant_key, collection, args.recreate)

    indexed = 0
    skipped = 0
    pending_rows: list[dict] = []
    pending_texts: list[str] = []
    points_buffer: list[dict] = []
    started = time.time()

    def flush_embeddings() -> None:
        nonlocal indexed
        if not pending_rows:
            return
        vectors = embed_documents(cohere_key, pending_texts)
        for row, vector in zip(pending_rows, vectors):
            case_id = clean(row.get("case_id")) or str(uuid.uuid4())
            point_id = str(uuid.uuid5(POINT_NAMESPACE, case_id))
            points_buffer.append({"id": point_id, "vector": vector, "payload": to_payload(row)})
        indexed += len(pending_rows)
        pending_rows.clear()
        pending_texts.clear()

    def flush_points() -> None:
        if not points_buffer:
            return
        upsert_points(qdrant_url, qdrant_key, collection, points_buffer)
        print(f"  upserted {indexed:,} indexed so far")
        points_buffer.clear()

    for row in fetch_closed_cases(client, max_rows):
        text = compose_text(row)
        if not text:
            skipped += 1
            continue
        pending_rows.append(row)
        pending_texts.append(text)

        if len(pending_rows) >= COHERE_BATCH:
            flush_embeddings()
        if len(points_buffer) >= QDRANT_BATCH:
            flush_points()

    flush_embeddings()
    flush_points()

    elapsed = time.time() - started
    print(
        f"Done. Indexed {indexed:,} closed cases into Qdrant collection "
        f"'{collection}' ({skipped:,} skipped for empty text) in {elapsed:.0f}s."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
