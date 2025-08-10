# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a client-side web application called "Controle de Faturas 60/40" - a domestic expense control system that processes credit card statements (faturas) from PDF files and automatically categorizes transactions with a 60/40 splitting mechanism between partners.

## Development Commands

### Running the Application
```bash
# No build process required - simply open in browser
open index.html
# Or serve via local server if needed:
python3 -m http.server 8000
# Then visit: http://localhost:8000
```

### Testing
```bash
# Use sample PDFs in doc/exemploFaturas/ for testing:
# - Fatura Amazon - ago.pdf
# - Fatura Nubank - ago.pdf  
# - fatura Itaú - ago.pdf
# - fatura rico - ago.pdf
```

### Browser Requirements
- **Chrome recommended** (best PDF.js compatibility)
- Must support ES6+ features and localStorage
- Requires internet connection for CDN dependencies (pdf.js, SheetJS)

## Architecture

### Core System Flow
1. **PDF Upload** → Drag & drop or file selection
2. **Text Extraction** → pdf.js processes PDF to extract text and reconstruct visual lines
3. **Bank Detection** → Heuristic analysis of content and filename to identify bank
4. **Transaction Parsing** → Bank-specific parsers extract structured data
5. **Smart Classification** → Machine learning categorization with user feedback loop
6. **60/40 Calculation** → Automatic expense splitting (Geral vs Exclusiva)
7. **Export** → CSV/XLSX generation

### Key Modules

#### PDF Processing (`app.js:105-147`)
- `extractTextFromPDF()` - Uses pdf.js to extract text and reconstruct visual table rows
- Handles coordinate-based text positioning to rebuild table structure
- Disables workers to avoid CORS issues with file:// protocol

#### Bank Detection (`app.js:79-103`)
- `detectBanco()` - Identifies bank from text content and filename
- Supports: Nubank, Itaú, Amazon, Rico
- Uses diacritic-insensitive matching for Brazilian Portuguese

#### Transaction Parsing
- `parseTransacoesGeneric()` (`app.js:150-353`) - Main parser with fallback strategies
- `parseTransacoesAmazon()` (`app.js:356-450`) - Specialized Amazon parser
- Handles various date formats: DD/MM/YYYY, DD/MM, DD mon
- Extracts: date, description, values (BRL/USD), exchange rate, installments, taxes

#### Machine Learning Classification
- `inferDivisaoSugerida()` (`app.js:467-473`) - Learns from user choices
- `confirmarDivisao()` (`app.js:484-489`) - Updates learning model
- `STATE.regras` object stores learned patterns by normalized description

#### State Management
- All data persisted in localStorage with versioned keys
- `STATE` object manages: transactions, filters, sort preferences, learning rules
- No external database required

### Data Structure

#### Transaction Object
```javascript
{
  id: `${banco}|${data}|${descricao}|${valor}`,
  banco: string,           // Bank name
  data: string,            // DD/MM/YY format
  descricao: string,       // Clean description
  descricaoNormalizada: string, // Normalized for learning
  categoriaTipo: string,   // Auto-categorized type
  divisao: string,         // "Geral" | "Exclusiva" + "(sugerido)"
  valorBRL: number,        // Amount in BRL
  valorUSD: string,        // USD amount if international
  cotacao: string,         // Exchange rate
  taxas: string,          // IOF, fees
  parcelamento: string,   // Installment info "n/total"
  observacoes: string     // Additional notes
}
```

## Important Development Notes

### Adding New Bank Support
1. Update `detectBanco()` with bank identification patterns
2. Consider creating specialized parser like `parseTransacoesAmazon()`
3. Test with actual PDF samples
4. Update category inference rules in `inferCategoria()`

### Text Processing Considerations
- PDFs must contain extractable text (not scanned images - no OCR support)
- Different banks have varied statement layouts requiring heuristic adjustments
- `cleanDescricao()` removes bank-specific prefixes (especially Nubank masked card numbers)

### Performance Notes
- All processing happens client-side for privacy
- Large PDFs may cause memory issues
- Consider pagination for very long statements

### Debugging
- Check browser console for parsing errors
- Use `STATE.transacoes` to inspect parsed data
- Sample PDFs in `doc/exemploFaturas/` for testing new features

## File Structure
- `index.html` - Main UI and library loading
- `app.js` - Core logic (parsing, learning, export)
- `styles.css` - Dark theme styling
- `doc/exemploFaturas/` - Sample PDF files for testing
- `doc/Prompt.txt` - Original AI prompt for the system requirements

## External Dependencies (CDN)
- pdf.js 3.11.174 - PDF text extraction
- SheetJS 0.18.5 - XLSX export functionality