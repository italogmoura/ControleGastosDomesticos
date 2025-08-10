# Controle de Faturas 60/40 (MVP)

Aplicativo web simples (client-side) para importar faturas de cartão em JSON estruturado, consolidar lançamentos, classificar como "Geral" (a dividir) ou "Exclusiva" (do usuário), aprender suas escolhas e calcular os totais 60%/40%.

- Entrada padronizada: arquivos `.json` com a chave `faturas` seguindo o novo esquema aninhado (faturas > cartões > transações) descrito abaixo. O formato anterior ainda é aceito como fallback.
- Todo processamento acontece no navegador (Chrome recomendado).
- Exporta CSV e XLSX.

## Como usar

1. Abra o arquivo `index.html` no Chrome (duplo clique ou arraste para uma aba do navegador).
2. Arraste seus JSONs para a área de drop ou clique em "Selecionar JSON" e escolha um ou mais arquivos `.json`.
3. Revise a tabela de lançamentos e ajuste a coluna "Divisão" (Geral/Exclusiva). O app memoriza suas escolhas para sugerir nas próximas importações.
4. Veja o painel de resumo com totais. A divisão de despesas é configurável (padrão 60%/40%).
5. Exporte como CSV ou XLSX quando quiser.

## Formato de entrada (JSON)

O app espera um JSON com a estrutura aninhada abaixo:

```json
{
  "faturas": [
    {
      "identificacaoFatura": {
        "banco": "Nome do Banco",
        "mesReferencia": "MM/YYYY",
        "valorTotal": 8690.40,
        "dataVencimento": "AAAA-MM-DD",
        "dataFechamento": "AAAA-MM-DD",
        "periodoReferencia": "AAAA-MM-DD a AAAA-MM-DD"
      },
      "cartoes": [
        {
          "identificacaoCartao": {
            "titular": "Nome do Titular",
            "bandeira": "Bandeira do Cartão",
            "tipoCartao": "Tipo do Cartão",
            "finalCartao": "1234"
          },
          "transacoes": [
            {
              "data": "AAAA-MM-DD",
              "descricao": "Descrição Original da Fatura",
              "estabelecimento": "Nome Limpo do Estabelecimento",
              "categoria": "Categoria Pré-definida",
              "tipoLancamento": "Nacional",
              "valorBRL": 150.00,
              "valorUSD": null,
              "cotacaoDolar": null,
              "iof": 0.00,
              "taxas": 0.00,
              "parcelamento": "1/2",
              "local": "Cidade/País",
              "observacoes": "Informações adicionais relevantes"
            }
          ]
        }
      ]
    }
  ]
}
```

Exemplo real:

```json
{
  "faturas": [
    {
      "identificacaoFatura": {
        "banco": "Itaú",
        "mesReferencia": "08/2025",
        "valorTotal": 5718.95,
        "dataVencimento": "2025-08-10",
        "dataFechamento": "2025-08-03",
        "periodoReferencia": "2025-07-04 a 2025-08-03"
      },
      "cartoes": [
        {
          "identificacaoCartao": {
            "titular": "ITALO GONCALVES MOURA",
            "bandeira": "Mastercard",
            "tipoCartao": "Black",
            "finalCartao": "9348"
          },
          "transacoes": [
            {
              "data": "2025-07-14",
              "descricao": "Raia DrogasilSA",
              "estabelecimento": "Raia Drogasil",
              "categoria": "Saúde",
              "tipoLancamento": "Nacional",
              "valorBRL": 221.69,
              "valorUSD": null,
              "cotacaoDolar": null,
              "iof": 0.00,
              "taxas": 0.00,
              "parcelamento": null,
              "local": "TRES RIOS",
              "observacoes": ""
            },
            {
              "data": "2025-08-01",
              "descricao": "PACCO BACCO WINER BAR",
              "estabelecimento": "PACCO BACCO WINER BAR",
              "categoria": "Alimentação",
              "tipoLancamento": "Nacional",
              "valorBRL": 675.00,
              "valorUSD": null,
              "cotacaoDolar": null,
              "iof": 0.00,
              "taxas": 0.00,
              "parcelamento": null,
              "local": "TIRADENTES",
              "observacoes": ""
            }
          ]
        }
      ]
    }
  ]
}
```

Observações:
- O formato antigo (fatura com `identificacao` + `transacoes` no topo) ainda é aceito como fallback.
- Valores negativos continuam indicando "Pagamento/Crédito".
- O app exibe coluna de IOF quando disponível e inclui o valor nos exports.
- Preferências e regras ficam salvas localmente (localStorage). Para limpar, use o botão "Limpar dados".

## Desenvolvimento

- Sem dependências locais; bibliotecas via CDN: SheetJS (xlsx).
- Estrutura:
  - `index.html` – UI e carregamento das libs.
  - `styles.css` – estilo básico.
  - `app.js` – lógica: upload de JSON, mapeamento (novo esquema aninhado), filtros, ordenação, aprendizado, insights (Chart.js) e export.

## Próximos passos sugeridos

- Validações de esquema e feedback de erro por campo.
- IndexedDB (Dexie) para volumes grandes e histórico mensal.
- Enriquecimento opcional de categorias (lookup) e dashboards.
- Percentuais de divisão configuráveis. (Implementado)
- PWA para trabalhar offline.
