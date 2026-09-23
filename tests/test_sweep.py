import sys, re
from playwright.sync_api import sync_playwright

import os
# O teste roda contra o arquivo montado em dist/. Rode antes:
#   python3 build.py
_RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'file://' + os.path.join(_RAIZ, 'dist', 'central-de-compras.html')
errors = []
FAILS = []

def check(cond, label):
    if cond:
        print("OK  -", label)
    else:
        print("FAIL-", label)
        FAILS.append(label)

def log_console(msg):
    if msg.type == 'error' and 'Failed to load resource' not in msg.text and 'ERR_TUNNEL_CONNECTION_FAILED' not in msg.text:
        errors.append(msg.text)

BAD_STRINGS = ["undefined", "NaN", "[object Object]", "null%", "R$ NaN", "Infinity"]

def scan_text(label):
    txt = page.inner_text("#app")
    for b in BAD_STRINGS:
        if b in txt:
            FAILS.append(f"{label}: found '{b}' in visible text")
            print(f"FAIL- {label}: found '{b}' in visible text")
            return
    print(f"OK  - {label}: no leaking placeholder text")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.on("console", log_console)
    page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
    page.goto(URL)
    # bootstrap: this app now requires login. Register a throwaway admin so the rest of
    # this test (which predates the login feature) can reach the dashboard as before.
    page.wait_for_selector(".auth-card", timeout=10000)
    page.click('[data-auth-tab="cadastro"]')
    page.fill('#input-cad-nome', 'Test Bootstrap Admin')
    page.fill('#input-cad-email', 'bootstrap-admin@test.local')
    page.fill('#input-cad-ramal', '0000')
    page.fill('#input-cad-senha', 'bootstrap123')
    page.fill('#input-cad-senha2', 'bootstrap123')
    page.fill('#input-cad-codigo', 'ADMIN-SETUP-2026')
    page.click('#btn-cadastro-submit')
    page.wait_for_selector("#app .nav-item")

    def click_nav(tab):
        page.click(f'[data-nav="{tab}"]')
        page.wait_for_timeout(200)

    def dismiss_toast():
        try:
            page.wait_for_selector(".toast", state="detached", timeout=3000)
        except Exception:
            pass

    tabs = ["visao-geral","fornecedores","itens","cotacoes","comparativo","pedidos",
            "compras-periodo","reposicao","contratos","obras","alertas","atividades"]

    for t in tabs:
        click_nav(t)
        check(page.locator(f'[data-nav="{t}"].active').count()==1, f"nav to {t} works")
        scan_text(f"tab {t} initial render")

    # ---- Fornecedores: sort every column, open several fornecedor modals, csv export ----
    click_nav("fornecedores")
    sort_cols = page.locator('[data-sort-fornecedor]')
    n = sort_cols.count()
    for i in range(n):
        col = page.locator('[data-sort-fornecedor]').nth(i)
        key = col.get_attribute('data-sort-fornecedor')
        col.click()
        page.wait_for_timeout(80)
        col.click()  # toggle direction too
        page.wait_for_timeout(80)
    scan_text("fornecedores after sorting all columns both directions")

    # open first, middle, last fornecedor rows (varied data completeness)
    total_rows = page.locator('[data-open-fornecedor]').count()
    check(total_rows > 0, "fornecedores table has rows to open")
    sample_idxs = sorted(set([0, min(1,total_rows-1), total_rows//2, total_rows-1]))
    for idx in sample_idxs:
        page.locator('[data-open-fornecedor]').nth(idx).click(force=True)
        page.wait_for_timeout(150)
        check(page.locator('#fornecedor-modal-backdrop').count()==1, f"fornecedor modal #{idx} opens")
        scan_text(f"fornecedor modal #{idx}")
        # try starring / status change if present
        stars = page.locator('[data-star-fornecedor]')
        if stars.count():
            stars.first.click()
            page.wait_for_timeout(100)
            scan_text(f"fornecedor modal #{idx} after star click")
        page.click('[data-close-fornecedor]')
        page.wait_for_timeout(100)

    # csv export - cycle through every dataset
    page.click("#btn-abrir-csv-export")
    page.wait_for_timeout(150)
    dataset_btns = page.locator('[data-csv-dataset]')
    dcount = dataset_btns.count()
    for i in range(dcount):
        b = page.locator('[data-csv-dataset]').nth(i)
        ds_name = b.get_attribute('data-csv-dataset')
        b.click()
        page.wait_for_timeout(120)
        val = page.input_value("#csv-export-textarea")
        check(len(val) > 0, f"csv dataset '{ds_name}' produces non-empty output")
        for b2 in BAD_STRINGS:
            if b2 in val:
                FAILS.append(f"csv dataset '{ds_name}' contains '{b2}'")
                print(f"FAIL- csv dataset '{ds_name}' contains '{b2}'")
    page.click('[data-close-csv-export]')
    page.wait_for_timeout(100)

    # ---- Itens & Matriz: quadrant filters + sorting ----
    click_nav("itens")
    quad_btns = page.locator('[data-item-quad]')
    for i in range(quad_btns.count()):
        page.locator('[data-item-quad]').nth(i).click()
        page.wait_for_timeout(100)
        scan_text(f"itens quadrant filter #{i}")
    sort_cols_i = page.locator('[data-sort-item]')
    for i in range(sort_cols_i.count()):
        page.locator('[data-sort-item]').nth(i).click()
        page.wait_for_timeout(80)
    scan_text("itens after sorting all columns")

    # ---- Cotacoes: filters ----
    click_nav("cotacoes")
    cot_filtros = page.locator('[data-cotacao-filtro]')
    for i in range(cot_filtros.count()):
        page.locator('[data-cotacao-filtro]').nth(i).click()
        page.wait_for_timeout(100)
        scan_text(f"cotacoes filter #{i}")

    # ---- Pedidos: filters ----
    click_nav("pedidos")
    ped_filtros = page.locator('[data-pedido-filtro]')
    for i in range(ped_filtros.count()):
        page.locator('[data-pedido-filtro]').nth(i).click()
        page.wait_for_timeout(100)
        scan_text(f"pedidos filter #{i}")

    # ---- Compras por periodo: "mais" buttons ----
    click_nav("compras-periodo")
    for sel in ["#btn-compras-meses-mais", "#btn-compras-semanas-mais"]:
        if page.locator(sel).count():
            page.click(sel)
            page.wait_for_timeout(120)
    scan_text("compras-periodo after expanding lists")

    # ---- Reposicao: quadrant filters, toggle, sort ----
    click_nav("reposicao")
    rquad = page.locator('[data-reposicao-quad]')
    for i in range(rquad.count()):
        page.locator('[data-reposicao-quad]').nth(i).click()
        page.wait_for_timeout(100)
    rsort = page.locator('[data-sort-reposicao]')
    for i in range(rsort.count()):
        page.locator('[data-sort-reposicao]').nth(i).click()
        page.wait_for_timeout(80)
    scan_text("reposicao after filters/sort")
    toggles = page.locator('[data-toggle-reposicao]')
    if toggles.count():
        toggles.first.click()
        page.wait_for_timeout(120)
        scan_text("reposicao after toggle")

    # ---- Contratos: filters ----
    click_nav("contratos")
    cfiltros = page.locator('[data-contrato-filtro]')
    for i in range(cfiltros.count()):
        page.locator('[data-contrato-filtro]').nth(i).click()
        page.wait_for_timeout(100)
        scan_text(f"contratos filter #{i}")

    # ---- Obras ----
    click_nav("obras")
    scan_text("obras tab")

    # ---- Alertas ----
    click_nav("alertas")
    scan_text("alertas tab")

    # ---- Atividades ----
    click_nav("atividades")
    scan_text("atividades tab")

    # ---- Print / export relatorio ----
    click_nav("visao-geral")
    if page.locator("#btn-exportar-relatorio").count():
        page.click("#btn-exportar-relatorio")
        page.wait_for_timeout(200)
        scan_text("after clicking exportar relatorio")

    print("\n==== console errors ====")
    for e in errors:
        print(e)
    check(len(errors)==0, "no console/page errors across full sweep")

    print("\n==== SUMMARY ====")
    if FAILS:
        print(f"{len(FAILS)} FAILURES:")
        for f in FAILS: print(" -", f)
    else:
        print("ALL CHECKS PASSED")

    browser.close()
    sys.exit(1 if FAILS or errors else 0)
