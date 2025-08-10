# Controle de Faturas 60/40 (MVP)

Aplicativo web simples (client-side) para importar faturas de cartão em PDF, consolidar lançamentos, classificar como "Geral" (a dividir) ou "Exclusiva" (do usuário), aprender suas escolhas e calcular os totais 60%/40%.

- Compatível inicialmente com faturas similares às de Amazon, Nubank, Itaú e Rico contidas em `exemploFaturas/`.
- Todo processamento acontece no navegador (Chrome recomendado).
- Exporta CSV e XLSX.

## Como usar

1. Abra o arquivo `index.html` no Chrome (duplo clique ou arraste para uma aba do navegador).
2. Arraste seus PDFs para a área de drop ou clique em "Selecionar PDFs" e escolha múltiplos arquivos.
3. Revise a tabela de lançamentos e ajuste a coluna "Divisão" (Geral/Exclusiva). O app memoriza suas escolhas para sugerir nas próximas importações.
4. Veja o painel de resumo com totais e a divisão 60%/40%.
5. Exporte como CSV ou XLSX quando quiser.

## Observações

- Este MVP usa heurísticas simples para extrair transações do texto do PDF (via pdf.js). Se o PDF for digitalizado (imagem sem texto), a extração não funcionará. Futuramente podemos acoplar OCR.
- A detecção de banco e parsing são heurísticos e podem exigir ajustes finos por layout. Envie exemplos adicionais quando desejar ampliar a cobertura.
- Preferências e regras ficam salvas localmente (localStorage). Para limpar, use o botão "Limpar dados".

## Desenvolvimento

- Sem dependências locais; bibliotecas via CDN: pdf.js e SheetJS (xlsx).
- Estrutura:
  - `index.html` – UI e carregamento das libs.
  - `styles.css` – estilo básico.
  - `app.js` – lógica: upload, parsing, filtros, ordenação, aprendizado e export.

## Próximos passos sugeridos

- Parsers específicos por banco para melhorar precisão (regex por layout).
- IndexedDB (Dexie) para volumes grandes e histórico mensal.
- Ajustar regex para parcelamento/IOF/cotação com maior robustez.
- Percentuais de divisão configuráveis.
- PWA para trabalhar offline.
