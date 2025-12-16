function hasArabicScript(text) {
  try {
    return /\p{Script=Arabic}/u.test(text);
  } catch (e) {
    // Older Node fallback (best-effort)
    return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text);
  }
}

function looksLikeUtf8Mojibake(text) {
  // Common UTF-8-as-Latin1 mojibake fragments (covers Arabic + many other scripts)
  // Examples: "Ø§Ù" (Arabic), "Ã©" (Latin accents)
  return /[ÃÂØÙÐÑ][\x80-\xBF]/.test(text) || /[ØÙ][\x80-\xBF]/.test(text) || /Ã./.test(text);
}

function normalizeUtf8FromLatin1(text) {
  if (typeof text !== 'string') return text;
  if (!text) return text;

  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  if (!looksLikeUtf8Mojibake(trimmed)) return trimmed;

  // Multer/Busboy can surface filenames in latin1 when browsers send UTF-8.
  const fixed = Buffer.from(trimmed, 'latin1').toString('utf8');

  // Only accept the "fixed" version when it meaningfully improves the string.
  // - if fixed introduces Arabic where original had none
  // - or fixed contains fewer replacement chars
  const origArabic = hasArabicScript(trimmed);
  const fixedArabic = hasArabicScript(fixed);

  if (fixedArabic && !origArabic) return fixed;

  const origReplacement = (trimmed.match(/\uFFFD/g) || []).length;
  const fixedReplacement = (fixed.match(/\uFFFD/g) || []).length;
  if (fixedReplacement < origReplacement) return fixed;

  return trimmed;
}

module.exports = {
  normalizeUtf8FromLatin1
};
