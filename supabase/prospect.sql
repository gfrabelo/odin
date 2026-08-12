-- Odin Prospect — persistência de runs e leads.
-- Rode no Supabase: Dashboard → SQL Editor → New query → cole e Run.
--
-- Separado de `schema.sql` (que é do RAG) de propósito: são dois domínios
-- sem relação, e misturá-los faria uma migração de um arriscar o outro.
--
-- Por que persistir: sem isto o refresh apaga tudo e o mesmo negócio é
-- re-abordado num run seguinte — o que queima o lead e a reputação. É
-- também o que permite contar tentativas por nicho na estratégia de
-- demo-por-nicho.

-- ─── Runs ───────────────────────────────────────────────────────────

create table if not exists prospect_runs (
  id              uuid primary key default gen_random_uuid(),
  -- thread_id do LangGraph: liga a linha ao checkpoint do grafo.
  thread_id       text not null unique,
  task            text not null,
  -- Nicho e demo ficam aqui (não no lead) porque a estratégia é uma demo
  -- por nicho: é neste nível que "quantas tentativas já fiz" faz sentido.
  demo_context    text,
  status          text not null default 'running',
  total_found     int  not null default 0,
  total_qualified int  not null default 0,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz
);

-- ─── Leads ──────────────────────────────────────────────────────────

create table if not exists leads (
  id              bigint generated always as identity primary key,
  -- A constraint que impede re-contatar: telefone normalizado, ou hash de
  -- nome+localização. Ver lib/workflows/lead-key.ts.
  lead_key        text not null unique,
  run_id          uuid references prospect_runs(id) on delete set null,

  name            text not null,
  segment         text,
  phone           text,
  website         text,
  location        text,
  rating          numeric,
  source          text,
  google_maps_url text,

  score           int,
  qualified       boolean not null default false,
  reasoning       text,
  opportunities   text[] not null default '{}',
  message         text,
  whatsapp_link   text,

  -- O ÚNICO campo que o grafo não escreve. O wa.me abre o WhatsApp e nada
  -- reporta de volta, então "contatado" só pode ser afirmado pelo clique
  -- na UI (POST /api/leads/contacted). Ver ADR-0007.
  contact_status  text not null default 'novo',
    -- novo | contatado | respondeu | reuniao | fechado | descartado
  contacted_at    timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists leads_run_id_idx         on leads(run_id);
create index if not exists leads_contact_status_idx on leads(contact_status);
