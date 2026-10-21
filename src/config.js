import "dotenv/config";

export const PORT = Number(process.env.PORT) || 3000;
export const DATABASE_URL = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/faq";
export const API_KEY = process.env.API_KEY || "";
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";
export const MODEL_CACHE_DIR = process.env.MODEL_CACHE_DIR || ".model-cache";
