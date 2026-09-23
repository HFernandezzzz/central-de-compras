#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Roda a suíte inteira de testes, montando antes tudo o que ela precisa.

    python3 tests/run_all.py            # tudo
    python3 tests/run_all.py comparativo sweep    # só os que casam com esses nomes

Requisito: playwright com o Chromium instalado.

    pip install playwright && playwright install chromium
"""

import os
import subprocess
import sys
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTES = os.path.join(RAIZ, 'tests')


def rodar(cmd, descricao):
    print('>>', descricao)
    r = subprocess.run([sys.executable] + cmd, cwd=RAIZ)
    if r.returncode != 0:
        print('   falhou:', descricao)
        sys.exit(r.returncode)


def main():
    filtros = [a.lower() for a in sys.argv[1:]]

    # 1. as bases e os arquivos HTML que os testes abrem
    rodar([os.path.join('tools', 'gerar_dados_exemplo.py')], 'gerando a base de exemplo')
    rodar([os.path.join('tools', 'gerar_dados_teste.py')], 'gerando a base do teste de períodos')
    rodar(['build.py'], 'montando dist/central-de-compras.html')
    rodar(['build.py', os.path.join('dist', 'dados_teste_compras.json'),
           os.path.join('dist', 'painel-teste-compras.html')], 'montando o painel de teste')

    # 2. os testes
    arquivos = sorted(f for f in os.listdir(TESTES)
                      if f.startswith('test_') and f.endswith('.py'))
    if filtros:
        arquivos = [f for f in arquivos if any(x in f.lower() for x in filtros)]
    if not arquivos:
        print('Nenhum teste casou com', filtros)
        return 1

    print('\n%d arquivo(s) de teste\n' % len(arquivos))
    falhas, inicio = [], time.time()
    for nome in arquivos:
        t0 = time.time()
        r = subprocess.run([sys.executable, os.path.join('tests', nome)],
                           cwd=RAIZ, capture_output=True, text=True)
        ok = r.returncode == 0
        print('%-28s %s  (%.1fs)' % (nome, 'ok ' if ok else 'FALHOU', time.time() - t0))
        if not ok:
            falhas.append(nome)
            print(r.stdout[-3000:])
            print(r.stderr[-2000:])

    print('\n%d de %d passaram em %.0fs' % (len(arquivos) - len(falhas), len(arquivos), time.time() - inicio))
    if falhas:
        print('falharam:', ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


if __name__ == '__main__':
    sys.exit(main())
