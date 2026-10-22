import { env, pipeline } from "@huggingface/transformers";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "./config.js";

const DIMENSIONS = 384;
const TIMEOUT_MS = 10_000;

env.cacheDir = config.modelCacheDir;

let modelPromise;

export function loadModel() {
  if (!modelPromise) {
    modelPromise = pipeline("feature-extraction", config.embeddingModel).catch((err) => {
      modelPromise = undefined;
      throw err;
    });
  }
  return modelPromise;
}

function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Embedding timed out")), TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function embed(text) {
  const model = await loadModel();
  const output = await withTimeout(model(text, { pooling: "mean", normalize: true }));
  const vector = Array.from(output.data);

  if (vector.length !== DIMENSIONS) {
    throw new Error(`Expected ${DIMENSIONS} dimensions, got ${vector.length}`);
  }

  return vector;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await loadModel();
}
