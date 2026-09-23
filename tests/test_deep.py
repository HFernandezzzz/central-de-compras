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

    # ---- Obras: full create flow ----
    click_nav("obras")
    page.click("#btn-abrir-obra")
    page.wait_for_timeout(100)
    page.fill("#input-obra-nome", "Obra Teste Regressao")
    page.fill("#input-obra-cliente", "Cliente XPTO")
    page.click("#btn-salvar-obra")
    page.wait_for_timeout(200)
    txt = page.inner_text("#app")
    check("Obra Teste Regressao" in txt, "obra created and listed")

    # ---- Contratos: full create flow ----
    click_nav("contratos")
    page.click("#btn-abrir-contrato")
    page.wait_for_timeout(150)
    html = page.inner_html('.qform') if page.locator('.qform').count() else page.inner_html('#app')
    print("CONTRATO FORM FIELDS:")
    for i in page.locator("input, select, textarea").all():
        try:
            print(" -", i.get_attribute("id"))
        except Exception:
            pass

    browser.close()
