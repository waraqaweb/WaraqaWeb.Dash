import { readFileSync, writeFileSync } from 'fs';

const path = 'frontend/src/pages/dashboard/DashboardHome.jsx';
let c = readFileSync(path, 'utf8');
// U+00E2 U+20AC U+201D = â€" (mojibake for em dash U+2014)
const before = (c.match(/\u00e2\u20ac\u201d/g) || []).length;
// U+00E2 U+20AC U+2122 = â€™ (mojibake for right single quote U+2019)
const beforeApos = (c.match(/\u00e2\u20ac\u2122/g) || []).length;
c = c.split('\u00e2\u20ac\u201d').join('\u2014');
c = c.split('\u00e2\u20ac\u2122').join('\u2019');
writeFileSync(path, c, 'utf8');
console.log(`Replaced ${before} em dashes, ${beforeApos} apostrophes. Done.`);
