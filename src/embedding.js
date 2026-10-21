import crypto from "node:crypto";
import { query } from "./db.js";
import { EMBEDDING_MODEL } from "./config.js";
import { embed } from "./model.js";

// Embed this string and hash it
export function documentText(title, content) {
  return `${title.trim()}\n\n${content.trim()}`;
}

export function hashText(text) {
  return crypto.createHash("sha256").update(text.trim()).digest("hex");
}

async function readCache(hash) {
  try {
    const { rows } = await query(
      "SELECT embedding FROM embedding_cache WHERE content_hash = $1 AND model = $2",
      [hash, EMBEDDING_MODEL]
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
    [hash, EMBEDDING_MODEL, JSON.stringify(vector)]
  ).catch((err) => console.error("Cache write failed:", err.message));
}

// Documents are cached by the hash of their text
export async function embedDocument(text) {
  const hash = hashText(text);
  const cached = await readCache(hash);
  if (cached) return { vector: cached, hash };

  const vector = await embed(text.trim());
  writeCache(hash, vector);
  return { vector, hash };
}

export function embedQuestion(text) {
  return embed(text.trim());
}
