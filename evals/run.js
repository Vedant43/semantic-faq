import { readFileSync } from "node:fs";
import pg from "pg";

const ADMIN_URL = process.env.EVAL_ADMIN_DATABASE_URL || "postgres://postgres:postgres@localhost:5432/postgres";
const EVAL_DB = "faq_eval";
const K = 3;
const KEY = "eval-key";

process.env.DATABASE_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${EVAL_DB}`);
process.env.API_KEY = KEY;
process.env.RATE_LIMIT_PER_MINUTE = "100000";

const { documents, questions } = JSON.parse(readFileSync(new URL("./dataset.json", import.meta.url), "utf8"));

function score(ranked, relevant) {
  const rel = new Set(relevant);
  const rank = ranked.findIndex((title) => rel.has(title)) + 1; // 0 means not in the top K
  const dcg = ranked.reduce((sum, title, i) => sum + (rel.has(title) ? 1 / Math.log2(i + 2) : 0), 0);
  const ideal = Array.from({ length: Math.min(rel.size, K) }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0);
  return { hit1: rank === 1, hitK: rank > 0, rr: rank ? 1 / rank : 0, ndcg: dcg / ideal, rank };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x) => `${(100 * x).toFixed(0)}%`;
const f2 = (x) => x.toFixed(2);
const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))];

function summarize(rows) {
  return {
    n: rows.length,
    hit1: mean(rows.map((r) => +r.hit1)),
    hitK: mean(rows.map((r) => +r.hitK)),
    mrr: mean(rows.map((r) => r.rr)),
    ndcg: mean(rows.map((r) => r.ndcg)),
  };
}

// ---- run ----
const admin = new pg.Client(ADMIN_URL);
let server, pool;
try {
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${EVAL_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${EVAL_DB}`);
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(readFileSync(new URL("../migrations/001_init.sql", import.meta.url), "utf8"));

  const { default: app } = await import("../src/app.js");
  const { config } = await import("../src/config.js");
  server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  const post = (path, body) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-api-key": KEY }, body: JSON.stringify(body) });

  for (const d of documents) {
    const res = await post("/documents", d);
    if (res.status !== 201 || (await res.json()).embedding_status !== "ready") throw new Error(`could not index "${d.title}"`);
  }
  await post("/ask", { question: "warm up" });

  const results = [];
  for (const q of questions) {
    const t0 = performance.now();
    const res = await post("/ask", { question: q.question });
    const ms = performance.now() - t0;
    if (res.status !== 200) throw new Error(`/ask returned ${res.status} for "${q.question}"`);
    const returned = (await res.json()).results;
    const ranked = returned.map((r) => r.title);
    results.push({
      ...q,
      ms,
      top1Score: returned[0]?.score ?? 0,
      returned: returned.map((r) => `${r.title} (${f2(r.score)})`),
      sem: score(ranked, q.relevant),
    });
  }

  // ---- report ----
  const answerable = results.filter((r) => r.relevant.length);
  const outOfDomain = results.filter((r) => !r.relevant.length);
  const categories = [...new Set(answerable.map((r) => r.category))];

  const row = (label, rows) => {
    const s = summarize(rows.map((r) => r.sem));
    return `| ${label} | ${s.n} | ${pct(s.hit1)} | ${pct(s.hitK)} | ${f2(s.mrr)} | ${f2(s.ndcg)} |`;
  };
  const table = () =>
    [
      "| Questions | n | Hit@1 | Hit@3 | MRR | nDCG@3 |",
      "|---|---|---|---|---|---|",
      ...categories.map((c) => row(c, answerable.filter((r) => r.category === c))),
      row("**all answerable**", answerable),
    ].join("\n");

  console.log(`# Retrieval eval\n`);
  console.log(`Model \`${config.embeddingModel}\`, ${documents.length} documents, ${questions.length} questions (${answerable.length} answerable, ${outOfDomain.length} out-of-domain).`);
  console.log(`Hit@k = a relevant document is in the top k. MRR and nDCG@3 reward ranking it higher. A "hard" question may have two acceptable answers.\n`);
  console.log(`## Results\n\n${table()}\n`);

  const correct = answerable.filter((r) => r.sem.hit1);
  const wrong = answerable.filter((r) => !r.sem.hit1);
  console.log(`## Scores\n`);
  console.log(`Top-1 score, mean: ${f2(mean(correct.map((r) => r.top1Score)))} when the top result is right (${correct.length}), ${wrong.length ? f2(mean(wrong.map((r) => r.top1Score))) : "n/a"} when it is not (${wrong.length}), ${f2(mean(outOfDomain.map((r) => r.top1Score)))} for out-of-domain questions (${outOfDomain.length}).\n`);
  console.log(`If the API only answered above a minimum top-1 score:\n`);
  console.log(`| Min score | Answerable questions answered | Out-of-domain questions answered |`);
  console.log(`|---|---|---|`);
  for (const t of [0.2, 0.3, 0.4, 0.5]) {
    console.log(`| ${t} | ${pct(mean(answerable.map((r) => +(r.top1Score >= t))))} | ${pct(mean(outOfDomain.map((r) => +(r.top1Score >= t))))} |`);
  }

  const ms = results.map((r) => r.ms);
  console.log(`\n## Latency\n`);
  console.log(`\`POST /ask\` over local HTTP, warm, sequential: p50 ${quantile(ms, 0.5).toFixed(0)} ms, p95 ${quantile(ms, 0.95).toFixed(0)} ms, max ${Math.max(...ms).toFixed(0)} ms (${ms.length} requests, includes embedding the question and the database search).\n`);

  const misses = answerable.filter((r) => !r.sem.hit1);
  console.log(`## Semantic misses (${misses.length})\n`);
  for (const r of misses) {
    console.log(`- "${r.question}" expected ${r.relevant.join(" or ")}; got ${r.sem.rank ? `rank ${r.sem.rank}` : "not in top 3"}: ${r.returned.join(", ")}`);
  }
} finally {
  server?.close();
  const { pool: appPool } = await import("../src/db.js").catch(() => ({}));
  await appPool?.end();
  await pool?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${EVAL_DB} WITH (FORCE)`).catch(() => {});
  await admin.end().catch(() => {});
}
