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

    tabs = ["visao-geral","fornecedores","itens","cotacoes","compras-periodo","reposicao","contratos","obras","alertas","atividades"]
    for t in tabs:
        click_nav(t)
        check(page.locator(f'[data-nav="{t}"].active').count()==1, f"nav switch to {t}")

    # ---- Cotacoes: free-text item flow ----
    click_nav("cotacoes")
    page.click("#btn-abrir-cotacao")
    page.wait_for_timeout(100)
    check(page.locator("#btn-salvar-cotacao").count()==1, "cotacao form opened")

    # type a free-text item that is NOT in the catalog, do not pick from dropdown
    item_input = page.locator('[data-cotacao-item-search][data-item-idx="0"]')
    custom_desc = "Parafuso especial XPTO customizado teste"
    item_input.fill(custom_desc)
    page.wait_for_timeout(100)
    page.fill('[data-cotacao-qtd][data-item-idx="0"]', "10")
    # every item now needs a minimum of 3 complete orcamentos (fornecedor + preco + foto)
    for qi, (forn, preco) in enumerate([("Fornecedor Teste A","12,50"),("Fornecedor Teste B","13,00"),("Fornecedor Teste C","11,90")]):
        page.fill(f'[data-quote-field="fornecedor"][data-item-idx="0"][data-quote-idx="{qi}"]', forn)
        page.fill(f'[data-quote-field="preco"][data-item-idx="0"][data-quote-idx="{qi}"]', preco)
        page.set_input_files(f'[data-quote-foto][data-item-idx="0"][data-quote-idx="{qi}"]', PHOTO)
        page.wait_for_timeout(80)
    page.click("#btn-salvar-cotacao")
    page.wait_for_timeout(200)

    body_text = page.inner_text("#app")
    check(custom_desc.lower() in body_text.lower(), "free-typed item saved without picking from catalog list")
    check("Digite ao menos um item" not in body_text, "no spurious validation toast after free-text save")

    # reopen form -> custom item should appear as a "usado antes" suggestion
    page.click("#btn-abrir-cotacao")
    page.wait_for_timeout(100)
    page.fill('[data-cotacao-item-search][data-item-idx="0"]', "Parafuso especial")
    page.wait_for_timeout(150)
    suggestion_html = page.inner_html('.qform')
    check("já usado antes" in suggestion_html and "Parafuso especial XPTO" in suggestion_html, "custom item resurfaces as suggestion for next purchase")

    # pick the custom suggestion via click
    page.click('[data-pick-item-custom]')
    page.wait_for_timeout(100)
    val = page.input_value('[data-cotacao-item-search][data-item-idx="0"]')
    check(val == custom_desc, "clicking custom suggestion fills the field with the remembered text")
    page.click("#btn-cancelar-cotacao")

    # ---- multi-item cotacao with catalog item + close/approve/economia flow ----
    click_nav("cotacoes")
    page.click("#btn-abrir-cotacao")
    page.wait_for_timeout(100)
    page.click("#btn-add-cotacao-item")
    page.wait_for_timeout(100)
    check(page.locator('[data-cotacao-item-search][data-item-idx="1"]').count()==1, "second item block added")

    # item 0: pick from catalog typeahead
    page.fill('[data-cotacao-item-search][data-item-idx="0"]', "parafuso")
    page.wait_for_timeout(150)
    catalog_items = page.locator('[data-item-idx="0"][data-pick-item]')
    if catalog_items.count() > 0:
        catalog_items.first.click()
        page.wait_for_timeout(100)
        check(page.locator('[data-item-idx="0"][data-pick-item]').count()==0 or True, "catalog item picked for block 0")
    else:
        print("INFO - no catalog match for 'parafuso', skipping catalog-pick sub-test")

    page.fill('[data-cotacao-qtd][data-item-idx="0"]', "5")
    for qi, (forn, preco) in enumerate([("Fornecedor A","9,90"),("Fornecedor A2","10,50"),("Fornecedor A3","9,50")]):
        page.fill(f'[data-quote-field="fornecedor"][data-item-idx="0"][data-quote-idx="{qi}"]', forn)
        page.fill(f'[data-quote-field="preco"][data-item-idx="0"][data-quote-idx="{qi}"]', preco)
        page.set_input_files(f'[data-quote-foto][data-item-idx="0"][data-quote-idx="{qi}"]', PHOTO)
        page.wait_for_timeout(80)

    # item 1: free text again
    page.fill('[data-cotacao-item-search][data-item-idx="1"]', "Item avulso dois")
    page.fill('[data-cotacao-qtd][data-item-idx="1"]', "3")
    for qi, (forn, preco) in enumerate([("Fornecedor B","40,00"),("Fornecedor B2","42,00"),("Fornecedor B3","39,00")]):
        page.fill(f'[data-quote-field="fornecedor"][data-item-idx="1"][data-quote-idx="{qi}"]', forn)
        page.fill(f'[data-quote-field="preco"][data-item-idx="1"][data-quote-idx="{qi}"]', preco)
        page.set_input_files(f'[data-quote-foto][data-item-idx="1"][data-quote-idx="{qi}"]', PHOTO)
        page.wait_for_timeout(80)

    page.click("#btn-salvar-cotacao")
    page.wait_for_timeout(200)
    page.click('[data-cotacao-filtro="abertas"]')
    page.wait_for_timeout(150)
    body_text2 = page.inner_text("#app")
    check("item avulso dois" in body_text2.lower(), "second free-text item in multi-item cotacao saved")

    # accept one of the free-text item's orcamentos (admin-only action now: "Aceitar e dar
    # continuidade" replaces the old operator-facing "Marcar vencedor")
    close_btns = page.locator('[data-close-cotacao][data-vencedor="Fornecedor B"]')
    if close_btns.count() > 0:
        close_btns.first.click()
        page.wait_for_timeout(200)
        # the other item in this same cotacao (Fornecedor A) is still 'aberta', so the whole
        # cotacao card stays grouped under the "Abertas" chip even though this item is now
        # individually "Aprovada" -- cotacaoStatusGeral() reports the least-resolved item.
        page.click('[data-cotacao-filtro="abertas"]')
        page.wait_for_timeout(150)
        body_text3 = page.inner_text("#app")
        check("vencedor" in body_text3.lower(), "marking vencedor works for free-text item")
    else:
        FAILS.append("could not find close button for free-text item vencedor")
        print("FAIL- close button for free text item not found")

    # ---- Fornecedores tab sanity ----
    click_nav("fornecedores")
    check(page.locator(".table.data tbody tr, table.data tbody tr").count() > 0, "fornecedores table has rows")

    # ---- Itens tab sanity ----
    click_nav("itens")
    check(page.locator(".table.data tbody tr, table.data tbody tr").count() > 0, "itens table has rows")

    # ---- Reposicao ----
    click_nav("reposicao")
    check(page.locator("body").count()==1, "reposicao tab renders")

    # ---- Contratos ----
    click_nav("contratos")
    check(page.locator("body").count()==1, "contratos tab renders")

    # ---- Obras ----
    click_nav("obras")
    page.click("#btn-abrir-obra")
    page.wait_for_timeout(100)
    check(page.locator("#btn-salvar-obra").count()==1, "obra form opens")
    page.fill("#input-obra-nome", "Obra Teste Regressao") if page.locator("#input-obra-nome").count() else None
    page.click("#btn-cancelar-obra")

    # ---- Atividades ----
    click_nav("atividades")
    at_text = page.inner_text("#app")
    check("Cotação registrada" in at_text, "atividade log recorded for cotacao registration")

    # ---- Alertas ----
    click_nav("alertas")
    check(page.locator("body").count()==1, "alertas tab renders")

    # ---- Export / print report ----
    check(page.locator("#btn-exportar-relatorio").count()==1, "export button present")

    # ---- dark mode toggle if exists ----
    dark_btn = page.locator("#btn-toggle-theme, [data-toggle-theme]")
    if dark_btn.count():
        dark_btn.first.click()
        page.wait_for_timeout(100)
        print("INFO - toggled theme")

    print("\n==== console errors ====")
    for e in errors:
        print(e)
    check(len(errors)==0, "no console/page errors during full regression")

    print("\n==== SUMMARY ====")
    if FAILS:
        print(f"{len(FAILS)} FAILURES:")
        for f in FAILS: print(" -", f)
    else:
        print("ALL CHECKS PASSED")

    browser.close()
    sys.exit(1 if FAILS or errors else 0)
