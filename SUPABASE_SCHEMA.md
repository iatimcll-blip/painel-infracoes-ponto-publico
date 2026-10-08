# Schema do Supabase — projeto `ymltjceiviyadckxzbxw`

Registro de todas as mudanças de schema feitas no banco compartilhado deste painel, pra nunca
mais depender de alguém lembrar "já rodei isso?" na hora de montar um ambiente novo ou auditar
o que existe em produção.

## Como aplicar uma migração nova

1. Escreva o SQL num arquivo novo `supabase_<nome>.sql` na raiz do repositório, seguindo o
   padrão dos arquivos já existentes (RLS com leitura pública + escrita só via RPC
   `security definer` liberada pra `authenticated`, nunca um `GRANT` direto na tabela).
2. Rode no **SQL Editor do Dashboard do Supabase** (Dashboard do projeto → SQL Editor → New
   query → cola o arquivo inteiro → Run) — é o jeito mais seguro, não exige nenhuma credencial
   nova. Alternativa: pedir uma PAT temporária (Management API) pra aplicar via script, nunca
   gravada em disco e revogada depois de usar (ver abaixo "Via PAT temporária").
3. Depois de confirmar que funcionou (rode um teste rápido: upsert de verdade, leitura pública,
   escrita anônima bloqueada), **marque como aplicada** na tabela abaixo com a data.
4. Se a migração adiciona uma tabela nova que o espelho horário (`sync-dados.yml` /
   `exportar_dados.py`) deveria incluir como backup, adicione a leitura dela lá também.

### Via PAT temporária (Management API)

Só quando pedido explicitamente pelo dono do projeto — gera uma PAT em
https://supabase.com/dashboard/account/tokens, usa uma vez via
`POST https://api.supabase.com/v1/projects/ymltjceiviyadckxzbxw/database/query` com
`{"query": "<conteúdo do .sql>"}`, e pede pra revogar o token assim que terminar. Nunca escrita
em arquivo — só passada como variável de ambiente na hora do comando.

## Migrações aplicadas

| Arquivo | O que cria | Aplicada em | Espelhada em `dados.json`? |
|---|---|---|---|
| *(pré-existente — sem .sql neste repo)* | `infracoes_registros`, `infracoes_roster`, `infracoes_meta` | antes desta integração começar | Sim (`registros`, `roster`) |
| [`supabase_auxiliares.sql`](supabase_auxiliares.sql) | `bh_registros`, `dsr_registros`, `feriado_registros` + RPCs `upsert_*` | 2026-09-22 | Não — painéis auxiliares ainda não têm espelho de backup |
| [`supabase_justificativas.sql`](supabase_justificativas.sql) | `infracoes_justificativas` (chave→texto genérica) + RPC `upsert_infracoes_justificativas` | 2026-09-30 | Sim (`justificativas`, desde 2026-10-01) |
| [`supabase_justificativas.sql`](supabase_justificativas.sql) (grant) | `grant execute ... to authenticated, anon` na RPC `upsert_infracoes_justificativas` (liberando escrita sincronizada também pra quem nunca logou) | 2026-10-02 | — |
| [`supabase_auxiliares.sql`](supabase_auxiliares.sql) (tabelas) | `bh_registros`, `dsr_registros`, `feriado_registros` | 2026-09-22 | Sim (`bh_registros`, `dsr_registros`, `feriado_registros`, desde 2026-10-01) |
| [`supabase_limpeza_bases.sql`](supabase_limpeza_bases.sql) | RPCs `limpar_infracoes_registros_fora_de`, `limpar_bh_registros_fora_de`, `limpar_dsr_registros_fora_de`, `limpar_feriado_registros_fora_de` (cada uma com `dry_run`) | 2026-10-07 | — |
| [`supabase_realtime.sql`](supabase_realtime.sql) | Liga as 7 tabelas (`infracoes_registros`, `infracoes_roster`, `infracoes_meta`, `infracoes_justificativas`, `bh_registros`, `dsr_registros`, `feriado_registros`) na publicação `supabase_realtime`, pro painel sincronizar sozinho entre dispositivos via websocket (ver `wireRealtimeSync()`) | 2026-10-08 | — |
| [`supabase_apagar_so_infracoes.sql`](supabase_apagar_so_infracoes.sql) | RPC `clear_infracoes_registros_only` (apaga só `infracoes_registros`, preserva `infracoes_roster`/Hierarquia) | 2026-10-08 | — |
| [`supabase_justificativa_autor.sql`](supabase_justificativa_autor.sql) | Coluna `autor` em `infracoes_justificativas` + atualiza `upsert_infracoes_justificativas` pra gravá-la | 2026-10-08 | Sim (campo `autor` incluso no espelho desde 2026-10-08) |

## Padrão de segurança usado em toda tabela deste projeto

- **Leitura pública** (`public_read` policy, `for select using (true)`) — Usuário Padrão vê sem
  precisar logar.
- **Escrita só via RPC `security definer`**, `grant execute ... to authenticated` (nunca
  `anon`/`public` direto na função, nunca `GRANT` na tabela em si).
  **Exceção única e deliberada:** `upsert_infracoes_justificativas` também libera `anon` desde
  2026-10-02 (decisão explícita do dono do projeto) — Justificativa é uma anotação de texto
  livre que qualquer usuário (logado ou não) já editava localmente desde que a feature existe;
  abrir a escrita sincronizada pra `anon` só torna consistente o que já era verdade na prática.
  Base/Hierarquia/painéis auxiliares continuam exigindo login de Admin pra escrever.
- **Upsert only (regra geral) — com 1 exceção deliberada:** nenhuma função de DELETE em massa
  pelas tabelas normais. "Apagar" uma justificativa é um upsert com `texto = ''` (o painel já
  trata texto vazio como "sem justificativa" na leitura); remover hierarquia de 1 pessoa continua
  local-only (ver comentário perto de `he-remove` no `painel2.html` — não existe RPC de delete de
  1 linha do roster ainda). **Exceção:** as 4 RPCs `limpar_*_fora_de` (ver
  `supabase_limpeza_bases.sql`) SÃO DELETE — existem especificamente porque upload de Base/
  planilha é sempre upsert e nunca remove quem sumiu do arquivo novo, então dados de uploads
  antigos ficavam acumulando pra sempre (confirmado em produção: `infracoes_registros` chegou a
  44.162 linhas em 2026-10-07, quando deveria ter poucos milhares — datas desde 2025-12-15 nunca
  limpas). Cada uma recebe as chaves de tudo que está na planilha carregada na tela (`mantidos`)
  e remove do servidor só o que não está nesse conjunto; tem `dry_run` (conta sem apagar) pra o
  painel mostrar quantas linhas seriam removidas ANTES de perguntar. Botões em Configurações →
  "Limpar dados de bases anteriores", um por painel (Infrações/BH/DSR/Feriados), authenticated-only.
- A conta compartilhada `admin@painel-infracoes.local` é quem autentica como `authenticated`
  quando alguém loga como Admin no painel (ver `authLogin()`).
- **Usuários por GA (2026-10-08):** login local (mesmo mecanismo do Admin, mas `role:'ga'` +
  `gaNome`) que só edita Justificativa dos colaboradores da própria área — client-side apenas
  (`campoJustEhEditavelPara()` no `painel2.html`), não muda nada no servidor: a RPC de
  Justificativa continua liberada pra `authenticated` E `anon`. Não tenta a sessão de escrita
  compartilhada no Supabase (não precisa — Justificativa já é anon-writable). O campo `autor`
  (ver `supabase_justificativa_autor.sql`) é só um registro informativo de quem salvou, não uma
  trava de acesso de verdade.

## Configuração de Auth (não é schema de tabela, mas afeta a sincronização)

- **`security_refresh_token_reuse_interval`: 60s** (era 10s — aumentado em 2026-10-02). Com
  rotação de refresh token ativada (`refresh_token_rotation_enabled: true`) e uma única conta
  compartilhada (`admin@painel-infracoes.local`) usada por vários GAs/dispositivos ao mesmo
  tempo, 10s de tolerância era pouco: duas abas/dispositivos renovando por perto um do outro
  faziam o Supabase achar que era reuso de um token já trocado e **revogava a sessão inteira**
  — aparecia como o badge "Sincronização expirada" pedindo login de novo, sem ninguém ter feito
  nada de errado. 60s dá mais folga sem abrir mão da rotação. Ajustado via Management API
  (`PATCH /v1/projects/ymltjceiviyadckxzbxw/config/auth`), não tem arquivo `.sql` (é config do
  projeto, não schema de tabela).
- `jwt_exp`: 3600 (1h, padrão) — token de acesso vence em 1h; `hasSupabaseWriteSession()` no
  `painel2.html` tenta renovar sozinha (`refreshSession()`) antes de mostrar o badge de
  expirado, cobrindo o caso comum de token vencido + refresh token ainda válido.

## Pendências conhecidas

*(nenhuma no momento — Base, Hierarquia, Justificativas e os 3 painéis auxiliares estão todos
cobertos pelo espelho horário desde 2026-10-01)*
