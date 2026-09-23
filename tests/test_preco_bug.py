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

    # ---- Cotacao with a price that has BOTH a thousands separator AND non-zero cents ----
    click_nav("cotacoes")
    page.click("#btn-abrir-cotacao")
    page.wait_for_timeout(100)
    page.fill('[data-cotacao-item-search][data-item-idx="0"]', "Item preco alto teste")
    page.fill('[data-cotacao-qtd][data-item-idx="0"]', "2")
    page.fill('[data-quote-field="fornecedor"][data-item-idx="0"][data-quote-idx="0"]', "Fornecedor Preco Teste")
    # 1.234,56 -> should be interpreted as R$ 1234,56 (one thousand two hundred thirty four reais and 56 cents)
    page.fill('[data-quote-field="preco"][data-item-idx="0"][data-quote-idx="0"]', "1.234,56")
    page.set_input_files('[data-quote-foto][data-item-idx="0"][data-quote-idx="0"]', PHOTO)
    page.wait_for_timeout(150)
    txt_live = page.inner_text("#app")
    # find the live-typed line total shown near the quote line (valor total = qtd * preco = 2 * 1234.56 = 2469.12)
    print("---- form snippet ----")
    idx = txt_live.find("Fornecedor Preco Teste")
    print(txt_live[max(0,idx-200):idx+400])
    # every item now needs a minimum of 3 complete orcamentos (fornecedor + preco + foto)
    for qi, (forn, preco) in enumerate([("Fornecedor Preco Teste B","1.300,00"),("Fornecedor Preco Teste C","1.250,00")], start=1):
        page.fill(f'[data-quote-field="fornecedor"][data-item-idx="0"][data-quote-idx="{qi}"]', forn)
        page.fill(f'[data-quote-field="preco"][data-item-idx="0"][data-quote-idx="{qi}"]', preco)
        page.set_input_files(f'[data-quote-foto][data-item-idx="0"][data-quote-idx="{qi}"]', PHOTO)
        page.wait_for_timeout(80)
    page.click("#btn-salvar-cotacao")
    page.wait_for_timeout(200)

    # ---- Scoped check: the "menor preço" line in the OPEN cotação card must show the
    # correct unit price (R$ 1.234,56), not a mangled value like R$ 123.456,00 ----
    card_row = page.locator('.bar-row', has_text="Fornecedor Preco Teste")
    check(card_row.count() > 0, "quote line for Fornecedor Preco Teste is rendered")
    row_txt = card_row.first.inner_text() if card_row.count() else ""
    print("---- quote line row text ----", repr(row_txt))
    check("1.234,56" in row_txt, f"quote line shows correct unit price R$1.234,56 (got: {row_txt!r})")
    check("123.456,00" not in row_txt, "unit price NOT mangled into R$123.456,00 (double-parse bug symptom)")

    close_btn = page.locator('[data-close-cotacao][data-vencedor="Fornecedor Preco Teste"]')
    check(close_btn.count() > 0, "cotacao with formatted price saved and closable")
    if close_btn.count():
        close_btn.first.click()
        page.wait_for_timeout(200)

    click_nav("compras-periodo")
    # Scope to the row for our specific test item rather than scanning the whole page,
    # since an unrelated coincidental substring elsewhere would make this check meaningless.
    item_row = page.locator('tr', has_text="Item Preco Alto Teste")
    check(item_row.count() > 0, "test item appears in compras-periodo top itens table")
    item_row_txt = item_row.first.inner_text() if item_row.count() else ""
    print("---- compras-periodo item row ----", repr(item_row_txt))
    # total should reflect 2 * 1234.56 = 2469.12 -> "R$ 2.469"; a double-parse/truncation
    # bug would instead show something wildly different like R$ 246.912 or R$ 2.
    check("2.469" in item_row_txt, f"correct total for price with thousands-sep + cents (expected ~R$2.469) — got {item_row_txt!r}")
    check("246.912" not in item_row_txt, "total NOT inflated 100x (double-parse bug symptom)")

    # ---- CSV export should also reflect correct numeric price, scoped to our row ----
    click_nav("cotacoes")
    page.click("#btn-abrir-csv-export")
    page.wait_for_timeout(150)
    page.click('[data-csv-dataset="cotacoes"]')
    page.wait_for_timeout(150)
    csv_val = page.input_value("#csv-export-textarea")
    csv_lines = [l for l in csv_val.split("\n") if "Fornecedor Preco Teste" in l]
    check(len(csv_lines) == 1, "exactly one csv row for our test cotacao")
    csv_line = csv_lines[0] if csv_lines else ""
    print("---- csv row ----", repr(csv_line))
    check("1234,56" in csv_line or "1234.56" in csv_line, f"csv export shows correct unit price (1234.56), not truncated — got {csv_line!r}")
    check("2469,12" in csv_line or "2469.12" in csv_line, f"csv export shows correct total (2469.12) — got {csv_line!r}")

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
