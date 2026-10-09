// Edge Function "robo-painel" — Jarvis, o assistente de atualização e interação do
// Painel Infrações de Ponto. Fica no servidor (nunca no navegador) justamente pra guardar a
// ANTHROPIC_API_KEY em segredo: se ela fosse usada direto do painel.html, qualquer pessoa que
// abrisse o DevTools conseguiria roubá-la. O cliente (painel2.html) manda a conversa + o
// contexto de quem está logado; esta função chama a Anthropic com um laço de tool-use
// (consultar dados / salvar Justificativa) e devolve só a resposta final em texto.
//
// Deploy (sem Supabase CLI instalada neste ambiente — ver SUPABASE_SCHEMA.md "Robô do painel"
// pra o passo a passo completo via Management API):
//   1. Criar a função com este arquivo.
//   2. Definir o segredo: ANTHROPIC_API_KEY (console.anthropic.com → API Keys).
//   3. SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente em toda Edge Function.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODELO = 'claude-sonnet-5-5';

// pequeno client REST manual (sem importar @supabase/supabase-js) — chama o PostgREST direto
// com a service role key, que ignora RLS (a autorização de quem pode ver/editar o quê é feita
// AQUI, em runSalvarJustificativa/runConsultarInfracoes, nunca delegada pro banco).
async function pg(path: string, init: RequestInit = {}) {
  const resp = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...init,
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!resp.ok) throw new Error('PostgREST ' + resp.status + ': ' + (await resp.text()));
  // bug real encontrado: um POST/PATCH sem "Prefer: return=representation" volta 2xx com corpo
  // VAZIO (padrão do PostgREST) — chamar resp.json() nesse caso sempre quebrava com "Unexpected
  // end of JSON input", disfarçado de "falha interna" pro usuário (runSalvarJustificativa nunca
  // conseguia terminar com sucesso, mesmo quando o INSERT/UPSERT já tinha sido feito).
  const texto = await resp.text();
  return texto ? JSON.parse(texto) : null;
}

// mesma regra de ciclo de pagamento (15 a 14) de cicloOf() em painel2.html, reimplementada aqui
// porque esta função roda isolada, sem acesso ao código do painel.
function cicloInicioISO(dataISO: string): string {
  const [y, m, d] = dataISO.split('-').map(Number);
  let startY = y, startM = m;
  if (d < 15) { startM -= 1; if (startM === 0) { startM = 12; startY -= 1; } }
  return startY + '-' + String(startM).padStart(2, '0') + '-15';
}
function justificativaKeyData(nome: string, cicloInicio: string, dataISO: string): string {
  return nome + '::ciclo:' + cicloInicio + '|' + dataISO;
}

type Contexto = { username: string | null; role: 'admin' | 'ga' | 'usuario' | null; gaNome: string | null };

// ----- ferramentas que o modelo pode chamar -----

async function runConsultarInfracoes(input: any, ctx: Contexto) {
  const ciclo_inicio = input.ciclo_inicio || cicloInicioISO(new Date().toISOString().slice(0, 10));
  let gaFiltro: string | null = input.ga || null;
  if (ctx.role === 'ga') gaFiltro = ctx.gaNome; // GA nunca vê outra área, mesmo que peça
  let path = 'infracoes_registros?select=data,nome,ga,go,dias7,interj,he2&ciclo_inicio=eq.' + encodeURIComponent(ciclo_inicio) + '&limit=3000';
  if (gaFiltro) path += '&ga=eq.' + encodeURIComponent(gaFiltro);
  const linhas = await pg(path);
  const porNome: Record<string, any> = {};
  for (const r of linhas) {
    if (!porNome[r.nome]) porNome[r.nome] = { nome: r.nome, ga: r.ga, go: r.go, d7: 0, interj: 0, hex: 0, datas: [] as string[] };
    porNome[r.nome].d7 += r.dias7 || 0;
    porNome[r.nome].interj += r.interj || 0;
    porNome[r.nome].hex += r.he2 || 0;
    porNome[r.nome].datas.push(r.data);
  }
  const porColaborador = Object.values(porNome).map((c: any) => ({ nome: c.nome, ga: c.ga, go: c.go, d7: c.d7, interj: c.interj, hex: c.hex, total: c.d7 + c.interj + c.hex }));
  porColaborador.sort((a: any, b: any) => b.total - a.total);
  // soma geral já pronta (não obriga o modelo a somar dezenas de colaboradores "de cabeça" pra
  // responder "quantas infrações no total") — e a lista fica mais enxuta (sem o array `datas`,
  // que só importa pra detalhar UM colaborador, não pra uma visão geral) e MENOR (top 25, não
  // 60): um ciclo com 80+ colaboradores gerava um resultado tão grande que o modelo gastava todo
  // o orçamento de "pensamento estendido" só processando aquilo, sem sobrar nada pra responder
  // (bug real: stop_reason "max_tokens" com resposta vazia — ver também o aumento de max_tokens
  // em chamarAnthropic).
  const totalGeral = porColaborador.reduce((s: number, c: any) => s + c.total, 0);
  return {
    ciclo_inicio, ga_filtrado: gaFiltro,
    total_colaboradores_com_infracao: porColaborador.length,
    total_infracoes_geral: totalGeral,
    top_colaboradores: porColaborador.slice(0, 25),
  };
}

async function runConsultarPendencias(input: any, ctx: Contexto) {
  const ciclo_inicio = input.ciclo_inicio || cicloInicioISO(new Date().toISOString().slice(0, 10));
  let gaFiltro: string | null = input.ga || null;
  if (ctx.role === 'ga') gaFiltro = ctx.gaNome;
  let path = 'infracoes_registros?select=data,nome,ga&ciclo_inicio=eq.' + encodeURIComponent(ciclo_inicio) + '&limit=3000';
  if (gaFiltro) path += '&ga=eq.' + encodeURIComponent(gaFiltro);
  const linhas = await pg(path);
  if (!linhas.length) return { ciclo_inicio, ga_filtrado: gaFiltro, total_pendentes: 0, pendentes: [] };
  // bug real encontrado: construir um filtro in.("chave1","chave2",...) com uma chave por LINHA
  // (às vezes 300+) sem url-encode em cada uma (chave tem espaço, acento, : e | — nenhum deles
  // seguro cru numa query string) gerava uma URL inválida/gigante e o pg() sempre falhava. Em vez
  // disso, busca TODAS as justificativas desse ciclo de uma vez só com "like" (chave sempre
  // termina em "::ciclo:<início>|<data>" — o início do ciclo aparece sempre nesse formato), 1
  // request só, sem depender de quantas linhas a Base tem.
  const likePattern = encodeURIComponent('*::ciclo:' + ciclo_inicio + '|*');
  const justs: any[] = await pg('infracoes_justificativas?select=chave,texto&chave=like.' + likePattern);
  const comTexto = new Set(justs.filter(j => (j.texto || '').trim()).map(j => j.chave));
  const pendentes = linhas
    .filter((r: any) => !comTexto.has(justificativaKeyData(r.nome, ciclo_inicio, r.data)))
    .map((r: any) => ({ nome: r.nome, ga: r.ga, data: r.data }));
  // mesmo cuidado de tamanho de runConsultarInfracoes — devolve o total certo sempre, mas só
  // lista até 30 linhas (o modelo já sabe, pelo total_pendentes, que a lista pode estar cortada).
  return { ciclo_inicio, ga_filtrado: gaFiltro, total_pendentes: pendentes.length, pendentes: pendentes.slice(0, 30) };
}

async function runSalvarJustificativa(input: any, ctx: Contexto) {
  const nome = (input.nome || '').toString().trim();
  const data = (input.data || '').toString().trim();
  const texto = (input.texto || '').toString().trim();
  if (!nome || !/^\d{4}-\d{2}-\d{2}$/.test(data) || !texto) {
    return { ok: false, erro: 'Faltou nome, data (AAAA-MM-DD) ou texto — confirme os 3 com o usuário antes de chamar esta ferramenta de novo.' };
  }
  // trava de segurança equivalente a campoJustEhEditavelPara() do painel: um GA só grava dentro
  // da própria área, mesmo que o modelo (ou alguém manipulando o cliente) tente mandar outro
  // nome — reconfere a área de verdade no servidor, nunca confia só no que o cliente afirma.
  if (ctx.role === 'ga') {
    const roster = await pg('infracoes_roster?select=ga&nome=eq.' + encodeURIComponent(nome) + '&limit=1');
    const gaDoNome = roster[0]?.ga || null;
    if (gaDoNome !== ctx.gaNome) {
      return { ok: false, erro: nome + ' não é da sua área (' + ctx.gaNome + ') — não é possível salvar.' };
    }
  }
  const cicloInicio = cicloInicioISO(data);
  const chave = justificativaKeyData(nome, cicloInicio, data);
  // bug real encontrado: sem "on_conflict=chave" na URL, o PostgREST não sabe qual coluna usar
  // como alvo do upsert e tenta um INSERT puro — que batia na constraint única toda vez que já
  // existia uma justificativa pra esse colaborador+data (erro 23505 "duplicate key value"),
  // disfarçado de "falha interna" pro usuário. "chave" já tem UNIQUE (ver
  // infracoes_justificativas_chave_key) — é o mesmo alvo que upsert_infracoes_justificativas usa.
  await pg('infracoes_justificativas?on_conflict=chave', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ chave, texto, autor: ctx.username, atualizado_em: new Date().toISOString() }]),
  });
  return { ok: true, chave, nome, data, texto };
}

// pedido do usuário: "Permitir que ele encaminhe mensagem direta para qualquer um dos usuários
// cadastrados no painel" — "usuários cadastrados" = o bootstrap "admin" (conta única, sempre
// válida) + qualquer GA sincronizado em painel_usuarios (ver supabase_mensagens.sql). Busca por
// nome do GA OU nome de usuário (ilike, tolera acento/caixa diferente e nome parcial) — o Jarvis
// recebe só o que a pessoa escreveu em linguagem natural, não o username exato de login.
async function runEnviarMensagem(input: any, ctx: Contexto) {
  const busca = (input.destinatario || '').toString().trim();
  const texto = (input.texto || '').toString().trim();
  if (!busca || !texto) return { ok: false, erro: 'Faltou pra quem mandar ou o texto da mensagem.' };
  let destinatarioUsername: string | null = null;
  let destinatarioLabel: string | null = null;
  if (busca.toLowerCase() === 'admin' || busca.toLowerCase() === 'administrador') {
    destinatarioUsername = 'admin';
    destinatarioLabel = 'Administrador';
  } else {
    const padrao = encodeURIComponent('*' + busca + '*');
    const usuarios: any[] = await pg('painel_usuarios?select=username,ga_nome&or=(username.ilike.' + padrao + ',ga_nome.ilike.' + padrao + ')');
    if (!usuarios.length) {
      return { ok: false, erro: 'Não achei nenhum usuário cadastrado parecido com "' + busca + '". Confira o nome com a pessoa que pediu, ou peça pra listar os GAs cadastrados.' };
    }
    if (usuarios.length > 1) {
      return { ok: false, erro: 'Achei mais de um usuário parecido com "' + busca + '": ' + usuarios.map((u: any) => u.ga_nome || u.username).join(', ') + '. Peça pra especificar melhor.' };
    }
    destinatarioUsername = usuarios[0].username;
    destinatarioLabel = usuarios[0].ga_nome || usuarios[0].username;
  }
  await pg('painel_mensagens', {
    method: 'POST',
    body: JSON.stringify([{ destinatario: destinatarioUsername, remetente: ctx.username, texto }]),
  });
  return { ok: true, destinatario: destinatarioLabel, texto };
}

const FERRAMENTAS = [
  {
    name: 'consultar_infracoes',
    description: 'Consulta infrações (>7 dias trabalhados, interjornada, >2h de horas extras) por colaborador, num ciclo de pagamento (sempre do dia 15 ao dia 14). Use para responder quantidade/tipo de infração de uma pessoa, de uma área (GA) ou geral.',
    input_schema: {
      type: 'object',
      properties: {
        ga: { type: 'string', description: 'Nome do GA (gestor de área) pra filtrar. Vazio = todas as áreas (só válido se o usuário atual for Admin; para um GA, é sempre forçado pra área dele mesmo).' },
        ciclo_inicio: { type: 'string', description: 'Início do ciclo, AAAA-MM-DD (sempre dia 15). Vazio = ciclo atual.' },
      },
    },
  },
  {
    name: 'consultar_pendencias',
    description: 'Lista infrações que ainda não têm nenhuma Justificativa (FCA) preenchida no ciclo.',
    input_schema: {
      type: 'object',
      properties: {
        ga: { type: 'string', description: 'Nome do GA pra filtrar (mesma regra de consultar_infracoes).' },
        ciclo_inicio: { type: 'string', description: 'Início do ciclo, AAAA-MM-DD. Vazio = ciclo atual.' },
      },
    },
  },
  {
    name: 'salvar_justificativa',
    description: 'Salva o texto de Justificativa (FCA) de UM colaborador em UMA data específica. Chame direto, sem pedir confirmação extra, sempre que a mensagem do usuário já trouxer os 3 dados (nome completo, data, texto) com clareza — só pergunte de volta quando algum dos três estiver genuinamente faltando ou ambíguo (nunca invente nenhum dos três).',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome completo do colaborador, exatamente como aparece no painel.' },
        data: { type: 'string', description: 'Data da infração, AAAA-MM-DD.' },
        texto: { type: 'string', description: 'Texto da Justificativa (FCA).' },
      },
      required: ['nome', 'data', 'texto'],
    },
  },
  {
    name: 'enviar_mensagem',
    description: 'Manda uma mensagem direta pra outro usuário cadastrado do painel (um GA, ou "admin" pro Administrador) — ele vê a mensagem na próxima vez que entrar no painel. Chame direto quando o usuário pedir pra avisar/mandar recado/encaminhar algo pra alguém, sem precisar confirmar de novo se o destinatário e o texto já estão claros.',
    input_schema: {
      type: 'object',
      properties: {
        destinatario: { type: 'string', description: 'Nome do GA (ou "admin") pra quem mandar — pode ser parcial, em linguagem natural.' },
        texto: { type: 'string', description: 'Texto da mensagem.' },
      },
      required: ['destinatario', 'texto'],
    },
  },
];

async function executarFerramenta(nome: string, input: any, ctx: Contexto) {
  try {
    if (nome === 'consultar_infracoes') return await runConsultarInfracoes(input, ctx);
    if (nome === 'consultar_pendencias') return await runConsultarPendencias(input, ctx);
    if (nome === 'salvar_justificativa') return await runSalvarJustificativa(input, ctx);
    if (nome === 'enviar_mensagem') return await runEnviarMensagem(input, ctx);
    return { ok: false, erro: 'ferramenta desconhecida: ' + nome };
  } catch (e) {
    console.error('Falha ao executar ferramenta ' + nome, e);
    return { ok: false, erro: 'Falha interna ao executar "' + nome + '" — tente de novo em instantes.' };
  }
}

function montarSystemPrompt(ctx: Contexto) {
  let p = 'Você é o Jarvis, assistente do "Painel Infrações de Ponto" (MCLL / alloha FIBRA) — um rapaz jovem, cordial e direto, não um robô genérico. ' +
    'Responda SEMPRE em português, com um tom simpático e objetivo (sem rodeios, sem markdown pesado). ' +
    'Aja de forma AUTÔNOMA — pedido explícito do usuário. ' +
    'Nunca invente números — use as ferramentas pra consultar os dados reais antes de responder qualquer pergunta sobre infrações/pendências. ' +
    'Quando o usuário pedir pra salvar uma Justificativa (FCA) e a mensagem já trouxer o nome completo do colaborador, a data e o texto com clareza, SALVE DIRETO — não pare pra confirmar de novo algo que a pessoa já disse. ' +
    'Só pergunte de volta quando faltar ou estiver ambíguo o nome, a data ou o texto (por exemplo: "qual colaborador?", "qual data exatamente?") — nunca como uma confirmação de algo que já está claro. Depois de salvar, confirme em 1 frase curta o que foi feito (nome, data, texto). ' +
    'Quando pedirem pra mandar uma mensagem/recado/aviso pra outro usuário do painel (um GA ou o Administrador), use enviar_mensagem direto, sem pedir confirmação extra se o destinatário e o texto já estão claros.';
  if (ctx.role === 'ga' && ctx.gaNome) {
    p += ' O usuário atual é o GA "' + ctx.gaNome + '" — ele só pode ver e alterar dados da PRÓPRIA área. ' +
      'Nunca tente consultar ou alterar outra área, mesmo que ele peça; explique educadamente que só vê a própria equipe.';
  } else if (ctx.role === 'admin') {
    p += ' O usuário atual é Admin — pode consultar e alterar qualquer área.';
  } else {
    p += ' O usuário atual não está logado como Admin/GA — trate qualquer pedido de alteração com cautela extra e confirme bem antes de salvar.';
  }
  return p;
}

async function chamarAnthropic(mensagens: any[], ctx: Contexto) {
  if (!ANTHROPIC_API_KEY) {
    return { resposta: 'O assistente ainda não foi configurado neste servidor (falta a chave de API). Avise o Admin.', alterou_dados: false };
  }
  const historico = mensagens.slice(-20); // não deixa a conversa crescer sem limite a cada chamada
  let alterouDados = false; // vira true só se salvar_justificativa de fato gravar (ok:true) — o
  // cliente usa isto pra saber quando vale recarregar a tela sozinho, sem precisar adivinhar a
  // partir do texto livre da resposta.
  for (let volta = 0; volta < 6; volta++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODELO,
        // 1024 era pouco: com um resultado de ferramenta grande (ex.: ciclo com 80+
        // colaboradores), o "pensamento estendido" do modelo sozinho já consumia o limite
        // inteiro, sem sobrar nada pra resposta final — stop_reason virava "max_tokens" com
        // texto vazio (bug real, reproduzido e confirmado). 4096 dá folga pra pensar E responder.
        max_tokens: 4096,
        system: montarSystemPrompt(ctx),
        tools: FERRAMENTAS,
        messages: historico,
      }),
    });
    if (!resp.ok) {
      const texto = await resp.text();
      console.error('Anthropic API erro', resp.status, texto);
      throw new Error('Anthropic API ' + resp.status);
    }
    const data = await resp.json();
    historico.push({ role: 'assistant', content: data.content });
    if (data.stop_reason !== 'tool_use') {
      let textoFinal = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
      if (!textoFinal) {
        // rede de segurança (não deveria mais acontecer com max_tokens:4096, mas se um dia um
        // resultado de ferramenta vier gigante de novo, melhor essa mensagem clara do que
        // "(sem resposta)" sem explicação nenhuma).
        textoFinal = data.stop_reason === 'max_tokens'
          ? 'A resposta ficou grande demais pra processar de uma vez — tente perguntar de um jeito mais específico (ex.: só um GA, ou um resumo em vez da lista completa).'
          : '(sem resposta)';
      }
      return { resposta: textoFinal, alterou_dados: alterouDados };
    }
    const usosDeFerramenta = (data.content || []).filter((b: any) => b.type === 'tool_use');
    const resultados = [];
    for (const uso of usosDeFerramenta) {
      const resultado = await executarFerramenta(uso.name, uso.input, ctx);
      if (uso.name === 'salvar_justificativa' && resultado && resultado.ok) alterouDados = true;
      resultados.push({ type: 'tool_result', tool_use_id: uso.id, content: JSON.stringify(resultado) });
    }
    historico.push({ role: 'user', content: resultados });
  }
  return { resposta: 'Não consegui concluir essa consulta em tempo — tente perguntar de um jeito mais direto.', alterou_dados: alterouDados };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  try {
    const { mensagens, contexto } = await req.json();
    const ctx: Contexto = {
      username: contexto?.username ?? null,
      role: contexto?.role ?? null,
      gaNome: contexto?.gaNome ?? null,
    };
    if (!Array.isArray(mensagens) || !mensagens.length) {
      return new Response(JSON.stringify({ erro: 'mensagens vazio' }), { status: 400, headers: CORS_HEADERS });
    }
    const resultado = await chamarAnthropic(mensagens, ctx);
    return new Response(JSON.stringify(resultado), { headers: { ...CORS_HEADERS, 'content-type': 'application/json' } });
  } catch (e) {
    console.error('robo-painel falhou', e);
    return new Response(JSON.stringify({ erro: 'Não foi possível falar com o assistente agora. Tente de novo em instantes.' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  }
});
