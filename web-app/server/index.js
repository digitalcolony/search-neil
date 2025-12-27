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

// Check if we need to build index
const row = db.prepare('SELECT value FROM metadata WHERE key = ?').get('is_indexed');
let isIndexed = row ? row.value === 'true' : false;
let indexingProgress = { current: 0, total: 0 };

async function buildIndex() {
  if (isIndexed) {
      console.log('Database already indexed. Skipping.');
      return;
  }

  console.log('Starting SQLite Indexing...');
  
  // Clear old data just in case
  db.prepare('DELETE FROM transcripts_fts').run();

  const files = await glob(TRANSCRIPTS_DIR + '/**/*.txt');
  console.log(`Found ${files.length} transcripts to ingest.`);
  indexingProgress.total = files.length;

  const insert = db.prepare(`
    INSERT INTO transcripts_fts (id, file, line, date, text_content) 
    VALUES (@id, @file, @line, @date, @text_content)
  `);

  const insertMany = db.transaction((docs) => {
    for (const doc of docs) insert.run(doc);
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
  db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run('is_indexed', 'true');
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

  if (!isIndexed) return res.status(503).json({ error: 'Indexing', progress:  Math.round((indexingProgress.current / indexingProgress.total) * 100)});
  if (!query) return res.json([]);

  try {
    const expandedQuery = expandQuery(query);
    console.log(`Original: "${query}" -> Expanded: "${expandedQuery}"`);
    
    let sql = `
      SELECT t.id, t.file, t.line, t.date, t.text_content, 
             snippet(transcripts_fts, 4, '<b>', '</b>', '...', 64) as highlight,
             l.youtube_url
      FROM transcripts_fts t
      LEFT JOIN show_links l ON t.date = l.date
      WHERE t.transcripts_fts MATCH ? 
    `;
    
    const params = [expandedQuery]; 
    
    if (yearsParam) {
       const years = yearsParam.split(',');
       // Create OR condition for years: AND (t.date LIKE '1999%' OR t.date LIKE '2000%')
       const yearPlaceholders = years.map(() => "t.date LIKE ?").join(' OR ');
       sql += ` AND (${yearPlaceholders}) `;
       years.forEach(y => params.push(`${y}%`));
    }

    const limit = 100;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;

    sql += ` ORDER BY rank LIMIT ${limit} OFFSET ${offset}`;

    const results = db.prepare(sql).all(...params);

    // Context Loading
    // We already have text_content, but if we want surrounding lines we might read file.
    // Ideally we just specific snippets.
    
    // For now, let's just return what we have. 
    // The user wanted "context". FTS snippet gives small context.
    // Let's stick to reading file for "Full Context" like before if snippet is too short.
    
    const enriched = results.map(hit => {
        // Only read file if we really need larger context than what we stored
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
