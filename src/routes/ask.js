import { Router } from "express";
import { query } from "../db.js";
import { embedQuestion } from "../embedding.js";
import { askSchema } from "../validate.js";

const router = Router();
const TOP_K = 3;

async function search(vector) {
  const { rows } = await query(
    `SELECT id, title, content, 1 - (embedding <=> $1::vector) AS score
     FROM documents
     WHERE embedding_status = 'ready'
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(vector), TOP_K]
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
