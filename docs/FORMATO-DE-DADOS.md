# Formato dos dados

A base é um único JSON. `build.py` o injeta no HTML e `app.js` o lê na carga, em `STATE`.
Todas as chaves abaixo são opcionais fora `kpis` e `fornecedores` — o que faltar entra com um
padrão vazio. Para começar do zero, basta um arquivo assim:

```json
{
  "kpis": {"totalSpend": 0, "nFornecedores": 0, "nProdutos": 0, "nPedidos": 0,
           "periodoInicio": null, "periodoFim": null, "nFornecedores80pct": 0,
           "nItensSingleSource": 0, "pctItensSingleSource": 0},
  "fornecedores": [], "produtos": [], "tendenciaMensal": [], "gastoPorTipo": []
}
```

O caminho normal, porém, é gerar o arquivo a partir de um relatório de pedidos de compra
exportado do ERP. `tools/gerar_dados_exemplo.py` faz exatamente isso com dados inventados, e
serve de referência de como agregar: leia as linhas de pedido, some por fornecedor e por
item, ordene por gasto e calcule a curva ABC e os quadrantes.

---

## Dados vindos do ERP

Estes campos são calculados na importação e o aplicativo só lê.

### `kpis`

| Campo | Tipo | O quê |
|---|---|---|
| `totalSpend` | número | gasto total do período |
| `nFornecedores` | inteiro | fornecedores com pelo menos uma compra |
| `nProdutos` | inteiro | itens distintos comprados |
| `nPedidos` | inteiro | pedidos de compra no período |
| `periodoInicio` / `periodoFim` | `"AAAA-MM-DD"` | intervalo coberto |
| `nFornecedores80pct` | inteiro | quantos concentram 80% do gasto |
| `nItensSingleSource` | inteiro | itens com um único fornecedor |
| `pctItensSingleSource` | número | o mesmo em percentual |

### `fornecedores[]`

```json
{"codigo": "000332", "codigosMesclados": ["000332", "000402"],
 "nome": "ALVORADA AÇOS E METAIS S.A.", "nPedidos": 21, "nProdutos": 10,
 "spend": 1145721.16, "pct": 10.97, "cumPct": 10.97, "abc": "A",
 "primeiro": "2026-03-23", "ultimo": "2026-07-08", "tipoPrincipal": "MP"}
```

`codigosMesclados` é o que permite consolidar um fornecedor que tinha vários códigos no ERP:
liste todos e o painel trata como um cadastro só. Deixe `[]` se não houver duplicidade.
`abc` sai da curva de Pareto sobre `cumPct` (A até 80%, B até 95%, C o resto).

### `produtos[]`

```json
{"codigo": "001782", "descricao": "CHAPA DE AÇO CARBONO 3,00MM", "tipo": "MP",
 "unidade": "KG", "nPedidos": 12, "nFornecedores": 3, "qtdTotal": 8400.0,
 "spend": 82320.0, "precoMin": 9.1, "precoMax": 10.4, "precoMedio": 9.8,
 "variacaoPct": 14.3, "abc": "A", "quadrante": "alavancagem",
 "fornecedores": [{"nome": "...", "precoMedio": 9.8, "nPedidos": 7}]}
```

`quadrante` é a matriz de Kraljic, cruzando gasto alto/baixo com fornecedor único/vários:

| | poucos fornecedores | vários fornecedores |
|---|---|---|
| **gasto alto** | `estrategico` | `alavancagem` |
| **gasto baixo** | `gargalo` | `rotina` |

`tipo` é a categoria do ERP. Os códigos reconhecidos estão em `TIPO_LABELS`, em `app.js`:
`MP` matéria-prima, `MC` material de consumo, `SV` serviço, `PA` peças/componentes,
`II` manutenção/rolamentos, `KT` EPI/kits, `GN` insumos gerais, `OI`, `ME`, `GG`.

### Séries dos gráficos

```json
"tendenciaMensal": [{"mes": "2026-03", "spend": 1464135.35, "nPedidos": 157}],
"gastoPorTipo":    [{"tipo": "MP", "spend": 5765623.82, "nPedidos": 575}],
"fornecedoresMesclados": [{"nome": "...", "codigos": ["000332","000402"], "spend": 1145721.16}],
"reposicaoCandidatos": [{"codigo": "000031", "descricao": "...", "unidade": "UN",
                         "tipo": "MC", "quadrante": "alavancagem", "nPedidos": 37,
                         "qtdTotalPeriodo": 273.0, "consumoMedioMensal": 58.52,
                         "precoMedio": 566.37, "spend": 79645.77, "precoConfiavel": false}]
```

`precoConfiavel: false` faz o painel avisar que a sugestão de ponto de pedido está apoiada em
preços que variaram demais no período.

---

## Dados criados pelo uso

Estas chaves começam vazias e são preenchidas pelo próprio aplicativo. Você não precisa
montá-las na importação — basta existirem (ou nem isso, já que entram com padrão).

| Chave | O quê guarda |
|---|---|
| `avaliacoes` | ficha cadastral e avaliação de cada fornecedor, indexada pelo código |
| `cotacoes` | cotações com seus orçamentos, fotos e decisões |
| `pedidos` / `pedidosSeq` | pedidos de compra emitidos e o contador de numeração |
| `contratos` | contratos com reajuste por índice |
| `obras` | obras / centros de custo |
| `comparativo` | propostas, itens cotados, seleção atual e histórico do mapa comparativo |
| `agendamentos` | cards do quadro Kanban |
| `horaExtra` | pedidos de lanche/marmita por setor |
| `usuarios` / `configAuth` | contas de acesso e o hash do código de administrador |
| `notificacoes` | avisos do sino |
| `estoqueAtual` / `pontosPedido` | saldo informado e preferências de reposição |
| `itensPersonalizados` | itens digitados à mão, fora do catálogo do ERP |
| `segundaFonte` | acompanhamento de busca por fornecedor alternativo |
| `configAprovacao` | alçada de valor e mínimo de cotações exigido pela política |
| `configReposicao` | dias de cobertura usados no cálculo do ponto de pedido |
| `branding` | logo da empresa, em data URL |
| `empresa` | nome e endereço da empresa que usa o painel |
| `atividades` | log de quem fez o quê |

> **Atenção ao publicar:** um JSON em uso carrega nome de fornecedor, CNPJ, preço praticado,
> conta de usuário e hash de senha. O `.gitignore` deste repositório já bloqueia `data/*.json`
> fora o arquivo de exemplo, justamente por isso.
