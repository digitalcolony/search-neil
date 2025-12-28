const fs = require('fs');
const path = require('path');

const csvPath = 'nrs_shows.csv';
const missingMdPath = '../../Missing.md';

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

function stringifyLine(parts) {
    return parts.map(p => {
        if (p.includes(',') || p.includes('"')) {
            return `"${p.replace(/"/g, '""')}"`;
        }
        return p;
    }).join(',');
}

let csvContent = fs.readFileSync(csvPath, 'utf8');
const missingMd = fs.readFileSync(missingMdPath, 'utf8');

const lines = csvContent.split(/\r?\n/);
let headerParts = parseLine(lines[0]);
if (headerParts[headerParts.length - 1] === '') headerParts.pop(); // Remove empty trailing
if (!headerParts.includes('Host')) {
    headerParts.push('Host');
}

const dataLines = lines.slice(1).filter(l => l.trim());
const updates = {};
const removeDate = '1989-08-26';

missingMd.split('\n').forEach(line => {
    const match = line.match(/^(\d{4}-\d{2}-\d{2}).*?=\s*(https:\/\/[^\s]+)(?:\s*\((.*?)\))?\s*$/);
    if (match) {
        const date = match[1];
        const url = match[2];
        const host = (match[3] || '').replace(/ host$/, '');
        updates[date] = { url, host };
        console.log(`Matched: ${date} -> ${url} (${host})`);
    } else if (line.trim() && !line.includes('(remove)') && !line.startsWith('.')) {
        console.log(`No match: ${line}`);
    }
});

let updatedCsvLines = dataLines.map(line => {
    const parts = parseLine(line);
    const date = parts[0];
    if (date === removeDate) return null;
    if (updates[date]) {
        parts[2] = updates[date].url;
        parts[5] = updates[date].host;
        delete updates[date];
    } else {
        if (parts.length < 6) parts[5] = '';
    }
    return stringifyLine(parts);
}).filter(l => l !== null);

// Add remaining updates
Object.keys(updates).forEach(date => {
    updatedCsvLines.push(stringifyLine([date, 'NRS', updates[date].url, '', '', updates[date].host]));
});

// Sort by date
updatedCsvLines.sort((a, b) => a.split(',')[0].localeCompare(b.split(',')[0]));

fs.writeFileSync(csvPath, [headerParts.join(','), ...updatedCsvLines].join('\n') + '\n');
console.log('CSV Updated');
