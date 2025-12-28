const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const db = new Database('transcripts.db');

db.exec(`DROP TABLE IF EXISTS show_links`);
// 1. Create show_links table
db.exec(`
    CREATE TABLE IF NOT EXISTS show_links (
        date TEXT PRIMARY KEY,
        youtube_url TEXT,
        host TEXT,
        custom_title TEXT
    );
`);
console.log("Ensured show_links table exists.");

// 2. Parse CSV
const csvData = fs.readFileSync('nrs_shows.csv', 'utf8');
const lines = csvData.split(/\r?\n/);

console.log(`Processing ${lines.length - 1} rows...`);

const insertStmt = db.prepare('INSERT OR REPLACE INTO show_links (date, youtube_url, host, custom_title) VALUES (?, ?, ?, ?)');

let count = 0;
function parseLine(line) {
    const parts = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i+1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            parts.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    parts.push(current);
    return parts;
}

const transaction = db.transaction((rows) => {
    for (const row of rows) {
        if (row.length < 3) continue;
        const [date, init, youtube, notes, info, host, custom_title] = row;
        // Clean fields
        const cleanDate = date.replace(/"/g, '').trim();
        const cleanYoutube = (youtube || '').replace(/"/g, '').trim();
        const cleanHost = (host || '').replace(/"/g, '').trim();
        const cleanCustomTitle = (custom_title || '').replace(/"/g, '').trim();
        
        // We now allow shows even if init isn't "NRS" as long as they have a date and youtube link
        if (cleanDate && cleanYoutube && cleanYoutube.startsWith('http')) {
            insertStmt.run(cleanDate, cleanYoutube, cleanHost, cleanCustomTitle);
            count++;
        }
    }
});

const rowsToUpdate = lines.slice(1).map(line => parseLine(line));
transaction(rowsToUpdate);

console.log(`Stored ${count} YouTube links in show_links table.`);
db.close();
