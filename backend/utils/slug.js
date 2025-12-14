function normalize(input) {
  return input
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function randomSuffix(length = 6) {
  return Math.random().toString(36).slice(2, 2 + length);
}

function slugify(value, { fallbackPrefix = 'node', maxLength = 120 } = {}) {
  if (!value) {
    return `${fallbackPrefix}-${randomSuffix()}`;
  }
  const safe = normalize(value).slice(0, maxLength);
  return safe || `${fallbackPrefix}-${randomSuffix()}`;
}

module.exports = {
  slugify
};
