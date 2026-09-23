import sys
from playwright.sync_api import sync_playwright

import os
# O teste roda contra o arquivo montado em dist/. Rode antes:
#   python3 build.py
_RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'file://' + os.path.join(_RAIZ, 'dist', 'painel-teste-compras.html')
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
    page.click('[data-nav="compras-periodo"]')
    page.wait_for_timeout(200)

    txt = page.inner_text("#app")
    print(txt[:3000])
    print("----")

    check("R$" in txt, "renders monetary values")
    check("R$\xa06.700" in txt or "R$ 6.700" in txt or "6.700" in txt, "grand total 6.700 present")
    check("jul/26" in txt, "july month label present")
    check("ago/26" in txt, "august month label present")
    check("set/26" in txt, "september month label present")
    check("Parafuso Teste A" in txt, "item name shown (title-cased)")
    check("Fornecedor Alfa" in txt.replace("  "," ") or "Fornecedor Alfa" in txt, "supplier name shown")
    check("Semana" in txt, "week grouping label present")
    check("NaN" not in txt and "undefined" not in txt and "Infinity" not in txt, "no NaN/undefined/Infinity")

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
