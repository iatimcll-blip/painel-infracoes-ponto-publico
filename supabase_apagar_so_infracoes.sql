-- ============================================================================
-- "Apagar só Infrações (mantém Hierarquia)" — botão em Configurações, Zona de perigo
--
-- clear_infracoes_shared_data (já existente) apaga infracoes_registros E infracoes_roster
-- juntos. Pedido do usuário: um jeito de zerar só a Base de Infrações pra reimportar do zero,
-- SEM perder o vínculo GA/GO de cada colaborador já configurado em Hierarquia.
--
-- Mesmo padrão de segurança de toda ação destrutiva deste projeto: SECURITY DEFINER, liberado
-- só pra "authenticated" (Admin com sessão válida), nunca "anon"/"public".
--
-- Rode isto inteiro de uma vez no SQL Editor do Supabase (Dashboard do projeto
-- ymltjceiviyadckxzbxw > SQL Editor > New query > cola isto > Run).
-- ============================================================================

create or replace function public.clear_infracoes_registros_only()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from infracoes_registros where true;
end;
$$;
revoke all on function public.clear_infracoes_registros_only() from public, anon;
grant execute on function public.clear_infracoes_registros_only() to authenticated;
