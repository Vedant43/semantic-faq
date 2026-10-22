import { after, before, test } from "node:test";
import assert from "node:assert/strict";

// Postgres is unreachable (nothing listens on port 1): a generic 500, not a crash.
process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:1/faq";
process.env.API_KEY = "test-key";

let server, base;
const post = (path, body) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-api-key": "test-key" }, body: JSON.stringify(body) });

before(async () => {
  const { default: app } = await import("../src/app.js");
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  server?.close();
  const { pool } = await import("../src/db.js");
  await pool.end();
});

test("database down returns a generic 500 and the server stays up", async () => {
  for (const [path, body] of [["/documents", { title: "Hello", content: "World" }], ["/ask", { question: "anything" }]]) {
    const res = await post(path, body);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "Internal server error" });
  }
  assert.equal((await fetch(base + "/health")).status, 200);
});
