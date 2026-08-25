-- ============================================================
-- Casa Aura — esquema inicial
-- ------------------------------------------------------------
-- NÃO APLICADO. A conta tem organização mas nenhum projeto, e criar
-- projeto Supabase é ação cobrável — fica para o Thiago decidir.
-- Depois de criar o projeto:
--     supabase link --project-ref <ref>
--     supabase db push
--
-- Duas tabelas, com propósitos opostos em relação a quem escreve:
--
--   project_configs  o cliente final só LÊ. É o que tira os parâmetros de
--                    iluminação do JavaScript e permite ajustar um imóvel
--                    sem gerar build novo.
--   analytics        o cliente final só ESCREVE, e não pode ler nada. É
--                    telemetria de sessão: sem ela não há como saber em
--                    que tier o parque de aparelhos realmente cai.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- configuração por imóvel ----------
create table if not exists public.project_configs (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,           -- ?projeto=casa-aura
  nome          text not null,
  -- As paradas atmosféricas inteiras, no mesmo formato de LP no cliente.
  -- Guardar como jsonb e não em colunas: o conjunto de parâmetros muda
  -- junto com o shader, e uma migração por parâmetro novo seria atrito
  -- sem retorno.
  luz           jsonb not null default '{}'::jsonb,
  -- contato do corretor, CTA, textos comerciais
  comercial     jsonb not null default '{}'::jsonb,
  publicado     boolean not null default false,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.project_configs enable row level security;

-- Leitura pública SÓ do que está publicado. Um imóvel em preparação não
-- aparece para quem adivinhar o slug.
create policy "config publicada e legivel por qualquer um"
  on public.project_configs for select
  using (publicado = true);

-- ---------- telemetria de sessão ----------
create table if not exists public.analytics (
  id            bigserial primary key,
  sessao        uuid not null,
  slug          text,
  criado_em     timestamptz not null default now(),
  -- o que decide se a meta de 60fps está sendo cumprida no parque real
  tier          text,
  fps_medio     real,
  fps_p05       real,          -- o percentil baixo importa mais que a média
  quadro_ms     real,
  draw_calls    int,
  programas     int,
  ms_ate_pronto int,           -- tempo até a cena aparecer
  -- contexto do aparelho, para cruzar com o tier escolhido
  ua            text,
  memoria_gb    real,
  nucleos       int,
  dpr           real,
  tela          text,
  webgl2        boolean,
  max_textura   int
);

alter table public.analytics enable row level security;

-- Só INSERT anônimo. Sem select: telemetria de um cliente não pode ser
-- lida por outro cliente, e o painel interno usa a service key.
create policy "qualquer um pode inserir telemetria"
  on public.analytics for insert
  with check (true);

create index if not exists analytics_slug_data on public.analytics (slug, criado_em desc);
create index if not exists analytics_tier on public.analytics (tier);

-- Leitura agregada para o painel, sem expor linha individual.
create or replace view public.analytics_resumo as
  select slug, tier,
         count(*)                as sessoes,
         round(avg(fps_medio)::numeric, 1)     as fps_medio,
         round(avg(fps_p05)::numeric, 1)       as fps_p05,
         round(avg(ms_ate_pronto)::numeric, 0) as ms_ate_pronto,
         round(avg(draw_calls)::numeric, 0)    as draw_calls
    from public.analytics
   group by slug, tier;
