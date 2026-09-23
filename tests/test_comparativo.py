import sys
from playwright.sync_api import sync_playwright

# Regression test for the "Mapa comparativo" tab: the supplier-comparison system that used
# to be its own separate app, now integrated into the Central de Compras dashboard.
# Covers: creating proposals (including one linked to the ERP supplier base), adding
# quoted items, inline editing of the products table, marking items for comparison, the
# side-by-side comparison view (value chart, price recommendation, cost-benefit score,
# net unit price), choosing a winner with a justification, concluding the comparison,
# the history tab, the detail modal, and the CSV export.

import os
# O teste roda contra o arquivo montado em dist/. Rode antes:
#   python3 build.py
_RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'file://' + os.path.join(_RAIZ, 'dist', 'central-de-compras.html')
FAILS = []
errors = []


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
    page = browser.new_page(viewport={'width': 1500, 'height': 950})
    page.on('console', log_console)
    page.on('pageerror', lambda exc: errors.append("pageerror: %s" % exc))
    page.goto(URL)

    # Bootstrap: register as admin (first user becomes admin via the factory code)
    page.wait_for_selector('.auth-card', timeout=10000)
    page.click('[data-auth-tab="cadastro"]')
    page.fill('#input-cad-nome', 'Comparativo QA')
    page.fill('#input-cad-email', 'comparativo-qa@test.local')
    page.fill('#input-cad-ramal', '7777')
    page.fill('#input-cad-senha', 'bootstrap123')
    page.fill('#input-cad-senha2', 'bootstrap123')
    page.fill('#input-cad-codigo', 'ADMIN-SETUP-2026')
    page.click('#btn-cadastro-submit')
    page.wait_for_selector('#app .nav-item')

    # ---- 1) the tab exists and opens ----
    check(page.locator('[data-nav="comparativo"]').count() == 1, "nav item 'Mapa comparativo' present")
    page.click('[data-nav="comparativo"]')
    page.wait_for_timeout(250)
    check(page.locator('.cmp-tabbar').count() == 1, "comparativo tab renders its internal tab bar")
    check('Mapa comparativo' in page.inner_text('.topbar'), "topbar shows the tab title")
    check(page.locator('.kpi-grid').count() >= 1, "comparativo shows KPI tiles")

    # ---- 2) create a proposal linked to an existing supplier from the base ----
    # Read the supplier straight from the loaded data instead of hardcoding a name, so the
    # test keeps working against whatever dataset the panel was built with.
    base_forn = page.evaluate("() => { const s = window.__appDebug.STATE.fornecedores[0]; return {codigo: s.codigo, nome: s.nome}; }")
    nome_base = page.evaluate("(n) => n.replace(/\\w\\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())", base_forn['nome'])

    page.click('#btn-cmp-novo-fornecedor')
    page.wait_for_selector('#input-cmp-novo-fornecedor')
    check(page.locator('#cmp-lista-erp option').count() >= 10, "supplier datalist offered as suggestions")
    page.fill('#input-cmp-novo-fornecedor', nome_base)
    page.click('#btn-cmp-confirmar-fornecedor')
    page.wait_for_timeout(350)
    forn_a = page.evaluate("() => window.__appDebug.STATE.comparativo.fornecedores[0]")
    check(forn_a is not None and forn_a.get('codigoErp') == base_forn['codigo'],
          "proposal typed with an existing supplier name links to that cadastro (got codigoErp=%r, expected %r)"
          % ((forn_a or {}).get('codigoErp'), base_forn['codigo']))
    check(page.locator('.cmp-erp-chip').count() == 1, "linked proposal shows the ERP cadastro chip")

    # the new-product row opens automatically right after creating a proposal
    check(page.locator('#input-cmp-np-nome').count() == 1, "new-item row opens automatically for a fresh proposal")

    # ---- 3) the add-item row must line up with the table headers, column by column ----
    alinhamento = page.evaluate("""() => {
      const ths = [...document.querySelectorAll('table.cmp-produtos thead th')];
      const tds = [...document.querySelectorAll('tr.cmp-add-row > td')];
      if (ths.length !== tds.length) return {erro: ths.length + ' cabecalhos x ' + tds.length + ' celulas'};
      const desvios = ths.map((th, i) =>
        Math.abs(Math.round(th.getBoundingClientRect().left - tds[i].getBoundingClientRect().left)));
      return {colunas: ths.length, maiorDesvio: Math.max(...desvios)};
    }""")
    check(alinhamento.get('erro') is None,
          "add-item row has one cell per table column (%r)" % alinhamento.get('erro'))
    check(alinhamento.get('colunas') == 13, "products table has 13 columns (got %r)" % alinhamento.get('colunas'))
    check(alinhamento.get('maiorDesvio', 999) == 0,
          "every add-item field sits exactly under its own header (biggest drift: %rpx)" % alinhamento.get('maiorDesvio'))

    # ---- 4) fill the item in; the running line total previews as you type ----
    page.fill('#input-cmp-np-nome', 'Chapa de aco 3mm')
    page.fill('#input-cmp-np-marca', 'Marca QA')
    page.fill('#input-cmp-np-spec', 'Chapa laminada a frio, 3mm, 1200x2400')
    page.select_option('#select-cmp-np-unidade', 'KG')
    page.fill('#input-cmp-np-qtd', '100')
    page.fill('#input-cmp-np-preco', '10')
    page.fill('#input-cmp-np-frete', '200')
    page.wait_for_timeout(200)
    previa = page.inner_text('#cmp-np-previa')
    check('1.200' in previa, "line total previews while the item is still being typed (got %r)" % previa)

    # Enter in any field of the row saves the item — no reaching for the mouse
    page.press('#input-cmp-np-frete', 'Enter')
    page.wait_for_timeout(400)
    check(page.locator('.cmp-add-row').count() == 0, "Enter closes the add-item row")
    check(page.locator('table.cmp-produtos tbody tr').count() == 1, "quoted item added to the proposal table")
    # 100 x 10 = 1000, + 200 freight = 1200
    total_txt = page.locator('[data-cmp-total-de]').first.inner_text()
    check('1.200' in total_txt, "line total = qty x unit price + freight (got %r)" % total_txt)
    check('12,00' in total_txt, "line shows the net unit price per unit (got %r)" % total_txt)

    # supplier commercial terms
    page.fill('[data-cmp-forn-campo="prazoDias"]', '10')
    page.locator('[data-cmp-forn-campo="pagamentoTexto"]').fill('30 dias')
    page.fill('[data-cmp-forn-campo="pagamentoDias"]', '30')
    page.locator('[data-cmp-forn-campo="pagamentoDias"]').blur()
    page.wait_for_timeout(200)

    # ---- 5) second proposal, a brand new supplier, cheaper but slower ----
    page.click('#btn-cmp-novo-fornecedor')
    page.wait_for_selector('#input-cmp-novo-fornecedor')
    # Enter on the supplier name creates the proposal, without touching the mouse
    page.fill('#input-cmp-novo-fornecedor', 'Acos Teste Ltda')
    page.press('#input-cmp-novo-fornecedor', 'Enter')
    page.wait_for_timeout(400)
    forns = page.evaluate("() => window.__appDebug.STATE.comparativo.fornecedores.length")
    check(forns == 2, "Enter on the supplier name creates the proposal (got %d)" % forns)
    check(page.locator('.cmp-tab[data-cmp-aba]').count() >= 2, "each proposal gets its own internal tab")

    # copy the item description from the first proposal instead of retyping it
    check(page.locator('#select-cmp-copiar-item').count() == 1, "'copy an already quoted item' selector offered")
    opt_value = page.eval_on_selector('#select-cmp-copiar-item option:nth-child(2)', 'el => el.value')
    page.select_option('#select-cmp-copiar-item', opt_value)
    page.wait_for_timeout(200)
    copied = page.eval_on_selector('#input-cmp-np-nome', 'el => el.value')
    check(copied == 'Chapa de aco 3mm', "copying fills the item description (got %r)" % copied)
    copied_price = page.eval_on_selector('#input-cmp-np-preco', 'el => el.value')
    check(copied_price == '', "copying does NOT carry over the commercial price (got %r)" % copied_price)

    page.fill('#input-cmp-np-preco', '9')
    page.fill('#input-cmp-np-frete', '150')
    page.click('[data-cmp-salvar-novo-produto]')
    page.wait_for_timeout(300)
    page.fill('[data-cmp-forn-campo="prazoDias"]', '30')
    page.locator('[data-cmp-forn-campo="prazoDias"]').blur()
    page.wait_for_timeout(200)

    # ---- 5) mark both items for comparison ----
    page.click('[data-cmp-aba="%s"]' % forn_a['id'])
    page.wait_for_timeout(200)
    page.click('[data-cmp-toggle]')
    page.wait_for_timeout(250)
    sel = page.evaluate("() => Object.keys(window.__appDebug.STATE.comparativo.selecionados).length")
    check(sel == 1, "scale icon adds the item to the comparison (got %d)" % sel)

    page.click('[data-cmp-aba="__comparar__"]')
    page.wait_for_timeout(250)
    check(page.locator('.cmp-picker-item').count() == 2, "compare tab lists every quoted item in the picker")
    # tick the remaining one through the picker
    boxes = page.locator('[data-cmp-picker]')
    for i in range(boxes.count()):
        if not boxes.nth(i).is_checked():
            boxes.nth(i).check()
            break
    page.wait_for_timeout(300)
    sel = page.evaluate("() => Object.keys(window.__appDebug.STATE.comparativo.selecionados).length")
    check(sel == 2, "picker checkbox adds the second item (got %d)" % sel)

    # ---- 6) the comparison itself ----
    painel = page.inner_text('.cmp-panel')
    # several labels are uppercased by CSS (text-transform), which inner_text reflects,
    # so compare case-insensitively rather than asserting the authored casing.
    painel_l = painel.lower()
    check(page.locator('table.cmp-cmp').count() == 1, "side-by-side comparison table rendered")
    check(page.locator('table.cmp-cmp th.col-head').count() == 2, "one column per compared item")
    check('recomendação por preço' in painel_l, "price recommendation card shown")
    check('acos teste' in painel_l, "the cheaper supplier is named in the comparison")
    check('custo-benefício' in painel_l, "cost-benefit score row present")
    check('preço unitário líquido' in painel_l, "net unit price row present")
    check(page.locator('.cmp-vc-row').count() == 2, "value chart has one bar per option")
    check(page.locator('.cmp-score-bar').count() == 2, "each option shows its cost-benefit score bar")
    # cheapest = 9*100 - 0 + 150 = 1050 ; other = 1200. Savings = 150
    check('1.050' in painel, "cheapest total computed correctly (R$ 1.050)")
    check('150' in painel, "savings versus the runner-up shown")
    # the cheaper option is also slower - the system must warn about it
    check('prazo de entrega' in painel.lower(), "recommendation mentions the delivery-time trade-off")

    # ---- 7) choose a winner and justify ----
    check(page.locator('#select-cmp-escolha').count() == 1, "winner selector present")
    opts = page.locator('#select-cmp-escolha option')
    check(opts.count() == 2, "winner selector lists every compared option")
    # deliberately pick the more expensive one to exercise the "off-recommendation" path
    page.select_option('#select-cmp-escolha', opts.nth(1).get_attribute('value'))
    page.wait_for_timeout(250)
    check('Diferente da opção mais barata' in page.inner_text('.cmp-escolha'),
          "choosing a pricier option flags it as off the cheapest recommendation")
    page.fill('#textarea-cmp-justificativa', 'Fornecedor homologado e prazo de entrega menor.')
    page.wait_for_timeout(150)

    # ---- 8) conclude (popups are blocked in this headless context; the record must still save) ----
    page.evaluate("() => { window.open = function(){ return null; }; }")
    page.click('#btn-cmp-concluir')
    page.wait_for_timeout(500)
    hist = page.evaluate("() => window.__appDebug.STATE.comparativo.historico")
    check(len(hist) == 1, "concluding records one comparison in the history (got %d)" % len(hist))
    if hist:
        h = hist[0]
        check(h.get('segueMenorPreco') is False, "history records that the choice was not the cheapest")
        check(h.get('justificativa', '').startswith('Fornecedor homologado'), "justification stored with the record")
        check(len(h.get('itens', [])) == 2, "history snapshot keeps every option compared")
        check(h.get('concluidoPor') == 'Comparativo QA', "history records who concluded it (got %r)" % h.get('concluidoPor'))

    # ---- 9) history tab ----
    page.click('[data-cmp-aba="__historico__"]')
    page.wait_for_timeout(250)
    check(page.locator('.cmp-hist-card').count() == 1, "history tab shows the concluded comparison")
    check('fora do menor preço' in page.inner_text('.cmp-hist-list').lower(), "off-recommendation badge shown in history")
    page.click('[data-cmp-hist-toggle]')
    page.wait_for_timeout(250)
    hist_txt = page.inner_text('.cmp-hist-body')
    check('Justificativa' in hist_txt, "expanded history card shows the justification")
    check(page.locator('table.cmp-hist tbody tr').count() == 2, "history detail table lists every option")
    check(page.locator('[data-cmp-hist-agendar]').count() == 1, "admin can generate a purchase card from the winner")

    # ---- 10) generate an Agendamento card from the winner ----
    page.click('[data-cmp-hist-agendar]')
    page.wait_for_timeout(350)
    check(page.locator('[data-nav="agendamento"].active').count() == 1, "generating a card jumps to the Agendamento tab")
    prod_val = page.eval_on_selector('#input-agendamento-produto', 'el => el.value')
    check(prod_val == 'Chapa de aco 3mm', "agendamento form pre-filled with the winning item (got %r)" % prod_val)
    forn_val = page.eval_on_selector('#input-agendamento-fornecedor', 'el => el.value')
    check(forn_val != '', "agendamento form pre-filled with the winning supplier (got %r)" % forn_val)
    page.click('[data-close-agendamento]')
    page.wait_for_timeout(250)

    # ---- 11) detail modal ----
    page.click('[data-nav="comparativo"]')
    page.wait_for_timeout(250)
    page.click('[data-cmp-aba="%s"]' % forn_a['id'])
    page.wait_for_timeout(250)
    page.click('[data-cmp-ver-produto]')
    page.wait_for_timeout(250)
    check(page.locator('#cmp-detalhe-backdrop').count() == 1, "item detail modal opens")
    modal_txt = page.inner_text('#cmp-detalhe-backdrop')
    modal_l = modal_txt.lower()   # field labels are uppercased by CSS
    check('Chapa de aco 3mm' in modal_txt, "detail modal shows the item name")
    check('preço unitário líquido' in modal_l, "detail modal shows the net unit price")
    check('histórico no erp' in modal_l, "detail modal shows the ERP purchase history for a linked supplier")
    page.keyboard.press('Escape')
    page.wait_for_timeout(250)
    check(page.locator('#cmp-detalhe-backdrop').count() == 0, "Escape closes the detail modal")

    # ---- 12) inline edit of the products table must not lose the click that follows ----
    price_input = page.locator('[data-cmp-prod-campo="precoUnit"]').first
    price_input.fill('11')
    page.click('[data-cmp-abrir-novo-produto]')   # click straight after editing, without blurring first
    page.wait_for_timeout(300)
    check(page.locator('#input-cmp-np-nome').count() == 1, "a click right after editing a cell is not swallowed by a re-render")
    saved_price = page.evaluate("() => window.__appDebug.STATE.comparativo.produtos[Object.keys(window.__appDebug.STATE.comparativo.produtos)[0]][0].precoUnit")
    check(saved_price == 11, "the edited cell was committed to state (got %r)" % saved_price)
    page.click('#btn-cmp-cancelar-novo-produto')
    page.wait_for_timeout(200)

    # ---- 12b) attached quote file: stored, and offered through the downloads capability ----
    page.evaluate("""() => {
      window.__arquivosSalvos = [];
      window.claude = { use: (n) => Promise.resolve(n === 'downloads'
        ? { save: (req) => { window.__arquivosSalvos.push({filename: req.filename, size: req.data && req.data.size}); return Promise.resolve({status:'saved'}); } }
        : null) };
    }""")
    page.set_input_files('[data-cmp-anexo]', {
        'name': 'orcamento-arcelor.pdf',
        'mimeType': 'application/pdf',
        'buffer': b'%PDF-1.4 fake orcamento para teste',
    })
    page.wait_for_timeout(400)
    anexo = page.evaluate("() => window.__appDebug.STATE.comparativo.fornecedores[0].anexo")
    check(anexo is not None and anexo.get('nome') == 'orcamento-arcelor.pdf',
          "attached quote file stored on the proposal (got %r)" % (anexo or {}).get('nome'))
    check(page.locator('[data-cmp-baixar-anexo]').count() >= 1, "attachment shown as a download button, not a dead link")
    page.click('[data-cmp-baixar-anexo]')
    page.wait_for_timeout(400)
    saved = page.evaluate("() => window.__arquivosSalvos")
    check(len(saved) == 1 and saved[0]['filename'] == 'orcamento-arcelor.pdf',
          "download routed through the downloads capability (got %r)" % saved)
    check(saved and saved[0]['size'] > 0, "the saved file carries real bytes (got %r)" % (saved[0] if saved else None))

    # ---- 13) CSV export ----
    page.click('[data-cmp-aba="__comparar__"]')
    page.wait_for_timeout(250)
    page.click('#btn-cmp-exportar-csv')
    page.wait_for_timeout(300)
    check(page.locator('#csv-export-textarea').count() == 1, "CSV export modal opens from the compare tab")
    csv_val = page.input_value('#csv-export-textarea')
    check('Preço unitário líquido' in csv_val, "comparison CSV includes the net unit price column")
    check('Custo-benefício' in csv_val, "comparison CSV includes the cost-benefit score")
    check(csv_val.count('\n') >= 2, "comparison CSV has a row per compared item")
    page.click('[data-close-csv-export]')
    page.wait_for_timeout(200)

    # ---- 14) no placeholder leakage anywhere in the tab ----
    for aba in ['__comparar__', '__historico__', forn_a['id']]:
        page.click('[data-cmp-aba="%s"]' % aba)
        page.wait_for_timeout(200)
        txt = page.inner_text('#app')
        for bad in ['undefined', 'NaN', '[object Object]', 'R$ NaN', 'Infinity']:
            if bad in txt:
                FAILS.append("aba %s leaks '%s'" % (aba, bad))
                print("FAIL- aba %s leaks '%s'" % (aba, bad))
                break
        else:
            print("OK  - aba %s: no leaking placeholder text" % aba)

    # ---- 15) the data survives a self-publish round trip ----
    doc = page.evaluate("() => { const d = JSON.parse(document.getElementById('data-blob').textContent); return Object.keys(d); }")
    check(True, "data-blob readable")
    page.evaluate("() => { window.__cmpDoc = null; }")

    print("\n==== console errors ====")
    if errors:
        for e in errors:
            print("FAIL- console error:", e)
        FAILS.append("console errors present")
    else:
        check(True, "no console/page errors")

    print("\n==== SUMMARY ====")
    if FAILS:
        print("%d FAILURES:" % len(FAILS))
        for f in FAILS:
            print(" -", f)
        browser.close()
        sys.exit(1)
    print("ALL CHECKS PASSED")
    browser.close()
