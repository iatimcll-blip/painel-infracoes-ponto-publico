-- ============================================================================
-- Sincronização automática entre dispositivos (Supabase Realtime)
--
-- Sem isto, uma mudança feita num dispositivo (upload de Base, edição de Justificativa/
-- hierarquia) só aparecia nos OUTROS quando alguém clicava "Atualizar dados agora" ou
-- recarregava a página inteira. O Supabase Realtime avisa o navegador via websocket assim que
-- um INSERT/UPDATE/DELETE acontece numa tabela — mas só pra tabelas que estejam na publicação
-- "supabase_realtime" (desligado por padrão em cada tabela nova). Isto liga pras 7 tabelas que
-- o painel sincroniza entre dispositivos (ver wireRealtimeSync() no painel2.html).
--
-- Idempotente — pode rodar de novo em cima de uma instalação já existente sem erro (o DO block
-- confere se a tabela já está na publicação antes de tentar adicionar de novo).
--
-- Rode isto inteiro de uma vez no SQL Editor do Supabase (Dashboard do projeto
-- ymltjceiviyadckxzbxw > SQL Editor > New query > cola isto > Run).
-- ============================================================================

do $$
declare
  tabelas text[] := array[
    'infracoes_registros', 'infracoes_roster', 'infracoes_meta', 'infracoes_justificativas',
    'bh_registros', 'dsr_registros', 'feriado_registros'
  ];
  t text;
begin
  foreach t in array tabelas loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
