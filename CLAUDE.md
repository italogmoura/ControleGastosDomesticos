# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a client-side web application for managing personal credit card expenses with a 60/40 split calculation system. The application processes JSON files containing credit card transaction data, categorizes expenses as "General" (shared) or "Exclusive" (personal), learns from user preferences, and calculates proportional splits between two people. It also supports reclassifying payment/refund rows into the main Transactions list, a keyboard-first Review Mode, a light/dark theme, token-based search, and manual transaction entry.

## Architecture

The application follows a simple client-side architecture with no backend dependencies:

- **Frontend-only**: Pure HTML/CSS/JavaScript running entirely in the browser
- **No build process**: Direct file serving, no bundlers or transpilation
- **CDN dependencies**: External libraries loaded via CDN (SheetJS for Excel export, Apache ECharts for visualizations)
- **Local persistence**: All data stored in localStorage and IndexedDB (transactions cache, preferences, learned rules, reclassifications)
- **File processing**: JSON import/export with drag-and-drop support

## Core Components

### Data Flow
1. **Input**: JSON files with structured credit card transaction data (nested schema, vectorized-by-index schema, and legacy schema)
2. **Processing**: Transaction normalization, categorization, and learning system
3. **Classification**: User manually classifies expenses as "General" or "Exclusive" (optionally via Review Mode overlay)
4. **Output**: Expense reports, CSV/XLSX exports, and collapsible visual insights

### Key Files
- `index.html`: Main UI structure with tables, filters, and controls; includes dialogs (Review Mode, manual entry) and theme/insights toggles
- `app.js`: Core application logic (~1300 lines)
- `styles.css`: Light/Dark theme CSS styling (including Review Mode)
- `doc/Prompt.txt`: Documentation of the expected JSON input format

### Key Features
- **Machine Learning**: Learns from user classifications to suggest categories for future transactions
- **Multi-format support**: Handles nested, vectorized-by-index, and legacy JSON schemas
- **Data persistence**: Caches transactions and preferences locally until the user clicks "Clear data"
- **Export capabilities**: CSV and XLSX export functionality
- **Visual insights**: Collapsible insights (Top Categories, Treemap, Heatmap) using Apache ECharts
- **Auto-save**: Optional automatic rule saving using File System Access API
- **Reclassification**: Move items from "Payments and Refunds (separated)" into the main Transactions list with one click
- **Review Mode**: Full-screen overlay to classify one transaction at a time with keyboard shortcuts
- **Themes**: Light/Dark theme toggle with persisted preference
- **Search**: Token-based, diacritic-insensitive substring search for Transactions
- **Manual Entries**: Add manual transactions with required fields (date, description, value) and fixed category list

## Development Commands

Since this is a client-side only application with no build process:

### Running the application
```bash
# Open directly in browser (recommended: Chrome)
open index.html
# OR serve locally if needed
python3 -m http.server 8000
# Then open http://localhost:8000
```

### No package management
- No npm/yarn/package.json
- All dependencies via CDN
- No installation or build steps required

## Data Format

The application accepts three JSON input structures:

```json
{
  "faturas": [
    {
      "identificacaoFatura": {
        "banco": "Bank Name",
        "mesReferencia": "MM/YYYY",
        "valorTotal": 1234.56,
        "dataVencimento": "YYYY-MM-DD",
        "dataFechamento": "YYYY-MM-DD"
      },
      "cartoes": [
        {
          "identificacaoCartao": {
            "titular": "Card Holder",
            "bandeira": "Visa/Mastercard",
            "finalCartao": "1234"
          },
          "transacoes": [
            {
              "data": "YYYY-MM-DD",
              "descricao": "Transaction Description",
              "estabelecimento": "Merchant Name",
              "categoria": "Category",
              "valorBRL": 150.00,
              "valorUSD": 30.00,
              "cotacaoDolar": 5.00,
              "iof": 1.50,
              "parcelamento": "1/2",
              "local": "City",
              "observacoes": "Notes"
            }
          ]
        }
      ]
    }
  ]
}
```

### Vectorized-by-index schema (alternative)

Good for large files. Transactions are provided as column arrays, with integer indices mapping to cards and categories.

```json
{
  "faturas": [
    {
      "cartoes": [
        { "finalCartao": "9348", "titular": "ITALO GONCALVES MOURA", "bandeira": "Mastercard", "tipoCartao": "Black" }
      ],
      "categorias": ["Food", "Health", "Other"],
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

### Legacy schema (fallback)

Older flat format with `identificacao` and `transacoes` at the top level remains supported for backward compatibility.

## Key Functions and State

### State Management
- `STATE` object contains all application state (transactions, filters, rules, decisions, reclassifications, theme, insights toggle)
- Persistent storage in localStorage with versioned keys; transactions cache persists until "Clear data"
- Auto-save functionality for rules when supported by browser

### Transaction Processing
- `mapJsonToTransactions()`: Converts JSON input to internal format (handles nested/vectorized/legacy)
- `normalizeDesc()`: Cleans and normalizes transaction descriptions
- `inferCategoria()`: Attempts automatic categorization
- `isPagamento()`: Determines if transaction is payment/credit (with reclassification overrides)
- `reclassificarParaLancamentos()`: Moves a payment/refund into Transactions and persists the override

### Learning System
- `STATE.regras`: Stores learned preferences by normalized description
- `confirmarDivisao()`: Updates learning when user makes classification
- Counter-based system tracks "General" vs "Exclusive" classifications
- Auto-suggests classifications based on previous decisions

### Filtering and Display
- `applyFiltersSort()`: Applies all active filters and sorting; Transactions search uses token-based matching
- `renderTable()`: Renders main transaction tables and updates badges (e.g., Exclusive total)
- `renderInsights()`: Creates collapsible charts and visual analytics (Top Categories, Treemap, Heatmap)
- `openReviewMode()`: Opens the full-screen classification overlay with keyboard shortcuts
- `applyTheme()`: Applies and persists light/dark theme
- `saveDataCache()/loadDataCache()`: Persist/restore parsed transactions across sessions

## Browser Compatibility

- **Primary target**: Google Chrome (recommended for best experience)
- **File System Access API**: Chrome/Edge only for auto-save feature
- **Fallback support**: Other browsers work but without auto-save
- **Requires**: Modern browser with ES6+ support, localStorage, IndexedDB

## Data Persistence

- **localStorage**: User preferences, filters, learned rules, cached transactions, reclassification map, search queries, theme and insights preferences
- **IndexedDB**: File handles for auto-save functionality (Chrome/Edge only)
- **Export options**: Manual JSON export/import for rules backup
- **Cache system**: Transactions cached locally to survive page refreshes until the user clears data

## Common Development Tasks

### Adding new transaction categories
1. Update category inference logic in `inferCategoria()`
2. Add new category options to UI filters if needed

### Modifying the learning system
- Main logic in `confirmarDivisao()` function
- Rules stored with counter system for each classification type
- Migration logic in `migrateRegrasInPlace()` handles format changes

### Extending export functionality
- CSV export in `exportCSV()`
- XLSX export in `exportXLSX()` using SheetJS library
- Add new export formats by following existing patterns

### Adding new visualizations
- Charts implemented using Apache ECharts library
- Chart rendering in `renderInsights()` function
- Multiple chart types: bar charts, treemaps, heatmaps

## Testing

No formal test framework - testing is done manually:
1. Load the application in Chrome
2. Import sample JSON files
3. Test classification, filtering, and export functionality
4. Verify data persistence across page refreshes

## Security Notes

- Client-side only processing - no data sent to external servers
- File System Access API requires user permission for auto-save
- All data processing happens locally in the browser
- JSON parsing includes basic error handling but no schema validation yet; schema validation is a suggested next step