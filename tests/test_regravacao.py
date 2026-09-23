import sys
from playwright.sync_api import sync_playwright

# Teste de regressão do caminho de regravação da página (persist -> buildFullDocument).
#
# Quando o painel está hospedado num ambiente que lhe oferece serviço de gravação, cada
# persist() — salvar QUALQUER coisa: uma logo, um fornecedor, uma cotação — remonta e
# regrava a página inteira. Houve um bug real em produção nesse caminho: buildFullDocument
# capturava a folha de estilo com document.querySelector('style') em tempo de execução, o
# que é ambíguo assim que a página passa a ser servida dentro de uma casca que injeta um
# <style> de reset próprio antes do nosso. Ele pegava silenciosamente a tag errada, e o
# documento regravado saía sem CSS nenhum: layout quebrado, imagens sem limite de tamanho.
# A correção embute o CSS real no app.js na montagem (APP_CSS_TEXT), em vez de raspar o DOM.
#
# Nenhum dos outros testes cobre este caminho, porque nenhum deles simula um hospedeiro —
# neles persist() sempre cai no ramo "aberto em modo local".

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

    # Simula um hospedeiro que concede à página o serviço de regravação, guardando cada
    # documento gravado para o teste conferir depois.
    page.add_init_script('''
        window.__documentosGravados = [];
        window.claude = {
          use: function(name) {
            if (name === 'artifact') {
              return Promise.resolve({
                publish: function(html) { window.__documentosGravados.push(html); return Promise.resolve(); }
              });
            }
            return Promise.resolve(null);
          }
        };
    ''')

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
    page.wait_for_timeout(500)  # deixa a checagem do hospedeiro terminar

    check(page.locator('.sync-pill:has-text("equipe")').count() > 0,
          "app detects self-publish capability is available (sync pill shows team-saving state)")

    # Trigger persist() the same way a real user action does (uploading a logo).
    page.set_input_files('#input-logo-upload', '/tmp/test_logo_square.png')
    page.wait_for_timeout(800)

    n_published = page.evaluate('window.__documentosGravados.length')
    check(n_published >= 1, "logo upload triggers a self-publish via buildFullDocument()")

    if n_published:
        doc = page.evaluate('window.__documentosGravados[window.__documentosGravados.length-1]')
        with open('/tmp/_selfpub_check.html', 'w', encoding='utf-8') as f:
            f.write(doc)

        # Reload the documento regravadoument itself, exactly as a viewer would after the
        # Reabre o documento regravado, como faria quem recebe a página atualizada, e confere
        # que é uma página funcionando por inteiro — e não uma casca quebrada.
        # largura de desktop de propósito: abaixo de 900px a barra lateral vira faixa no topo,
        # e o que este teste confere é justamente o layout de coluna fixa com o CSS presente.
        page2 = browser.new_page(viewport={'width': 1280, 'height': 936})
        errors2 = []
        page2.on("console", lambda msg: errors2.append(msg.text) if msg.type == 'error' and 'Failed to load resource' not in msg.text else None)
        page2.on("pageerror", lambda exc: errors2.append(f"pageerror: {exc}"))
        page2.goto('file:///tmp/_selfpub_check.html')
        # this fresh browser context has no session, so it hits the login screen even
        # though the bootstrap admin account already exists in the self-published data.
        page2.wait_for_selector(".auth-card", timeout=10000)
        page2.fill('#input-login-email', 'bootstrap-admin@test.local')
        page2.fill('#input-login-senha', 'bootstrap123')
        page2.click('#btn-login-submit')
        page2.wait_for_selector('#app .nav-item', timeout=10000)
        page2.wait_for_timeout(300)

        counts = page2.evaluate('''() => ({
            navItems: document.querySelectorAll("#app .nav-item").length,
            appStyle: document.querySelectorAll("style#app-style").length,
            dataBlob: document.querySelectorAll("script#data-blob").length,
            brandMarkWidth: getComputedStyle(document.querySelector(".brand-mark")).width,
            sidebarWidth: getComputedStyle(document.querySelector(".sidebar")).width
        })''')
        print("documento regravado, reloaded:", counts)
        # 15, not 12: the bootstrap account is an admin (registered with the admin code),
        # so it also sees the admin-only "Usuarios" tab, plus the "Agendamento de Compras",
        # "Hora Extra" and "Mapa comparativo" tabs added alongside the original 11 tabs
        # (12 minus the removed "Mapa de fornecedores" tab).
        check(counts["navItems"] == 15, "documento regravado still has every tab, including Mapa comparativo")
        check(counts["appStyle"] == 1, "documento regravado has exactly one app stylesheet")
        check(counts["dataBlob"] == 1, "documento regravado has exactly one data-blob")
        check(counts["brandMarkWidth"] == "34px", f"brand-mark keeps its real fixed width in the documento regravado (got {counts['brandMarkWidth']!r})")
        check(counts["sidebarWidth"] == "232px", f"sidebar keeps its real fixed width in the documento regravado (got {counts['sidebarWidth']!r})")

        logo_box = page2.eval_on_selector('.brand-mark img', 'el => el ? {w: el.clientWidth, h: el.clientHeight} : null')
        check(logo_box == {"w": 34, "h": 34}, f"uploaded logo renders at the correct small size in the documento regravado (got {logo_box})")

        check(len(errors2) == 0, "no console/page errors when loading the documento regravado")
        for e in errors2:
            print("  self-pub reload error:", e)

        page2.close()

    print("\n==== console errors (original page) ====")
    for e in errors:
        print(e)
    check(len(errors) == 0, "no console/page errors on the original page")

    print("\n==== SUMMARY ====")
    if FAILS:
        print(f"{len(FAILS)} FAILURES:")
        for f in FAILS: print(" -", f)
    else:
        print("ALL CHECKS PASSED")

    browser.close()
    sys.exit(1 if FAILS or errors else 0)
