const fs = require('fs');

const reportPath = process.argv[2] || 'C:/waraqa/frontend/.eslint-report.json';

const text = fs.readFileSync(reportPath, 'utf8');

let index = 0;
while (index < text.length && /\s/.test(text[index])) index++;
if (text[index] !== '[') {
  throw new Error(`Expected '[' at start, got ${JSON.stringify(text[index])}`);
}
index++;

let inString = false;
let isEscaped = false;
let depth = 0;
let objectStart = -1;

let fileCount = 0;
let errorCount = 0;
let warningCount = 0;

const ruleCounts = new Map();

function bumpRule(ruleId) {
  const key = ruleId || 'none';
  ruleCounts.set(key, (ruleCounts.get(key) || 0) + 1);
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
    if (ch === '"') {
      inString = false;
    }
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
    let obj;
    try {
      obj = JSON.parse(objStr);
    } catch (e) {
      console.error('FAILED_OBJECT_PARSE');
      console.error('start', objectStart, 'end', index);
      console.error('error', e && e.message);
      console.error('head', objStr.slice(0, 250));
      console.error('tail', objStr.slice(-250));
      process.exit(2);
    }

    fileCount += 1;
    errorCount += obj.errorCount || 0;
    warningCount += obj.warningCount || 0;
    if (Array.isArray(obj.messages)) {
      for (const msg of obj.messages) {
        bumpRule(msg.ruleId);
      }
    }

    objectStart = -1;
  }
}

console.log(JSON.stringify({ fileCount, errorCount, warningCount }));

const top = [...ruleCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
for (const [ruleId, count] of top) {
  console.log(String(count).padStart(5, ' '), ruleId);
}
