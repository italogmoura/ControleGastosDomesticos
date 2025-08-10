# Controle de Faturas 60/40 (MVP)

Aplicativo web simples (client-side) para importar faturas de cartão em JSON estruturado, consolidar lançamentos, classificar como "Geral" (a dividir) ou "Exclusiva" (do usuário), aprender suas escolhas e calcular os totais 60%/40%.

- Entrada padronizada: arquivos `.json` com a chave `faturas` seguindo o esquema descrito abaixo.
- Todo processamento acontece no navegador (Chrome recomendado).
- Exporta CSV e XLSX.

## Como usar

1. Abra o arquivo `index.html` no Chrome (duplo clique ou arraste para uma aba do navegador).
2. Arraste seus JSONs para a área de drop ou clique em "Selecionar JSON" e escolha um ou mais arquivos `.json`.
3. Revise a tabela de lançamentos e ajuste a coluna "Divisão" (Geral/Exclusiva). O app memoriza suas escolhas para sugerir nas próximas importações.
4. Veja o painel de resumo com totais e a divisão 60%/40%.
5. Exporte como CSV ou XLSX quando quiser.

## Observações

- A partir desta versão, não há parsing de PDF: a ingestão é via JSON padronizado com o seguinte formato de exemplo:

```
{
  "faturas": [
    {
      "identificacao": { "banco": "Bradesco", "cartao": "Visa Signature", "mesReferencia": "05/2024" },
      "transacoes": [
        { "data": "2024-04-22", "descricao": "IFD*RAIA DROGASIL", "categoria": "Saúde", "valorBRL": 147.70, "valorUSD": null, "cotacaoDolar": null, "taxas": 0.00, "parcelamento": null, "local": "Três Rios", "observacoes": "Compra via iFood" }
      ]
    }
  ]
}
```

- Preferências e regras ficam salvas localmente (localStorage). Para limpar, use o botão "Limpar dados".

## Desenvolvimento

- Sem dependências locais; bibliotecas via CDN: SheetJS (xlsx).
- Estrutura:
  - `index.html` – UI e carregamento das libs.
  - `styles.css` – estilo básico.
  - `app.js` – lógica: upload de JSON, mapeamento, filtros, ordenação, aprendizado e export.

## Próximos passos sugeridos

- Validações de esquema e feedback de erro por campo.
- IndexedDB (Dexie) para volumes grandes e histórico mensal.
- Enriquecimento opcional de categorias (lookup) e dashboards.
- Percentuais de divisão configuráveis.
- PWA para trabalhar offline.
