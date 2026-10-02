-- ============================================================================
-- Justificativa (FCA) — sincronização entre dispositivos
-- Padrão deste projeto, com UMA diferença de propósito (ver abaixo):
--   - leitura pública (qualquer um vê as justificativas, sem login)
--   - escrita via função upsert (security definer) — LIBERADA TANTO PRA "anon" QUANTO PRA
--     "authenticated": decisão explícita do usuário (2026-10-02) — diferente de Base/
--     Hierarquia/painéis auxiliares, que continuam exigindo login de Admin pra escrever, a
--     Justificativa é uma anotação de texto livre, já editável localmente por qualquer um
--     (Usuário Padrão incluído) desde que a feature existe; abrir a ESCRITA SINCRONIZADA
--     pra "anon" também só torna consistente o que já era verdade localmente — qualquer
--     pessoa com o link do painel consegue gravar uma Justificativa sem senha nenhuma.
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
-- ymltjceiviyadckxzbxw > SQL Editor > New query > cola isto > Run) — idempotente, pode rodar
-- de novo em cima de uma instalação já existente pra só aplicar a mudança de grant pro "anon".
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
revoke all on function public.upsert_infracoes_justificativas(jsonb) from public;
grant execute on function public.upsert_infracoes_justificativas(jsonb) to authenticated, anon;
