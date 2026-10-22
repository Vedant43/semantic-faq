import { env, pipeline } from "@huggingface/transformers";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "./config.js";

const DIMENSIONS = 384;
const TIMEOUT_MS = 10_000;

env.cacheDir = config.modelCacheDir;

let modelPromise;
let status = "loading";

export const modelStatus = () => status;

export function loadModel() {
  if (!modelPromise) {
    status = "loading";
    modelPromise = pipeline("feature-extraction", config.embeddingModel)
      .then((model) => {
        status = "ready";
        return model;
      })
      .catch((err) => {
        status = "failed";
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
  const output = await withTimeout(loadModel().then((model) => model(text, { pooling: "mean", normalize: true })));
  const vector = Array.from(output.data);

  if (vector.length !== DIMENSIONS) {
    throw new Error(`Expected ${DIMENSIONS} dimensions, got ${vector.length}`);
  }

  return vector;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await loadModel();
}
