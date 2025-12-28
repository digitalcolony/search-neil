# The Neil Rogers Archive

A digital home for the transcripts and recordings of the legendary South Florida radio host Neil Rogers. This project provides a powerful search interface and chronological show index to explore decades of radio history.

## 📻 Features

- **High-Performance Search**: Instant full-text search across 2,000+ transcripts using SQLite FTS5.
- **Deep Linking**: Search results link directly to the exact moment in the YouTube recording.
- **Show List**: A chronological index of shows, filtered by year, with direct YouTube "PLAY" links.
- **Best Of Collections**: Dedicated indexing for "Best Of" transcripts (1988–2006) with specialized tracklists.
- **Guest Host Support**: Integration of guest host metadata (e.g., Stan Major, Bob Lassiter, Jorge Rodriguez).
- **Responsive Design**: Modern, retro-inspired interface with Dark and Light mode support.

## � Technical Architecture (Search & Indexing)

The core of this project is a high-performance search engine built on **SQLite**, designed to handle millions of lines of transcript text with sub-second latency.

### Dual-Index Strategy
To provide both precision and flexibility, the system utilizes two distinct FTS5 virtual tables:
1.  **Porter Stemmer Index (`transcripts_fts`)**: Used for standard linguistic matching. It understands word roots (e.g., searching "dance" will match "dancing" or "danced").
2.  **Trigram Index (`transcripts_fts_trigram`)**: Used as a fallback for fuzzy matching. This allows the system to find results even with misspellings or partial words by indexing character sequences.

### Search Flow
1.  **Exact Match**: The engine first attempts an exact phrase match or Porter-stemmed search.
2.  **AND Logic**: Users can perform show-wide searches using the `AND` operator (e.g., `Rick AND Suds`) to find any show containing both terms.
3.  **Fuzzy Fallback**: If no exact results are found, the engine automatically falls back to the Trigram index to suggest the closest matches.
4.  **Verbatim Search**: Wrapping a query in double quotes (e.g., `"Rick and Suds"`) disables thesaurus expansion and fuzzy matching for strict result accuracy.

### Indexing Process
The backend (`server/index.js`) monitors a metadata versioning system (e.g., `is_indexed_v6`). When new transcripts are added or the schema is updated:
- The system performs a **Drop/Recreate** cycle for maximum speed.
- It parses ~2,000 files, extracting dates from filenames (e.g., `rogers-19930611`) and handling both VTT timestamps and "Best Of" markdown formats.
- Data is committed in large batches using SQLite transactions to minimize disk I/O.

### Deep Linking Logic
Search hits are returned with metadata including the file path and line number. The frontend uses this to:
- Fetch the specific transcript segment.
- Calculate the timestamp in seconds.
- Append a time parameter (e.g., `?t=120s`) to the YouTube URL, including a 5-second "lead-in" buffer for context.

## 🚀 Deployment (Railway) - Split-Repo Setup

Since transcripts are in a separate 6GB repository, follow these steps to deploy:

1.  **Create a Volume**:
    - In Railway, go to **Settings** > **Volumes** > **Add Volume**.
    - Size: **20GB** recommended (for 6GB text + 10GB SQLite index).
    - Mount Path: `/app/data`

2.  **Environment Variables**:
    - `DATA_DIR`: `/app/data` (This tells the app to store the index on the volume).
    - `TRANSCRIPT_REPO_URL`: The URL to your transcript Git repo (e.g., `https://github.com/user/transcripts.git`).
    - `NODE_ENV`: `production`

3.  **Deployment**:
    - Point Railway to your **Web App** repository.
    - On the first deployment, the `start.sh` script will automatically clone your transcripts into the volume and build the SQLite index.
    - Subsequent deployments will be instant because the data persists on the volume!

## 📂 Project Structure

- `transcripts/`: The raw data source.
  - `timestamps/`: Daily show transcripts with VTT-style timestamps.
  - `best-of/`: Specialized markdown transcripts for "Best Of" compilations.
- `web-app/`: The application source code.
  - `server/`: Node.js Express server handling indexing and the Search API.
  - `client-app/`: React (Vite) frontend for the user interface.

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- [npm](https://www.npmjs.com/)

### 1. Start the Backend
The server handles the SQLite database and initial indexing of the transcript files.

```bash
cd web-app/server
npm install
node index.js
```
*Note: On the first run, the server will build an index of the ~6GB transcript collection. This takes approximately 2-5 minutes.*

### 2. Start the Frontend
The client application provides the web interface.

```bash
cd web-app/client-app
npm install
npm run dev
```
By default, the application will be available at `http://localhost:5173`.

## 🛠 Tech Stack

- **Frontend**: React, Vite, Lucide Icons, date-fns, Axios.
- **Backend**: Node.js, Express, better-sqlite3.
- **Database**: SQLite with FTS5 (Full-Text Search) and Trigram indexing for fuzzy matching.

## 📜 Metadata
The project uses `nrs_shows.csv` in the server directory as the primary source for YouTube links and guest host metadata. This is synced to the database via `update_links.js`.
