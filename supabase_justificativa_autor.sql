-- ============================================================================
-- Autoria de Justificativa + usuários por GA
--
-- Pedido do usuário: "criar um usuario para cada GA... pra realizar suas justificativas e o
-- usuario Admin verifica todas". Sem registrar QUEM escreveu, o Admin não tinha como saber de
-- onde veio cada edição. Adiciona a coluna "autor" (nome de quem estava logado ao salvar — Admin
-- ou GA; fica NULL se foi um Usuário Padrão sem login, como sempre foi possível) e atualiza a
-- RPC de upsert pra gravá-la junto. O controle de QUEM PODE editar o quê (GA só edita a própria
-- área) é client-side, no painel2.html (campoJustEhEditavelPara) — a escrita no servidor
-- continua liberada pra authenticated E anon, como já decidido antes (ver
-- supabase_justificativas.sql); autoria é só um registro informativo, não uma trava de acesso.
--
-- Idempotente — "add column if not exists" não falha se já tiver sido aplicado antes.
--
-- Rode isto inteiro de uma vez no SQL Editor do Supabase (Dashboard do projeto
-- ymltjceiviyadckxzbxw > SQL Editor > New query > cola isto > Run).
-- ============================================================================

alter table public.infracoes_justificativas add column if not exists autor text;

create or replace function public.upsert_infracoes_justificativas(novos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.infracoes_justificativas (chave, texto, autor, atualizado_em)
  select (j->>'chave')::text, coalesce((j->>'texto')::text, ''), nullif(j->>'autor', ''), now()
  from jsonb_array_elements(novos) as j
  on conflict (chave) do update set
    texto = excluded.texto, autor = excluded.autor, atualizado_em = now();
end;
$$;
-- o grant não muda (authenticated + anon, mesma decisão de 2026-10-02) — só republicando a
-- função já é suficiente, mas o revoke/grant explícitos aqui deixam claro que nada de acesso
-- mudou nesta migração, só o corpo da função.
revoke all on function public.upsert_infracoes_justificativas(jsonb) from public;
grant execute on function public.upsert_infracoes_justificativas(jsonb) to authenticated, anon;
