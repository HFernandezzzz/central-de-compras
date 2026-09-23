# Central de Compras

Painel de gestão de suprimentos que roda inteiro dentro de **um único arquivo HTML**, sem
servidor, sem banco de dados, sem instalação e sem dependência externa. Abre com dois
cliques, funciona offline e pode ser guardado num pen drive.

Foi escrito para o dia a dia de um setor de compras industrial: consolidar o gasto vindo do
ERP, classificar fornecedores e itens por risco, registrar cotações com no mínimo três
orçamentos, comparar propostas lado a lado e acompanhar pedidos até o recebimento.

*[English version](README.en.md)*

![Visão geral do painel](docs/img/02-visao-geral.png)

> Todos os dados mostrados nas imagens e no repositório são **fictícios**, gerados por
> `tools/gerar_dados_exemplo.py`. Nenhum fornecedor, preço ou pedido real de nenhuma empresa
> está aqui.

---

## Índice

- [Como rodar](#como-rodar)
- [O que ele faz](#o-que-ele-faz)
- [Usando com os seus dados](#usando-com-os-seus-dados)
- [Como funciona por dentro](#como-funciona-por-dentro)
- [Testes](#testes)
- [Limites e segurança](#limites-e-segurança)
- [Licença](#licença)

---

## Como rodar

Você precisa só de Python 3.8+ para montar o arquivo. O aplicativo em si não precisa de nada.

```bash
git clone https://github.com/<seu-usuario>/central-de-compras.git
cd central-de-compras

python3 tools/gerar_dados_exemplo.py   # cria a base fictícia
python3 build.py                       # monta dist/central-de-compras.html
```

Abra `dist/central-de-compras.html` no navegador. Na primeira vez ele pede um cadastro:
use o código de administrador de fábrica **`ADMIN-SETUP-2026`** para a primeira conta virar
administradora, e **troque esse código** logo em seguida, na aba *Usuários*, já que ele é
público aqui no repositório.

---

## O que ele faz

### Visão geral
Indicadores do período (gasto, pedidos, fornecedores ativos, concentração), gasto por mês e
por categoria, os dez maiores fornecedores e os pontos que merecem atenção do comprador.

### Fornecedores
Cadastro consolidado, fornecedores que tinham mais de um código no ERP aparecem como um
registro só, com o histórico inteiro junto. Cada um tem ficha completa: razão social, CNPJ,
condição de pagamento, contato, endereço, avaliação por estrelas, status de homologação e
anexo de certificados. Dá para cadastrar fornecedores que ainda não existem no ERP.

![Fornecedores](docs/img/04-fornecedores.png)

### Itens & Matriz
Todos os itens comprados, classificados pela **matriz de Kraljic** em estratégico,
alavancagem, gargalo e rotina, cruzando gasto com número de fornecedores. O gráfico de
dispersão mostra de imediato quais itens concentram dinheiro e risco ao mesmo tempo.

![Itens e matriz de criticidade](docs/img/03-itens-matriz.png)

### Cotações
Registro de cotações exigindo no mínimo três orçamentos por item, cada um com fornecedor,
preço e **foto do item**. Um administrador escolhe qual aceitar; fechar com menos orçamentos
do que a política exige obriga a escrever uma justificativa, que fica registrada.

### Mapa comparativo
Comparação de propostas lado a lado. Cada proposta recebida vira uma aba com a ficha do
fornecedor e os itens cotados (foto, marca, especificação, quantidade, preço, desconto,
frete, MOQ, impostos). A tela de comparação traz:

- **preço unitário líquido**, total com desconto e frete dividido pela quantidade, que é o
  único jeito honesto de comparar propostas com quantidades diferentes;
- **recomendação por preço**, com as ressalvas que importam: prazo de entrega maior,
  condição de pagamento melhor em outro fornecedor, proposta vencida, fornecedor não
  homologado;
- **nota de custo-benefício de 0 a 100**, com pesos explícitos na tela (preço 50%, prazo
  20%, pagamento 15%, homologação 10%, validade 5%), que aparece como segunda opinião quando
  aponta para um fornecedor diferente do mais barato;
- registro da decisão com justificativa, guardado no histórico junto com o retrato de todas
  as opções consideradas na época;
- exportação em CSV e folha para impressão/PDF.

![Mapa comparativo](docs/img/06-comparativo.png)

### Pedidos de compra
Emitidos automaticamente quando uma cotação é aprovada. Registro de recebimento com data,
quantidade, nota fiscal, anexo e sinalização de problema de qualidade, que realimenta o
indicador de desempenho do fornecedor.

### Agendamento de Compras
Quadro Kanban (pendente → comprando → comprado) para o administrador atribuir compras a um
operador específico e acompanhar o andamento.

### Compras por período, Reposição, Contratos, Obras
Compras fechadas agrupadas por semana e por mês; sugestão de ponto de pedido a partir do
consumo histórico; contratos com reajuste por índice (IPCA, IGP-M, INCC) e alerta de
vencimento; e vínculo de cotações e contratos a obras/centros de custo.

### Alertas
Itens estratégicos com fornecedor único, variação de preço fora do normal, contratos perto
do reajuste, cotações aguardando decisão e fornecedores sem due diligence completa.

### Usuários e acesso
Três papéis: administrador, operador e chefe de setor, com cadastro sujeito a aprovação.
Chefe de setor só enxerga a aba Hora Extra.

### No celular
Abaixo de 900px de largura a barra lateral deixa de ser uma coluna fixa e vira uma faixa de
abas roláveis no topo, liberando a largura inteira da tela para o conteúdo. Consultar
alertas ou conferir um preço no meio do galpão funciona sem pinçar a tela.

<img src="docs/img/07-celular.png" alt="Painel no celular" width="330">


---

## Usando com os seus dados

A base é um único JSON. O jeito mais simples de começar do zero é copiar
`data/dados_exemplo.json`, esvaziar as listas e montar de novo:

```bash
python3 build.py data/meus_dados.json dist/meu-painel.html
```

O formato está documentado em [`docs/FORMATO-DE-DADOS.md`](docs/FORMATO-DE-DADOS.md). Na
prática, a origem costuma ser um relatório de pedidos de compra exportado do ERP, agregado
por fornecedor e por item, foi assim que a base original nasceu.

Depois que o painel está em uso, **ele guarda os próprios dados dentro do arquivo HTML**:
toda alteração reescreve o documento inteiro, com dados e código juntos. Não existe banco,
nem API, nem sincronização, é um arquivo que sabe se regravar.

---

## Como funciona por dentro

Três arquivos-fonte, costurados em um só na montagem:

```
src/template.html   casca HTML + todo o CSS (design tokens, tema claro com vermelho neon)
src/app.js          a aplicação inteira: estado, regras de negócio e renderização
data/*.json         os dados
        ↓  build.py
dist/central-de-compras.html    um arquivo, 500 KB, autossuficiente
```

**JavaScript puro**, sem framework, sem etapa de transpilação e sem `node_modules`. O padrão
é simples e cabe na cabeça:

- `STATE` guarda tudo que é persistido; `UI` guarda o que é só de tela (aba ativa, filtros,
  formulários abertos).
- `render()` reconstrói `#app.innerHTML` inteiro a partir de `STATE` + `UI`.
- Os eventos são tratados por **delegação no `document`**, um listener de `click`, um de
  `input`, um de `change` e um de `keydown` para o aplicativo todo. Nenhum listener preso a
  elemento, então o redesenho total nunca deixa handler órfão.
- `persist()` regrava o documento com os dados novos.

Isso torna o código fácil de acompanhar de cima a baixo, ao custo de redesenhar tudo a cada
ação, o que, para o volume de dados de um setor de compras, é imperceptível. Onde redesenhar
seria um problema (a tabela editável do mapa comparativo, em que perder o foco a cada campo
atrapalharia o preenchimento), as alterações são gravadas no estado e só os números
derivados são reescritos na tela.

O mapa de navegação linha a linha está em
[`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

---

## Testes

A suíte usa [Playwright](https://playwright.dev/python/) e abre o painel num Chromium de
verdade, clicando na interface como um usuário faria.

```bash
pip install playwright
playwright install chromium

python3 tests/run_all.py              # monta tudo e roda os 12 arquivos
python3 tests/run_all.py comparativo  # só os que casam com o nome
```

O runner gera as bases, monta os HTML e executa os testes, não é preciso preparar nada
antes. São cerca de 250 verificações cobrindo o fluxo de cotação de ponta a ponta, o mapa
comparativo, a aprovação por exceção, o cálculo de preços (incluindo um teste de regressão
para um bug de valor multiplicado por 100), a exportação em CSV, o modo escuro, a
regravação do documento e uma varredura em todas as abas procurando `undefined`/`NaN`
vazando para a tela.

---

## Limites e segurança

Vale ser direto sobre o modelo, porque ele é incomum:

- **Os dados moram no arquivo.** Quem tem o arquivo tem os dados. Não há criptografia.
  Trate o HTML gerado como você trataria a planilha de compras da empresa.
- **O login protege a interface, não o arquivo.** As senhas são guardadas como SHA-256 com
  salt por usuário, o que evita que apareçam em texto claro, mas a verificação acontece no
  navegador. Quem abrir o arquivo num editor de texto enxerga os dados.
- **Troque o código de administrador de fábrica** (`ADMIN-SETUP-2026`) assim que criar a
  primeira conta. Ele é público neste repositório.
- **Não é multiusuário concorrente.** Duas pessoas editando cópias diferentes do arquivo ao
  mesmo tempo vão divergir.

Para um setor de compras que hoje trabalha em planilhas soltas, isso costuma ser um avanço
grande com custo de operação zero. Para algo que exija auditoria formal, controle de acesso
real ou uso simultâneo pesado, o caminho é outro.

---

## Licença

[MIT](LICENSE) — Copyright (c) 2026 Henrique Paulo Fernandez.

Você pode usar, copiar, modificar e distribuir, inclusive comercialmente, mantendo o aviso
de copyright.
