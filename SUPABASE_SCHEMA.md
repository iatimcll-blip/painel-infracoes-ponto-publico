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
- **Upsert only** — nenhuma função de DELETE em massa. "Apagar" uma justificativa é um upsert
  com `texto = ''` (o painel já trata texto vazio como "sem justificativa" na leitura); remover
  hierarquia de 1 pessoa continua local-only (ver comentário perto de `he-remove` no
  `painel2.html` — não existe RPC de delete de 1 linha do roster ainda).
- A conta compartilhada `admin@painel-infracoes.local` é quem autentica como `authenticated`
  quando alguém loga como Admin no painel (ver `authLogin()`).

## Pendências conhecidas

*(nenhuma no momento — Base, Hierarquia, Justificativas e os 3 painéis auxiliares estão todos
cobertos pelo espelho horário desde 2026-10-01)*
