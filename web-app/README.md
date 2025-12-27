# How to Run The Neil Rogers Archive

## Architecture

This application uses **SQLite with FTS5 (Full-Text Search)** for fast, persistent searching of 2,000+ transcript files.

- **Backend**: Node.js + Express + better-sqlite3
- **Frontend**: React (Vite)
- **Database**: SQLite with FTS5 indexing

## Running the Application

1. **Start the Backend (Search Engine)**
   - Open a terminal in `web-app/server`
   - Run: `node index.js`
   - **First-time setup**: The server will index all transcripts from `../../transcripts/timestamps` into `transcripts.db`. This takes ~2-3 minutes and only happens once.
   - **Subsequent runs**: The server starts instantly using the existing database.

2. **Start the Frontend (Web App)**
   - Open a terminal in `web-app/client-app`
   - Run: `npm run dev`
   - Open your browser to the URL shown (typically `http://localhost:5173`)

## Features

- **Instant Search**: SQLite FTS5 provides sub-second search across all transcripts
- **Multi-Year Filtering**: Select one or more years to narrow results
- **Pagination**: Load more results in batches of 100
- **Persistent Index**: Database is saved to disk and reused on restart

