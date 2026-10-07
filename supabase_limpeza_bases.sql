-- ============================================================================
-- Limpar dados de bases anteriores (botões "Limpar X antigo" em Configurações)
--
-- Problema que isto resolve: upload de Base/planilha auxiliar é sempre upsert (ver
-- upsertBaseToSupabase/upsertAuxToSupabase no painel2.html) — nunca remove quem sumiu do
-- arquivo novo. Alguém cuja infração foi corrigida (não aparece mais na planilha mais recente)
-- continuava aparecendo no painel pra sempre, vindo de um upload antigo que nunca foi limpo.
--
-- Cada função abaixo recebe `mantidos` (as chaves únicas de tudo que está na planilha CARREGADA
-- AGORA na tela) e, com dry_run=true, só CONTA quantas linhas do servidor não estão nesse
-- conjunto (preview, sem mexer em nada); com dry_run=false (padrão), de fato apaga essas linhas
-- e devolve quantas foram removidas. O painel sempre chama com dry_run:true primeiro, mostra o
-- número pra quem está confirmando, e só chama de novo com dry_run:false depois da confirmação
-- digitada — nunca apaga sem avisar quantas linhas antes.
--
-- Mesmo padrão de segurança das outras tabelas: SECURITY DEFINER, liberado só pra
-- "authenticated" (Admin com sessão válida) — nunca "anon", já que isto é destrutivo e afeta
-- todo mundo que sincronizar com o painel.
--
-- Rode isto inteiro de uma vez no SQL Editor do Supabase (Dashboard do projeto
-- ymltjceiviyadckxzbxw > SQL Editor > New query > cola isto > Run).
-- ============================================================================

create or replace function public.limpar_infracoes_registros_fora_de(mantidos jsonb, dry_run boolean default false)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  qtd int;
begin
  if dry_run then
    select count(*) into qtd
    from public.infracoes_registros r
    where not exists (
      select 1 from jsonb_array_elements(mantidos) as m
      where (m->>'data')::date = r.data and m->>'funcid' = r.funcid
    );
    return qtd;
  end if;

  delete from public.infracoes_registros r
  where not exists (
    select 1 from jsonb_array_elements(mantidos) as m
    where (m->>'data')::date = r.data and m->>'funcid' = r.funcid
  );
  get diagnostics qtd = row_count;
  return qtd;
end;
$$;
revoke all on function public.limpar_infracoes_registros_fora_de(jsonb, boolean) from public, anon;
grant execute on function public.limpar_infracoes_registros_fora_de(jsonb, boolean) to authenticated;

create or replace function public.limpar_bh_registros_fora_de(mantidos jsonb, dry_run boolean default false)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  qtd int;
begin
  if dry_run then
    select count(*) into qtd
    from public.bh_registros r
    where not exists (
      select 1 from jsonb_array_elements(mantidos) as m
      where m->>'funcid' = r.funcid and m->>'limite_comp' = r.limite_comp
    );
    return qtd;
  end if;

  delete from public.bh_registros r
  where not exists (
    select 1 from jsonb_array_elements(mantidos) as m
    where m->>'funcid' = r.funcid and m->>'limite_comp' = r.limite_comp
  );
  get diagnostics qtd = row_count;
  return qtd;
end;
$$;
revoke all on function public.limpar_bh_registros_fora_de(jsonb, boolean) from public, anon;
grant execute on function public.limpar_bh_registros_fora_de(jsonb, boolean) to authenticated;

create or replace function public.limpar_dsr_registros_fora_de(mantidos jsonb, dry_run boolean default false)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  qtd int;
begin
  if dry_run then
    select count(*) into qtd
    from public.dsr_registros r
    where not exists (
      select 1 from jsonb_array_elements(mantidos) as m
      where m->>'funcid' = r.funcid and (m->>'data')::date = r.data
        and r.hora_inicio is not distinct from nullif(m->>'hora_inicio','')::time
    );
    return qtd;
  end if;

  delete from public.dsr_registros r
  where not exists (
    select 1 from jsonb_array_elements(mantidos) as m
    where m->>'funcid' = r.funcid and (m->>'data')::date = r.data
      and r.hora_inicio is not distinct from nullif(m->>'hora_inicio','')::time
  );
  get diagnostics qtd = row_count;
  return qtd;
end;
$$;
revoke all on function public.limpar_dsr_registros_fora_de(jsonb, boolean) from public, anon;
grant execute on function public.limpar_dsr_registros_fora_de(jsonb, boolean) to authenticated;

create or replace function public.limpar_feriado_registros_fora_de(mantidos jsonb, dry_run boolean default false)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  qtd int;
begin
  if dry_run then
    select count(*) into qtd
    from public.feriado_registros r
    where not exists (
      select 1 from jsonb_array_elements(mantidos) as m
      where m->>'funcid' = r.funcid and (m->>'data')::date = r.data
        and r.hora_inicio is not distinct from nullif(m->>'hora_inicio','')::time
    );
    return qtd;
  end if;

  delete from public.feriado_registros r
  where not exists (
    select 1 from jsonb_array_elements(mantidos) as m
    where m->>'funcid' = r.funcid and (m->>'data')::date = r.data
      and r.hora_inicio is not distinct from nullif(m->>'hora_inicio','')::time
  );
  get diagnostics qtd = row_count;
  return qtd;
end;
$$;
revoke all on function public.limpar_feriado_registros_fora_de(jsonb, boolean) from public, anon;
grant execute on function public.limpar_feriado_registros_fora_de(jsonb, boolean) to authenticated;
