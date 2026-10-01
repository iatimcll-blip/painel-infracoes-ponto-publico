"""Exporta a Base + Hierarquia + Justificativas (FCA) + painéis auxiliares (Banco de Horas, DSR,
Feriados) do Supabase para dados.json na raiz do repositório.

Usa apenas a chave pública (anon) do Supabase, que só dá acesso de leitura e já está no
código do painel. Nenhum segredo novo é necessário.

Além de servir como fonte reserva (o painel cai pra este arquivo se a leitura do Supabase
falhar no navegador de alguém — ver loadFromGithubMirror no painel2.html), isto também vira um
backup versionado de verdade: cada execução que muda algo gera um commit, então dá pra ver no
histórico do Git exatamente quando cada justificativa foi criada/alterada, e recuperar qualquer
versão anterior mesmo que o Supabase perca o dado por algum motivo.
"""

import datetime
import json
import os
import urllib.request

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_ANON_KEY"]
PAGINA = 1000  # o PostgREST devolve no máximo 1000 linhas por requisição


def buscar_tudo(tabela: str, colunas: str) -> list:
    linhas: list = []
    offset = 0
    while True:
        url = (
            f"{URL}/rest/v1/{tabela}?select={colunas}&order=id.asc"
            f"&limit={PAGINA}&offset={offset}"
        )
        req = urllib.request.Request(
            url, headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"}
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            lote = json.load(resp)
        linhas.extend(lote)
        if len(lote) < PAGINA:
            return linhas
        offset += PAGINA


def buscar_tudo_opcional(tabela: str, colunas: str) -> list:
    # tabelas mais novas (criadas depois que este script nasceu) não devem derrubar o espelho
    # inteiro se, por algum motivo, ainda não existirem numa instalação — grava lista vazia e
    # segue em frente, igual já era feito só pra justificativas antes desta mudança.
    try:
        return buscar_tudo(tabela, colunas)
    except Exception as erro:  # noqa: BLE001 — queremos seguir o espelho mesmo se isto falhar
        print(f"Aviso: não foi possível ler {tabela} ({erro}) — seguindo sem ela.")
        return []


registros = buscar_tudo(
    "infracoes_registros",
    "data,funcid,nome,funcao,codccusto,bu,subbu,entrada,saida,dias7,interj,he2",
)
roster = buscar_tudo("infracoes_roster", "nome,ga,go")
justificativas = buscar_tudo_opcional("infracoes_justificativas", "chave,texto")
bh_registros = buscar_tudo_opcional(
    "bh_registros", "funcid,nome,bu,subbu,limite_comp,horas,vlr,dias"
)
dsr_registros = buscar_tudo_opcional(
    "dsr_registros",
    "data,tipo_dia,funcid,nome,gestor,bu,subbu,hora_inicio,hora_fim,horas,valor",
)
feriado_registros = buscar_tudo_opcional(
    "feriado_registros",
    "data,funcid,nome,gestor,bu,subbu,tipo,hora_inicio,hora_fim,horas,valor,tipo_feriado",
)

saida = {
    "gerado_em": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "total_registros": len(registros),
    "total_hierarquia": len(roster),
    "total_justificativas": len(justificativas),
    "total_bh": len(bh_registros),
    "total_dsr": len(dsr_registros),
    "total_feriado": len(feriado_registros),
    "registros": registros,
    "roster": roster,
    "justificativas": justificativas,
    "bh_registros": bh_registros,
    "dsr_registros": dsr_registros,
    "feriado_registros": feriado_registros,
}

with open("dados.json", "w", encoding="utf-8") as f:
    json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))

print(
    f"{len(registros)} registros, {len(roster)} linhas de hierarquia, "
    f"{len(justificativas)} justificativas, {len(bh_registros)} linhas de Banco de Horas, "
    f"{len(dsr_registros)} linhas de DSR e {len(feriado_registros)} linhas de Feriados gravados."
)
