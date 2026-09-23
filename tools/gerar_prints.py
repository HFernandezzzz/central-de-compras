#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tira os prints usados no README, sempre a partir da base de exemplo.

Nunca aponte este script para uma base real: as imagens vão para o repositório e ficam
públicas. Ele usa `dist/central-de-compras.html`, que é montado com `data/dados_exemplo.json`.

    python3 build.py && python3 tools/gerar_prints.py
"""

import os
from playwright.sync_api import sync_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
URL = 'file://' + os.path.join(RAIZ, 'dist', 'central-de-compras.html')
IMG = os.path.join(RAIZ, 'docs', 'img')

EMPRESA = 'Metalúrgica Exemplo Ltda'


def main():
    os.makedirs(IMG, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
        page.goto(URL)
        page.wait_for_selector('.auth-card', timeout=15000)
        page.wait_for_timeout(600)
        page.screenshot(path=os.path.join(IMG, '01-login.png'))

        page.click('[data-auth-tab="cadastro"]')
        for campo, valor in [('#input-cad-nome', 'Administrador Demo'),
                             ('#input-cad-email', 'demo@exemplo.local'),
                             ('#input-cad-ramal', '1000'),
                             ('#input-cad-senha', 'demo123456'),
                             ('#input-cad-senha2', 'demo123456'),
                             ('#input-cad-codigo', 'ADMIN-SETUP-2026')]:
            page.fill(campo, valor)
        page.click('#btn-cadastro-submit')
        page.wait_for_selector('#app .nav-item')

        # nomeia a empresa, para os prints mostrarem o app já personalizado
        page.click('[data-nav="usuarios"]')
        page.wait_for_timeout(250)
        page.fill('#input-empresa-nome', EMPRESA)
        page.click('#btn-salvar-empresa-nome')
        # espera os avisos de gravação sumirem, senão eles aparecem por cima dos prints
        page.wait_for_timeout(5000)

        def aba(nav, arquivo, espera=500, full=False):
            page.click('[data-nav="%s"]' % nav)
            page.wait_for_timeout(espera)
            page.screenshot(path=os.path.join(IMG, arquivo), full_page=full)
            print('  ', arquivo)

        aba('visao-geral', '02-visao-geral.png', full=True)
        aba('itens', '03-itens-matriz.png', full=True)
        aba('fornecedores', '04-fornecedores.png')

        # ---- mapa comparativo com três propostas montadas na hora ----
        page.click('[data-nav="comparativo"]')
        page.wait_for_timeout(300)

        propostas = [
            ('Alvorada Aços e Metais S.A.', '12', '30 dias',
             [('Chapa de aço carbono 3,00mm', 'Usiforte', 'Laminada a frio, 1200x2400mm', 'KG', '1200', '9.80', '450')]),
            ('Serrana Fixadores Ltda', '25', '45 dias',
             [('Chapa de aço carbono 3,00mm', 'Metalbras', 'Laminada a frio, 1200x2400mm', 'KG', '1200', '9.10', '620')]),
            ('Vertente Usinagem Ltda', '7', '15 dias',
             [('Chapa de aço carbono 3,00mm', 'Aceros', 'Laminada a frio, equivalente', 'KG', '1200', '10.40', '')]),
        ]
        for nome, prazo, pagto, itens in propostas:
            page.click('#btn-cmp-novo-fornecedor')
            page.wait_for_selector('#input-cmp-novo-fornecedor')
            page.fill('#input-cmp-novo-fornecedor', nome)
            page.click('#btn-cmp-confirmar-fornecedor')
            page.wait_for_timeout(400)
            for i, (pn, marca, spec, un, q, pr, fr) in enumerate(itens):
                if i:
                    page.click('[data-cmp-abrir-novo-produto]')
                    page.wait_for_timeout(200)
                page.fill('#input-cmp-np-nome', pn)
                page.fill('#input-cmp-np-marca', marca)
                page.fill('#input-cmp-np-spec', spec)
                page.select_option('#select-cmp-np-unidade', un)
                page.fill('#input-cmp-np-qtd', q)
                page.fill('#input-cmp-np-preco', pr)
                if fr:
                    page.fill('#input-cmp-np-frete', fr)
                page.click('[data-cmp-salvar-novo-produto]')
                page.wait_for_timeout(300)
            page.fill('[data-cmp-forn-campo="prazoDias"]', prazo)
            page.locator('[data-cmp-forn-campo="pagamentoTexto"]').fill(pagto)
            page.fill('[data-cmp-forn-campo="pagamentoDias"]', pagto.split()[0])
            page.locator('[data-cmp-forn-campo="pagamentoDias"]').blur()
            page.wait_for_timeout(300)

        page.screenshot(path=os.path.join(IMG, '05-comparativo-proposta.png'), full_page=True)
        print('   05-comparativo-proposta.png')

        # seleciona os três itens e abre a comparação
        page.evaluate("""() => {
          const c = window.__appDebug.STATE.comparativo;
          c.fornecedores.forEach(f => (c.produtos[f.id] || []).forEach(p => {
            c.selecionados[f.id + '|' + p.id] = true;
          }));
          window.__appDebug.render();
        }""")
        page.click('[data-cmp-aba="__comparar__"]')
        page.wait_for_timeout(600)
        # deixa os avisos de gravação sumirem antes do print
        page.wait_for_timeout(4500)
        page.screenshot(path=os.path.join(IMG, '06-comparativo.png'), full_page=True)
        print('   06-comparativo.png')

        # largura de celular: a barra lateral vira faixa de abas no topo
        page.set_viewport_size({'width': 390, 'height': 844})
        page.click('[data-nav="visao-geral"]')
        page.wait_for_timeout(600)
        page.screenshot(path=os.path.join(IMG, '07-celular.png'), full_page=True)
        print('   07-celular.png')

        b.close()
    print('Prints gerados em docs/img/')


if __name__ == '__main__':
    main()
