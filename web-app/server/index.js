const express = require("express");
console.log("[NODE] PROCESS STARTED");
const cors = require("cors");
const { glob } = require("glob");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "../../");
const TRANSCRIPTS_DIR = path.resolve(DATA_DIR, "transcripts/timestamps");
const DB_PATH = path.resolve(DATA_DIR, "transcripts.db");
const BEST_OF_DIR = path.resolve(DATA_DIR, "transcripts/best-of");

console.log(`[INIT] Transcript directory resolved to: ${TRANSCRIPTS_DIR}`);
if (!fs.existsSync(TRANSCRIPTS_DIR)) {
	console.warn(
		`[WARNING] Transcript directory NOT FOUND at ${TRANSCRIPTS_DIR}. Search will return no results.`
	);
}

const getFullPath = (relPath) => {
	return relPath.startsWith("best-of/")
		? path.join(path.dirname(TRANSCRIPTS_DIR), relPath)
		: path.join(TRANSCRIPTS_DIR, relPath);
};

// Initialize DB
const db = new Database(DB_PATH);

// Create Table structure
function createTables() {
	db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
      id, file, line, date, text_content, type, tokenize="porter"
    );
  `);

	db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts_trigram USING fts5(
      id, file, line, date, text_content, type, tokenize="trigram"
    );
  `);

	db.exec(`
    CREATE TABLE IF NOT EXISTS shows (
      date TEXT,
      file TEXT PRIMARY KEY,
      type TEXT,
      youtube_url TEXT,
      custom_title TEXT
    );
  `);

	db.exec(`
    CREATE TABLE IF NOT EXISTS show_links (
      date TEXT PRIMARY KEY,
      youtube_url TEXT,
      host TEXT,
      custom_title TEXT
    );
  `);

	db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

createTables();

function getDateFromFilename(filename) {
	const match = filename.match(/(?:rogers|lassiter)-(\d{8})/);
	if (match) {
		const d = match[1];
		return `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`;
	}

	// Best Of handler (e.g., 1988.md)
	// Use Dec 31st to avoid collision with Jan 1st shows
	const yearMatch = filename.match(/^(\d{4})/);
	if (yearMatch) {
		return `${yearMatch[1]}-12-31`;
	}

	return "Unknown Date";
}

// Check if we need to build index (v6 includes Best Of support)
const row = db.prepare("SELECT value FROM metadata WHERE key = ?").get("is_indexed_v9");
let isIndexed = row ? row.value === "true" : false;
let indexingProgress = { current: 0, total: 0 };

async function buildIndex() {
	if (isIndexed) {
		console.log("Database already indexed (v6). Skipping.");
		// Quick check if we have data anyway
		const count = db.prepare("SELECT COUNT(*) as count FROM shows").get().count;
		console.log(`[STATUS] Database has ${count} shows indexed.`);
		return;
	}

	console.log("Starting SQLite Indexing (v9 with Best Of support)...");

	// Faster than DELETE: DROP and Recreate
	db.exec(`DROP TABLE IF EXISTS transcripts_fts`);
	db.exec(`DROP TABLE IF EXISTS transcripts_fts_trigram`);
	db.exec(`DROP TABLE IF EXISTS shows`);
	createTables();

	const files = await glob(TRANSCRIPTS_DIR + "/**/*.txt");
	const bestOfFiles = fs.existsSync(BEST_OF_DIR) ? await glob(BEST_OF_DIR + "/*.md") : [];

	const allFiles = [
		...files.map((f) => ({ path: f, type: "show" })),
		...bestOfFiles.map((f) => ({ path: f, type: "best_of" })),
	];

	if (allFiles.length === 0) {
		console.error(
			`[CRITICAL] No transcripts found in ${TRANSCRIPTS_DIR} or ${BEST_OF_DIR}. Check your deployment.`
		);
	}

	console.log(`Found ${files.length} shows and ${bestOfFiles.length} best-of files to ingest.`);
	indexingProgress.total = allFiles.length;

	const insertPorter = db.prepare(`
    INSERT INTO transcripts_fts (id, file, line, date, text_content, type) 
    VALUES (@id, @file, @line, @date, @text_content, @type)
  `);

	const insertTrigram = db.prepare(`
    INSERT INTO transcripts_fts_trigram (id, file, line, date, text_content, type) 
    VALUES (@id, @file, @line, @date, @text_content, @type)
  `);

	const insertShow = db.prepare(`
    INSERT OR REPLACE INTO shows (date, file, type, youtube_url, custom_title) 
    VALUES (@date, @file, @type, @youtube_url, @custom_title)
  `);

	const insertLink = db.prepare(`
    INSERT OR REPLACE INTO show_links (date, youtube_url, host, custom_title) 
    VALUES (?, ?, ?, ?)
  `);

	const insertMany = db.transaction((docs, shows, links) => {
		for (const doc of docs) {
			insertPorter.run(doc);
			insertTrigram.run(doc);
		}
		for (const show of shows) {
			insertShow.run(show);
		}
		for (const link of links) {
			insertLink.run(...link);
		}
	});

	let batch = [];
	let showsBatch = [];
	let linksBatch = [];

	for (let i = 0; i < allFiles.length; i++) {
		const fileInfo = allFiles[i];
		const file = fileInfo.path;
		const type = fileInfo.type;

		indexingProgress.current = i + 1;
		if (i % 50 === 0) await new Promise((r) => setImmediate(r));

		const content = fs.readFileSync(file, "utf-8");
		const lines = content.split(/\r?\n/);
		const filename = path.basename(file);
		const date = getDateFromFilename(filename);
		const relativePath =
			type === "best_of" ? `best-of/${filename}` : path.relative(TRANSCRIPTS_DIR, file);

		if (type === "best_of") {
			const title = lines[0]?.trim() || filename;
			const ytUrl = lines[1]?.trim() || "";
			showsBatch.push({ date, file: relativePath, type, youtube_url: ytUrl, custom_title: title });

			for (let j = 2; j < lines.length; j++) {
				const line = lines[j].trim();
				if (!line || line === ".") continue;
				const tsMatch = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)/);
				if (tsMatch) {
					batch.push({
						id: `${relativePath}::${j}`,
						file: relativePath,
						line: j,
						date: date,
						text_content: line, // Keep the whole line for better display
						type: "best_of",
					});
				}
			}
		} else {
			showsBatch.push({ date, file: relativePath, type, youtube_url: null, custom_title: null });
			let currentDoc = null;
			for (let j = 0; j < lines.length; j++) {
				const line = lines[j].trim();
				if (!line) continue;
				if (line.startsWith("[") && line.includes("-->")) {
					if (currentDoc) batch.push(currentDoc);
					currentDoc = {
						id: `${relativePath}::${j}`,
						file: relativePath,
						line: j,
						date: date,
						text_content: "",
						type: "show",
					};
				} else if (currentDoc) {
					currentDoc.text_content += " " + line;
				}
			}
			if (currentDoc) batch.push(currentDoc);
		}

		if (showsBatch.length >= 50) {
			insertMany(batch, showsBatch, []);
			console.log(`Indexed ${i + 1} / ${allFiles.length} files...`);
			batch = [];
			showsBatch = [];
		}
	}

	if (batch.length > 0 || showsBatch.length > 0) insertMany(batch, showsBatch, []);

	// Update show_links from CSV
	const csvFile = path.resolve(__dirname, "nrs_shows.csv");
	if (fs.existsSync(csvFile)) {
		console.log("Syncing metadata from nrs_shows.csv...");
		const csvData = fs.readFileSync(csvFile, "utf8");
		const lines = csvData.split(/\r?\n/).slice(1);

		const links = lines
			.map((line) => {
				const parts = [];
				let current = "";
				let inQuotes = false;
				for (let i = 0; i < line.length; i++) {
					const char = line[i];
					if (char === '"') {
						if (inQuotes && line[i + 1] === '"') {
							current += '"';
							i++;
						} else {
							inQuotes = !inQuotes;
						}
					} else if (char === "," && !inQuotes) {
						parts.push(current);
						current = "";
					} else {
						current += char;
					}
				}
				parts.push(current);
				return parts;
			})
			.filter((p) => p.length >= 3)
			.map((row) => {
				const [date, init, youtube, notes, info, host, custom_title] = row;
				const cleanDate = (date || "").replace(/"/g, "").trim();
				const cleanYoutube = (youtube || "").replace(/"/g, "").trim();
				let cleanHost = (host || "").replace(/"/g, "").trim();
				if (cleanHost.startsWith("http")) cleanHost = ""; // Filter out URLs from host column
				const cleanCustomTitle = (custom_title || "").replace(/"/g, "").trim();
				return cleanDate && cleanYoutube && cleanYoutube.startsWith("http")
					? [cleanDate, cleanYoutube, cleanHost, cleanCustomTitle]
					: null;
			})
			.filter(Boolean);

		db.transaction((ls) => {
			db.exec("DELETE FROM show_links");
			for (const link of ls) insertLink.run(...link);
		})(links);
		console.log(`Synced ${links.length} links.`);
	}

	// Mark complete
	db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)").run(
		"is_indexed_v9",
		"true"
	);
	isIndexed = true;
	console.log("Indexing Complete!");
}

// Start background indexing if needed
if (!isIndexed) {
	buildIndex();
}

app.get("/api/status", (req, res) => {
	res.json({
		ready: isIndexed,
		progress: indexingProgress.total
			? Math.round((indexingProgress.current / indexingProgress.total) * 100)
			: 0,
		totalFiles: indexingProgress.total || 0,
	});
});

const NEIL_THESAURUS = {
	jorge: ["jorge", "george"],
	george: ["jorge", "george"],
};

function expandQuery(query) {
	// Escape/sanitize quotes that could cause FTS5 syntax errors
	// Remove unmatched quotes or multiple consecutive quotes
	let sanitized = query;

	// If query starts and ends with matching quotes, it's verbatim - keep it
	if (sanitized.startsWith('"') && sanitized.endsWith('"') && sanitized.length > 1) {
		return sanitized;
	}

	// Otherwise, remove all quotes and apostrophes to prevent FTS5 syntax errors
	// FTS5 phrase search can be problematic with unmatched quotes
	sanitized = sanitized.replace(/["'`'']/g, "");

	const words = sanitized
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w.length > 0);
	const expandedParts = words.map((word) => {
		// Basic match for exact word from thesaurus
		const cleanWord = word.replace(/[^\w]/g, "");
		if (NEIL_THESAURUS[cleanWord]) {
			return `(${NEIL_THESAURUS[cleanWord].join(" OR ")})`;
		}
		// Return the word with only alphanumeric chars to avoid FTS5 issues
		return cleanWord || word;
	});
	return expandedParts.join(" ");
}

app.get("/api/search", (req, res) => {
	const query = req.query.q;
	const yearsParam = req.query.years;
	const offset = req.query.offset ? parseInt(req.query.offset) : 0;
	const limit = 100;

	if (!isIndexed)
		return res.status(503).json({
			error: "Indexing",
			progress: Math.round((indexingProgress.current / indexingProgress.total) * 100),
		});
	if (!query || !query.trim()) return res.json([]);

	try {
		const isVerbatim = query.startsWith('"') && query.endsWith('"') && query.length > 1;
		const expandedQuery = expandQuery(query);

		// Validate expanded query to prevent FTS5 syntax errors
		const cleanedQuery = expandedQuery.replace(/["()]/g, "").trim();
		if (!cleanedQuery || cleanedQuery.length === 0) {
			return res.json([]);
		}

		// Additional safety: check for problematic FTS5 characters
		// FTS5 special characters that could cause issues: " : ^ * ( )
		// The expandQuery function should handle quotes, but double-check
		if (expandedQuery.split('"').length % 2 === 0) {
			// Odd number of quotes detected (after split, even length means odd quotes)
			console.warn("[FTS5 WARNING] Odd number of quotes in query, stripping all quotes:", {
				query,
				expandedQuery,
			});
			// This shouldn't happen after our expandQuery fix, but safety net
		}

		// Check for show-wide AND operator
		const isAndSearch = expandedQuery.toUpperCase().includes(" AND ");

		const getSearchResults = (tableName, queryString, searchParams, currentOffset) => {
			let finalMatchQuery = queryString;
			let filterSql = "";

			if (isAndSearch) {
				// Split and expand each part for the intersection
				const parts = query.split(/\s+AND\s+/i);
				const expandedParts = parts.map((p) => expandQuery(p.trim()));

				// Match segments that contain ANY of the terms...
				finalMatchQuery = `(${expandedParts.join(" OR ")})`;

				// ...but only in shows that contain ALL of the terms
				filterSql = ` AND t.file IN (
          ${expandedParts
						.map(() => `SELECT file FROM ${tableName} WHERE ${tableName} MATCH ?`)
						.join(" INTERSECT ")}
        )`;
			}

			const typeParam = req.query.type;
			let typeFilter = " AND t.type = ? ";
			const typeValue = typeParam || "show";

			let sql = `
        SELECT t.id, t.file, t.line, t.date, t.text_content, 
               snippet(${tableName}, 4, '<b>', '</b>', '...', 64) as highlight,
               COALESCE(l.youtube_url, s.youtube_url) as youtube_url, 
               l.host, 
               COALESCE(l.custom_title, s.custom_title) as custom_title,
               t.type
        FROM ${tableName} t
        LEFT JOIN show_links l ON t.date = l.date
        LEFT JOIN shows s ON t.file = s.file
        WHERE t.${tableName} MATCH ? 
        ${filterSql}
        ${typeFilter}
      `;

			const queryParams = [finalMatchQuery];
			if (isAndSearch) {
				const parts = query.split(/\s+AND\s+/i);
				parts.forEach((p) => queryParams.push(expandQuery(p.trim())));
			}

			queryParams.push(typeValue);

			if (yearsParam) {
				const years = yearsParam.split(",");
				const yearPlaceholders = years.map(() => "t.date LIKE ?").join(" OR ");
				sql += ` AND (${yearPlaceholders}) `;
				years.forEach((y) => queryParams.push(`${y}%`));
			}

			sql += ` ORDER BY rank LIMIT ${limit} OFFSET ${currentOffset}`;
			return db.prepare(sql).all(...queryParams);
		};

		// 1. Try Exact/Porter search first
		let results = [];
		try {
			results = getSearchResults("transcripts_fts", expandedQuery, yearsParam, offset);
		} catch (ftsError) {
			console.error("[FTS5 ERROR] Query failed:", {
				query,
				expandedQuery,
				error: ftsError.message,
			});
			return res.json([]);
		}

		// 2. Fallback to Fuzzy/Trigram ONLY if verbatim search is NOT used AND exact results were 0
		// This prevents "Elian" from matching "reliance" when exact hits for Elian exist.
		if (!isVerbatim && results.length === 0 && query.length >= 3) {
			const fuzzyResults = getSearchResults(
				"transcripts_fts_trigram",
				expandedQuery,
				yearsParam,
				offset
			);
			results = fuzzyResults;
		}

		const enriched = results.map((hit) => {
			try {
				const fullPath = getFullPath(hit.file);
				const content = fs.readFileSync(fullPath, "utf-8");
				const lines = content.split("\n");
				const startLine = Math.max(0, hit.line);
				const endLine = Math.min(lines.length - 1, hit.line + 6);
				return {
					...hit,
					snippet: lines.slice(startLine, endLine + 1).join("\n"),
				};
			} catch (e) {
				return { ...hit, snippet: hit.text_content };
			}
		});

		res.json(enriched);
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: err.message });
	}
});

app.get("/api/shows", (req, res) => {
	const yearsParam = req.query.years;
	const typeParam = req.query.type;
	if (!isIndexed)
		return res.status(503).json({
			error: "Indexing",
			progress: Math.round((indexingProgress.current / indexingProgress.total) * 100),
		});

	console.log(
		`[API] Fetching shows for years: ${yearsParam || "ALL"}, type: ${typeParam || "ALL"}`
	);

	try {
		let sql = `
      SELECT s.date, s.file, COALESCE(l.youtube_url, s.youtube_url) as youtube_url, l.host, COALESCE(l.custom_title, s.custom_title) as custom_title, s.type
      FROM shows s
      LEFT JOIN show_links l ON (s.date = l.date AND s.type = 'show')
      WHERE 1=1
    `;
		const params = [];

		const typeValue = typeParam || "show";
		sql += ` AND s.type = ? `;
		params.push(typeValue);

		if (yearsParam) {
			const years = yearsParam.split(",");
			const yearPlaceholders = years.map(() => "s.date LIKE ?").join(" OR ");
			sql += ` AND (${yearPlaceholders}) `;
			years.forEach((y) => params.push(`${y}%`));
		}

		sql += ` ORDER BY s.date ASC`;
		const results = db.prepare(sql).all(...params);
		res.json(results);
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: err.message });
	}
});

app.get("/api/transcript", (req, res) => {
	const relPath = req.query.file;
	if (!relPath) return res.status(400).send("Missing file param");
	const fullPath = getFullPath(relPath);
	if (fs.existsSync(fullPath)) {
		fs.readFile(fullPath, "utf8", (err, data) => res.send(data));
	} else {
		res.status(404).send("Not Found");
	}
});

// Serve static files from React build in production
if (process.env.NODE_ENV === "production") {
	const clientDist = path.resolve(__dirname, "../client-app/dist");
	app.use(express.static(clientDist));

	// Handle SPA routing: serve index.html for non-API routes
	app.get("*", (req, res) => {
		if (!req.path.startsWith("/api/")) {
			res.sendFile(path.join(clientDist, "index.html"));
		}
	});
}

app.listen(PORT, "0.0.0.0", () => {
	console.log(`Server running on port ${PORT}`);
});
