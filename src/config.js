import "dotenv/config";

export const PORT = Number(process.env.PORT) || 3000;
export const DATABASE_URL = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/faq";
export const JINA_API_KEY = process.env.JINA_API_KEY || "";
export const JINA_MODEL = process.env.JINA_MODEL || "jina-embeddings-v3";
