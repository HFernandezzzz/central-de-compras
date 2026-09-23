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

    # ---- Contratos: full create flow ----
    click_nav("contratos")
    page.click("#btn-abrir-contrato")
    page.wait_for_timeout(150)
    # Type a fragment of a supplier that actually exists in the loaded dataset, rather than
    # hardcoding a name, so the test survives any change to the base it runs against.
    trecho = page.evaluate("() => window.__appDebug.STATE.fornecedores[0].nome.split(' ')[0].toLowerCase()")
    page.fill("#input-contrato-fornecedor", trecho)
    page.wait_for_timeout(150)
    sugg = page.locator('[data-pick-fornecedor-contrato]')
    check(sugg.count() > 0, "contrato fornecedor typeahead shows suggestions (buscou %r)" % trecho)
    if sugg.count():
        sugg.first.click()
        page.wait_for_timeout(100)
    page.fill("#input-contrato-escopo", "Fornecimento de aço")
    page.fill("#input-contrato-preco", "1000,50")
    page.fill("#input-contrato-data", "2026-01-01")
    page.click("#btn-salvar-contrato")
    page.wait_for_timeout(200)
    txt = page.inner_text("#app")
    check("Fornecimento De Aço" in txt or "Fornecimento de aço" in txt, "contrato created and listed")
    check("undefined" not in txt and "NaN" not in txt, "contrato render has no undefined/NaN")

    # renovar / encerrar
    renovar = page.locator('[data-renovar-contrato]')
    if renovar.count():
        renovar.first.click()
        page.wait_for_timeout(150)
        check("undefined" not in page.inner_text("#app"), "contrato renovado sem erro")
    encerrar = page.locator('[data-encerrar-contrato]')
    if encerrar.count():
        encerrar.first.click()
        page.wait_for_timeout(150)
        check("Encerrado" in page.inner_text("#app"), "contrato encerrado")

    # ---- Cotacao: 3-orcamentos-with-photo minimum + admin decision flow. Every item now
    # needs >=3 complete orcamentos to save at all; the old "single-quote exception" path is
    # gone (you literally cannot save with fewer than 3). The exception-justification flow
    # still exists, but now only fires when an org RAISES its policy minimum above the
    # built-in 3 (e.g. requires 5 for big purchases) and an admin accepts one of only 3. ----
    click_nav("cotacoes")
    page.fill('#input-min-cot-valor', '300')
    page.fill('#input-min-cot-qtd', '5')
    page.click('#btn-salvar-min-cot')
    page.wait_for_timeout(150)

    page.click("#btn-abrir-cotacao")
    page.wait_for_timeout(100)
    check(page.locator('.quote-line').count()==3, "cotacao form starts with the 3 required orcamento lines")
    page.fill('[data-cotacao-item-search][data-item-idx="0"]', "Item caro unico teste")
    page.fill('[data-cotacao-qtd][data-item-idx="0"]', "100")
    for qi, (forn, preco) in enumerate([("Fornecedor Unico","500,00"),("Fornecedor Unico B","520,00"),("Fornecedor Unico C","510,00")]):
        page.fill(f'[data-quote-field="fornecedor"][data-item-idx="0"][data-quote-idx="{qi}"]', forn)
        page.fill(f'[data-quote-field="preco"][data-item-idx="0"][data-quote-idx="{qi}"]', preco)
        page.set_input_files(f'[data-quote-foto][data-item-idx="0"][data-quote-idx="{qi}"]', PHOTO)
        page.wait_for_timeout(80)
    page.click("#btn-salvar-cotacao")
    page.wait_for_timeout(200)
    close_btn = page.locator('[data-close-cotacao][data-vencedor="Fornecedor Unico"]')
    check(close_btn.count() > 0, "high-value 3-orcamento item shows accept button for admin")
    close_btn.first.click()
    page.wait_for_timeout(200)
    txt2 = page.inner_text("#app")
    print("AFTER ACCEPT (exception expected):", txt2[-1500:])
    exc_input = page.locator("#input-cotacao-exception-just")
    check(exc_input.count() > 0, "exception justification form appears (org policy now requires 5 orcamentos, this item has only 3)")
    if exc_input.count():
        exc_input.fill("Fornecedor exclusivo do fabricante, sem alternativa no mercado.")
        confirm_btn = page.locator('[data-confirmar-excecao-cotacao]')
        confirm_btn.first.click()
        page.wait_for_timeout(200)
        page.click('[data-cotacao-filtro="todas"]')
        page.wait_for_timeout(150)
        txt3 = page.inner_text("#app")
        print("AFTER EXCEPTION CONFIRM:", txt3[txt3.find("Item Caro"):txt3.find("Item Caro")+500] if "Item Caro" in txt3 else "ITEM NOT FOUND IN TEXT")
        check("Aprovada" in txt3, "item approved by admin after exception justification")
        check("exceção" in txt3.lower() and "sem alternativa no mercado" in txt3.lower(), "exception justification recorded and displayed")

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
