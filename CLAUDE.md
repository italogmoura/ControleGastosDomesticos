# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a client-side expense management web application that runs entirely in the browser. It processes credit card PDF statements, splits expenses between users (60/40 ratio), and provides export capabilities.

## Development Commands

**No build system or npm commands** - This is a static web application:
- **Run:** Open `index.html` directly in Chrome browser
- **Test:** Use sample PDFs in `doc/exemploFaturas/` folder
- **Deploy:** Simply copy all files to a web server (static hosting)

## Architecture & Structure

### Core Components

**app.js (809 lines)** - Main application logic organized into sections:
1. **Constants & State** (lines 1-50): `LS_KEYS`, `STATE` object
2. **PDF Processing** (lines 50-400): Bank detection, text extraction, transaction parsing
3. **UI Management** (lines 400-600): Table rendering, filtering, sorting
4. **Data Persistence** (lines 600-700): localStorage operations
5. **Export Functions** (lines 700-809): CSV and XLSX generation

### Key Architectural Patterns

- **State Management:** Single global `STATE` object with localStorage persistence
- **Bank Processors:** Each bank (Amazon, Nubank, Itaú, Rico) has dedicated parsing logic
- **Learning System:** Tracks user classifications in `STATE.userPreferences` for future suggestions
- **Event Delegation:** Main table uses event delegation for row interactions

### Critical Functions

- `processPDF()`: Entry point for PDF processing - detects bank and routes to specific parser
- `detectBankFromPDF()`: Uses heuristics to identify bank type
- `parseAmazonPDF()`, `parseNubankPDF()`, etc.: Bank-specific parsing logic
- `updateSummary()`: Recalculates expense splits whenever data changes
- `saveToLocalStorage()`: Persists entire application state

### Data Flow

1. User drops PDF → `processPDF()` extracts text
2. Bank detection → Routes to specific parser
3. Parser extracts transactions → Adds to `STATE.transactions`
4. User classifies expenses → Updates `STATE.userPreferences`
5. Export functions → Generate CSV/XLSX from current state

## Important Considerations

### PDF Processing
- **Chrome Required:** PDF.js works best in Chrome
- **Text Extraction:** PDFs are parsed as text, not OCR - requires selectable text
- **Bank Formats:** Each bank has unique table structure requiring custom parsing

### Expense Classification
- **60/40 Split:** "Geral" expenses split 60% User1, 40% User2
- **Learning System:** Automatically suggests classifications based on past choices
- **Manual Override:** Users can always change suggested classifications

### Testing New Banks
When adding support for new banks:
1. Get sample PDF in `doc/exemploFaturas/`
2. Add detection logic in `detectBankFromPDF()`
3. Create new parser function following existing patterns
4. Test transaction extraction thoroughly

### Browser Compatibility
- Uses modern JavaScript (ES6+) - no transpilation
- Requires localStorage support
- File API for drag-and-drop
- No Internet Explorer support