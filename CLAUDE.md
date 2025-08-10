# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Application Overview

This is a client-side web application for processing and categorizing credit card statements with configurable expense splitting logic (default 60/40). The app ingests a nested JSON (faturas > cartoes > transacoes), applies learning for categorization suggestions, and exports results to CSV/XLSX. An insights panel shows charts for categories, establishments, and locations.

## Key Architecture

### Core Files
- `index.html` - Main UI with tables for expenses, payments, and exclusive transactions
- `app.js` - Application logic including JSON parsing, learning system, filtering, and export
- `styles.css` - Styling and responsive layout

### Data Flow
1. JSON input (nested) → `mapJsonToTransactions()` → internal transaction format
2. Learning system applies suggestions via `inferDivisaoSugerida()`
3. User interactions update rules through `confirmarDivisao()`
4. Export functions generate CSV/XLSX from filtered data

## JSON Input Format

The application expects a nested JSON structure:
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
            { "data": "AAAA-MM-DD", "descricao": "...", "estabelecimento": "...", "categoria": "...", "tipoLancamento": "Nacional|Internacional", "valorBRL": 0, "valorUSD": null, "cotacaoDolar": null, "iof": 0, "taxas": 0, "parcelamento": null, "local": "Cidade/País", "observacoes": "..." }
          ]
        }
      ]
    }
  ]
}
```

## Core Systems

### Transaction Processing
- `mapJsonToTransactions()` - Converts nested JSON to internal format (keeps fallback for older schema)
- `cleanDescricao()` - Removes bank-specific prefixes (especially Nubank card masks)
- `detectBanco()` - Bank detection heuristics using text and filename analysis
- `normalizeDesc()` - Normalizes descriptions for learning system

### Learning System
- `STATE.regras` - Stores classification rules with counters per label
- `ensureRule()` - Creates/ensures rule structure exists
- `confirmarDivisao()` - Updates rules when user confirms classification
- `migrateRegrasInPlace()` - Handles rule format migrations

### Filtering & Display
- `applyFiltersSort()` - Applies filters and sorting to transaction data
- `renderTable()` - Renders main expenses table with interactive division selectors
- Separate tables for payments/credits and exclusive expenses

### Data Persistence
- LocalStorage for filters, rules, decisions, and sort preferences
- IndexedDB for File System Access API handles (auto-save feature)
- `scheduleAutoSaveRules()` - Debounced auto-save with 400ms delay

## Development Commands

### Running the Application
```bash
# Open in Chrome (recommended browser)
open index.html
# or serve via HTTP server
python3 -m http.server 8000
open http://localhost:8000
```

### Testing
No automated tests - manual testing via browser with sample JSON files

## Key Features

### Split Logic (Configurable)
- "Geral" expenses split by a user-configured percentage (default 60% user / 40% spouse)
- "Exclusiva" expenses 100% user
- Automatic calculation in summary panel

### Auto-Save (Chrome/Edge only)
- Uses File System Access API for persistent rule saves
- Requires HTTPS or localhost context
- Falls back to manual export/import

### Export Formats
- CSV with semicolon separator for Brazilian locale (includes IOF when present)
- XLSX via SheetJS library (includes IOF when present)
- JSON rule export/import for backup

## Browser Compatibility

- Primary: Chrome/Edge (File System Access API support)
- Secondary: Firefox/Safari (limited auto-save features)
- Requires modern ES6+ support

## Data Categories

The application automatically categorizes transactions into:
- Alimentação, Transporte, Saúde, Assinaturas
- Compras Online, Serviços Financeiros, Lazer
- Educação, Casa, Pagamento/Crédito, Outros

Negative values automatically become "Pagamento/Crédito" category.