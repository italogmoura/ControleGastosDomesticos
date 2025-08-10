# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a client-side expense control application that processes credit card PDF bills to extract transactions, categorize them, and calculate 60/40 expense splits between users. The application is built entirely with vanilla JavaScript and runs in the browser without server dependencies.

## How to Run and Test

**Development/Testing:**
- Open `index.html` directly in Chrome browser (double-click or drag to browser tab)
- No build process needed - all dependencies are loaded via CDN
- Chrome is recommended due to File System Access API support for auto-save features

**File Structure:**
- `index.html` - Main UI and library loading
- `app.js` - Core application logic (PDF parsing, transaction processing, learning system)
- `styles.css` - Dark theme styling with responsive design
- `doc/Prompt.txt` - Contains the original AI prompt used for expense categorization rules
- `doc/exemploFaturas/` - Sample PDF bills for testing parsers

## Core Architecture

**PDF Processing Pipeline:**
1. PDF text extraction using pdf.js library
2. Bank detection via heuristics (filename + content analysis)
3. Bank-specific parsers for transaction extraction
4. Transaction normalization and categorization
5. Machine learning for expense division suggestions

**Bank Parser System:**
- Generic parser handles most banks with date + description + value pattern matching
- Specialized parsers for complex formats:
  - `parseTransacoesAmazon()` - Amazon credit card statements
  - `parseItauFromText()` - Itaú cards with multi-line transaction format
  - `itauPreprocessRows()` - Handles Itaú's two-column layout issues

**Data Storage:**
- localStorage for user preferences, filters, and learning rules
- IndexedDB for File System Access API handles (Chrome auto-save feature)
- All processing is client-side only

**Learning System:**
- Tracks user's "Geral" vs "Exclusiva" choices per transaction description
- Uses normalized description as key for future suggestions
- Maintains counters for each choice to determine majority preference
- Supports import/export of learning rules in JSON format

## Key Components

**Transaction Processing (`app.js:335-964`):**
- `parseTransacoesGeneric()` - Main transaction parser with fallback logic
- `cleanDescricao()` - Removes card prefixes (especially Nubank masked numbers)
- `inferCategoria()` - Auto-categorizes transactions based on merchant patterns
- `detectBanco()` - Identifies bank from PDF content and filename

**UI State Management (`app.js:12-77`):**
- `STATE` object holds all application data (transactions, filters, rules)
- Automatic persistence to localStorage
- Real-time table updates when data changes

**Export Functionality:**
- CSV export with proper Brazilian formatting (comma decimal separator)
- XLSX export using SheetJS library
- Learning rules export/import for backup/sharing

## Development Notes

**Parser Testing:**
- Use `window.testItauParser()` in browser console to test Itaú parsing edge cases
- Test cases include two-column layout problems and various transaction formats

**Adding New Bank Support:**
1. Add bank detection logic in `detectBanco()`
2. Create specialized parser function if needed
3. Update `parseTransacoesGeneric()` to use new parser
4. Test with sample PDFs

**Transaction Categories:**
- Categories are defined in `inferCategoria()` using regex patterns
- Common patterns: iFood (IFD*), Uber, pharmacies, supermarkets, streaming services
- Default category is "Outros" for unmatched transactions

**File System Access API:**
- Auto-save feature requires HTTPS or localhost
- Only supported in Chrome/Edge browsers
- Fallback to manual export/import for other browsers

## Important Implementation Details

**Date Parsing:**
- Supports DD/MM, DD/MM/YY, DD/MM/YYYY formats
- Also handles Portuguese abbreviated months (jan, fev, mar, etc.)
- Year defaults to current year when not specified

**Value Parsing:**
- Handles Brazilian currency format (1.234,56)
- Supports parentheses and trailing minus for negative values
- Detects USD amounts and exchange rates for international transactions

**Transaction Deduplication:**
- Uses composite ID: `${banco}|${data}|${descricao}|${valor}`
- Prevents duplicate imports when reprocessing same PDF files

**Responsive Design:**
- Tables use horizontal scrolling on narrow screens
- Summary grid adapts from 4 to 2 to 1 column based on screen width
- Touch-friendly controls for mobile usage