import { Router } from "express";
import { query } from "../db.js";
import { documentText, embedDocument, hashText } from "../embedding.js";
import { documentSchema } from "../validate.js";

const router = Router();

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

export default router;
