import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import { env } from "@huggingface/transformers";

// The model cannot load, so every embed fails. The service should stay up:
// /ask answers 503 and documents are saved as pending.
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL || "postgres://postgres:postgres@localhost:5432/postgres";
const TEST_DB = "faq_test_model_failure";
process.env.DATABASE_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB}`);
process.env.API_KEY = "test-key";

let server, base, pool;
const post = (path, body) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "test-key" }, body: JSON.stringify(body) });

before(async () => {
  const admin = new pg.Client(ADMIN_URL);
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(readFileSync("migrations/001_init.sql", "utf8"));

  env.allowRemoteModels = false;
  const { config } = await import("../src/config.js");
  config.embeddingModel = "not-a-real/model";

  const { default: app } = await import("../src/app.js");
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  server?.close();
  const { pool: appPool } = await import("../src/db.js");
  await appPool.end();
  await pool.end();
  const admin = new pg.Client(ADMIN_URL);
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.end();
});

test("/ask returns 503 with Retry-After and /health reports the failed model", async () => {
  const res = await post("/ask", { question: "how do I reset my password?" });
  assert.equal(res.status, 503);
  assert.ok(res.headers.get("retry-after"));

  const health = await fetch(base + "/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).model, "failed");
});

test("documents are saved as pending, and re-embedding returns 503 while the model is down", async () => {
  const res = await post("/documents", { title: "Reset password", content: "Use the forgot password link." });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).embedding_status, "pending");

  assert.equal((await post("/documents/reembed", {})).status, 503);
  const { rows } = await pool.query("SELECT embedding_status FROM documents");
  assert.deepEqual(rows, [{ embedding_status: "pending" }]);
});
