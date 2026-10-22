import crypto from "node:crypto";
import { query } from "./db.js";
import { config } from "./config.js";
import { embed } from "./model.js";

export function documentText(title, content) {
  return `${title.trim()}\n\n${content.trim()}`;
}

export function hashText(text) {
  return crypto.createHash("sha256").update(text.trim()).digest("hex");
}

async function getEmbedding(hash) {
  const { rows } = await query(
    `UPDATE embeddings
     SET last_used_at = now()
     WHERE content_hash = $1 AND embedding_profile = $2
     RETURNING id, embedding`,
    [hash, config.embeddingProfile]
  );
  const row = rows[0];
  return row && { id: row.id, vector: parseVector(row.embedding) };
}

function parseVector(raw) {
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function saveEmbedding(hash, vector) {
  const { rows } = await query(
    `INSERT INTO embeddings (content_hash, embedding_profile, embedding)
     VALUES ($1, $2, $3::vector)
     ON CONFLICT (content_hash, embedding_profile)
     DO UPDATE SET last_used_at = now()
     RETURNING id, embedding`,
    [hash, config.embeddingProfile, JSON.stringify(vector)]
  );
  return { id: rows[0].id, vector: parseVector(rows[0].embedding) };
}

async function embedCached(text) {
  const hash = hashText(text);
  const existing = await getEmbedding(hash);
  if (existing) return { ...existing, hash };

  const vector = await embed(text.trim());
  const stored = await saveEmbedding(hash, vector);
  return { ...stored, hash };
}

export function embedDocument(text) {
  return embedCached(text);
}

export function embedQuestion(text) {
  return embed(text.trim());
}
