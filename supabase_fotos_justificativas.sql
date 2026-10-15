-- ============================================================================
-- Fotos + Nº do chamado em cada linha de Justificativa (FCA)
--
-- Pedido do usuário (2026-10-15): "colocar um anexo de foto para cada justificativa, no máx 3
-- fotos por justificativa, e as fotos ficarem armazenadas no Google Drive em uma pasta privada.
-- Para cada foto anexada deverá conter o número do chamado junto com a justificativa." Quem vê e
-- anexa: GA e Admin (Usuário Padrão sem login não vê nada disto).
--
-- As fotos em si NUNCA passam pelo Supabase — vão do navegador direto pro Web App do Google Apps
-- Script (google-apps-script/fotos-justificativas.gs), que roda na conta iatimcll@gmail.com e
-- grava numa pasta PRIVADA do Drive dela. O Supabase só guarda:
--   1) painel_sessoes — um token aleatório por login de GA/Admin. É o que o Apps Script confere
--      (via painel_validar_sessao) antes de aceitar/mostrar/apagar qualquer foto — sem isto,
--      qualquer pessoa com o link público do painel conseguiria encher o Drive ou ver as fotos.
--      Sem policy de leitura nenhuma (ninguém lê a tabela direto, só as funções abaixo).
--   2) infracoes_justificativas_anexos — chave da justificativa -> nº do chamado + lista de até 3
--      IDs de arquivo do Drive. Leitura pública (igual infracoes_justificativas: o ID de um
--      arquivo numa pasta privada não dá acesso a ele), escrita só via painel_salvar_anexos, que
--      exige um token válido e confere se um GA só está mexendo na PRÓPRIA área (infracoes_roster).
--
-- Idempotente. Rode isto inteiro de uma vez no SQL Editor do Supabase (Dashboard do projeto
-- ymltjceiviyadckxzbxw > SQL Editor > New query > cola isto > Run).
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.painel_sessoes (
  token text primary key,
  username text not null,
  role text not null check (role in ('admin', 'ga')),
  ga_nome text,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '30 days'
);
alter table public.painel_sessoes enable row level security;
-- de propósito: NENHUMA policy. Só as funções security definer abaixo tocam nesta tabela.

create table if not exists public.infracoes_justificativas_anexos (
  id bigint generated always as identity primary key,
  chave text not null unique,
  chamado text not null default '',
  fotos jsonb not null default '[]'::jsonb,
  autor text,
  atualizado_em timestamptz not null default now()
);
alter table public.infracoes_justificativas_anexos enable row level security;
drop policy if exists public_read on public.infracoes_justificativas_anexos;
create policy public_read on public.infracoes_justificativas_anexos for select using (true);

-- GA (ou Admin extra) sincronizado em painel_usuarios: valida usuário+senha (mesma conta do
-- painel_validar_login) e devolve um token novo.
create or replace function public.painel_criar_sessao(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  u record;
  tk text;
begin
  select * into u from painel_usuarios where lower(username) = lower(trim(p_username));
  if not found then return jsonb_build_object('ok', false); end if;
  if encode(digest(u.salt || p_password, 'sha256'), 'hex') <> u.hash then return jsonb_build_object('ok', false); end if;
  delete from painel_sessoes where expira_em < now();
  tk := encode(gen_random_bytes(32), 'hex');
  insert into painel_sessoes (token, username, role, ga_nome) values (tk, u.username, u.role, u.ga_nome);
  return jsonb_build_object('ok', true, 'token', tk);
end;
$$;
revoke all on function public.painel_criar_sessao(text, text) from public;
grant execute on function public.painel_criar_sessao(text, text) to anon, authenticated;

-- Admin "bootstrap" (usuário local, não existe em painel_usuarios): só consegue um token se já
-- estiver autenticado no Supabase (conta compartilhada de escrita) — authenticated-only.
create or replace function public.painel_criar_sessao_admin(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  tk text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false); end if;
  delete from painel_sessoes where expira_em < now();
  tk := encode(gen_random_bytes(32), 'hex');
  insert into painel_sessoes (token, username, role) values (tk, coalesce(nullif(trim(p_username), ''), 'admin'), 'admin');
  return jsonb_build_object('ok', true, 'token', tk);
end;
$$;
revoke all on function public.painel_criar_sessao_admin(text) from public, anon;
grant execute on function public.painel_criar_sessao_admin(text) to authenticated;

-- usada pelo Apps Script (com a chave anon) e pelo próprio painel. pode_editar = Admin sempre;
-- GA só se o colaborador da chave (parte antes de "::") for da área dele na Hierarquia.
create or replace function public.painel_validar_sessao(p_token text, p_chave text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  pode boolean;
begin
  select * into s from painel_sessoes where token = p_token and expira_em > now();
  if not found then return jsonb_build_object('ok', false); end if;
  pode := s.role = 'admin' or (
    p_chave is not null and exists (
      select 1 from infracoes_roster r where r.nome = split_part(p_chave, '::', 1) and r.ga = s.ga_nome
    )
  );
  return jsonb_build_object('ok', true, 'username', s.username, 'role', s.role, 'ga_nome', s.ga_nome, 'pode_editar', pode);
end;
$$;
revoke all on function public.painel_validar_sessao(text, text) from public;
grant execute on function public.painel_validar_sessao(text, text) to anon, authenticated;

create or replace function public.painel_encerrar_sessao(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from painel_sessoes where token = p_token;
$$;
revoke all on function public.painel_encerrar_sessao(text) from public;
grant execute on function public.painel_encerrar_sessao(text) to anon, authenticated;

-- grava nº do chamado + lista de fotos (array de {id, nome}, no máx 3) de UMA justificativa.
create or replace function public.painel_salvar_anexos(p_token text, p_chave text, p_chamado text, p_fotos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  v := painel_validar_sessao(p_token, p_chave);
  if not (v->>'ok')::boolean then return jsonb_build_object('ok', false, 'erro', 'sessao-invalida'); end if;
  if not (v->>'pode_editar')::boolean then return jsonb_build_object('ok', false, 'erro', 'sem-permissao'); end if;
  if p_fotos is null or jsonb_typeof(p_fotos) <> 'array' then p_fotos := '[]'::jsonb; end if;
  if jsonb_array_length(p_fotos) > 3 then return jsonb_build_object('ok', false, 'erro', 'max-3-fotos'); end if;
  insert into infracoes_justificativas_anexos (chave, chamado, fotos, autor, atualizado_em)
  values (p_chave, left(coalesce(trim(p_chamado), ''), 60), p_fotos, v->>'username', now())
  on conflict (chave) do update set
    chamado = excluded.chamado, fotos = excluded.fotos, autor = excluded.autor, atualizado_em = now();
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.painel_salvar_anexos(text, text, text, jsonb) from public;
grant execute on function public.painel_salvar_anexos(text, text, text, jsonb) to anon, authenticated;

-- realtime: outros dispositivos veem chamado/fotos novos sem recarregar (ver wireRealtimeSync)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'infracoes_justificativas_anexos'
  ) then
    alter publication supabase_realtime add table public.infracoes_justificativas_anexos;
  end if;
end $$;
