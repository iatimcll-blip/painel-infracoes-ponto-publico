-- ============================================================================
-- Sincronização de usuários (Admin + GA) entre dispositivos
--
-- Bug real relatado: usuários de GA importados no navegador do Admin não conseguiam logar em
-- NENHUM outro dispositivo — AUTH.users sempre foi só localStorage, sem nada no servidor. Um GA
-- abrindo o painel pela primeira vez no PRÓPRIO celular/computador simplesmente não tinha o
-- usuário cadastrado ali, e a senha "não batia" porque o login nem existia naquele navegador.
--
-- Esta tabela guarda username/salt/hash/role/ga_nome de todo usuário local (Admin extra ou GA)
-- criado via authAddUser()/authAddUsersBulk(). NUNCA é lida diretamente pelo cliente (sem
-- policy de SELECT nenhuma) — só através de painel_validar_login(), que devolve apenas
-- "bateu ou não" + role/ga_nome em caso de sucesso, nunca salt/hash. Isso evita expor hashes de
-- senha publicamente (mesmo sendo SHA-256 simples, sem isso qualquer um poderia baixar a lista
-- inteira e tentar quebrar offline).
--
-- O Admin "bootstrap" (usuário "admin", senha padrão do código) continua funcionando 100% local
-- em qualquer navegador — ele é recriado sozinho por loadAuth() se AUTH.users estiver vazio,
-- nunca precisou de servidor pra isso. Esta sincronização é só pra usuários CRIADOS depois
-- (Admins extras e GAs).
--
-- Rode isto inteiro de uma vez no SQL Editor do Supabase (Dashboard do projeto
-- ymltjceiviyadckxzbxw > SQL Editor > New query > cola isto > Run).
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.painel_usuarios (
  username text primary key,
  salt text not null,
  hash text not null,
  role text not null default 'admin' check (role in ('admin', 'ga')),
  ga_nome text,
  atualizado_em timestamptz not null default now()
);
alter table public.painel_usuarios enable row level security;
-- de propósito: NENHUMA policy de leitura. Ninguém lê esta tabela direto, nem authenticated —
-- só as 3 funções abaixo (security definer) tocam nela.

-- valida usuário+senha SEM NUNCA devolver salt/hash — só confirma "bateu" e, se sim, o papel
-- (role) e a área (ga_nome) pra authLogin() montar a sessão local.
-- search_path inclui "extensions" de propósito: no Supabase o pgcrypto (função digest(), usada
-- abaixo) é instalado nesse schema, não em "public" — com search_path só "public" a função dava
-- erro 42883 "function digest(text, unknown) does not exist" em QUALQUER chamada que chegasse a
-- usá-la (confirmado em produção: toda tentativa de login de um usuário que REALMENTE existia na
-- tabela falhava com esse erro — só não aparecia pra usuário inexistente, que retorna antes de
-- chegar no digest()).
create or replace function public.painel_validar_login(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  u record;
  calc text;
begin
  select * into u from painel_usuarios where lower(username) = lower(trim(p_username));
  if not found then return jsonb_build_object('ok', false); end if;
  calc := encode(digest(u.salt || p_password, 'sha256'), 'hex');
  if calc <> u.hash then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'username', u.username, 'role', u.role, 'ga_nome', u.ga_nome);
end;
$$;
revoke all on function public.painel_validar_login(text, text) from public;
grant execute on function public.painel_validar_login(text, text) to anon, authenticated;

-- cria/atualiza um usuário sincronizado — recebe salt+hash JÁ CALCULADOS pelo cliente (a senha
-- em texto puro nunca passa por aqui, só pela validação de login acima). Authenticated-only:
-- só um Admin com sessão de escrita válida consegue publicar usuários novos, igual
-- Base/Hierarquia/painéis auxiliares.
create or replace function public.painel_sincronizar_usuario(p_username text, p_salt text, p_hash text, p_role text, p_ga_nome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into painel_usuarios (username, salt, hash, role, ga_nome, atualizado_em)
  values (trim(p_username), p_salt, p_hash, p_role, nullif(p_ga_nome, ''), now())
  on conflict (username) do update set
    salt = excluded.salt, hash = excluded.hash, role = excluded.role, ga_nome = excluded.ga_nome, atualizado_em = now();
end;
$$;
revoke all on function public.painel_sincronizar_usuario(text, text, text, text, text) from public, anon;
grant execute on function public.painel_sincronizar_usuario(text, text, text, text, text) to authenticated;

-- remove um usuário sincronizado — sem isto, alguém removido localmente continuava logando em
-- qualquer outro dispositivo via painel_validar_login.
create or replace function public.painel_remover_usuario_sync(p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from painel_usuarios where lower(username) = lower(trim(p_username));
end;
$$;
revoke all on function public.painel_remover_usuario_sync(text) from public, anon;
grant execute on function public.painel_remover_usuario_sync(text) to authenticated;
