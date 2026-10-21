import { env, pipeline } from "@huggingface/transformers";
import { EMBEDDING_MODEL, MODEL_CACHE_DIR } from "./config.js";

const DIMENSIONS = 384;

env.cacheDir = MODEL_CACHE_DIR;

// Loaded once at startup
const model = await pipeline("feature-extraction", EMBEDDING_MODEL);

export async function embed(text) {
  const output = await model(text, { pooling: "mean", normalize: true });
  const vector = Array.from(output.data);

  if (vector.length !== DIMENSIONS) {
    throw new Error(`Expected ${DIMENSIONS} dimensions, got ${vector.length}`);
  }

  return vector;
}
