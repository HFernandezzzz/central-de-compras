#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gera a base de demonstração da Central de Compras.

Todos os fornecedores, itens, pedidos, contratos e obras deste arquivo são INVENTADOS.
Nenhum dado real de nenhuma empresa é usado aqui — nem nomes, nem CNPJs, nem preços, nem
histórico de compras. A base existe só para o painel abrir com conteúdo suficiente para
alguém entender o que ele faz (gráficos, curva ABC, matriz de criticidade, alertas).

Use uma semente fixa para o resultado ser sempre o mesmo, de modo que o arquivo gerado
não fique mudando a cada execução e poluindo o histórico do Git.

    python3 tools/gerar_dados_exemplo.py

Escreve em data/dados_exemplo.json.
"""

import json
import os
import random
import zlib
from datetime import date, timedelta

SEMENTE = 20260921
AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
SAIDA = os.path.join(RAIZ, 'data', 'dados_exemplo.json')

# O painel classifica gasto por categoria usando estes códigos (ver TIPO_LABELS em app.js).
CATEGORIAS = ['MP', 'MC', 'SV', 'PA', 'II', 'KT', 'GN']

# ---------------------------------------------------------------------------
# Fornecedores fictícios. Os nomes são compostos de propósito para não coincidirem
# com empresas reais: um termo inventado + um ramo genérico + uma forma societária.
# ---------------------------------------------------------------------------
PREFIXOS = [
    'Alvorada', 'Bandeirante', 'Carvalho', 'Dinâmica', 'Estrela', 'Ferrovale', 'Guarani',
    'Horizonte', 'Ipê', 'Jacarandá', 'Kiwa', 'Lumiar', 'Marajá', 'Nortec', 'Oliveira',
    'Piratini', 'Quaresma', 'Rio Claro', 'Serrana', 'Taquari', 'Umbu', 'Vertente',
    'Xaxim', 'Zambeze', 'Aurora', 'Bonsucesso', 'Cristalina', 'Douradense', 'Embiara',
    'Farroupilha', 'Girassol', 'Hidrolar', 'Itaúna', 'Juritis', 'Lagoa Nova', 'Morro Azul',
]
RAMOS = [
    'Aços e Metais', 'Ferramentas Industriais', 'Componentes Elétricos', 'Rolamentos',
    'Equipamentos de Proteção', 'Tintas e Revestimentos', 'Fixadores', 'Usinagem',
    'Mangueiras e Conexões', 'Automação', 'Lubrificantes', 'Embalagens',
    'Transportes', 'Manutenção Predial', 'Materiais de Escritório', 'Solda e Gases',
]
FORMAS = ['Ltda', 'S.A.', 'Indústria e Comércio Ltda', 'Comercial Ltda', 'ME']

# ---------------------------------------------------------------------------
# Itens fictícios, genéricos de qualquer indústria metalmecânica.
# ---------------------------------------------------------------------------
ITENS = [
    ('Chapa de aço carbono 3,00mm', 'MP', 'KG'),
    ('Chapa de aço carbono 6,35mm', 'MP', 'KG'),
    ('Barra redonda trefilada 1"', 'MP', 'KG'),
    ('Perfil U 100x50x6000', 'MP', 'UN'),
    ('Tubo quadrado 40x40x2,00', 'MP', 'UN'),
    ('Cantoneira 2" x 1/4"', 'MP', 'KG'),
    ('Eletrodo revestido 2,50mm', 'MC', 'KG'),
    ('Arame MIG ER70S-6 1,20mm', 'MC', 'KG'),
    ('Disco de corte 7"', 'MC', 'UN'),
    ('Disco de desbaste 4.1/2"', 'MC', 'UN'),
    ('Lixa flap 4.1/2" grão 80', 'MC', 'UN'),
    ('Gás de proteção mistura', 'MC', 'M3'),
    ('Oxigênio industrial', 'MC', 'M3'),
    ('Tinta esmalte sintético cinza', 'MC', 'L'),
    ('Primer anticorrosivo', 'MC', 'L'),
    ('Solvente para limpeza', 'MC', 'L'),
    ('Rolamento rígido de esferas 6205', 'II', 'UN'),
    ('Rolamento autocompensador 22210', 'II', 'UN'),
    ('Correia sincronizadora 8M', 'II', 'UN'),
    ('Retentor 35x52x7', 'II', 'UN'),
    ('Mancal de parede P205', 'II', 'UN'),
    ('Graxa de lítio EP2', 'II', 'KG'),
    ('Óleo hidráulico ISO 68', 'II', 'L'),
    ('Parafuso sextavado M10x40 zincado', 'PA', 'UN'),
    ('Porca sextavada M10 zincada', 'PA', 'UN'),
    ('Arruela lisa M10', 'PA', 'UN'),
    ('Chumbador parabolt 1/2"', 'PA', 'UN'),
    ('Rebite pop 4,8x12', 'PA', 'UN'),
    ('Contator tripolar 25A', 'PA', 'UN'),
    ('Disjuntor motor 6,3-10A', 'PA', 'UN'),
    ('Inversor de frequência 3CV', 'PA', 'UN'),
    ('Sensor indutivo M12 PNP', 'PA', 'UN'),
    ('Botoeira de emergência', 'PA', 'UN'),
    ('Cabo flexível 2,5mm² preto', 'PA', 'M'),
    ('Eletroduto galvanizado 3/4"', 'PA', 'UN'),
    ('Luva de vaqueta punho curto', 'KT', 'PAR'),
    ('Óculos de proteção incolor', 'KT', 'UN'),
    ('Protetor auricular plug', 'KT', 'PAR'),
    ('Máscara de solda automática', 'KT', 'UN'),
    ('Botina de segurança bico composite', 'KT', 'PAR'),
    ('Avental de raspa', 'KT', 'UN'),
    ('Capacete de segurança classe B', 'KT', 'UN'),
    ('Serviço de jateamento e pintura', 'SV', 'SERV'),
    ('Serviço de calandragem', 'SV', 'SERV'),
    ('Serviço de tratamento térmico', 'SV', 'SERV'),
    ('Locação de empilhadeira mensal', 'SV', 'SERV'),
    ('Manutenção de ponte rolante', 'SV', 'SERV'),
    ('Transporte rodoviário de carga', 'SV', 'SERV'),
    ('Papel sulfite A4 75g', 'GN', 'RESMA'),
    ('Água mineral 20L', 'GN', 'UN'),
    ('Material de limpeza sortido', 'GN', 'UN'),
    ('Café em grãos 1kg', 'GN', 'KG'),
]


def dinheiro(v):
    return round(v, 2)


def gerar():
    rnd = random.Random(SEMENTE)

    # ---- fornecedores ----
    nomes = set()
    fornecedores = []
    while len(fornecedores) < 42:
        nome = '%s %s %s' % (rnd.choice(PREFIXOS), rnd.choice(RAMOS), rnd.choice(FORMAS))
        if nome in nomes:
            continue
        nomes.add(nome)
        fornecedores.append({
            'codigo': '%06d' % (100 + len(fornecedores) * 7),
            'codigosMesclados': [],
            'nome': nome.upper(),
            'nPedidos': 0, 'nProdutos': 0, 'spend': 0.0, 'pct': 0.0, 'cumPct': 0.0,
            'abc': None, 'primeiro': None, 'ultimo': None, 'tipoPrincipal': None,
        })

    # Dois cadastros duplicados consolidados, para a tela explicar esse recurso.
    fornecedores[0]['codigosMesclados'] = [fornecedores[0]['codigo'], '000901', '000902']
    fornecedores[3]['codigosMesclados'] = [fornecedores[3]['codigo'], '000903']

    # ---- pedidos sintéticos ao longo de 6 meses ----
    fim = date(2026, 8, 31)
    inicio = fim - timedelta(days=181)
    linhas = []          # cada linha = um item comprado de um fornecedor numa data
    pedidos_ids = set()

    # Cada item tem de 1 a 4 fornecedores possíveis; itens estratégicos ficam com 1 só.
    forn_por_item = {}
    for idx, (desc, tipo, un) in enumerate(ITENS):
        n = 1 if idx % 5 == 0 else rnd.randint(2, 4)
        forn_por_item[desc] = rnd.sample(fornecedores, n)

    # preço-base por item, com variação por fornecedor e ao longo do tempo
    preco_base = {}
    for desc, tipo, un in ITENS:
        if tipo == 'SV':
            preco_base[desc] = rnd.uniform(1800, 26000)
        elif tipo == 'MP':
            preco_base[desc] = rnd.uniform(7, 62)
        elif tipo == 'II':
            preco_base[desc] = rnd.uniform(38, 720)
        elif tipo == 'PA':
            preco_base[desc] = rnd.uniform(1.2, 2600)
        elif tipo == 'KT':
            preco_base[desc] = rnd.uniform(9, 320)
        else:
            preco_base[desc] = rnd.uniform(6, 180)

    num_pedido = 0
    dia = inicio
    while dia <= fim:
        if dia.weekday() < 5:                      # compras só em dias úteis
            for _ in range(rnd.randint(0, 5)):
                desc, tipo, un = rnd.choice(ITENS)
                forn = rnd.choice(forn_por_item[desc])
                num_pedido += 1
                pedidos_ids.add(num_pedido)
                base = preco_base[desc]
                # Variação por fornecedor (+-18%) e sazonal ao longo do período.
                # crc32 e não hash(): o hash de strings do Python muda a cada processo, o que
                # faria este arquivo sair diferente a cada execução e sujar o histórico do Git.
                semente_forn = zlib.crc32((forn['codigo'] + '|' + desc).encode('utf-8'))
                fator_forn = 1 + (semente_forn % 37 - 18) / 100.0
                fator_tempo = 1 + (dia - inicio).days / 900.0
                preco = base * fator_forn * fator_tempo * rnd.uniform(0.96, 1.05)
                if un in ('KG', 'M', 'L', 'M3'):
                    qtd = float(rnd.randint(20, 1400))
                elif un == 'SERV':
                    qtd = 1.0
                else:
                    qtd = float(rnd.randint(1, 120))
                linhas.append({
                    'data': dia.isoformat(), 'fornecedor': forn, 'descricao': desc,
                    'tipo': tipo, 'unidade': un, 'qtd': qtd, 'preco': preco,
                    'total': qtd * preco, 'pedido': num_pedido,
                })
        dia += timedelta(days=1)

    total_geral = sum(l['total'] for l in linhas)

    # ---- agregação por fornecedor ----
    por_forn = {}
    for l in linhas:
        c = l['fornecedor']['codigo']
        d = por_forn.setdefault(c, {'spend': 0.0, 'pedidos': set(), 'itens': set(),
                                    'datas': [], 'tipos': {}})
        d['spend'] += l['total']
        d['pedidos'].add(l['pedido'])
        d['itens'].add(l['descricao'])
        d['datas'].append(l['data'])
        d['tipos'][l['tipo']] = d['tipos'].get(l['tipo'], 0) + l['total']

    for f in fornecedores:
        d = por_forn.get(f['codigo'])
        if not d:
            continue
        f['spend'] = dinheiro(d['spend'])
        f['nPedidos'] = len(d['pedidos'])
        f['nProdutos'] = len(d['itens'])
        f['primeiro'] = min(d['datas'])
        f['ultimo'] = max(d['datas'])
        f['tipoPrincipal'] = max(d['tipos'], key=d['tipos'].get)

    fornecedores.sort(key=lambda f: -f['spend'])
    acumulado = 0.0
    n80 = 0
    for f in fornecedores:
        f['pct'] = dinheiro(f['spend'] / total_geral * 100) if total_geral else 0.0
        acumulado += f['pct']
        f['cumPct'] = dinheiro(acumulado)
        f['abc'] = 'A' if acumulado <= 80 else ('B' if acumulado <= 95 else 'C')
        if f['abc'] == 'A':
            n80 += 1

    # ---- agregação por item ----
    por_item = {}
    for l in linhas:
        d = por_item.setdefault(l['descricao'], {
            'tipo': l['tipo'], 'unidade': l['unidade'], 'spend': 0.0, 'qtd': 0.0,
            'pedidos': set(), 'precos': [], 'forn': {},
        })
        d['spend'] += l['total']
        d['qtd'] += l['qtd']
        d['pedidos'].add(l['pedido'])
        d['precos'].append(l['preco'])
        fd = d['forn'].setdefault(l['fornecedor']['nome'], {'precos': [], 'pedidos': set()})
        fd['precos'].append(l['preco'])
        fd['pedidos'].add(l['pedido'])

    produtos = []
    for i, (desc, d) in enumerate(sorted(por_item.items(), key=lambda kv: -kv[1]['spend'])):
        pmin, pmax = min(d['precos']), max(d['precos'])
        pmed = sum(d['precos']) / len(d['precos'])
        produtos.append({
            'codigo': '%06d' % (1000 + i * 3),
            'descricao': desc.upper(),
            'tipo': d['tipo'],
            'unidade': d['unidade'],
            'nPedidos': len(d['pedidos']),
            'nFornecedores': len(d['forn']),
            'qtdTotal': dinheiro(d['qtd']),
            'spend': dinheiro(d['spend']),
            'precoMin': dinheiro(pmin),
            'precoMax': dinheiro(pmax),
            'precoMedio': dinheiro(pmed),
            'variacaoPct': dinheiro((pmax - pmin) / pmin * 100) if pmin else 0.0,
            'abc': None,
            'quadrante': None,
            'fornecedores': [
                {'nome': n, 'precoMedio': dinheiro(sum(v['precos']) / len(v['precos'])),
                 'nPedidos': len(v['pedidos'])}
                for n, v in sorted(d['forn'].items(), key=lambda kv: -sum(kv[1]['precos']))
            ],
        })

    # curva ABC e matriz de criticidade dos itens
    acumulado = 0.0
    mediana_spend = sorted(p['spend'] for p in produtos)[len(produtos) // 2]
    n_single = 0
    for p in produtos:
        acumulado += p['spend'] / total_geral * 100 if total_geral else 0
        p['abc'] = 'A' if acumulado <= 80 else ('B' if acumulado <= 95 else 'C')
        alto_gasto = p['spend'] >= mediana_spend
        poucos_forn = p['nFornecedores'] <= 1
        if alto_gasto and poucos_forn:
            p['quadrante'] = 'estrategico'
        elif alto_gasto:
            p['quadrante'] = 'alavancagem'
        elif poucos_forn:
            p['quadrante'] = 'gargalo'
        else:
            p['quadrante'] = 'rotina'
        if poucos_forn:
            n_single += 1

    # ---- séries para os gráficos ----
    por_mes = {}
    for l in linhas:
        m = l['data'][:7]
        d = por_mes.setdefault(m, {'spend': 0.0, 'pedidos': set()})
        d['spend'] += l['total']
        d['pedidos'].add(l['pedido'])
    tendencia = [{'mes': m, 'spend': dinheiro(v['spend']), 'nPedidos': len(v['pedidos'])}
                 for m, v in sorted(por_mes.items())]

    por_tipo = {}
    for l in linhas:
        d = por_tipo.setdefault(l['tipo'], {'spend': 0.0, 'pedidos': set()})
        d['spend'] += l['total']
        d['pedidos'].add(l['pedido'])
    gasto_tipo = sorted(
        [{'tipo': t, 'spend': dinheiro(v['spend']), 'nPedidos': len(v['pedidos'])}
         for t, v in por_tipo.items()],
        key=lambda x: -x['spend'])

    # ---- candidatos a reposição automática ----
    meses = max(1, len(tendencia))
    reposicao = []
    for p in produtos:
        if p['nPedidos'] < 6 or p['tipo'] == 'SV':
            continue
        reposicao.append({
            'codigo': p['codigo'], 'descricao': p['descricao'], 'unidade': p['unidade'],
            'tipo': p['tipo'], 'quadrante': p['quadrante'], 'nPedidos': p['nPedidos'],
            'qtdTotalPeriodo': p['qtdTotal'],
            'consumoMedioMensal': dinheiro(p['qtdTotal'] / meses),
            'precoMedio': p['precoMedio'], 'spend': p['spend'],
            'precoConfiavel': p['variacaoPct'] < 40,
        })
    reposicao.sort(key=lambda r: -r['spend'])

    mesclados = [
        {'nome': f['nome'], 'codigos': f['codigosMesclados'], 'spend': f['spend']}
        for f in fornecedores if len(f['codigosMesclados']) > 1
    ]

    # ---- obras e contratos de exemplo ----
    obras = [
        {'id': 'obra_exemplo_1', 'nome': 'Ampliação do galpão 2', 'cliente': 'Projeto interno',
         'status': 'ativa', 'criadoEm': (inicio + timedelta(days=20)).isoformat() + 'T12:00:00.000Z'},
        {'id': 'obra_exemplo_2', 'nome': 'Reforma da linha de pintura', 'cliente': 'Projeto interno',
         'status': 'ativa', 'criadoEm': (inicio + timedelta(days=95)).isoformat() + 'T12:00:00.000Z'},
    ]
    contratos = [
        {'id': 'ctr_exemplo_1', 'fornecedorNome': fornecedores[0]['nome'],
         'escopo': 'Fornecimento programado de chapas de aço',
         'precoBase': 148000.0, 'indice': 'IPCA', 'periodicidade': 'anual',
         'dataInicio': (inicio + timedelta(days=5)).isoformat(),
         'proximoReajuste': (fim + timedelta(days=18)).isoformat(),
         'status': 'ativo', 'obs': 'Reajuste anual pelo IPCA acumulado.', 'obraId': '',
         'criadoEm': (inicio + timedelta(days=5)).isoformat() + 'T12:00:00.000Z'},
        {'id': 'ctr_exemplo_2', 'fornecedorNome': fornecedores[2]['nome'],
         'escopo': 'Locação mensal de empilhadeira',
         'precoBase': 6400.0, 'indice': 'IGPM', 'periodicidade': 'anual',
         'dataInicio': (inicio + timedelta(days=40)).isoformat(),
         'proximoReajuste': (fim + timedelta(days=210)).isoformat(),
         'status': 'ativo', 'obs': '', 'obraId': 'obra_exemplo_1',
         'criadoEm': (inicio + timedelta(days=40)).isoformat() + 'T12:00:00.000Z'},
    ]

    dados = {
        'kpis': {
            'totalSpend': dinheiro(total_geral),
            'nFornecedores': len(fornecedores),
            'nProdutos': len(produtos),
            'nPedidos': len(pedidos_ids),
            'periodoInicio': inicio.isoformat(),
            'periodoFim': fim.isoformat(),
            'nFornecedores80pct': n80,
            'nItensSingleSource': n_single,
            'pctItensSingleSource': dinheiro(n_single / len(produtos) * 100),
        },
        'fornecedores': fornecedores,
        'produtos': produtos,
        'tendenciaMensal': tendencia,
        'gastoPorTipo': gasto_tipo,
        'fornecedoresMesclados': mesclados,
        'reposicaoCandidatos': reposicao,
        'periodoDias': (fim - inicio).days,
        'avaliacoes': {},
        'cotacoes': [],
        'contratos': contratos,
        'configAprovacao': {'alcadaValor': 5000, 'minCotacoesValor': 10000, 'minCotacoesQtd': 3},
        'configReposicao': {'coberturaDias': 30},
        'pontosPedido': {},
        'obras': obras,
        'estoqueAtual': {},
        'atividades': [{
            'ts': fim.isoformat() + 'T12:00:00.000Z',
            'acao': 'Base de demonstração carregada',
            'detalhe': 'Fornecedores, itens e pedidos fictícios, gerados por '
                       'tools/gerar_dados_exemplo.py. Nenhum dado real de nenhuma empresa.',
            'autor': 'Sistema',
        }],
        'branding': {'logoDataUrl': ''},
        'itensPersonalizados': [],
        'pedidos': [],
        'pedidosSeq': 0,
        'fornecedoresSeq': 0,
        'segundaFonte': {},
        'empresa': {'nome': '', 'endereco': '', 'cidade': '', 'uf': '',
                    'latitude': None, 'longitude': None},
        'usuarios': [],
        'configAuth': {},
        'notificacoes': [],
        'agendamentos': [],
        'horaExtra': [],
        'comparativo': {'fornecedores': [], 'produtos': {}, 'selecionados': [],
                        'historico': [], 'seq': 0},
    }
    # `selecionados` é um objeto no aplicativo; em JSON vazio, use {} para não virar lista.
    dados['comparativo']['selecionados'] = {}
    return dados


if __name__ == '__main__':
    dados = gerar()
    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    with open(SAIDA, 'w', encoding='utf-8') as f:
        json.dump(dados, f, ensure_ascii=False, separators=(',', ':'))
    k = dados['kpis']
    print('Base de exemplo gerada em', os.path.relpath(SAIDA, RAIZ))
    print('  fornecedores :', k['nFornecedores'])
    print('  itens        :', k['nProdutos'])
    print('  pedidos      :', k['nPedidos'])
    print('  gasto total  : R$ %s' % format(k['totalSpend'], ',.2f').replace(',', '_').replace('.', ',').replace('_', '.'))
    print('  período      :', k['periodoInicio'], 'a', k['periodoFim'])
