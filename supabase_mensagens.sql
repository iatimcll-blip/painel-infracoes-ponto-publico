-- Mensagens diretas entre usuários cadastrados do painel, encaminhadas pelo Jarvis (pedido do
-- usuário: "Permitir que ele encaminhe mensagem direta para qualquer um dos usuários cadastrados
-- no painel"). Mesmo padrão de segurança do resto do projeto (ver SUPABASE_SCHEMA.md):
-- leitura pública (RLS) + escrita só via RPC security definer, liberada pra authenticated E anon
-- (mesma exceção já usada em upsert_infracoes_justificativas — GA não tem sessão de escrita
-- compartilhada no Supabase, então a RPC precisa aceitar anon pra funcionar pra todo mundo).

create table if not exists painel_mensagens (
  id bigint generated always as identity primary key,
  destinatario text not null,
  remetente text,
  texto text not null,
  lida boolean not null default false,
  criado_em timestamptz not null default now()
);

alter table painel_mensagens enable row level security;

drop policy if exists "public_read" on painel_mensagens;
create policy "public_read" on painel_mensagens for select using (true);

create or replace function enviar_mensagem_painel(p_destinatario text, p_remetente text, p_texto text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_destinatario is null or trim(p_destinatario) = '' or p_texto is null or trim(p_texto) = '' then
    raise exception 'destinatario e texto são obrigatórios';
  end if;
  insert into painel_mensagens (destinatario, remetente, texto) values (trim(p_destinatario), nullif(trim(coalesce(p_remetente, '')), ''), p_texto);
end;
$$;
grant execute on function enviar_mensagem_painel(text, text, text) to authenticated, anon;

create or replace function marcar_mensagens_lidas_painel(p_destinatario text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update painel_mensagens set lida = true where destinatario = p_destinatario and lida = false;
end;
$$;
grant execute on function marcar_mensagens_lidas_painel(text) to authenticated, anon;
