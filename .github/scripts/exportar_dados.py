"""Exporta a Base + Hierarquia do Supabase para dados.json na raiz do repositório.

Usa apenas a chave pública (anon) do Supabase, que só dá acesso de leitura e já está no
código do painel. Nenhum segredo novo é necessário.
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

saida = {
    "gerado_em": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "total_registros": len(registros),
    "total_hierarquia": len(roster),
    "registros": registros,
    "roster": roster,
}

with open("dados.json", "w", encoding="utf-8") as f:
    json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))

print(f"{len(registros)} registros e {len(roster)} linhas de hierarquia gravados.")
