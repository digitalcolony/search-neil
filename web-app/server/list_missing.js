const DB = require('better-sqlite3');
const db = new DB('transcripts.db');
const fs = require('fs');

const res = db.prepare(`
    SELECT s.date, s.file 
    FROM shows s 
    LEFT JOIN show_links l ON s.date = l.date 
    WHERE l.date IS NULL 
    ORDER BY s.date ASC
`).all();

let output = 'Shows without YouTube links:\n\n';
res.forEach(s => {
    output += `- ${s.date} [File: ${s.file}]\n`;
});

fs.writeFileSync('missing_links.txt', output);
console.log('Written to missing_links.txt');
