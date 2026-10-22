CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE embeddings (
  id BIGSERIAL PRIMARY KEY,
  content_hash CHAR(64) NOT NULL,
  embedding_profile TEXT NOT NULL,
  embedding vector(384) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (content_hash, embedding_profile)
);

CREATE INDEX embeddings_vector_idx ON embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  embedding_id BIGINT REFERENCES embeddings(id) ON DELETE RESTRICT,
  embedding_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (embedding_status IN ('pending','ready')),
  CONSTRAINT ready_requires_embedding
    CHECK (embedding_status <> 'ready' OR embedding_id IS NOT NULL),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX documents_embedding_id_idx ON documents (embedding_id);
