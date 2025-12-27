# Product Requirements Document (PRD): The Neil Rogers Archive

## 1. Executive Summary
"The Neil Rogers Archive" is a web application designed to preserve and make accessible the vast collection of transcripts from the *Neil Rogers Show*. The goal is to provide a premium, nostalgic, and powerful search experience that allows fans to explore decades of radio history instantly.

## 2. Core Features

### 2.1 Search Engine
- **Instant Search**: Real-time results as the user types.
- **Fuzzy Search**: Tolerates misspellings (e.g., "Sudds" finds "Suds").
- **relevance Ranking**:
    - Prioritizes shows with higher frequency of the search term.
    - "Best Match" logic to bubble up the most relevant episodes.
- **Scope**: Search across all available years (approx. 1977-2009).

### 2.2 Results Display
- **Contextual Snippets**: Display the search term with surrounding lines of dialogue to provide context without opening the full transcript.
- **Hit Highlighting**: Visually highlight the matched terms in the results.
- **Metadata**: Display formatted date (e.g., "Monday, January 4, 1999") derived from filenames.

### 2.3 Navigation & Filtering
- **Timeline Key**: A visual filter to narrow down results by specific year.
- **Full Transcript View**: Ability to click a result and read the entire transcript, with the finding scrolled into view.

### 2.4 Design Aesthetic
- **Theme**: "Retro Radio" / Analog.
- **Visual Elements**:
    - Dark mode base.
    - Glow effects (amber/green monochrome terminals or neon tubes).
    - Skeuomorphic elements (dials, switches, VU meters as decorative elements).
    - Serif or Monospace fonts reminiscent of old broadcasting logs or early computer terminals.

## 3. Technical Architecture

### 3.1 Frontend
- **Framework**: React (via Vite).
- **Styling**: Vanilla CSS (CSS Variables for theming) to achieve a bespoke Retro look.
- **State Management**: React Context or Hooks for search state.

### 3.2 Backend / Data Layer
- **Server**: Node.js (Express) running locally.
- **Data Source**: Local filesystem text files (~6,000 files, ~1.8GB est).
- **Indexing Strategy**:
    - On server startup, traverse `transcripts/timestamps` recursively.
    - Build an in-memory search index (using a library like `minisearch` or `flexsearch` for performance and fuzzy capabilities).
    - Serve search results via a simple REST API (e.g., `GET /api/search?q=...`).

## 4. Future Considerations (Out of Scope for MVP)
- **Audio Integration**: Linking timestamps to YouTube/Audio streams.
- **User Accounts**: Saving favorite clips.

## 5. Success Metrics
- Search results returned in under 200ms.
- "Retro" vibe achieved without compromising readability.
- Successful handling of common misspellings (Fuzzy match).
