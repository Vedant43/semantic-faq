import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const dir = fileURLToPath(new URL("../migrations/", import.meta.url));

try {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(dir + file, "utf8"));
    console.log(`applied ${file}`);
  }
} catch (err) {
  console.error(`Migration failed: ${err.message}`);
  if (/extension/i.test(err.message)) console.error("Postgres needs the pgvector extension installed (see README).");
  process.exitCode = 1;
} finally {
  await pool.end();
}
