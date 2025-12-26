const fs = require('fs');

const reportPath = process.argv[2] || 'C:/waraqa/frontend/.eslint-report.json';
const only = process.argv[3] || 'errors'; // 'errors' | 'warnings'

const text = fs.readFileSync(reportPath, 'utf8');

let index = 0;
while (index < text.length && /\s/.test(text[index])) index++;
if (text[index] !== '[') throw new Error('Report is not a JSON array');
index++;

let inString = false;
let isEscaped = false;
let depth = 0;
let objectStart = -1;

const wantedSeverity = only === 'warnings' ? 1 : 2;

function print(msg) {
  process.stdout.write(msg + '\n');
}

for (; index < text.length; index++) {
  const ch = text[index];

  if (inString) {
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (ch === '\\') {
      isEscaped = true;
      continue;
    }
    if (ch === '"') inString = false;
    continue;
  }

  if (ch === '"') {
    inString = true;
    continue;
  }

  if (objectStart === -1) {
    if (ch === '{') {
      objectStart = index;
      depth = 1;
    } else if (ch === ']') {
      break;
    }
    continue;
  }

  if (ch === '{') depth++;
  if (ch === '}') depth--;

  if (depth === 0) {
    const objStr = text.slice(objectStart, index + 1);
    const obj = JSON.parse(objStr);
    const msgs = Array.isArray(obj.messages) ? obj.messages : [];

    for (const m of msgs) {
      if (m.severity !== wantedSeverity) continue;
      const where = `${obj.filePath}:${m.line}:${m.column}`;
      const rule = m.ruleId || 'none';
      const sev = m.severity;
      const message = (m.message || '').replace(/\s+/g, ' ').trim();
      print(`${sev}\t${rule}\t${where}\t${message}`);
    }

    objectStart = -1;
  }
}
