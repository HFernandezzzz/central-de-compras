#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Monta a Central de Compras num único arquivo HTML.

O aplicativo é escrito em três pedaços — a casca e o CSS em `src/template.html`, a lógica
em `src/app.js` e os dados num JSON — e este script costura os três num arquivo só, que
abre em qualquer navegador sem servidor, sem instalação e sem dependência externa.

Uso:

    python3 build.py                                   # base de exemplo -> dist/central-de-compras.html
    python3 build.py data/meus_dados.json              # outra base de dados
    python3 build.py data/meus_dados.json saida.html   # outro caminho de saída
    python3 build.py --fragmento                       # sem <html>/<head>, para embutir em outra página

Dois formatos de saída:

* `standalone` (padrão) — documento HTML completo, para abrir localmente ou hospedar.
* `fragmento` — só o conteúdo, sem `<html>`/`<head>`/`<body>`. É o formato usado quando a
  página é publicada dentro de um contêiner que já fornece a casca do documento.
"""

import argparse
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(RAIZ, 'src', 'template.html')
APPJS = os.path.join(RAIZ, 'src', 'app.js')
DADOS_PADRAO = os.path.join(RAIZ, 'data', 'dados_exemplo.json')
SAIDA_PADRAO = os.path.join(RAIZ, 'dist', 'central-de-compras.html')


def montar_fragmento(dados_json):
    """Devolve o corpo do aplicativo: CSS + markup + dados + JavaScript."""
    with open(TEMPLATE, encoding='utf-8') as f:
        tpl = f.read()
    with open(APPJS, encoding='utf-8') as f:
        appjs = f.read()

    # O app precisa do seu próprio CSS como texto, para conseguir se republicar inteiro
    # (ver buildFullDocument em app.js). Em vez de tentar redescobrir a folha de estilo pelo
    # DOM em tempo de execução — o que dá errado quando a página é embutida numa casca que
    # injeta um <style> próprio antes do nosso —, o CSS real é embutido aqui, na montagem.
    m = re.search(r'<style id="app-style">(.*?)</style>', tpl, re.S)
    if not m:
        raise SystemExit('Não achei o bloco <style id="app-style"> em src/template.html')
    css = m.group(1)

    marcador = '/*__APP_CSS__*/""'
    if appjs.count(marcador) != 1:
        raise SystemExit('Esperava exatamente um marcador %s em src/app.js, achei %d'
                         % (marcador, appjs.count(marcador)))
    appjs = appjs.replace(marcador, '/*__APP_CSS__*/' + json.dumps(css))

    json.loads(dados_json)  # valida o JSON antes de gravar qualquer coisa

    for marca in ('/*__DATA_JSON__*/', '/*__APP_JS__*/'):
        if tpl.count(marca) != 1:
            raise SystemExit('Esperava exatamente um marcador %s em src/template.html' % marca)

    return tpl.replace('/*__DATA_JSON__*/', dados_json).replace('/*__APP_JS__*/', appjs)


def montar_standalone(dados_json):
    """Envolve o fragmento num documento HTML completo."""
    return ('<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
            '<title>Central de Compras</title>\n'
            '</head>\n<body>\n' + montar_fragmento(dados_json) + '\n</body>\n</html>\n')


def main(argv=None):
    p = argparse.ArgumentParser(description='Monta a Central de Compras num único arquivo HTML.')
    p.add_argument('dados', nargs='?', default=DADOS_PADRAO,
                   help='JSON com os dados (padrão: data/dados_exemplo.json)')
    p.add_argument('saida', nargs='?', default=SAIDA_PADRAO,
                   help='arquivo HTML a gerar (padrão: dist/central-de-compras.html)')
    p.add_argument('--fragmento', action='store_true',
                   help='gera só o corpo, sem <html>/<head>/<body>')
    args = p.parse_args(argv)

    if not os.path.exists(args.dados):
        raise SystemExit('Arquivo de dados não encontrado: %s\n'
                         'Rode primeiro: python3 tools/gerar_dados_exemplo.py' % args.dados)

    with open(args.dados, encoding='utf-8') as f:
        dados_json = f.read()

    html = montar_fragmento(dados_json) if args.fragmento else montar_standalone(dados_json)

    destino = os.path.dirname(os.path.abspath(args.saida))
    if destino:
        os.makedirs(destino, exist_ok=True)
    with open(args.saida, 'w', encoding='utf-8') as f:
        f.write(html)

    kb = os.path.getsize(args.saida) / 1024.0
    print('Gerado: %s (%.0f KB, %s)'
          % (os.path.relpath(args.saida, RAIZ), kb, 'fragmento' if args.fragmento else 'standalone'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
