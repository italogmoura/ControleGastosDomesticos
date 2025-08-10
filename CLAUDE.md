# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a client-side web application for managing personal credit card expenses with a 60/40 split calculation system. The application processes JSON files containing credit card transaction data, categorizes expenses as "General" (shared) or "Exclusive" (personal), learns from user preferences, and calculates proportional splits between two people.

## Architecture

The application follows a simple client-side architecture with no backend dependencies:

- **Frontend-only**: Pure HTML/CSS/JavaScript running entirely in the browser
- **No build process**: Direct file serving, no bundlers or transpilation
- **CDN dependencies**: External libraries loaded via CDN (SheetJS for Excel export, Apache ECharts for visualizations)
- **Local persistence**: All data stored in localStorage and IndexedDB
- **File processing**: JSON import/export with drag-and-drop support

## Core Components

### Data Flow
1. **Input**: JSON files with structured credit card transaction data
2. **Processing**: Transaction normalization, categorization, and learning system
3. **Classification**: User manually classifies expenses as "General" or "Exclusive"
4. **Output**: Expense reports, CSV/XLSX exports, and visual insights

### Key Files
- `index.html`: Main UI structure with tables, filters, and controls
- `app.js`: Core application logic (~1300 lines)
- `styles.css`: Dark theme CSS styling
- `doc/Prompt.txt`: Documentation of the expected JSON input format

### Key Features
- **Machine Learning**: Learns from user classifications to suggest categories for future transactions
- **Multi-format support**: Handles both legacy and nested JSON schemas
- **Data persistence**: Caches transactions and preferences locally
- **Export capabilities**: CSV and XLSX export functionality
- **Visual insights**: Charts showing spending patterns using Apache ECharts
- **Auto-save**: Optional automatic rule saving using File System Access API

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

The application expects JSON input with this structure:

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

## Key Functions and State

### State Management
- `STATE` object contains all application state (transactions, filters, rules, decisions)
- Persistent storage in localStorage with versioned keys
- Auto-save functionality for rules when supported by browser

### Transaction Processing
- `mapJsonToTransactions()`: Converts JSON input to internal format
- `normalizeDesc()`: Cleans and normalizes transaction descriptions
- `inferCategoria()`: Attempts automatic categorization
- `isPagamento()`: Determines if transaction is payment/credit

### Learning System
- `STATE.regras`: Stores learned preferences by normalized description
- `confirmarDivisao()`: Updates learning when user makes classification
- Counter-based system tracks "General" vs "Exclusive" classifications
- Auto-suggests classifications based on previous decisions

### Filtering and Display
- `applyFiltersSort()`: Applies all active filters and sorting
- `renderTable()`: Renders main transaction tables
- `renderInsights()`: Creates charts and visual analytics

## Browser Compatibility

- **Primary target**: Google Chrome (recommended for best experience)
- **File System Access API**: Chrome/Edge only for auto-save feature
- **Fallback support**: Other browsers work but without auto-save
- **Requires**: Modern browser with ES6+ support, localStorage, IndexedDB

## Data Persistence

- **localStorage**: User preferences, filters, learned rules, cached transactions
- **IndexedDB**: File handles for auto-save functionality (Chrome/Edge only)
- **Export options**: Manual JSON export/import for rules backup
- **Cache system**: Transactions cached locally to survive page refreshes

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
- JSON parsing includes basic error handling but no schema validation