// Edge Function "robo-painel" — o "robozinho" assistente de atualização e interação do
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
  return resp.json();
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
  const porColaborador = Object.values(porNome).map((c: any) => ({ ...c, total: c.d7 + c.interj + c.hex }));
  porColaborador.sort((a: any, b: any) => b.total - a.total);
  return { ciclo_inicio, ga_filtrado: gaFiltro, total_colaboradores_com_infracao: porColaborador.length, colaboradores: porColaborador.slice(0, 60) };
}

async function runConsultarPendencias(input: any, ctx: Contexto) {
  const ciclo_inicio = input.ciclo_inicio || cicloInicioISO(new Date().toISOString().slice(0, 10));
  let gaFiltro: string | null = input.ga || null;
  if (ctx.role === 'ga') gaFiltro = ctx.gaNome;
  let path = 'infracoes_registros?select=data,nome,ga&ciclo_inicio=eq.' + encodeURIComponent(ciclo_inicio) + '&limit=3000';
  if (gaFiltro) path += '&ga=eq.' + encodeURIComponent(gaFiltro);
  const linhas = await pg(path);
  if (!linhas.length) return { ciclo_inicio, ga_filtrado: gaFiltro, pendentes: [] };
  const chaves = linhas.map((r: any) => justificativaKeyData(r.nome, ciclo_inicio, r.data));
  const justs: any[] = await pg('infracoes_justificativas?select=chave,texto&chave=in.(' + chaves.map((c: string) => '"' + c.replace(/"/g, '\\"') + '"').join(',') + ')');
  const comTexto = new Set(justs.filter(j => (j.texto || '').trim()).map(j => j.chave));
  const pendentes = linhas
    .filter((r: any) => !comTexto.has(justificativaKeyData(r.nome, ciclo_inicio, r.data)))
    .map((r: any) => ({ nome: r.nome, ga: r.ga, data: r.data }));
  return { ciclo_inicio, ga_filtrado: gaFiltro, total_pendentes: pendentes.length, pendentes: pendentes.slice(0, 80) };
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
  await pg('infracoes_justificativas', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ chave, texto, autor: ctx.username, atualizado_em: new Date().toISOString() }]),
  });
  return { ok: true, chave, nome, data, texto };
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
    description: 'Salva o texto de Justificativa (FCA) de UM colaborador em UMA data específica. Sempre confirme com o usuário o nome completo, a data exata e o texto antes de chamar — nunca invente nenhum dos três.',
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
];

async function executarFerramenta(nome: string, input: any, ctx: Contexto) {
  try {
    if (nome === 'consultar_infracoes') return await runConsultarInfracoes(input, ctx);
    if (nome === 'consultar_pendencias') return await runConsultarPendencias(input, ctx);
    if (nome === 'salvar_justificativa') return await runSalvarJustificativa(input, ctx);
    return { ok: false, erro: 'ferramenta desconhecida: ' + nome };
  } catch (e) {
    console.error('Falha ao executar ferramenta ' + nome, e);
    return { ok: false, erro: 'Falha interna ao executar "' + nome + '" — tente de novo em instantes.' };
  }
}

function montarSystemPrompt(ctx: Contexto) {
  let p = 'Você é o assistente do "Painel Infrações de Ponto" (Jarvis MCLL / alloha FIBRA). ' +
    'Responda SEMPRE em português, direto e objetivo (sem rodeios, sem markdown pesado). ' +
    'Nunca invente números — use as ferramentas pra consultar os dados reais antes de responder qualquer pergunta sobre infrações/pendências. ' +
    'Antes de salvar uma Justificativa (FCA), confirme com o usuário o nome completo do colaborador, a data exata e o texto, se qualquer um dos três não estiver 100% claro na mensagem dele.';
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
        max_tokens: 1024,
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
      const textoFinal = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim() || '(sem resposta)';
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
    if (!Array.isArray(mensagens) || !mensagens.length) {
      return new Response(JSON.stringify({ erro: 'mensagens vazio' }), { status: 400, headers: CORS_HEADERS });
    }
    const ctx: Contexto = {
      username: contexto?.username ?? null,
      role: contexto?.role ?? null,
      gaNome: contexto?.gaNome ?? null,
    };
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
