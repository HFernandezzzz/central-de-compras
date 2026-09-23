import sys
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

    click_nav("fornecedores")
    page.click('[data-open-fornecedor]')
    page.wait_for_timeout(150)
    modal_txt = page.inner_text("#app")
    check("undefined" not in modal_txt and "NaN" not in modal_txt, "fornecedor modal has no undefined/NaN with empty catalog")

    page.select_option("#select-fornecedor-status", "homologado")
    page.fill("#input-fornecedor-contato-nome", "Joao Comprador")
    page.fill("#input-fornecedor-telefone", "(11) 99999-0000")
    page.fill("#input-fornecedor-email", "joao@fornecedor.com")
    page.fill("#input-fornecedor-cidade", "Sao Paulo")
    page.fill("#input-fornecedor-uf", "SP")
    page.select_option("#select-fornecedor-fiscal", "regular")
    page.check("#chk-fornecedor-iso9001")
    page.fill("#textarea-fornecedor-obs", "Fornecedor confiavel, entrega no prazo.")
    page.click("[data-save-fornecedor]")
    page.wait_for_timeout(200)

    # reopen to verify persistence
    click_nav("visao-geral")
    click_nav("fornecedores")
    page.click('[data-open-fornecedor]')
    page.wait_for_timeout(150)
    modal_txt2 = page.inner_text("#app")
    check("Joao Comprador" in modal_txt2, "fornecedor contact name persisted")
    check("joao@fornecedor.com" in modal_txt2, "fornecedor email persisted")
    check("Homologado" in modal_txt2, "fornecedor status persisted")

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
