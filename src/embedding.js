import crypto from "node:crypto";
import { query } from "./db.js";
import { JINA_API_KEY, JINA_MODEL } from "./config.js";

const JINA_URL = "https://api.jina.ai/v1/embeddings";
const DIMENSIONS = 384;

// Embed this string and hash it
export function documentText(title, content) {
  return `${title.trim()}\n\n${content.trim()}`;
}

export function hashText(text) {
  return crypto.createHash("sha256").update(text.trim()).digest("hex");
}

async function callJina(input, task) {
  if (!JINA_API_KEY) throw new Error("JINA_API_KEY is not set");

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
    throw new Error(`Jina API error (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const vector = data.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== DIMENSIONS) {
    throw new Error(`Expected ${DIMENSIONS} dimensions, got ${vector?.length}`);
  }
  return vector;
}

async function readCache(hash) {
  try {
    const { rows } = await query(
      "SELECT embedding FROM embedding_cache WHERE content_hash = $1 AND model = $2",
      [hash, JINA_MODEL]
    );
    if (!rows.length) return null;
    const raw = rows[0].embedding;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (err) {
    console.error("Cache read failed:", err.message);
    return null;
  }
}

function writeCache(hash, vector) {
  query(
    "INSERT INTO embedding_cache (content_hash, model, embedding) VALUES ($1, $2, $3::vector) ON CONFLICT DO NOTHING",
    [hash, JINA_MODEL, JSON.stringify(vector)]
  ).catch((err) => console.error("Cache write failed:", err.message));
}

// Documents are cached by the hash of their text
export async function embedDocument(text) {
  const hash = hashText(text);
  const cached = await readCache(hash);
  if (cached) return { vector: cached, hash };

  const vector = await callJina(text.trim(), "retrieval.passage");
  writeCache(hash, vector);
  return { vector, hash };
}

export function embedQuestion(text) {
  return callJina(text.trim(), "retrieval.query");
}
