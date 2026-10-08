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
| [`supabase_usuarios_sync.sql`](supabase_usuarios_sync.sql) | Tabela `painel_usuarios` (sem policy de leitura — só via RPC) + RPCs `painel_validar_login` (anon+authenticated), `painel_sincronizar_usuario`/`painel_remover_usuario_sync` (authenticated-only) — login de GA/Admin extra passa a funcionar em qualquer dispositivo, não só no navegador onde foi criado | 2026-10-08 | — |
| [`supabase_usuarios_sync.sql`](supabase_usuarios_sync.sql) (fix) | `painel_validar_login`: `search_path` passa a incluir `extensions` (schema onde o Supabase instala o pgcrypto) — sem isto, `digest()` dava erro 42883 em QUALQUER login de usuário que realmente existisse na tabela (confirmado em produção: todos os 14 GAs recém-sincronizados ficaram impossíveis de logar até este fix) | 2026-10-08 | — |

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
- **Usuários por GA (2026-10-08):** login (mesmo mecanismo do Admin, mas `role:'ga'` + `gaNome`)
  que só edita Justificativa dos colaboradores da própria área — a RESTRIÇÃO de quem pode editar
  o quê é client-side (`campoJustEhEditavelPara()` no `painel2.html`): a RPC de Justificativa
  continua liberada pra `authenticated` E `anon`, não muda. GA não tenta a sessão de escrita
  compartilhada no Supabase (não precisa — Justificativa já é anon-writable). O campo `autor`
  (ver `supabase_justificativa_autor.sql`) é só um registro informativo de quem salvou, não uma
  trava de acesso de verdade.
  **O CADASTRO do usuário em si, porém, É sincronizado** (ver `supabase_usuarios_sync.sql`,
  2026-10-08) — sem isto, um GA só conseguia logar no MESMO navegador de quem criou o usuário
  (bug real reportado: "as senhas não estão dando corretas", um GA tentando logar no PRÓPRIO
  aparelho pela primeira vez). `authLogin()` tenta local primeiro, cai pro servidor
  (`painel_validar_login`) se não achar — nunca expõe salt/hash, só confirma se bateu.

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

## Robô do painel (Edge Function, não é schema de tabela)

Pedido do usuário (2026-10-08): "Criar um robozinho no qual ele será o agente de atualização e
interação do painel" — um assistente de chat embutido no `painel2.html` (botão flutuante no
canto inferior direito, só visível pra quem está logado), que usa IA (Anthropic) pra responder
perguntas sobre os dados reais (infrações, pendências de Justificativa) e pra salvar uma
Justificativa (FCA) que o usuário dite em linguagem natural.

- **Nunca fala direto com a API de IA pelo navegador** — a chave de API não pode existir no
  `painel2.html` (qualquer um com DevTools a roubaria). Em vez disso, o cliente chama a Edge
  Function `robo-painel` (`sb.functions.invoke('robo-painel', {...})`), que roda no servidor do
  Supabase, guarda a `ANTHROPIC_API_KEY` como segredo, e é quem de fato chama a Anthropic.
  Código-fonte: [`supabase/functions/robo-painel/index.ts`](supabase/functions/robo-painel/index.ts).
- **Ferramentas (tool-use) que o modelo pode chamar:** `consultar_infracoes`, `consultar_pendencias`
  (ambas leem `infracoes_registros`/`infracoes_justificativas` direto via `service_role`, que
  ignora RLS — a autorização de quem pode ver o quê é feita NO CÓDIGO da função, não delegada
  pro banco) e `salvar_justificativa` (reconfere no servidor, via `infracoes_roster`, que um GA
  só está salvando dentro da própria área — mesma trava de `campoJustEhEditavelPara()` do
  painel, só que reimplementada aqui porque é uma chamada separada, não passa pelo
  `painel2.html`). Grava em `infracoes_justificativas` com a MESMA chave
  (`nome::ciclo:<início>|<data>`) que o painel usa — uma edição manual depois encontra e
  atualiza a mesma linha, nunca cria uma segunda solta.
- **Segredos necessários** (`supabase secrets set`, ou via Management API — ver deploy abaixo):
  `ANTHROPIC_API_KEY`. `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` já existem automaticamente em
  toda Edge Function, não precisam ser configurados.
- **Deploy:** sem Supabase CLI instalada no ambiente onde isto foi desenvolvido — a implantação
  real (criar a função + definir o segredo) ainda não foi feita até a escrita desta nota.
  Quando for feita, usar a Management API (`POST/PATCH .../v1/projects/<ref>/functions/<slug>`
  pro código da função, `POST .../v1/projects/<ref>/secrets` pro segredo) com uma PAT temporária
  — mesmo padrão de "Via PAT temporária" no topo deste arquivo: nunca gravada em disco, revogada
  depois de usar. Alternativa mais simples se/quando a CLI estiver disponível:
  `supabase functions deploy robo-painel` + `supabase secrets set ANTHROPIC_API_KEY=...`.
- **Cliente (`painel2.html`):** botão `#robo-fab` + painel `#robo-panel`, visibilidade ligada a
  `atualizarRoboVisibilidade()` (chamada de dentro de `updateRoleBadge()`, então acompanha login/
  logout automaticamente). Enquanto a Edge Function não estiver implantada, o botão aparece
  normalmente mas qualquer mensagem volta com um erro amigável — não exige outro deploy do
  painel quando a função for implantada depois.

## Pendências conhecidas

- **Robô do painel ainda não está no ar:** a UI (botão + chat) já está publicada, mas a Edge
  Function `robo-painel` em si (e a `ANTHROPIC_API_KEY`) ainda não foram implantadas — falta (1)
  o usuário gerar uma chave em console.anthropic.com e (2) uma PAT temporária da Management API
  pra fazer o deploy. Até lá, o botão aparece mas o chat responde só com "assistente ainda não
  configurado".
