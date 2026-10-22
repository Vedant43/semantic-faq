import { Router } from "express";
import { query } from "../db.js";
import { embedQuestion } from "../embedding.js";
import { askSchema } from "../validate.js";
import { config } from "../config.js";

const router = Router();
const TOP_K = 3;
const CANDIDATE_K = 30;

async function search(vector) {
  const { rows } = await query(
    `WITH candidates AS MATERIALIZED (
      SELECT id, 1 - (embedding <=> $1::vector) AS score
      FROM embeddings
      WHERE embedding_profile = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
     )
     SELECT d.id, d.title, d.content, c.score
     FROM candidates c
     JOIN documents d ON d.embedding_id = c.id
     WHERE d.embedding_status = 'ready'
     ORDER BY c.score DESC, d.id
     LIMIT $4`,
    [JSON.stringify(vector), config.embeddingProfile, CANDIDATE_K, TOP_K]
  );
  return rows;
}

router.post("/", async (req, res) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({ error: `${issue.path.join(".")}: ${issue.message}` });
  }

  let vector;
  try {
    vector = await embedQuestion(parsed.data.question);
  } catch (err) {
    console.error("Embedding failed:", err.message);
    res.set("Retry-After", "10");
    return res.status(503).json({ error: "Embedding service unavailable, try again shortly" });
  }

  res.json({ results: await search(vector) });
});

export default router;
