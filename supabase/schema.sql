-- Odin RAG — schema pgvector
-- Rode no Supabase: Dashboard → SQL Editor → New query → cole e Run.
-- (Ou eu rodo via Supabase MCP quando estiver autenticado.)

-- 1. Extensão pgvector
create extension if not exists vector;

-- 2. Tabela de chunks do segundo cérebro
create table if not exists documents (
  id          bigint generated always as identity primary key,
  content     text not null,
  metadata    jsonb not null default '{}'::jsonb,
  embedding   vector(768),               -- text-embedding-004 = 768 dims
  created_at  timestamptz not null default now()
);

-- 3. Índice de similaridade (cosine, HNSW)
create index if not exists documents_embedding_idx
  on documents using hnsw (embedding vector_cosine_ops);

-- 4. Função de busca por similaridade
create or replace function match_documents(
  query_embedding vector(768),
  match_count int default 6,
  filter jsonb default '{}'::jsonb
)
returns table (id bigint, content text, metadata jsonb, similarity float)
language plpgsql
as $$
begin
  return query
  select d.id, d.content, d.metadata,
         1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where d.metadata @> filter
  order by d.embedding <=> query_embedding
  limit match_count;
end;
$$;
