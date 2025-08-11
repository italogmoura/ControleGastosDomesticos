# Controle de Faturas

Aplicativo web simples (client-side) para importar faturas de cartão em JSON estruturado, consolidar lançamentos, classificar como "Geral" (a dividir) ou "Exclusiva" (do usuário), aprender suas escolhas e calcular os totais 60%/40%.

- Entrada padronizada: arquivos `.json` nos formatos suportados (aninhado, vetorizado por índices e legado). Detalhes abaixo.
- Todo processamento acontece no navegador (Chrome recomendado).
- Exporta CSV e XLSX.
- Cache local: transações e preferências persistem (localStorage) até você clicar em "Limpar dados".

## Como usar

1. Abra o arquivo `index.html` no Chrome (duplo clique ou arraste para uma aba do navegador).
2. Arraste seus JSONs para a área de drop ou clique em "Selecionar JSON" e escolha um ou mais arquivos `.json`.
3. Revise a tabela de lançamentos e ajuste a coluna "Divisão" (Geral/Exclusiva). O app memoriza suas escolhas para sugerir nas próximas importações.
4. Use o Modo Classificação (overlay de revisão) para agilizar a classificação 1 a 1 com atalhos de teclado.
5. Se necessário, reclassifique itens de "Pagamentos e Estornos (separados)" para os "Lançamentos" com um clique no botão "Incluir em Lançamentos".
6. Inclua lançamentos manuais (ex.: débito/cartão diferente) pelo diálogo dedicado. Campos obrigatórios: data, descrição e valor. Se o valor for negativo, é tratado como Pagamento/Crédito.
7. Pesquise na lista de Lançamentos com busca precisa por tokens (sem acentos). Para termos curtos, a busca casa no início das palavras.
8. Veja o painel de resumo com totais. A divisão de despesas é configurável (padrão 60%/40%). Há um badge com o somatório de "Despesa Exclusiva Ítalo" ao lado do texto correspondente.
9. Exporte como CSV ou XLSX quando quiser.
10. Alterne entre modo claro/escuro no cabeçalho; a preferência fica salva.

## Formato de entrada (JSON)

O app suporta três variações de entrada:

1) Esquema aninhado (recomendado):

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

2) Esquema vetorizado por índices (alternativo):

Indicado para arquivos grandes. As transações vêm em colunas (arrays) e referências por índice para cartões/categorias.

```json
{
  "faturas": [
    {
      "cartoes": [
        { "finalCartao": "9348", "titular": "ITALO GONCALVES MOURA", "bandeira": "Mastercard", "tipoCartao": "Black" }
      ],
      "categorias": ["Alimentação", "Saúde", "Outros"],
      "transacoes": {
        "data": ["2025-07-14", "2025-08-01"],
        "descricao": ["Raia DrogasilSA", "PACCO BACCO WINER BAR"],
        "valorBRL": [221.69, 675.00],
        "categoriaIdx": [1, 0],
        "cartaoIdx": [0, 0],
        "iof": [0.0, 0.0],
        "local": ["TRES RIOS", "TIRADENTES"],
        "parcelamento": [null, null]
      }
    }
  ]
}
```

3) Formato legado (fallback):

- Fatura com `identificacao` + `transacoes` no topo. Continua aceito para compatibilidade.

Notas gerais:
- Valores negativos continuam indicando "Pagamento/Crédito".
- O app exibe coluna de IOF quando disponível e inclui o valor nos exports.
- Preferências, decisões, reclassificações e cache de dados ficam salvos localmente (localStorage). Para limpar, use o botão "Limpar dados".

## Desenvolvimento

- Sem dependências locais; bibliotecas via CDN: SheetJS (xlsx), Apache ECharts.
- Estrutura:
  - `index.html` – UI e carregamento das libs.
  - `styles.css` – temas claro/escuro e estilos do app.
  - `app.js` – lógica: upload de JSON, mapeamento (aninhado, vetorizado e legado), filtros, ordenação, aprendizado, reclassificação de pagamentos, Modo Classificação, busca por tokens, insights (Top Categorias, Treemap, Heatmap), cache local e export.

## Próximos passos sugeridos

- Validações de esquema e feedback de erro por campo.
- IndexedDB (Dexie) para volumes grandes e histórico mensal.
- Enriquecimento opcional de categorias (lookup) e dashboards.
- Percentuais de divisão configuráveis. (Implementado)
- Destacar termos que batem na busca.
- Opção de desfazer reclassificação no próprio lançamento.
- PWA para trabalhar offline.
