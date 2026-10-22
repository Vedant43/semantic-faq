import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL || "postgres://postgres:postgres@localhost:5432/postgres";
const TEST_DB = "faq_test";
const API_KEY = "test-key";

process.env.DATABASE_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB}`);
process.env.API_KEY = API_KEY;

let server, base, pool;

const headers = { "content-type": "application/json", "x-api-key": API_KEY };
const post = (path, body, h = headers) =>
  fetch(base + path, { method: "POST", headers: h, body: typeof body === "string" ? body : JSON.stringify(body) });
const add = (title, content) => post("/documents", { title, content });
const ask = async (question) => (await (await post("/ask", { question })).json()).results;

before(async () => {
  const admin = new pg.Client(ADMIN_URL);
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(readFileSync("migrations/001_init.sql", "utf8"));

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

describe("auth and validation", () => {
  test("missing or wrong key is 401", async () => {
    assert.equal((await post("/ask", { question: "hi" }, { "content-type": "application/json" })).status, 401);
    assert.equal((await post("/documents", {}, { ...headers, "x-api-key": "nope" })).status, 401);
  });

  test("invalid document is 400", async () => {
    for (const body of [{}, { title: "", content: "x" }, { title: "x", content: "  " }, { title: "x", content: "a".repeat(5001) }]) {
      assert.equal((await post("/documents", body)).status, 400);
    }
  });

  test("invalid question is 400", async () => {
    for (const body of [{}, { question: "" }, { question: 42 }, { question: "a".repeat(501) }]) {
      assert.equal((await post("/ask", body)).status, 400);
    }
  });
});

describe("retrieval", () => {
  test("empty store returns no results", async () => {
    assert.deepEqual(await ask("anything at all"), []);
  });

  test("ranks by meaning, not keywords, and returns the top three with scores", async () => {
    await add("Reset password", "Click 'Forgot password' on the login page and follow the emailed link to choose a new one.");
    await add("Refund policy", "Purchases can be refunded within 30 days if the product is unused. Contact billing to start a refund.");
    await add("Office hours", "Support is available Monday to Friday, 9am to 5pm UTC.");
    await add("Shipping times", "Orders usually arrive within five business days.");

    const login = await ask("I can't log in, how do I get a new password?");
    assert.equal(login.length, 3);
    assert.equal(login[0].title, "Reset password");

    const money = await ask("can I get my money back?");
    assert.equal(money[0].title, "Refund policy");

    for (const results of [login, money]) {
      const scores = results.map((r) => r.score);
      assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
      assert.ok(scores.every((s) => typeof s === "number" && s <= 1.0001));
    }
  });

  test("pending documents are not searched", async () => {
    await pool.query("INSERT INTO documents (title, content, content_hash) VALUES ('Parking', 'Visitor parking is in lot B.', repeat('0', 64))");
    const titles = (await ask("where can I park my car?")).map((r) => r.title);
    assert.ok(!titles.includes("Parking"));
  });
});

describe("canonical embeddings", () => {
  test("identical text is embedded once and reused", async () => {
    const before = (await pool.query("SELECT count(*)::int AS n FROM embeddings")).rows[0].n;
    const first = await add("Cache probe", "A snippet only this test adds.");
    const second = await add("Cache probe", "A snippet only this test adds.");
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);

    const after = (await pool.query("SELECT count(*)::int AS n FROM embeddings")).rows[0].n;
    assert.equal(after, before + 1);

    const { rows } = await pool.query(
      `SELECT d.embedding_id, e.embedding::text AS e
       FROM documents d JOIN embeddings e ON e.id = d.embedding_id
       WHERE d.title = 'Cache probe'`
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].embedding_id, rows[1].embedding_id);
    assert.equal(rows[0].e, rows[1].e);
  });

  test("cleanup removes only embeddings no document references", async () => {
    const [{ id: orphanId }] = (await pool.query(
      `INSERT INTO embeddings (content_hash, embedding_profile, embedding)
       VALUES (repeat('f', 64), 'unused-profile', ('[' || repeat('0,', 383) || '0]')::vector)
       RETURNING id`
    )).rows;
    const [{ id: retainedId }] = (await pool.query(
      `INSERT INTO embeddings (content_hash, embedding_profile, embedding)
       VALUES (repeat('e', 64), 'retained-profile', ('[' || repeat('0,', 383) || '0]')::vector)
       RETURNING id`
    )).rows;
    await pool.query(
      `INSERT INTO documents (title, content, content_hash, embedding_id, embedding_status)
       VALUES ('Retained', 'Referenced embedding.', repeat('e', 64), $1, 'ready')`,
      [retainedId]
    );
    await pool.query("UPDATE embeddings SET last_used_at = now() - interval '48 hours' WHERE id = $1", [orphanId]);

    const { cleanupOrphanedEmbeddings } = await import("../src/cleanupEmbeddings.js");
    await cleanupOrphanedEmbeddings(100);

    const { rows } = await pool.query("SELECT id FROM embeddings WHERE id = ANY($1::bigint[])", [[orphanId, retainedId]]);
    assert.deepEqual(rows.map((row) => row.id), [retainedId]);
  });
});

describe("re-embedding pending documents", () => {
  test("pending documents become ready and searchable", async () => {
    await pool.query("DELETE FROM documents WHERE embedding_status = 'pending'"); // leftovers from earlier tests
    await pool.query(
      "INSERT INTO documents (title, content, content_hash) VALUES ('Parking', 'Visitor parking is in lot B behind the main building.', repeat('0', 64))"
    );
    assert.ok(!(await ask("where can I park my car?")).some((r) => r.title === "Parking"));

    const res = await post("/documents/reembed", {});
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { reembedded: 1, remaining: 0 });

    const { rows } = await pool.query("SELECT embedding_status, embedding_id, content_hash FROM documents WHERE title = 'Parking'");
    assert.equal(rows[0].embedding_status, "ready");
    assert.ok(rows[0].embedding_id);
    assert.notEqual(rows[0].content_hash, "0".repeat(64));

    assert.equal((await ask("where can I park my car?"))[0].title, "Parking");
  });
});

describe("rate limiting", () => {
  test("/ask returns 429 once the per-minute limit is passed", async () => {
    const { config } = await import("../src/config.js");
    let blocked;
    for (let i = 0; i <= config.rateLimitPerMinute && !blocked; i++) {
      const res = await post("/ask", { question: "hello there" });
      if (res.status === 429) blocked = res;
    }
    assert.ok(blocked, "expected a 429");
    assert.match((await blocked.json()).error, /too many/i);
  });
});
