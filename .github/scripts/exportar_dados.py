"""Exporta a Base + Hierarquia + Justificativas (FCA) do Supabase para dados.json na raiz do
repositório.

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


registros = buscar_tudo(
    "infracoes_registros",
    "data,funcid,nome,funcao,codccusto,bu,subbu,entrada,saida,dias7,interj,he2",
)
roster = buscar_tudo("infracoes_roster", "nome,ga,go")
# tabela pode ainda não existir em instalações antigas (criada por supabase_justificativas.sql)
# — não deve quebrar o espelho de Base/Hierarquia se isso acontecer, só grava uma lista vazia.
try:
    justificativas = buscar_tudo("infracoes_justificativas", "chave,texto")
except Exception as erro:  # noqa: BLE001 — queremos seguir o espelho mesmo se isto falhar
    print(f"Aviso: não foi possível ler infracoes_justificativas ({erro}) — seguindo sem elas.")
    justificativas = []

saida = {
    "gerado_em": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "total_registros": len(registros),
    "total_hierarquia": len(roster),
    "total_justificativas": len(justificativas),
    "registros": registros,
    "roster": roster,
    "justificativas": justificativas,
}

with open("dados.json", "w", encoding="utf-8") as f:
    json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))

print(
    f"{len(registros)} registros, {len(roster)} linhas de hierarquia e "
    f"{len(justificativas)} justificativas gravados."
)
