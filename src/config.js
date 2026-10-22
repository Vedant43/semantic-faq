import "dotenv/config";

const embeddingModel = process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";

export const config = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/faq",
  apiKey: process.env.API_KEY || "",
  embeddingModel,
  embeddingProfile: process.env.EMBEDDING_PROFILE || `${embeddingModel}|mean-normalize|document-text-v1`,
  modelCacheDir: process.env.MODEL_CACHE_DIR || ".model-cache",
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE) || 30,
};
