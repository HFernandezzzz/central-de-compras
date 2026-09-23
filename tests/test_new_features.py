import sys
from playwright.sync_api import sync_playwright

import os
# O teste roda contra o arquivo montado em dist/. Rode antes:
#   python3 build.py
_RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'file://' + os.path.join(_RAIZ, 'dist', 'central-de-compras.html')
PHOTO = "/tmp/test_logo_square.png"
errors = []
FAILS = []

def check(cond, label):
    if cond:
        print("OK  -", label)
    else:
        print("FAIL-", label)
        FAILS.append(label)

def log_console(msg):
    if msg.type == 'error' and 'Failed to load resource' not in msg.text:
        errors.append(msg.text)

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
        page.wait_for_timeout(150)

    # ---- Pedidos tab renders without crash (was a dangling reference before) ----
    click_nav("pedidos")
    check(page.locator('[data-nav="pedidos"].active').count()==1, "pedidos tab nav works")
    check("Nenhum pedido de compra" in page.inner_text("#app"), "pedidos tab empty state shown")

    # ---- Full flow: cotacao with solicitante/setor/unidade -> approve -> pedido created ----
    click_nav("cotacoes")
    page.click("#btn-abrir-cotacao")
    page.wait_for_timeout(100)
    page.fill('[data-cotacao-item-search][data-item-idx="0"]', "Parafuso sextavado M10 teste")
    page.fill('[data-cotacao-qtd][data-item-idx="0"]', "50")
    page.fill('[data-cotacao-unidade][data-item-idx="0"]', "cx")
    for qi, (forn, preco) in enumerate([("Fornecedor Pedido Teste","10,00"),("Fornecedor Pedido Teste 2","10,80"),("Fornecedor Pedido Teste 3","9,90")]):
        page.fill(f'[data-quote-field="fornecedor"][data-item-idx="0"][data-quote-idx="{qi}"]', forn)
        page.fill(f'[data-quote-field="preco"][data-item-idx="0"][data-quote-idx="{qi}"]', preco)
        page.set_input_files(f'[data-quote-foto][data-item-idx="0"][data-quote-idx="{qi}"]', PHOTO)
        page.wait_for_timeout(80)
    page.fill("#input-cotacao-solicitante", "Maria Solicitante")
    page.fill("#input-cotacao-setor", "Manutencao")
    page.click("#btn-salvar-cotacao")
    page.wait_for_timeout(200)
    txt = page.inner_text("#app")
    check("cx" in txt, "unidade de medida shown in cotacao card")
    check("Maria Solicitante" in txt, "solicitante shown in cotacao card")
    check("Manutencao" in txt, "setor shown in cotacao card")

    close_btn = page.locator('[data-close-cotacao][data-vencedor="Fornecedor Pedido Teste"]')
    check(close_btn.count() > 0, "close button present for new item")
    close_btn.first.click()
    page.wait_for_timeout(200)
    txt2 = page.inner_text("#app")
    check("Aprovada" in txt2, "item auto-approved (below alcada)")

    # ---- Pedido should now exist ----
    click_nav("pedidos")
    txt3 = page.inner_text("#app")
    check("PC-" in txt3, "pedido numero (PC-xxxx) generated")
    check("Fornecedor Pedido Teste" in txt3, "pedido shows fornecedor")
    check("Maria Solicitante" in txt3, "pedido shows solicitante")
    check("undefined" not in txt3 and "NaN" not in txt3, "pedidos tab has no undefined/NaN")

    # ---- Registrar recebimento parcial ----
    abrir_receb = page.locator('[data-abrir-recebimento]')
    check(abrir_receb.count() > 0, "registrar recebimento button present")
    abrir_receb.first.click()
    page.wait_for_timeout(150)
    page.fill("#input-recebimento-qtd", "20")
    page.fill("#input-recebimento-nf", "NF-12345")
    salvar_receb = page.locator('[data-salvar-recebimento]')
    salvar_receb.first.click()
    page.wait_for_timeout(200)
    txt4 = page.inner_text("#app")
    check("Recebido parcial" in txt4, "pedido status becomes recebido parcial")
    check("NF-12345" in txt4, "nota fiscal recorded")

    # complete the receiving
    abrir_receb2 = page.locator('[data-abrir-recebimento]')
    if abrir_receb2.count():
        abrir_receb2.first.click()
        page.wait_for_timeout(150)
        page.fill("#input-recebimento-qtd", "30")
        page.locator('[data-salvar-recebimento]').first.click()
        page.wait_for_timeout(200)
        page.click('[data-pedido-filtro="todos"]')
        page.wait_for_timeout(150)
        txt5 = page.inner_text("#app")
        check("Recebido total" in txt5, "pedido status becomes recebido total after full qty")

    # ---- Fornecedor modal: CNPJ / razao social / condicao pagamento / scorecard ----
    click_nav("fornecedores")
    page.fill("#input-fornecedor-search", "fornecedor pedido teste")
    page.wait_for_timeout(150)
    open_btn = page.locator('[data-open-fornecedor]')
    if open_btn.count() == 0:
        # fornecedor might not be in registered catalog (free text vencedor) - open any fornecedor instead
        page.fill("#input-fornecedor-search", "")
        page.wait_for_timeout(150)
        open_btn = page.locator('[data-open-fornecedor]')
    open_btn.first.click()
    page.wait_for_timeout(150)
    page.fill("#input-fornecedor-razao-social", "Fornecedor Teste Ltda")
    page.fill("#input-fornecedor-cnpj", "12.345.678/0001-90")
    page.fill("#input-fornecedor-condicao-pagamento", "30/60 dias")
    page.click("[data-save-fornecedor]")
    page.wait_for_timeout(200)
    click_nav("visao-geral")
    click_nav("fornecedores")
    page.fill("#input-fornecedor-search", "")
    page.wait_for_timeout(100)
    open_btn2 = page.locator('[data-open-fornecedor]')
    open_btn2.first.click()
    page.wait_for_timeout(150)
    txt6 = page.inner_text("#app")
    check("Fornecedor Teste Ltda" in txt6, "razao social persisted")
    check("12.345.678/0001-90" in txt6, "cnpj persisted")
    check("30/60 dias" in txt6 or page.input_value("#input-fornecedor-condicao-pagamento")=="30/60 dias", "condicao pagamento persisted")
    check("Desempenho do fornecedor" in txt6, "scorecard section present")

    # ---- CSV export modal ----
    page.click('[data-close-fornecedor]')
    page.wait_for_timeout(100)
    page.click("#btn-abrir-csv-export")
    page.wait_for_timeout(150)
    check(page.locator("#csv-export-textarea").count()==1, "csv export modal opens")
    csv_val = page.input_value("#csv-export-textarea")
    check("Código" in csv_val or "Nome" in csv_val, "csv textarea has fornecedores header by default")
    page.click('[data-csv-dataset="pedidos"]')
    page.wait_for_timeout(100)
    csv_val2 = page.input_value("#csv-export-textarea")
    check("Número" in csv_val2 and "PC-" in csv_val2, "csv pedidos dataset shows generated pedido")
    page.click('[data-close-csv-export]')
    page.wait_for_timeout(100)
    check(page.locator("#csv-export-textarea").count()==0, "csv export modal closes")

    # ---- Segunda fonte: create a high-value single-supplier item to trigger "estrategico" quadrant ----
    click_nav("cotacoes")
    page.click("#btn-abrir-cotacao")
    page.wait_for_timeout(100)
    page.fill('[data-cotacao-item-search][data-item-idx="0"]', "Redutor planetario exclusivo teste")
    page.fill('[data-cotacao-qtd][data-item-idx="0"]', "10")
    for qi, (forn, preco) in enumerate([("Fornecedor Exclusivo Teste","500,00"),("Fornecedor Exclusivo Teste 2","520,00"),("Fornecedor Exclusivo Teste 3","510,00")]):
        page.fill(f'[data-quote-field="fornecedor"][data-item-idx="0"][data-quote-idx="{qi}"]', forn)
        page.fill(f'[data-quote-field="preco"][data-item-idx="0"][data-quote-idx="{qi}"]', preco)
        page.set_input_files(f'[data-quote-foto][data-item-idx="0"][data-quote-idx="{qi}"]', PHOTO)
        page.wait_for_timeout(80)
    page.click("#btn-salvar-cotacao")
    page.wait_for_timeout(200)
    page.locator('[data-close-cotacao][data-vencedor="Fornecedor Exclusivo Teste"]').first.click()
    page.wait_for_timeout(200)

    click_nav("alertas")
    abrir_sf = page.locator('[data-abrir-segunda-fonte]')
    check(abrir_sf.count() > 0, "segunda fonte button appears for new strategic single-source item")
    if abrir_sf.count():
        abrir_sf.first.click()
        page.wait_for_timeout(150)
        page.select_option("#select-segunda-fonte-status", "buscando")
        page.fill("#input-segunda-fonte-fornecedor", "Fornecedor Alternativo Beta")
        page.click('[data-salvar-segunda-fonte]')
        page.wait_for_timeout(200)
        txt7 = page.inner_text("#app")
        check("Fornecedor Alternativo Beta" in txt7, "segunda fonte alternate supplier saved")
        check("Buscando alternativa" in txt7, "segunda fonte status badge shown")

    print("\n==== console errors ====")
    for e in errors:
        print(e)
    check(len(errors)==0, "no console/page errors")

    print("\n==== SUMMARY ====")
    if FAILS:
        print(f"{len(FAILS)} FAILURES:")
        for f in FAILS: print(" -", f)
    else:
        print("ALL CHECKS PASSED")

    browser.close()
    sys.exit(1 if FAILS or errors else 0)
