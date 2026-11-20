-- ============================================================================
-- Escala 5X2 — dados sincronizados entre dispositivos, separados por GA
--
-- Pedido do usuário (2026-11-20): "quando o GA atualizar com seu acesso as informações são
-- sincronizadas automaticamente". Antes a escala ficava só no navegador de cada pessoa.
--
-- Uma linha por "fatia" da escala:
--   chave = 'ga:<NOME DO GA>'  -> colaboradores daquele GA + férias, folgas fixadas, sobreaviso,
--                                 ajustes por dia, substitutos (tudo só das pessoas desse GA)
--   chave = 'geral'            -> colaboradores sem GA (ex.: escalas fixas) + dias sem sobreaviso
-- O nome do GA na chave vai em MAIÚSCULAS, sem acento e com espaços simples (mesma regra do
-- escala5x2.html, função chaveGA).
--
-- Leitura pública (como as demais tabelas do painel). Escrita SÓ pela função escala5x2_salvar,
-- que exige o token de sessão do login do painel (painel_sessoes, ver
-- supabase_fotos_justificativas.sql) e confere: GA só grava a PRÓPRIA chave; Admin grava qualquer
-- uma. Assim um GA nunca altera os dados de outro GA.
--
-- Idempotente. Rode isto inteiro de uma vez no SQL Editor do Supabase (Dashboard do projeto
-- ymltjceiviyadckxzbxw > SQL Editor > New query > cola isto > Run).
-- Requer supabase_fotos_justificativas.sql já aplicado (tabela painel_sessoes).
-- ============================================================================

create table if not exists public.escala5x2_estado (
  chave text primary key,
  dados jsonb not null default '{}'::jsonb,
  autor text,
  atualizado_em timestamptz not null default now()
);
alter table public.escala5x2_estado enable row level security;
drop policy if exists public_read on public.escala5x2_estado;
create policy public_read on public.escala5x2_estado for select using (true);
-- de propósito: nenhuma policy de insert/update/delete — só a função abaixo grava.

create or replace function public.escala5x2_chave_nome(t text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    translate(upper(trim(coalesce(t, ''))), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'AAAAAEEEEIIIIOOOOOUUUUCN'),
    '\s+', ' ', 'g');
$$;

create or replace function public.escala5x2_salvar(p_token text, p_chave text, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  agora timestamptz := now();
begin
  select * into s from painel_sessoes where token = p_token and expira_em > now();
  if not found then return jsonb_build_object('ok', false, 'erro', 'sessao'); end if;
  if p_chave is null or (p_chave <> 'geral' and p_chave not like 'ga:%') then
    return jsonb_build_object('ok', false, 'erro', 'chave');
  end if;
  if s.role = 'ga' then
    if p_chave <> 'ga:' || escala5x2_chave_nome(s.ga_nome) then
      return jsonb_build_object('ok', false, 'erro', 'permissao');
    end if;
  elsif s.role <> 'admin' then
    return jsonb_build_object('ok', false, 'erro', 'permissao');
  end if;
  insert into escala5x2_estado (chave, dados, autor, atualizado_em)
  values (p_chave, coalesce(p_dados, '{}'::jsonb), s.username, agora)
  on conflict (chave) do update set dados = excluded.dados, autor = excluded.autor, atualizado_em = excluded.atualizado_em;
  return jsonb_build_object('ok', true, 'atualizado_em', agora);
end;
$$;
revoke all on function public.escala5x2_salvar(text, text, jsonb) from public;
grant execute on function public.escala5x2_salvar(text, text, jsonb) to anon, authenticated;
