const express = require('express');
const cors = require('cors');
const { glob } = require('glob');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;
const TRANSCRIPTS_DIR = path.resolve(__dirname, '../../transcripts/timestamps');
const DB_PATH = path.resolve(__dirname, 'transcripts.db');

// Initialize DB
const db = new Database(DB_PATH);

// Create Table using FTS5 (Full Text Search) for super fast searching
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
    id, 
    file, 
    line, 
    date, 
    text_content, 
    tokenize="porter"
  );
`);

// Create Trigram Table for Fuzzy Search (handles typos like goldstien vs goldstein)
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts_trigram USING fts5(
    id, 
    file, 
    line, 
    date, 
    text_content, 
    tokenize="trigram"
  );
`);

// Simple KV for tracking if we have indexed or not
db.exec(`
  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

function getDateFromFilename(filename) {
  const match = filename.match(/rogers-(\d{8})/);
  if (match) {
    const d = match[1];
    return `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`;
  }
  return 'Unknown Date';
}

// Check if we need to build index (v2 includes trigram fuzzy search)
const row = db.prepare('SELECT value FROM metadata WHERE key = ?').get('is_indexed_v2');
let isIndexed = row ? row.value === 'true' : false;
let indexingProgress = { current: 0, total: 0 };

async function buildIndex() {
  if (isIndexed) {
      console.log('Database already indexed (v2). Skipping.');
      return;
  }

  console.log('Starting SQLite Indexing (v2 with Fuzzy Search)...');
  
  // Clear old data to ensure consistency across both tables
  db.prepare('DELETE FROM transcripts_fts').run();
  db.prepare('DELETE FROM transcripts_fts_trigram').run();

  const files = await glob(TRANSCRIPTS_DIR + '/**/*.txt');
  console.log(`Found ${files.length} transcripts to ingest.`);
  indexingProgress.total = files.length;

  const insertPorter = db.prepare(`
    INSERT INTO transcripts_fts (id, file, line, date, text_content) 
    VALUES (@id, @file, @line, @date, @text_content)
  `);

  const insertTrigram = db.prepare(`
    INSERT INTO transcripts_fts_trigram (id, file, line, date, text_content) 
    VALUES (@id, @file, @line, @date, @text_content)
  `);

  const insertMany = db.transaction((docs) => {
    for (const doc of docs) {
      insertPorter.run(doc);
      insertTrigram.run(doc);
    }
  });

  let batch = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    indexingProgress.current = i + 1;

    // Yield for event loop responsiveness
    if (i % 50 === 0) await new Promise(r => setImmediate(r));

    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    const filename = path.basename(file);
    const date = getDateFromFilename(filename);
    const relativePath = path.relative(TRANSCRIPTS_DIR, file);

    let currentDoc = null;

    for (let j = 0; j < lines.length; j++) {
      const line = lines[j].trim();
      if (!line) continue;

      if (line.startsWith('[') && line.includes('-->')) {
        if (currentDoc) batch.push(currentDoc);
        currentDoc = {
          id: `${relativePath}::${j}`,
          file: relativePath,
          line: j,
          date: date,
          text_content: ''
        };
      } else if (currentDoc) {
        currentDoc.text_content += ' ' + line;
      }
    }
    if (currentDoc) batch.push(currentDoc);

    // Commit every 50 files
    if (batch.length > 2000) {
      insertMany(batch);
      console.log(`Indexed ${i} / ${files.length} files...`);
      batch = [];
    }
  }

  if (batch.length > 0) insertMany(batch);

  // Mark complete
  db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run('is_indexed_v2', 'true');
  isIndexed = true;
  console.log('Indexing Complete!');
}

// Start background indexing if needed
if (!isIndexed) {
    buildIndex();
}

app.get('/api/status', (req, res) => {
  res.json({
    ready: isIndexed,
    progress: indexingProgress.total ? Math.round((indexingProgress.current / indexingProgress.total) * 100) : 0
  });
});

const NEIL_THESAURUS = {
  'jorge': ['jorge', 'george'],
  'george': ['jorge', 'george']
};

function expandQuery(query) {
  // If query is wrapped in quotes, treat as verbatim (no expansion)
  if (query.startsWith('"') && query.endsWith('"')) {
    return query;
  }

  const words = query.toLowerCase().split(/\s+/);
  const expandedParts = words.map(word => {
    // Basic match for exact word from thesaurus
    const cleanWord = word.replace(/[^\w]/g, '');
    if (NEIL_THESAURUS[cleanWord]) {
      return `(${NEIL_THESAURUS[cleanWord].join(' OR ')})`;
    }
    return word;
  });
  return expandedParts.join(' ');
}

app.get('/api/search', (req, res) => {
  const query = req.query.q;
  const yearsParam = req.query.years;
  const offset = req.query.offset ? parseInt(req.query.offset) : 0;
  const limit = 100;

  if (!isIndexed) return res.status(503).json({ error: 'Indexing', progress:  Math.round((indexingProgress.current / indexingProgress.total) * 100)});
  if (!query) return res.json([]);

  try {
    const isVerbatim = query.startsWith('"') && query.endsWith('"');
    const expandedQuery = expandQuery(query);
    
    // Check for show-wide AND operator
    const isAndSearch = expandedQuery.toUpperCase().includes(' AND ');
    
    const getSearchResults = (tableName, queryString, searchParams, currentOffset) => {
      let finalMatchQuery = queryString;
      let filterSql = '';

      if (isAndSearch) {
        // Split and expand each part for the intersection
        const parts = query.split(/\s+AND\s+/i);
        const expandedParts = parts.map(p => expandQuery(p.trim()));
        
        // Match segments that contain ANY of the terms...
        finalMatchQuery = `(${expandedParts.join(' OR ')})`;
        
        // ...but only in shows that contain ALL of the terms
        const intersectQueries = expandedParts.map(p => `SELECT file FROM ${tableName} WHERE ${tableName} MATCH ${db.prepare('?').bind(p).source.replace('?', `'${p}'`)}`);
        // Note: better-sqlite3 doesn't have a direct way to build this string safely with bindings in a subquery easily
        // so we will use a set of temp params or just trust FTS match syntax which is already sanitized in expandQuery
        filterSql = ` AND t.file IN (
          ${expandedParts.map(() => `SELECT file FROM ${tableName} WHERE ${tableName} MATCH ?`).join(' INTERSECT ')}
        )`;
      }

      let sql = `
        SELECT t.id, t.file, t.line, t.date, t.text_content, 
               snippet(${tableName}, 4, '<b>', '</b>', '...', 64) as highlight,
               l.youtube_url
        FROM ${tableName} t
        LEFT JOIN show_links l ON t.date = l.date
        WHERE t.${tableName} MATCH ? 
        ${filterSql}
      `;
      
      const queryParams = [finalMatchQuery];
      if (isAndSearch) {
        const parts = query.split(/\s+AND\s+/i);
        parts.forEach(p => queryParams.push(expandQuery(p.trim())));
      }
      
      if (yearsParam) {
         const years = yearsParam.split(',');
         const yearPlaceholders = years.map(() => "t.date LIKE ?").join(' OR ');
         sql += ` AND (${yearPlaceholders}) `;
         years.forEach(y => queryParams.push(`${y}%`));
      }

      sql += ` ORDER BY rank LIMIT ${limit} OFFSET ${currentOffset}`;
      return db.prepare(sql).all(...queryParams);
    };

    // 1. Try Exact/Porter search first
    let results = getSearchResults('transcripts_fts', expandedQuery, yearsParam, offset);

    // 2. Fallback to Fuzzy/Trigram ONLY if verbatim search is NOT used AND exact results were 0
    // This prevents "Elian" from matching "reliance" when exact hits for Elian exist.
    if (!isVerbatim && results.length === 0 && query.length >= 3) {
      const fuzzyResults = getSearchResults('transcripts_fts_trigram', expandedQuery, yearsParam, offset);
      results = fuzzyResults;
    }

    const enriched = results.map(hit => {
        try {
            const fullPath = path.join(TRANSCRIPTS_DIR, hit.file);
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            const startLine = Math.max(0, hit.line);
            const endLine = Math.min(lines.length - 1, hit.line + 6);
            return {
                ...hit,
                snippet: lines.slice(startLine, endLine + 1).join('\n')
            };
        } catch(e) { 
            return { ...hit, snippet: hit.text_content }; 
        }
    });

    res.json(enriched);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/transcript', (req, res) => {
    const relPath = req.query.file;
    if (!relPath) return res.status(400).send('Missing file param');
    const fullPath = path.join(TRANSCRIPTS_DIR, relPath);
    if (fs.existsSync(fullPath)) {
        fs.readFile(fullPath, 'utf8', (err, data) => res.send(data));
    } else {
        res.status(404).send('Not Found');
    }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
