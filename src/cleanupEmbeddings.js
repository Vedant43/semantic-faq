import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query } from "./db.js";
import { config } from "./config.js";

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_RETENTION_HOURS = 24;

export async function cleanupOrphanedEmbeddings(
  limit = DEFAULT_BATCH_SIZE,
  minAgeHours = DEFAULT_RETENTION_HOURS
) {
  const batchSize = Number(limit);
  const minimumAge = Number(minAgeHours);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new Error("Cleanup batch size must be an integer between 1 and 10000");
  }
  if (!Number.isInteger(minimumAge) || minimumAge < 1 || minimumAge > 24 * 365) {
    throw new Error("Cleanup retention must be an integer between 1 and 8760 hours");
  }

  const { rows } = await query(
    `WITH orphaned AS (
       SELECT e.id
       FROM embeddings e
       WHERE NOT EXISTS (
         SELECT 1 FROM documents d WHERE d.embedding_id = e.id
       )
       AND e.last_used_at < now() - ($2::text || ' hours')::interval
       ORDER BY e.last_used_at
       LIMIT $1
     )
     DELETE FROM embeddings e
     USING orphaned o
     WHERE e.id = o.id
     RETURNING e.id`,
    [batchSize, minimumAge]
  );
  return rows.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const limit = process.argv[2] === undefined ? DEFAULT_BATCH_SIZE : Number(process.argv[2]);
  const minAgeHours = process.argv[3] === undefined ? undefined : Number(process.argv[3]);

  try {
    const deleted = await cleanupOrphanedEmbeddings(limit, minAgeHours);
    console.log(`Deleted ${deleted} orphaned embedding(s).`);
  } finally {
    await pool.end();
  }
}
