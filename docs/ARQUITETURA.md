# Arquitetura

Mapa de navegação do código para quem vai mexer nele. Os números de linha apontam para os
arquivos-fonte em `src/`, não para o HTML montado.

## Visão de conjunto

```
src/template.html   964 linhas   casca HTML + todo o CSS
src/app.js        5.700 linhas   a aplicação inteira
data/*.json                      os dados
        ↓  build.py
dist/central-de-compras.html     um arquivo autossuficiente
```

`build.py` faz três coisas: lê o CSS de dentro de `template.html` e o injeta como texto em
`app.js` (no marcador `/*__APP_CSS__*/`, para o app conseguir se republicar inteiro depois),
substitui `/*__DATA_JSON__*/` pelos dados e `/*__APP_JS__*/` pelo script, e grava o resultado.

## O ciclo de vida

1. Na carga, `app.js` lê o JSON de `<script id="data-blob">` e monta o objeto `STATE`.
2. `render()` reconstrói `#app.innerHTML` inteiro a partir de `STATE` + `UI`.
3. Um clique cai num dos quatro listeners globais, que alteram `STATE`/`UI` e chamam
   `render()` de novo.
4. `persist()` reescreve o documento inteiro com os dados novos.

Não há componentes, nem diffing, nem binding. É um laço: estado entra, HTML sai.

### Duas regras que não podem ser quebradas

**Todo campo novo em `STATE` precisa aparecer em `buildFullDocument()`** (linha 911 de
`app.js`). O que não estiver lá se perde na próxima gravação — é o erro mais fácil de cometer
neste código.

**Nenhum listener preso a elemento.** Todo evento é tratado por delegação no `document`
(`click` 4168, `input` 5289, `change` 5388, `keydown` 5640). Como `render()` troca o HTML
inteiro, um listener preso a um botão morreria junto com ele; a delegação sobrevive porque
está no documento, não no elemento.

## `src/app.js`

### Estado e infraestrutura

| Linha | O quê |
|---|---|
| 24 | `var STATE` — tudo que é persistido (fornecedores, cotações, pedidos, comparativo, usuários…) |
| 131 | `var UI` — só estado de tela: aba ativa, filtros, formulários abertos, toasts |
| 212 | `host()` / `pedirServico()` — **todo o acoplamento com o ambiente que hospeda a página** (gravação e download). Hospedar em outro lugar mexe só aqui |
| 297 | `var ICONS` — os SVGs usados na interface |
| 911 | `buildFullDocument()` — monta o documento completo para gravar |
| 942 | `persist()` — grava o estado |
| 1048 | `var NAV_ITEMS` — as abas do menu lateral, com seus contadores |

### Telas

| Linha | Função | Aba |
|---|---|---|
| 1154 | `renderShell()` | menu lateral + topo |
| 1292 | `renderTab()` | roteador: decide qual aba desenhar |
| 1320 | `renderVisaoGeral()` | Visão geral |
| 1385 | `renderFornecedores()` | Fornecedores |
| 1589 | `renderItens()` | Itens & Matriz |
| 1646 | `renderScatter()` | gráfico da matriz de Kraljic |
| 1706 | `renderCotacoes()` | Cotações |
| 2191 | `renderComparativo()` | Mapa comparativo |
| 3266 | `renderPedidos()` | Pedidos de compra |
| 3798 | `renderUsuarios()` | Usuários |
| 3933 | `renderAgendamento()` | Agendamento de Compras (Kanban) |
| 4145 | `render()` | a raiz — daqui até o fim ficam os listeners |

### Mapa comparativo

Todas as funções começam com `cmp`. O bloco vai da linha 1900 à 3230.

| Linha | O quê |
|---|---|
| 1961 | `CMP_PESOS` — **os pesos da nota de custo-benefício**. Mexa aqui para mudar o critério; os valores aparecem escritos na tela e no rodapé da tabela, então se explicam sozinhos |
| 2191 | `renderComparativo()` — indicadores + abas internas + painel |
| 2661 | `cmpTabelaComparativa()` — a tabela lado a lado |

Os cálculos que importam: `cmpTotalLinha` (quantidade × preço − desconto + frete),
`cmpUnitLiquido` (o total dividido pela quantidade — o comparador justo quando as propostas
cotam quantidades diferentes) e `cmpComPontuacao` (normaliza preço, prazo, pagamento,
homologação e validade em notas de 0 a 100 e aplica os pesos).

## `src/template.html`

Todo o CSS vive num `<style id="app-style">`, organizado em seções:

| Linha | Seção |
|---|---|
| 4 | Design tokens — **todas as cores saem daqui**; trocar um token muda o app inteiro |
| 53 | Reset / base |
| 101 | Shell layout (sidebar, topbar, conteúdo) |
| 177 | Componentes (cards, badges, botões, tabelas, modais) |
| 333 | Notificações (sino) |
| 383 | Login / cadastro |
| 430 | Agendamento de Compras (Kanban) |
| 449 | Mapa Comparativo |
| 918 | Falling light rays (efeito de fundo da tela de login) |

## Onde mexer para cada tipo de mudança

- **Cores, espaçamentos, tipografia** → os design tokens, linha 4 de `template.html`.
- **Comportamento de uma aba** → a função `render<NomeDaAba>()` correspondente.
- **Campo novo nos dados** → `STATE` (24) **e** `buildFullDocument()` (911).
- **Nova aba** → `NAV_ITEMS` (1048), `TAB_TITLES` logo abaixo, e um `if` em `renderTab()` (1292).
- **Critério da recomendação de compra** → `CMP_PESOS` (1961).
