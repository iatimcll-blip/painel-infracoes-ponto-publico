/**
 * Fotos das Justificativas (FCA) — Web App do Google Apps Script
 *
 * Roda na conta Google dona da pasta (iatimcll@gmail.com) e grava as fotos numa pasta PRIVADA
 * do Drive dela. O painel (GitHub Pages) nunca tem credencial do Google: manda a foto pra cá
 * junto com o token de sessão do GA/Admin, e este script confere o token no Supabase
 * (painel_validar_sessao) antes de qualquer coisa. Ver supabase_fotos_justificativas.sql.
 *
 * Instalação (uma vez só):
 *   1. https://script.google.com > Novo projeto (logado em iatimcll@gmail.com) > cole este arquivo.
 *   2. Selecione a função "configurar" > Executar > autorize o acesso ao Drive. O log mostra o
 *      link da pasta criada ("Painel Infrações - Fotos das Justificativas"), privada por padrão.
 *   3. Implantar > Nova implantação > tipo "App da Web" > Executar como: "Eu" > Quem pode acessar:
 *      "Qualquer pessoa" > Implantar. Copie a URL que termina em /exec e coloque em
 *      FOTOS_API_URL no index.html. ("Qualquer pessoa" só deixa CHAMAR o script — sem um token
 *      válido ele recusa tudo; a pasta continua privada.)
 *   Ao alterar este código depois: Implantar > Gerenciar implantações > editar > Nova versão
 *   (mantém a mesma URL).
 */

const SUPABASE_URL = 'https://ymltjceiviyadckxzbxw.supabase.co';
// chave pública "anon" — a mesma que já está no index.html; não é segredo.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltbHRqY2Vpdml5YWRja3h6Ynh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NzQyNTMsImV4cCI6MjEwNTI1MDI1M30.dCtuE0oKMe29nH5rCV5hVl9A3AzL-PF-G_G5c-spiVg';
const NOME_PASTA = 'Painel Infrações - Fotos das Justificativas';
const MAX_BYTES = 8 * 1024 * 1024;
const SEPARADOR_JUST = '--- Justificativa ---';

function configurar() {
  const id = pastaId_();
  Logger.log('Pasta privada pronta: https://drive.google.com/drive/folders/' + id);
}

function doGet() {
  return json_({ ok: true, servico: 'fotos-justificativas' });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const sess = validarSessao_(req.token, req.chave || null);
    if (!sess || !sess.ok) return json_({ ok: false, erro: 'sessao-invalida' });
    switch (req.acao) {
      case 'upload': return json_(upload_(req, sess));
      case 'ver': return json_(ver_(req));
      case 'excluir': return json_(excluir_(req, sess));
      case 'descrever': return json_(descrever_(req, sess));
      default: return json_({ ok: false, erro: 'acao-desconhecida' });
    }
  } catch (err) {
    return json_({ ok: false, erro: String((err && err.message) || err) });
  }
}

function upload_(req, sess) {
  if (!sess.pode_editar) return { ok: false, erro: 'sem-permissao' };
  if (!req.chave || !req.base64) return { ok: false, erro: 'dados-incompletos' };
  const bytes = Utilities.base64Decode(req.base64);
  if (bytes.length > MAX_BYTES) return { ok: false, erro: 'foto-grande-demais' };
  const nome = String(req.nomeArquivo || 'foto.jpg').replace(/[^\w.\-]/g, '_').slice(0, 150);
  const blob = Utilities.newBlob(bytes, 'image/jpeg', nome);
  const file = subpastaDoGa_(nomeSubpasta_(req, sess)).createFile(blob);
  const cab = String(req.cabecalho || '').slice(0, 1500);
  const original = String(req.nomeOriginal || '').slice(0, 200);
  file.setDescription(
    cab + (original ? '\nArquivo original: ' + original : '') +
    '\nEnviado por: ' + sess.username + ' em ' + agora_() +
    '\nRef: ' + req.chave + '\n' + SEPARADOR_JUST + '\n' + String(req.justificativa || '').slice(0, 2500)
  );
  return { ok: true, id: file.getId(), nome: file.getName() };
}

function ver_(req) {
  const file = arquivoDaPasta_(req.id);
  const blob = file.getBlob();
  return { ok: true, mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

function excluir_(req, sess) {
  if (!sess.pode_editar) return { ok: false, erro: 'sem-permissao' };
  const file = arquivoDaPasta_(req.id);
  if (!pertenceAChave_(file, req.chave)) return { ok: false, erro: 'arquivo-de-outra-justificativa' };
  file.setTrashed(true);
  return { ok: true };
}

// atualiza só o texto da justificativa na descrição das fotos (quando o GA edita o texto depois)
function descrever_(req, sess) {
  if (!sess.pode_editar) return { ok: false, erro: 'sem-permissao' };
  (req.ids || []).slice(0, 3).forEach(function (id) {
    const file = arquivoDaPasta_(id);
    if (!pertenceAChave_(file, req.chave)) return;
    const cab = String(file.getDescription() || '').split(SEPARADOR_JUST)[0].replace(/\s+$/, '');
    file.setDescription(cab + '\n' + SEPARADOR_JUST + '\n' + String(req.justificativa || '').slice(0, 2500));
  });
  return { ok: true };
}

function validarSessao_(token, chave) {
  if (!token) return null;
  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/painel_validar_sessao', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    payload: JSON.stringify({ p_token: String(token), p_chave: chave }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return null;
  return JSON.parse(res.getContentText());
}

// uma subpasta por GA dentro da pasta principal (pedido do usuário). GA logado: sempre a área
// DELE (vem da sessão, não do navegador). Admin: a área do colaborador da justificativa,
// informada pelo painel — Admin anexando por um GA cai na mesma pasta que o GA usaria.
function nomeSubpasta_(req, sess) {
  const bruto = sess.role === 'ga' ? sess.ga_nome : (req.ga || 'Sem GA definido');
  return String(bruto || 'Sem GA definido').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 100) || 'Sem GA definido';
}

function subpastaDoGa_(nome) {
  const raiz = DriveApp.getFolderById(pastaId_());
  const it = raiz.getFoldersByName(nome);
  return it.hasNext() ? it.next() : raiz.createFolder(nome);
}

// aceita arquivo na pasta principal ou em qualquer subpasta de GA dela — nunca fora dela
function arquivoDaPasta_(id) {
  const file = DriveApp.getFileById(String(id || ''));
  const raiz = pastaId_();
  const pais = file.getParents();
  while (pais.hasNext()) {
    const pai = pais.next();
    if (pai.getId() === raiz) return file;
    const avos = pai.getParents();
    while (avos.hasNext()) if (avos.next().getId() === raiz) return file;
  }
  throw new Error('arquivo-fora-da-pasta');
}

function pertenceAChave_(file, chave) {
  return !!chave && String(file.getDescription() || '').indexOf('\nRef: ' + chave + '\n') >= 0;
}

function pastaId_() {
  const props = PropertiesService.getScriptProperties();
  const salvo = props.getProperty('PASTA_ID');
  if (salvo) {
    try { DriveApp.getFolderById(salvo); return salvo; } catch (e) { /* pasta apagada — recria */ }
  }
  const it = DriveApp.getFoldersByName(NOME_PASTA);
  const pasta = it.hasNext() ? it.next() : DriveApp.createFolder(NOME_PASTA);
  props.setProperty('PASTA_ID', pasta.getId());
  return pasta.getId();
}

function agora_() {
  return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
