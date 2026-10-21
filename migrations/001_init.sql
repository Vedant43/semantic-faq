CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  embedding vector(384),
  embedding_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (embedding_status IN ('pending','ready')),
  CONSTRAINT ready_requires_embedding
    CHECK (embedding_status <> 'ready' OR embedding IS NOT NULL),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE embedding_cache (
  content_hash CHAR(64) NOT NULL,
  model TEXT NOT NULL,
  embedding vector(384) NOT NULL,
  PRIMARY KEY (content_hash, model)
);

CREATE INDEX documents_embedding_idx ON documents USING hnsw (embedding vector_cosine_ops);