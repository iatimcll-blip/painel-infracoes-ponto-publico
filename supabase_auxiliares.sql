-- ============================================================================
-- Tabelas auxiliares: Banco de Horas, DSR, Feriados
-- Mesmo padrão das tabelas de Infrações já existentes neste projeto:
--   - leitura pública (qualquer um vê os dados, sem login)
--   - escrita só via função upsert (security definer), liberada só pra "authenticated"
--     (a conta compartilhada admin@painel-infracoes.local por trás do Admin do painel)
--   - upsert only — nunca um DELETE em massa
-- Rode isto inteiro de uma vez no SQL Editor do Supabase (Dashboard do projeto
-- ymltjceiviyadckxzbxw > SQL Editor > New query > cola isto > Run).
-- ============================================================================

-- ---------- Banco de Horas ----------
create table if not exists public.bh_registros (
  id bigint generated always as identity primary key,
  funcid text not null,
  nome text not null,
  bu text,
  subbu text,
  limite_comp date not null,   -- data limite pra compensar (é o "ciclo" deste tema)
  horas text,                  -- "HH:MM" ou "-HH:MM" (negativo = banco devedor), como vem da planilha
  vlr numeric,
  dias numeric,
  ga text,
  go text,
  atualizado_em timestamptz not null default now(),
  unique (funcid, limite_comp)
);
alter table public.bh_registros enable row level security;
drop policy if exists public_read on public.bh_registros;
create policy public_read on public.bh_registros for select using (true);

create or replace function public.upsert_bh_registros(novos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.bh_registros (funcid, nome, bu, subbu, limite_comp, horas, vlr, dias, ga, go, atualizado_em)
  select
    (r->>'funcid')::text, (r->>'nome')::text, (r->>'bu')::text, (r->>'subbu')::text,
    (r->>'limite_comp')::date, (r->>'horas')::text, (r->>'vlr')::numeric, (r->>'dias')::numeric,
    (r->>'ga')::text, (r->>'go')::text, now()
  from jsonb_array_elements(novos) as r
  on conflict (funcid, limite_comp) do update set
    nome = excluded.nome, bu = excluded.bu, subbu = excluded.subbu,
    horas = excluded.horas, vlr = excluded.vlr, dias = excluded.dias,
    ga = excluded.ga, go = excluded.go, atualizado_em = now();
end;
$$;
revoke all on function public.upsert_bh_registros(jsonb) from public, anon;
grant execute on function public.upsert_bh_registros(jsonb) to authenticated;

-- ---------- DSR ----------
create table if not exists public.dsr_registros (
  id bigint generated always as identity primary key,
  data date not null,
  tipo_dia text,
  funcid text not null,
  nome text not null,
  gestor text,
  bu text,
  subbu text,
  hora_inicio time,
  hora_fim time,
  horas numeric,
  valor numeric,
  ga text,
  go text,
  atualizado_em timestamptz not null default now(),
  unique (funcid, data, hora_inicio)
);
alter table public.dsr_registros enable row level security;
drop policy if exists public_read on public.dsr_registros;
create policy public_read on public.dsr_registros for select using (true);

create or replace function public.upsert_dsr_registros(novos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.dsr_registros (data, tipo_dia, funcid, nome, gestor, bu, subbu, hora_inicio, hora_fim, horas, valor, ga, go, atualizado_em)
  select
    (r->>'data')::date, (r->>'tipo_dia')::text, (r->>'funcid')::text, (r->>'nome')::text, (r->>'gestor')::text,
    (r->>'bu')::text, (r->>'subbu')::text, (r->>'hora_inicio')::time, (r->>'hora_fim')::time,
    (r->>'horas')::numeric, (r->>'valor')::numeric, (r->>'ga')::text, (r->>'go')::text, now()
  from jsonb_array_elements(novos) as r
  on conflict (funcid, data, hora_inicio) do update set
    tipo_dia = excluded.tipo_dia, nome = excluded.nome, gestor = excluded.gestor,
    bu = excluded.bu, subbu = excluded.subbu, hora_fim = excluded.hora_fim,
    horas = excluded.horas, valor = excluded.valor, ga = excluded.ga, go = excluded.go, atualizado_em = now();
end;
$$;
revoke all on function public.upsert_dsr_registros(jsonb) from public, anon;
grant execute on function public.upsert_dsr_registros(jsonb) to authenticated;

-- ---------- Feriados ----------
create table if not exists public.feriado_registros (
  id bigint generated always as identity primary key,
  data date not null,
  funcid text not null,
  nome text not null,
  gestor text,
  bu text,
  subbu text,
  tipo text,             -- "01 - FERIADO", "02 - COMPENSAÇÃO"
  hora_inicio time,
  hora_fim time,
  horas numeric,
  valor numeric,
  tipo_feriado text,     -- NACIONAL / ESTADUAL / MUNICIPAL
  ga text,
  go text,
  atualizado_em timestamptz not null default now(),
  unique (funcid, data, hora_inicio)
);
alter table public.feriado_registros enable row level security;
drop policy if exists public_read on public.feriado_registros;
create policy public_read on public.feriado_registros for select using (true);

create or replace function public.upsert_feriado_registros(novos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.feriado_registros (data, funcid, nome, gestor, bu, subbu, tipo, hora_inicio, hora_fim, horas, valor, tipo_feriado, ga, go, atualizado_em)
  select
    (r->>'data')::date, (r->>'funcid')::text, (r->>'nome')::text, (r->>'gestor')::text,
    (r->>'bu')::text, (r->>'subbu')::text, (r->>'tipo')::text, (r->>'hora_inicio')::time, (r->>'hora_fim')::time,
    (r->>'horas')::numeric, (r->>'valor')::numeric, (r->>'tipo_feriado')::text, (r->>'ga')::text, (r->>'go')::text, now()
  from jsonb_array_elements(novos) as r
  on conflict (funcid, data, hora_inicio) do update set
    nome = excluded.nome, gestor = excluded.gestor, bu = excluded.bu, subbu = excluded.subbu,
    tipo = excluded.tipo, hora_fim = excluded.hora_fim, horas = excluded.horas, valor = excluded.valor,
    tipo_feriado = excluded.tipo_feriado, ga = excluded.ga, go = excluded.go, atualizado_em = now();
end;
$$;
revoke all on function public.upsert_feriado_registros(jsonb) from public, anon;
grant execute on function public.upsert_feriado_registros(jsonb) to authenticated;
