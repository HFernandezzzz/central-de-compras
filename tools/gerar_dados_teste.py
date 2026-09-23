#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gera a base usada pelo teste de "Compras por período".

Pega a base de exemplo e substitui as cotações por um punhado de compras fechadas com
valores redondos e datas conhecidas, para o teste conferir as somas por semana e por mês
contra um resultado calculado à mão. Fornecedores e itens aqui são inventados.

    python3 tools/gerar_dados_teste.py
"""

import json
import os

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
ENTRADA = os.path.join(RAIZ, 'data', 'dados_exemplo.json')
SAIDA = os.path.join(RAIZ, 'dist', 'dados_teste_compras.json')


def item(desc, fornecedor, preco, qtd, fechado_em):
    return {
        'itemCodigo': None, 'itemDescricao': desc, 'quantidade': qtd,
        'linhas': [{'fornecedor': fornecedor, 'preco': preco, 'prazo': '10'}],
        'vencedor': fornecedor, 'status': 'aprovada', 'fechadoEm': fechado_em,
    }


COTACOES = [
    {'id': 'cot_t1', 'criadoEm': '2026-07-05T10:00:00.000Z', 'obraId': None, 'obs': '',
     'itensCotados': [item('Parafuso teste A', 'Fornecedor Alfa', 10, 100, '2026-07-06T10:00:00.000Z')]},
    {'id': 'cot_t2', 'criadoEm': '2026-07-20T10:00:00.000Z', 'obraId': None, 'obs': '',
     'itensCotados': [item('Rolamento teste B', 'Fornecedor Beta', 200, 5, '2026-07-21T10:00:00.000Z')]},
    {'id': 'cot_t3', 'criadoEm': '2026-08-03T10:00:00.000Z', 'obraId': None, 'obs': '',
     'itensCotados': [item('Parafuso teste A', 'Fornecedor Alfa', 9, 200, '2026-08-04T10:00:00.000Z')]},
    {'id': 'cot_t4', 'criadoEm': '2026-08-25T10:00:00.000Z', 'obraId': None, 'obs': '',
     'itensCotados': [item('Chapa teste C', 'Fornecedor Gama', 500, 2, '2026-08-26T10:00:00.000Z')]},
    {'id': 'cot_t5', 'criadoEm': '2026-08-31T10:00:00.000Z', 'obraId': None, 'obs': '',
     'itensCotados': [item('Rolamento teste B', 'Fornecedor Beta', 190, 10, '2026-09-01T10:00:00.000Z')]},
]

if __name__ == '__main__':
    with open(ENTRADA, encoding='utf-8') as f:
        dados = json.load(f)
    dados['cotacoes'] = COTACOES
    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    with open(SAIDA, 'w', encoding='utf-8') as f:
        json.dump(dados, f, ensure_ascii=False, separators=(',', ':'))

    por_mes = {}
    for c in COTACOES:
        for it in c['itensCotados']:
            mes = it['fechadoEm'][:7]
            por_mes[mes] = por_mes.get(mes, 0) + it['quantidade'] * it['linhas'][0]['preco']
    print('Gerado:', os.path.relpath(SAIDA, RAIZ))
    print('  totais por mês esperados:', por_mes)
    print('  total geral esperado    :', sum(por_mes.values()))
