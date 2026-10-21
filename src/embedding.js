import crypto from "node:crypto";
import { query } from "./db.js";
import { JINA_API_KEY, JINA_MODEL } from "./config.js";

const JINA_URL = "https://api.jina.ai/v1/embeddings";
const DIMENSIONS = 384;

export function hashContent(title = "", content = "") {
  const normalized = `${title.trim()}\n\n${content.trim()}`.trim();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export async function getEmbedding(text, task = "retrieval.passage") {
  const input = text.trim();
  const hash = hashContent("", input);

  // Cache hit?
  const cached = await query(
    "SELECT embedding FROM embedding_cache WHERE content_hash = $1 AND model = $2 LIMIT 1",
    [hash, JINA_MODEL]
  );

  if (cached.rows.length) {
    const raw = cached.rows[0].embedding;
    const vector = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { vector, cached: true, hash };
  }

  if (!JINA_API_KEY) {
    throw new Error("JINA_API_KEY is not set in environment");
  }

  const res = await fetch(JINA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${JINA_API_KEY}`,
    },
    body: JSON.stringify({
      model: JINA_MODEL,
      task,
      dimensions: DIMENSIONS,
      normalized: true,
      input: [input],
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Jina API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const vector = data.data?.[0]?.embedding;

  if (!Array.isArray(vector) || vector.length !== DIMENSIONS) {
    throw new Error(`Expected ${DIMENSIONS} dimensions, got ${vector?.length}`);
  }

  query(
    "INSERT INTO embedding_cache (content_hash, model, embedding) VALUES ($1, $2, $3::vector) ON CONFLICT DO NOTHING",
    [hash, JINA_MODEL, JSON.stringify(vector)]
  ).catch((err) => console.error("Cache write failed:", err.message));

  return { vector, cached: false, hash };
}
