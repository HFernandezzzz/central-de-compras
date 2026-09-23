import os
import sys
import json
from playwright.sync_api import sync_playwright

# Verifica que a base de demonstração (data/dados_exemplo.json) é coerente e que o painel
# a renderiza por inteiro: indicadores, curva ABC, matriz de criticidade, gráficos e listas.
# É o teste que garante que quem clonar o repositório abre o app e vê algo que faz sentido.

_RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'file://' + os.path.join(_RAIZ, 'dist', 'central-de-compras.html')
DADOS = os.path.join(_RAIZ, 'data', 'dados_exemplo.json')

FAILS = []
errors = []


def check(cond, label):
    if cond:
        print("OK  -", label)
    else:
        print("FAIL-", label)
        FAILS.append(label)


# ---- 1) coerência do próprio arquivo de dados, antes de abrir o navegador ----
with open(DADOS, encoding='utf-8') as f:
    dados = json.load(f)

k = dados['kpis']
check(k['nFornecedores'] == len(dados['fornecedores']), "KPI de fornecedores bate com a lista")
check(k['nProdutos'] == len(dados['produtos']), "KPI de itens bate com a lista")
check(k['totalSpend'] > 0, "a base tem gasto registrado")
check(len(dados['tendenciaMensal']) >= 3, "há meses suficientes para o gráfico de tendência")
check(len(dados['gastoPorTipo']) >= 3, "há categorias suficientes para o gráfico de gasto por tipo")
check(any(f['abc'] == 'A' for f in dados['fornecedores']), "a curva ABC classificou fornecedores classe A")
check(any(p['quadrante'] == 'estrategico' for p in dados['produtos']), "a matriz tem itens estratégicos")
check(dados['usuarios'] == [], "a base de exemplo não traz nenhuma conta de usuário")
check(dados['empresa']['nome'] == '', "a base de exemplo não traz nome de empresa")

soma_forn = round(sum(f['spend'] for f in dados['fornecedores']), 2)
check(abs(soma_forn - k['totalSpend']) < 1.0,
      "soma do gasto por fornecedor bate com o total (%.2f vs %.2f)" % (soma_forn, k['totalSpend']))

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 950})
    page.on('console', lambda m: errors.append(m.text)
            if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    page.on('pageerror', lambda exc: errors.append("pageerror: %s" % exc))
    page.goto(URL)

    # ---- 2) primeira visita: tela de cadastro, sem nenhuma conta criada ----
    page.wait_for_selector('.auth-card', timeout=10000)
    check(page.locator('.auth-card').count() == 1, "primeira visita cai na tela de login/cadastro")

    page.click('[data-auth-tab="cadastro"]')
    page.fill('#input-cad-nome', 'Administrador Demo')
    page.fill('#input-cad-email', 'demo@exemplo.local')
    page.fill('#input-cad-ramal', '1000')
    page.fill('#input-cad-senha', 'demo123456')
    page.fill('#input-cad-senha2', 'demo123456')
    page.fill('#input-cad-codigo', 'ADMIN-SETUP-2026')
    page.click('#btn-cadastro-submit')
    page.wait_for_selector('#app .nav-item')
    check(page.locator('[data-nav="usuarios"]').count() == 1,
          "o primeiro cadastro com o código de fábrica vira administrador")

    # ---- 3) visão geral com os números da base ----
    page.click('[data-nav="visao-geral"]')
    page.wait_for_timeout(300)
    vg = page.inner_text('#tab-content')
    check(str(k['nFornecedores']) in vg, "visão geral mostra o total de fornecedores")
    check(page.locator('.kpi-tile').count() >= 5, "visão geral mostra a régua de indicadores")
    check(page.locator('.bar-row').count() >= 10, "visão geral desenha os gráficos de barras")

    # ---- 4) as abas que dependem da base carregam com conteúdo ----
    esperado = {
        'fornecedores': '[data-open-fornecedor]',
        'itens': '[data-sort-item]',
        'compras-periodo': None,
        'reposicao': '[data-sort-reposicao]',
        'contratos': None,
        'obras': None,
        'alertas': None,
        'comparativo': '.cmp-tabbar',
    }
    for aba, seletor in esperado.items():
        page.click('[data-nav="%s"]' % aba)
        page.wait_for_timeout(250)
        check(page.locator('[data-nav="%s"].active' % aba).count() == 1, "abre a aba %s" % aba)
        if seletor:
            check(page.locator(seletor).count() > 0, "a aba %s renderiza seu conteúdo" % aba)
        texto = page.inner_text('#app')
        for ruim in ['undefined', 'NaN', '[object Object]', 'R$ NaN', 'Infinity']:
            if ruim in texto:
                FAILS.append("aba %s mostra '%s'" % (aba, ruim))
                print("FAIL- aba %s mostra '%s'" % (aba, ruim))
                break

    # ---- 5) o nome da empresa é configurável (app white-label) ----
    page.click('[data-nav="usuarios"]')
    page.wait_for_timeout(250)
    check(page.locator('#input-empresa-nome').count() == 1, "há campo para o nome da empresa")
    page.fill('#input-empresa-nome', 'Minha Empresa Ltda')
    page.click('#btn-salvar-empresa-nome')
    page.wait_for_timeout(350)
    nome_salvo = page.evaluate("() => window.__appDebug.STATE.empresa.nome")
    check(nome_salvo == 'Minha Empresa Ltda', "nome da empresa salvo (got %r)" % nome_salvo)

    page.click('[data-nav="comparativo"]')
    page.wait_for_timeout(250)
    check(page.locator('#btn-cmp-novo-fornecedor').count() == 1, "mapa comparativo pronto para uso")

    print("\n==== erros de console ====")
    if errors:
        for e in errors:
            print("FAIL- erro de console:", e)
        FAILS.append("erros de console")
    else:
        check(True, "nenhum erro de console")

    browser.close()

print("\n==== RESUMO ====")
if FAILS:
    print("%d FALHA(S):" % len(FAILS))
    for f in FAILS:
        print(" -", f)
    sys.exit(1)
print("TODAS AS VERIFICAÇÕES PASSARAM")
