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
    page = browser.new_page(color_scheme='dark')
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

    tabs = ["visao-geral","fornecedores","itens","cotacoes","compras-periodo","reposicao","contratos","obras","alertas","atividades"]
    for t in tabs:
        click_nav(t)
        check(page.locator(f'[data-nav="{t}"].active').count()==1, f"dark mode: nav switch to {t}")

    # print report content check
    print_html = page.eval_on_selector("#print-report", "el => el ? el.outerHTML.length : 0")
    check(print_html > 0, "print report block exists in DOM")
    print("print report length:", print_html)

    # pagination buttons on compras-periodo (won't exist without >12 weeks/months, just check no crash)
    click_nav("compras-periodo")
    check("Ainda não há nenhuma compra" in page.inner_text("#app"), "compras-periodo empty state shown (fresh reset data)")

    print("\n==== console errors ====")
    for e in errors:
        print(e)
    check(len(errors)==0, "no console/page errors in dark mode")

    print("\n==== SUMMARY ====")
    if FAILS:
        print(f"{len(FAILS)} FAILURES:")
        for f in FAILS: print(" -", f)
    else:
        print("ALL CHECKS PASSED")

    browser.close()
    sys.exit(1 if FAILS or errors else 0)
