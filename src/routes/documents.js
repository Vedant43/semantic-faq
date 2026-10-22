import { Router } from "express";
import { query } from "../db.js";
import { documentText, embedDocument, hashText } from "../embedding.js";
import { documentSchema } from "../validate.js";

const router = Router();
const REEMBED_BATCH = 50;

router.post("/", async (req, res) => {
  const parsed = documentSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({ error: `${issue.path.join(".")}: ${issue.message}` });
  }
  const { title, content } = parsed.data;
  const text = documentText(title, content);

  // content_hash is NOT NULL, so we need it even if embedding fails
  let hash = hashText(text);
  let embeddingId = null;
  try {
    ({ id: embeddingId, hash } = await embedDocument(text));
  } catch (err) {
    console.error("Embedding failed, saving as pending:", err.message);
  }

  const { rows } = await query(
    `INSERT INTO documents (title, content, content_hash, embedding_id, embedding_status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, title, content, embedding_status, created_at`,
    [title, content, hash, embeddingId, embeddingId ? "ready" : "pending"]
  );

  res.status(201).json(rows[0]);
});

// Retry documents saved as pending because embedding failed earlier
router.post("/reembed", async (req, res) => {
  const { rows: pending } = await query(
    "SELECT id, title, content FROM documents WHERE embedding_status = 'pending' ORDER BY id LIMIT $1",
    [REEMBED_BATCH]
  );

  let reembedded = 0;
  for (const doc of pending) {
    try {
      const { id: embeddingId, hash } = await embedDocument(documentText(doc.title, doc.content));
      await query(
        `UPDATE documents SET embedding_id = $1, content_hash = $2, embedding_status = 'ready'
         WHERE id = $3 AND embedding_status = 'pending'`,
        [embeddingId, hash, doc.id]
      );
      reembedded++;
    } catch (err) {
      console.error("Re-embedding failed:", err.message);
      break;
    }
  }

  if (pending.length && !reembedded) {
    res.set("Retry-After", "10");
    return res.status(503).json({ error: "Embedding service unavailable, try again shortly" });
  }

  const { rows } = await query("SELECT count(*)::int AS remaining FROM documents WHERE embedding_status = 'pending'");
  res.json({ reembedded, remaining: rows[0].remaining });
});

export default router;
