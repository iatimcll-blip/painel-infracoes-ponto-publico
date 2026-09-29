-- ============================================================================
-- Justificativa (FCA) — sincronização entre dispositivos
-- Mesmo padrão das outras tabelas deste projeto:
--   - leitura pública (qualquer um vê as justificativas, sem login)
--   - escrita só via função upsert (security definer), liberada só pra "authenticated"
--     (a conta compartilhada admin@painel-infracoes.local por trás do Admin do painel)
--   - upsert only — nunca um DELETE em massa; "apagar" uma justificativa é um upsert com
--     texto = '' (o painel já trata texto vazio como "sem justificativa" na leitura)
--
-- Tabela genérica chave->texto de propósito: a "chave" já embute nome + tipo de período +
-- valor do período (e, na tabela de Infrações, a data específica da infração) — ver
-- justificativaKey/justificativaKeyData/justificativaKeyAux no painel2.html. Isso evita
-- acoplar o schema ao formato da chave, e a mesma tabela serve pra Infrações e pros 3 painéis
-- auxiliares (Banco de Horas, DSR, Feriados) sem qualquer mudança.
--
-- Rode isto inteiro de uma vez no SQL Editor do Supabase (Dashboard do projeto
-- ymltjceiviyadckxzbxw > SQL Editor > New query > cola isto > Run).
-- ============================================================================

create table if not exists public.infracoes_justificativas (
  id bigint generated always as identity primary key,
  chave text not null unique,
  texto text not null default '',
  atualizado_em timestamptz not null default now()
);
alter table public.infracoes_justificativas enable row level security;
drop policy if exists public_read on public.infracoes_justificativas;
create policy public_read on public.infracoes_justificativas for select using (true);

create or replace function public.upsert_infracoes_justificativas(novos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.infracoes_justificativas (chave, texto, atualizado_em)
  select (j->>'chave')::text, coalesce((j->>'texto')::text, ''), now()
  from jsonb_array_elements(novos) as j
  on conflict (chave) do update set
    texto = excluded.texto, atualizado_em = now();
end;
$$;
revoke all on function public.upsert_infracoes_justificativas(jsonb) from public, anon;
grant execute on function public.upsert_infracoes_justificativas(jsonb) to authenticated;
