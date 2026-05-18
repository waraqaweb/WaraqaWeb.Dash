/**
 * Evaluation content catalogue.
 *
 * All text is editable in one place. The page consumes this catalogue
 * and renders gradual difficulty progressions.
 *
 * Reading section follows the Noor Al-Bayan order:
 *   1. isolated letters (focus on similar shapes / similar sounds)
 *   2. words: 3 letters → 4 → 5 (with fatha only)
 *   3. fatha + kasra → + dhamma
 *   4. long vowels (big alif / waw / yaa) then short (small)
 *   5. tanween (fatha / kasra / dhamma)
 *   6. lam shamsiyya / qamariyya
 *   7. sukun, shadda, shadda + tanween
 *   8. two words → three short words → full sentence
 *   9. silent letters, stopping rules
 *
 * Quran passages use specific ayat ranges requested by the admin.
 * Verse text is editable here; the admin can fine-tune any reading.
 */

export const IMPORTANT_LINKS = [
  { label: 'Terms & Conditions', url: 'https://www.waraqaweb.com/terms' },
  { label: 'Pricing', url: 'https://www.waraqaweb.com/pricing' },
  { label: 'Courses', url: 'https://www.waraqaweb.com/courses' },
  { label: 'Schedule a New Evaluation', url: 'https://www.waraqaweb.com/book' },
  { label: 'Website', url: 'https://www.waraqaweb.com/' },
  { label: 'Register a Student', url: 'https://app.waraqaweb.com/dashboard/register-student' },
];

export const DEFAULT_BIO = {
  title: 'CEO at Waraqa',
  subtitle:
    "Qur'an, Arabic and Islamic Studies expert · Al-Azhar University graduate",
  paragraphs: [
    "Bachelor's degree in Islamic Studies in Foreign Languages from Al-Azhar University.",
    'Former Head of Academic Advising at leading international Islamic education institutions worldwide.',
    "Over 9 years of experience teaching Qur'an, Arabic and Islamic Studies.",
    'Waraqa has been on for 5 years, with a hand-picked team of Azhari and Ijāzah-holder teachers — professionally trained to teach learners of all ages in fluent English.',
  ],
};

// Reading · Letters — follows the Noor Al-Bayan / Al-Futūḥāt al-Rabbāniyyah
// lesson sequence. Each "group" inside a level is one ordered lesson.
//   easy   → lessons 1-7 (alphabet, fatḥah, kasrah, ḍammah, medd, tanwīn, sukūn)
//   medium → lessons 8-13 (lām qamariyya, shaddah variants, similar shapes)
//   advanced → lessons 14-19 (lām shamsiyya, stoppage rules, qalqalah, syllables)
const ARABIC_ALPHABET = [
  'ا','ب','ت','ث','ج','ح','خ','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ع','غ','ف','ق','ك','ل','م','ن','ه','و','ي',
];

export const READING_LETTERS = {
  easy: {
    label: 'Easy · Lessons 1–7 (Noor Al-Bayan)',
    description: 'Alphabet identification, then fatḥah → kasrah → ḍammah → medd → tanwīn → sukūn.',
    groups: [
      { id: 'L1-alphabet', title: '1 · Arabic alphabet (no diacritics)', note: 'Identify each letter by name.', letters: ARABIC_ALPHABET },
      { id: 'L2-fatha',    title: '2 · Alphabet · Fatḥah ( ـَ )',         note: 'Open mouth with a short "a" sound.',
        letters: ['اَ','بَ','تَ','ثَ','جَ','حَ','خَ','دَ','ذَ','رَ','زَ','سَ','شَ','صَ','ضَ','طَ','ظَ','عَ','غَ','فَ','قَ','كَ','لَ','مَ','نَ','هَ','وَ','يَ'] },
      { id: 'L3-kasra',    title: '3 · Alphabet · Kasrah ( ـِ )',          note: 'Lower jaw with short "i" sound.',
        letters: ['اِ','بِ','تِ','ثِ','جِ','حِ','خِ','دِ','ذِ','رِ','زِ','سِ','شِ','صِ','ضِ','طِ','ظِ','عِ','غِ','فِ','قِ','كِ','لِ','مِ','نِ','هِ','وِ','يِ'] },
      { id: 'L4-damma',    title: '4 · Alphabet · Ḍammah ( ـُ )',          note: 'Round lips with short "u" sound.',
        letters: ['اُ','بُ','تُ','ثُ','جُ','حُ','خُ','دُ','ذُ','رُ','زُ','سُ','شُ','صُ','ضُ','طُ','ظُ','عُ','غُ','فُ','قُ','كُ','لُ','مُ','نُ','هُ','وُ','يُ'] },
      { id: 'L5-medd',     title: '5 · Medd letters ( ا · و · ي )',         note: 'Long vowels — extend the sound for two counts.',
        letters: ['با','بو','بي','تا','تو','تي','جا','جو','جي','دا','دو','دي','را','رو','ري','سا','سو','سي'] },
      { id: 'L6-tanween',  title: '6 · Alphabet · Tanwīn ( ـً ـٍ ـٌ )',     note: 'Double diacritic at the end of a word.',
        letters: ['بًا','بٍ','بٌ','تًا','تٍ','تٌ','دًا','دٍ','دٌ','رًا','رٍ','رٌ','سًا','سٍ','سٌ'] },
      { id: 'L7-sukoon',   title: '7 · Alphabet · Sukūn ( ـْ )',            note: 'Silent — no vowel; consonant only.',
        letters: ['أَبْ','أَتْ','أَجْ','أَدْ','أَرْ','أَزْ','أَسْ','أَصْ','أَطْ','أَفْ','أَقْ','أَكْ','أَلْ','أَمْ','أَنْ','أَهْ','أَوْ','أَيْ'] },
    ],
  },
  medium: {
    label: 'Medium · Lessons 8–13',
    description: 'Lām qamariyya · stoppage · shaddah with diacritics · medd combos · similar shapes.',
    groups: [
      { id: 'L8-lam-qamari',     title: '8 · Lām Qamariyyah (voiced ل)',  note: 'The lām of "al-" is pronounced clearly.',
        letters: ['الْ','الْب','الْج','الْح','الْك','الْم','الْه','الْو','الْي'] },
      { id: 'L9-stop-sukoon',    title: '9 · Stopping with sukūn on the last letter',
        note: 'When stopping, the last letter takes sukūn.',
        letters: ['كَتَبْ','قَرَأْ','جَلَسْ','شَرِبْ','ذَهَبْ','عَلِمْ'] },
      { id: 'L10-shadda-diac',   title: '10 · Shaddah with different diacritics',
        note: 'Shaddah doubles the letter (sākin + mutaḥarrik).',
        letters: ['بَّ','بِّ','بُّ','تَّ','تِّ','تُّ','دَّ','دِّ','دُّ','رَّ','رِّ','رُّ'] },
      { id: 'L11-shadda-medd',   title: '11 · Shaddah + diacritic + medd',
        note: 'Shaddah followed by a long vowel.',
        letters: ['بَّا','بِّي','بُّو','تَّا','تِّي','تُّو','رَّا','رِّي','رُّو'] },
      { id: 'L12-similar-shape', title: '12 · Similar letters · shape & dots',
        note: 'Distinguish letters by dot count and position.',
        letters: ['ب','ت','ث','ن','ي'] },
      { id: 'L12b-similar',      title: '12 · Similar letters · same body, different dots',
        letters: ['ج','ح','خ'] },
      { id: 'L12c-similar',      title: '12 · Similar letters · د / ذ',  letters: ['د','ذ'] },
      { id: 'L12d-similar',      title: '12 · Similar letters · ر / ز',  letters: ['ر','ز'] },
      { id: 'L12e-similar',      title: '12 · Similar letters · س / ش',  letters: ['س','ش'] },
      { id: 'L12f-similar',      title: '12 · Similar letters · ص / ض',  letters: ['ص','ض'] },
      { id: 'L12g-similar',      title: '12 · Similar letters · ط / ظ',  letters: ['ط','ظ'] },
      { id: 'L12h-similar',      title: '12 · Similar letters · ع / غ',  letters: ['ع','غ'] },
      { id: 'L12i-similar',      title: '12 · Similar letters · ف / ق',  letters: ['ف','ق'] },
      { id: 'L13-lam-qamari-rev',title: '13 · Lām Qamariyyah · review',
        note: 'Sukūn on lām before any of the 14 "qamariyya" letters.',
        letters: ['الْأَرْض','الْبَيْت','الْجَنَّة','الْحَقّ','الْخَيْر','الْعِلْم','الْغَيْب','الْفَجْر','الْقَمَر','الْكِتَاب','الْمَاء','الْهُدَى','الْوَلَد','الْيَوْم'] },
    ],
  },
  advanced: {
    label: 'Advanced · Lessons 14–19',
    description: 'Lām shamsiyya · stoppage on tanwīn / circled tāʾ · shaddah + tanwīn · qalqalah · ghunnah · syllables.',
    groups: [
      { id: 'L14-lam-shamsi',      title: '14 · Lām Shamsiyyah (silent ل, shaddah on next)',
        note: 'The 14 "shamsiyya" letters absorb the lām of "al-".',
        letters: ['التَّ','الثَّ','الدَّ','الذَّ','الرَّ','الزَّ','السَّ','الشَّ','الصَّ','الضَّ','الطَّ','الظَّ','اللَّ','النَّ'] },
      { id: 'L15-stop-tanween',    title: '15 · Stopping on tanwīn & circled tāʾ ( ة )',
        note: 'Tanwīn fatḥa → alif; kasra/ḍamma tanwīn → sukūn; ة → ه sākin.',
        letters: ['كَرِيمًا → كَرِيمَا','كِتَابٍ → كِتَابْ','وَلَدٌ → وَلَدْ','مَدْرَسَةٌ → مَدْرَسَهْ','جَنَّةٍ → جَنَّهْ'] },
      { id: 'L16-shadda-tanween',  title: '16 · Shaddah with tanwīn',
        letters: ['حَقًّا','مَرَّةً','صَفٍّ','مَحَلٍّ','حَبٍّ','رَبٌّ'] },
      { id: 'L17-stop-qalqalah',   title: '17 · Stopping on qalqalah / ghunnah letters',
        note: 'Qalqalah letters (ق ط ب ج د) bounce on stop; ghunnah (م ن) hums.',
        letters: ['الْحَقّ','يَجِدْ','يَكْتُبْ','أَطْ','يَقْطَعْ','مِنْ','عَنْ','ثُمَّ','أُمّ'] },
      { id: 'L18-double-sakin',    title: '18 · Two sākin letters in a row',
        note: 'Resolved by kasra on the first or by elision.',
        letters: ['قُلِ ادْعُوا','وَلَمْ يَكُنْ','إِنِ امْرُؤٌ','أَنِ اعْبُدُوا'] },
      { id: 'L19-syllables',       title: '19 · Dividing the word into syllables',
        note: 'Open & closed syllables — CV / CVC.',
        letters: ['كَ-تَ-بَ','ذَ-هَ-بَ','مَدْ-رَ-سَة','مُعَلِّ-مٌ','مُسْ-تَ-قِيمْ'] },
    ],
  },
};

// Words progression — same lesson order as letters, but with example words
// the student must read aloud. Each entry maps to one Noor Al-Bayan lesson.
export const READING_WORDS = [
  // ── Easy · Lessons 1-7 ───────────────────────────────────────────────────
  { id: 'wL2-fatha', level: 'easy', title: 'L2 · 3-letter words · fatḥah only',
    items: ['كَتَبَ','ذَهَبَ','فَتَحَ','رَسَمَ','جَلَسَ','شَرِبَ'] },
  { id: 'wL3-kasra', level: 'easy', title: 'L3 · fatḥah + kasrah',
    items: ['كَتِفَ','عَلِمَ','سَمِعَ','شَرِبَ','لَعِبَ'] },
  { id: 'wL4-damma', level: 'easy', title: 'L4 · fatḥah + kasrah + ḍammah',
    items: ['كَتُبَ','سَهُلَ','كَرُمَ','حَسُنَ','صَدُقَ'] },
  { id: 'wL5-medd-alif', level: 'easy', title: 'L5 · medd · alif',
    items: ['قَالَ','بَابٌ → بَابَا','مَالٌ → مَالَا','نَامَ','نَارٌ → نَارَا'] },
  { id: 'wL5-medd-waw',  level: 'easy', title: 'L5 · medd · wāw',
    items: ['نُورٌ','يَقُولُ','مُؤْمِنُونَ','يَكْتُبُونَ'] },
  { id: 'wL5-medd-yaa',  level: 'easy', title: 'L5 · medd · yāʾ',
    items: ['فِيلٌ','سَعِيدٌ','كَرِيمٌ','مُؤْمِنِينَ'] },
  { id: 'wL6-tanween-f', level: 'easy', title: 'L6 · tanwīn fatḥah',
    items: ['كِتَابًا','وَلَدًا','بَابًا','مَطَرًا'] },
  { id: 'wL6-tanween-k', level: 'easy', title: 'L6 · tanwīn kasrah',
    items: ['كِتَابٍ','وَلَدٍ','بَابٍ','بَيْتٍ'] },
  { id: 'wL6-tanween-d', level: 'easy', title: 'L6 · tanwīn ḍammah',
    items: ['كِتَابٌ','وَلَدٌ','بَابٌ','بَيْتٌ'] },
  { id: 'wL7-sukoon',    level: 'easy', title: 'L7 · sukūn',
    items: ['اكْتُبْ','اقْرَأْ','يَجْلِسْ','مَكْتَبْ','يَنْصُرْ'] },

  // ── Medium · Lessons 8-13 ────────────────────────────────────────────────
  { id: 'wL8-lam-qamari',    level: 'medium', title: 'L8 · Lām Qamariyyah (voiced)',
    items: ['الْقَمَرُ','الْكِتَابُ','الْبَيْتُ','الْعَالَمِينَ','الْفَجْرُ'] },
  { id: 'wL9-stop',          level: 'medium', title: 'L9 · Stopping with sukūn',
    items: ['ذَهَبَ → ذَهَبْ','كَتَبَ → كَتَبْ','شَرِبَ → شَرِبْ','جَلَسَ → جَلَسْ'] },
  { id: 'wL10-shadda',       level: 'medium', title: 'L10 · Shaddah with different diacritics',
    items: ['مُحَمَّدٌ','سَلَّمَ','كَرَّرَ','حَدَّثَ','رَبِّ','رَبُّ'] },
  { id: 'wL11-shadda-medd',  level: 'medium', title: 'L11 · Shaddah + diacritic + medd',
    items: ['رَبَّانَا','عَلَّمْنَا','كَرَّمَا','حَدَّثُوا','مُؤَدِّبِي'] },
  { id: 'wL12-similar',      level: 'medium', title: 'L12 · Similar letters in words',
    items: ['بَتَّ / تَبَّ','ثَبَتَ / تَبِثَ','حَجَّ / جَحَدَ','ذَهَبَ / دَهَبَ','سَرَّ / صَرَّ'] },
  { id: 'wL13-lam-qamari-r', level: 'medium', title: 'L13 · Lām Qamariyyah review',
    items: ['الْأَرْضُ','الْعِلْمُ','الْحَقُّ','الْكِتَابُ','الْهُدَى','الْيَوْمُ'] },

  // ── Advanced · Lessons 14-19 ─────────────────────────────────────────────
  { id: 'wL14-lam-shamsi',    level: 'advanced', title: 'L14 · Lām Shamsiyyah (silent)',
    items: ['الشَّمْسُ','النَّجْمُ','الرَّحْمَٰنُ','التِّينُ','الزَّيْتُونُ','الصَّلَاةُ'] },
  { id: 'wL15-stop-tanween',  level: 'advanced', title: 'L15 · Stopping on tanwīn & circled tāʾ',
    items: ['كَرِيمًا → كَرِيمَا','وَلَدٍ → وَلَدْ','بَيْتٌ → بَيْتْ','مَدْرَسَةٌ → مَدْرَسَهْ','جَنَّةٍ → جَنَّهْ'] },
  { id: 'wL16-shadda-tanween',level: 'advanced', title: 'L16 · Shaddah + tanwīn',
    items: ['حَقًّا','مَرَّةً','صَفٍّ','مَحَلٍّ','حُبًّا'] },
  { id: 'wL17-stop-qalqalah', level: 'advanced', title: 'L17 · Stop on qalqalah / ghunnah',
    items: ['الْحَقّ','يَجِدْ','يَكْتُبْ','يَقْطَعْ','ثُمَّ','أُمّ','مِنْ','عَنْ'] },
  { id: 'wL18-double-sakin',  level: 'advanced', title: 'L18 · Two sākin letters in a row',
    items: ['قُلِ ادْعُوا','وَلَمْ يَكُنْ','أَنِ اعْبُدُوا','إِنِ امْرُؤٌ'] },
  { id: 'wL19-syllables',     level: 'advanced', title: 'L19 · Word divided into syllables',
    items: ['مَدْ-رَ-سَة','مُعَلِّ-مٌ','مُسْ-تَ-قِيمْ','الْ-حَمْ-دُ','رَ-بِّ الْ-عَا-لَ-مِينْ'] },
  { id: 'wL20-sentence',      level: 'advanced', title: 'Reading short sentences',
    items: ['ذَهَبَ مُحَمَّدٌ إِلَى الْمَدْرَسَةِ.','قَرَأَ الْوَلَدُ كِتَابًا.','الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ.'] },
];

// 5 Quran passages (admin requested ranges). Editable here.
export const QURAN_PASSAGES = [
  {
    id: 'baqarah-30-32',
    surah: 'سورة البقرة',
    range: 'الآيات 30 – 32',
    verses: [
      'وَإِذْ قَالَ رَبُّكَ لِلْمَلَائِكَةِ إِنِّي جَاعِلٌ فِي الْأَرْضِ خَلِيفَةً ۖ قَالُوا أَتَجْعَلُ فِيهَا مَن يُفْسِدُ فِيهَا وَيَسْفِكُ الدِّمَاءَ وَنَحْنُ نُسَبِّحُ بِحَمْدِكَ وَنُقَدِّسُ لَكَ ۖ قَالَ إِنِّي أَعْلَمُ مَا لَا تَعْلَمُونَ ﴿٣٠﴾',
      'وَعَلَّمَ آدَمَ الْأَسْمَاءَ كُلَّهَا ثُمَّ عَرَضَهُمْ عَلَى الْمَلَائِكَةِ فَقَالَ أَنبِئُونِي بِأَسْمَاءِ هَٰؤُلَاءِ إِن كُنتُمْ صَادِقِينَ ﴿٣١﴾',
      'قَالُوا سُبْحَانَكَ لَا عِلْمَ لَنَا إِلَّا مَا عَلَّمْتَنَا ۖ إِنَّكَ أَنتَ الْعَلِيمُ الْحَكِيمُ ﴿٣٢﴾',
    ],
  },
  {
    id: 'nisa-26-31',
    surah: 'سورة النساء',
    range: 'الآيات 26 – 31',
    verses: [
      'يُرِيدُ اللَّهُ لِيُبَيِّنَ لَكُمْ وَيَهْدِيَكُمْ سُنَنَ الَّذِينَ مِن قَبْلِكُمْ وَيَتُوبَ عَلَيْكُمْ ۗ وَاللَّهُ عَلِيمٌ حَكِيمٌ ﴿٢٦﴾',
      'وَاللَّهُ يُرِيدُ أَن يَتُوبَ عَلَيْكُمْ وَيُرِيدُ الَّذِينَ يَتَّبِعُونَ الشَّهَوَاتِ أَن تَمِيلُوا مَيْلًا عَظِيمًا ﴿٢٧﴾',
      'يُرِيدُ اللَّهُ أَن يُخَفِّفَ عَنكُمْ ۚ وَخُلِقَ الْإِنسَانُ ضَعِيفًا ﴿٢٨﴾',
      'يَا أَيُّهَا الَّذِينَ آمَنُوا لَا تَأْكُلُوا أَمْوَالَكُم بَيْنَكُم بِالْبَاطِلِ إِلَّا أَن تَكُونَ تِجَارَةً عَن تَرَاضٍ مِّنكُمْ ۚ وَلَا تَقْتُلُوا أَنفُسَكُمْ ۚ إِنَّ اللَّهَ كَانَ بِكُمْ رَحِيمًا ﴿٢٩﴾',
      'وَمَن يَفْعَلْ ذَٰلِكَ عُدْوَانًا وَظُلْمًا فَسَوْفَ نُصْلِيهِ نَارًا ۚ وَكَانَ ذَٰلِكَ عَلَى اللَّهِ يَسِيرًا ﴿٣٠﴾',
      'إِن تَجْتَنِبُوا كَبَائِرَ مَا تُنْهَوْنَ عَنْهُ نُكَفِّرْ عَنكُمْ سَيِّئَاتِكُمْ وَنُدْخِلْكُم مُّدْخَلًا كَرِيمًا ﴿٣١﴾',
    ],
  },
  {
    id: 'anbiya-7-15',
    surah: 'سورة الأنبياء',
    range: 'الآيات 7 – 15',
    verses: [
      'وَمَا أَرْسَلْنَا قَبْلَكَ إِلَّا رِجَالًا نُّوحِي إِلَيْهِمْ ۖ فَاسْأَلُوا أَهْلَ الذِّكْرِ إِن كُنتُمْ لَا تَعْلَمُونَ ﴿٧﴾',
      'وَمَا جَعَلْنَاهُمْ جَسَدًا لَّا يَأْكُلُونَ الطَّعَامَ وَمَا كَانُوا خَالِدِينَ ﴿٨﴾',
      'ثُمَّ صَدَقْنَاهُمُ الْوَعْدَ فَأَنجَيْنَاهُمْ وَمَن نَّشَاءُ وَأَهْلَكْنَا الْمُسْرِفِينَ ﴿٩﴾',
      'لَقَدْ أَنزَلْنَا إِلَيْكُمْ كِتَابًا فِيهِ ذِكْرُكُمْ ۖ أَفَلَا تَعْقِلُونَ ﴿١٠﴾',
      'وَكَمْ قَصَمْنَا مِن قَرْيَةٍ كَانَتْ ظَالِمَةً وَأَنشَأْنَا بَعْدَهَا قَوْمًا آخَرِينَ ﴿١١﴾',
      'فَلَمَّا أَحَسُّوا بَأْسَنَا إِذَا هُم مِّنْهَا يَرْكُضُونَ ﴿١٢﴾',
      'لَا تَرْكُضُوا وَارْجِعُوا إِلَىٰ مَا أُتْرِفْتُمْ فِيهِ وَمَسَاكِنِكُمْ لَعَلَّكُمْ تُسْأَلُونَ ﴿١٣﴾',
      'قَالُوا يَا وَيْلَنَا إِنَّا كُنَّا ظَالِمِينَ ﴿١٤﴾',
      'فَمَا زَالَت تِّلْكَ دَعْوَاهُمْ حَتَّىٰ جَعَلْنَاهُمْ حَصِيدًا خَامِدِينَ ﴿١٥﴾',
    ],
  },
  {
    id: 'abasa-1-10',
    surah: 'سورة عبس',
    range: 'الآيات 1 – 10',
    verses: [
      'عَبَسَ وَتَوَلَّىٰ ﴿١﴾',
      'أَن جَاءَهُ الْأَعْمَىٰ ﴿٢﴾',
      'وَمَا يُدْرِيكَ لَعَلَّهُ يَزَّكَّىٰ ﴿٣﴾',
      'أَوْ يَذَّكَّرُ فَتَنفَعَهُ الذِّكْرَىٰ ﴿٤﴾',
      'أَمَّا مَنِ اسْتَغْنَىٰ ﴿٥﴾',
      'فَأَنتَ لَهُ تَصَدَّىٰ ﴿٦﴾',
      'وَمَا عَلَيْكَ أَلَّا يَزَّكَّىٰ ﴿٧﴾',
      'وَأَمَّا مَن جَاءَكَ يَسْعَىٰ ﴿٨﴾',
      'وَهُوَ يَخْشَىٰ ﴿٩﴾',
      'فَأَنتَ عَنْهُ تَلَهَّىٰ ﴿١٠﴾',
    ],
  },
  {
    id: 'tariq-1-10',
    surah: 'سورة الطارق',
    range: 'الآيات 1 – 10',
    verses: [
      'وَالسَّمَاءِ وَالطَّارِقِ ﴿١﴾',
      'وَمَا أَدْرَاكَ مَا الطَّارِقُ ﴿٢﴾',
      'النَّجْمُ الثَّاقِبُ ﴿٣﴾',
      'إِن كُلُّ نَفْسٍ لَّمَّا عَلَيْهَا حَافِظٌ ﴿٤﴾',
      'فَلْيَنظُرِ الْإِنسَانُ مِمَّ خُلِقَ ﴿٥﴾',
      'خُلِقَ مِن مَّاءٍ دَافِقٍ ﴿٦﴾',
      'يَخْرُجُ مِن بَيْنِ الصُّلْبِ وَالتَّرَائِبِ ﴿٧﴾',
      'إِنَّهُ عَلَىٰ رَجْعِهِ لَقَادِرٌ ﴿٨﴾',
      'يَوْمَ تُبْلَى السَّرَائِرُ ﴿٩﴾',
      'فَمَا لَهُ مِن قُوَّةٍ وَلَا نَاصِرٍ ﴿١٠﴾',
    ],
  },
];

// Tajweed — theoretical multiple-choice (admin marks correct after the student answers)
export const TAJWEED_THEORY = [
  {
    id: 't-th-1',
    level: 'easy',
    question: 'What is the ruling of nūn sākina or tanwīn when followed by ب?',
    options: ['Idhhār', 'Idghām', 'Iqlāb', 'Ikhfāʾ'],
    correctIndex: 2,
  },
  {
    id: 't-th-2',
    level: 'easy',
    question: 'Which letters cause Idhhār Ḥalqī?',
    options: ['ي ر م ل و ن', 'ء ه ع ح غ خ', 'ب', 'the remaining 15 letters'],
    correctIndex: 1,
  },
  {
    id: 't-th-3',
    level: 'medium',
    question: 'Madd Ṭabīʿī is held for…',
    options: ['1 ḥaraka', '2 ḥarakāt', '4 ḥarakāt', '6 ḥarakāt'],
    correctIndex: 1,
  },
  {
    id: 't-th-4',
    level: 'medium',
    question: 'Madd Lāzim is held for…',
    options: ['2 ḥarakāt', '4 ḥarakāt', '6 ḥarakāt', '8 ḥarakāt'],
    correctIndex: 2,
  },
  {
    id: 't-th-5',
    level: 'medium',
    question: 'Which letters are Qalqala?',
    options: ['ق ط ب ج د', 'ح خ ع غ ه', 'ي ر م ل و ن', 'ء ه ع ح غ خ'],
    correctIndex: 0,
  },
  {
    id: 't-th-6',
    level: 'advanced',
    question: 'In “مَن يَقُولُ”, the ruling is…',
    options: ['Idhhār', 'Idghām bi-ghunna', 'Idghām bilā ghunna', 'Iqlāb'],
    correctIndex: 1,
  },
  {
    id: 't-th-7',
    level: 'advanced',
    question: 'Tafkhīm letters (always heavy) are…',
    options: [
      'خ ص ض غ ط ق ظ',
      'all 28 letters',
      'ي ر م ل و ن',
      'ء ه ع ح غ خ',
    ],
    correctIndex: 0,
  },
];

// Tajweed — practical prompts the admin listens to and assesses.
export const TAJWEED_PRACTICAL = [
  { id: 't-pr-1', level: 'easy',
    prompt: 'Read “مِن رَّبِّهِمْ” and apply the correct ruling.', expects: 'Idghām bilā ghunna (ن → ر)' },
  { id: 't-pr-2', level: 'easy',
    prompt: 'Read “أَنبَتَكُم” and apply the correct ruling.', expects: 'Iqlāb (ن → م before ب)' },
  { id: 't-pr-3', level: 'medium',
    prompt: 'Read “الضَّالِّينَ” showing Madd Lāzim correctly.', expects: 'Madd Lāzim Kalimī Muthaqqal — 6 ḥarakāt' },
  { id: 't-pr-4', level: 'medium',
    prompt: 'Read “أَحَدٌ” at a stop, applying Qalqala.', expects: 'Qalqala Kubrā on د' },
  { id: 't-pr-5', level: 'advanced',
    prompt: 'Read “الرَّحْمَٰنِ الرَّحِيمِ” — show tafkhīm of ر and the dagger alif.', expects: 'Heavy ر + madd of dagger alif (2 ḥarakāt)' },
  { id: 't-pr-6', level: 'advanced',
    prompt: 'Read “عَلَيْهِمْ غَيْرِ” — apply Idhhār correctly.', expects: 'Idhhār Ḥalqī (ن→ غ)' },
];

export const WEAKNESS_AREAS = [
  'Letter recognition (similar shapes)',
  'Letter pronunciation (heavy / light)',
  'Short vowels (fatḥa / kasra / ḍamma)',
  'Long vowels (alif / wāw / yāʾ)',
  'Tanwīn',
  'Lām shamsiyya / qamariyya',
  'Sukūn',
  'Shadda',
  'Reading fluency (two/three words & sentences)',
  'Silent letters',
  'Stopping rules',
  'Quran recitation accuracy',
  'Tajweed theory',
  'Tajweed application',
];

export const FEEDBACK_QUESTIONS = [
  { key: 'overall', label: 'Overall, how was your evaluation experience?' },
  { key: 'knowledge', label: "Did the evaluator demonstrate strong knowledge of Qur'an & Arabic?" },
  { key: 'friendliness', label: 'Did the evaluator make you feel comfortable and welcomed?' },
  { key: 'clarity', label: 'Were the next steps and your level explained clearly?' },
  { key: 'recommend', label: 'How likely are you to recommend Waraqa to a friend?' },
];

// ────────────────────────────────────────────────────────────────────────────
// Arabic Skills (separate from Qur'an reading) — grammar, vocab, reading
// comprehension, writing prompts and short speaking prompts. Each skill has
// easy / medium / advanced items so the admin can probe gradually.
// ────────────────────────────────────────────────────────────────────────────

export const ARABIC_GRAMMAR = {
  easy: [
    {
      id: 'gram.e.1',
      prompt: 'Identify the noun (الاسم) in: الْوَلَدُ يَلْعَبُ',
      options: ['الْوَلَدُ', 'يَلْعَبُ'],
      correctIndex: 0,
    },
    {
      id: 'gram.e.2',
      prompt: 'Identify the verb (الفعل) in: ذَهَبَ أَحْمَدُ إِلَى الْمَدْرَسَةِ',
      options: ['أَحْمَدُ', 'ذَهَبَ', 'الْمَدْرَسَةِ'],
      correctIndex: 1,
    },
    {
      id: 'gram.e.3',
      prompt: 'Which one is a definite noun (معرفة)?',
      options: ['كِتَابٌ', 'الْكِتَابُ', 'كِتَابٍ'],
      correctIndex: 1,
    },
    {
      id: 'gram.e.4',
      prompt: 'Identify the preposition (حرف الجر) in: ذَهَبْتُ إِلَى السُّوقِ',
      options: ['ذَهَبْتُ', 'إِلَى', 'السُّوقِ'],
      correctIndex: 1,
    },
    {
      id: 'gram.e.5',
      prompt: 'Which one is a pronoun (ضمير)?',
      options: ['كِتَابٌ', 'أَنَا', 'يَكْتُبُ'],
      correctIndex: 1,
    },
    {
      id: 'gram.e.6',
      prompt: 'Pick the dual form (مُثَنَّى) of: طَالِبٌ',
      options: ['طُلَّابٌ', 'طَالِبَانِ', 'طَالِبَةٌ'],
      correctIndex: 1,
    },
    {
      id: 'gram.e.7',
      prompt: 'Which sentence is a nominal sentence (جملة اسمية)?',
      options: ['كَتَبَ الْوَلَدُ', 'الْوَلَدُ مُجْتَهِدٌ', 'لَا تَكْذِبْ'],
      correctIndex: 1,
    },
  ],
  medium: [
    {
      id: 'gram.m.1',
      prompt: 'Identify the subject (الفاعل) in: كَتَبَ الطَّالِبُ الدَّرْسَ',
      options: ['كَتَبَ', 'الطَّالِبُ', 'الدَّرْسَ'],
      correctIndex: 1,
    },
    {
      id: 'gram.m.2',
      prompt: 'Identify the object (المفعول به) in: شَرِبَ الْوَلَدُ الْمَاءَ',
      options: ['شَرِبَ', 'الْوَلَدُ', 'الْمَاءَ'],
      correctIndex: 2,
    },
    {
      id: 'gram.m.3',
      prompt: 'What is the plural of: قَلَمٌ ?',
      options: ['أَقْلَامٌ', 'قُلُومٌ', 'قَلَمَانِ'],
      correctIndex: 0,
    },
    {
      id: 'gram.m.4',
      prompt: 'Which is a feminine noun (مؤنث)?',
      options: ['وَلَدٌ', 'بِنْتٌ', 'بَابٌ'],
      correctIndex: 1,
    },
    {
      id: 'gram.m.5',
      prompt: 'Identify the مبتدأ in: الطَّالِبُ مُجْتَهِدٌ',
      options: ['الطَّالِبُ', 'مُجْتَهِدٌ'],
      correctIndex: 0,
    },
    {
      id: 'gram.m.6',
      prompt: 'Form the past tense (الماضي) of يَكْتُبُ for "he":',
      options: ['كَتَبَ', 'يَكْتُبُ', 'اُكْتُبْ'],
      correctIndex: 0,
    },
    {
      id: 'gram.m.7',
      prompt: 'Which particle makes the verb منصوب (subjunctive)?',
      options: ['لَمْ', 'أَنْ', 'لَا النافية'],
      correctIndex: 1,
    },
    {
      id: 'gram.m.8',
      prompt: 'Identify the إضافة (genitive construction) in: كِتَابُ الطَّالِبِ جَدِيدٌ',
      options: ['كِتَابُ الطَّالِبِ', 'الطَّالِبِ جَدِيدٌ', 'كِتَابُ جَدِيدٌ'],
      correctIndex: 0,
    },
  ],
  advanced: [
    {
      id: 'gram.a.1',
      prompt: 'In: إِنَّ الطَّالِبَ مُجْتَهِدٌ — what is the case (إعراب) of الطَّالِبَ ?',
      options: ['مرفوع', 'منصوب', 'مجرور'],
      correctIndex: 1,
    },
    {
      id: 'gram.a.2',
      prompt: 'Identify the type of sentence: الْعِلْمُ نُورٌ',
      options: ['جملة فعلية', 'جملة اسمية'],
      correctIndex: 1,
    },
    {
      id: 'gram.a.3',
      prompt: 'In: لَنْ أَذْهَبَ — why is أَذْهَبَ منصوب ?',
      options: ['بسبب لن', 'بسبب لم', 'بسبب لا الناهية'],
      correctIndex: 0,
    },
    {
      id: 'gram.a.4',
      prompt: 'Form the present tense (مضارع) of: كَتَبَ for "I"',
      options: ['أَكْتُبُ', 'يَكْتُبُ', 'نَكْتُبُ'],
      correctIndex: 0,
    },
    {
      id: 'gram.a.5',
      prompt: 'Identify the حال in: جَاءَ الطَّالِبُ مُسْرِعًا',
      options: ['الطَّالِبُ', 'مُسْرِعًا', 'جَاءَ'],
      correctIndex: 1,
    },
    {
      id: 'gram.a.6',
      prompt: 'In: كَانَ الْجَوُّ جَمِيلًا — what is the إعراب of جَمِيلًا ?',
      options: ['اسم كان (مرفوع)', 'خبر كان (منصوب)', 'حال'],
      correctIndex: 1,
    },
    {
      id: 'gram.a.7',
      prompt: 'Identify the مفعول مطلق in: ضَرَبْتُهُ ضَرْبًا شَدِيدًا',
      options: ['ضَرْبًا', 'شَدِيدًا', 'ضَرَبْتُهُ'],
      correctIndex: 0,
    },
    {
      id: 'gram.a.8',
      prompt: 'Convert to passive voice (مبني للمجهول): كَتَبَ الطَّالِبُ الدَّرْسَ',
      options: ['كُتِبَ الدَّرْسُ', 'يَكْتُبُ الدَّرْسَ', 'كَاتِبٌ الدَّرْسَ'],
      correctIndex: 0,
    },
  ],
};

export const ARABIC_VOCAB = {
  easy: [
    { id: 'vocab.e.1', prompt: 'Translate: بَيْت', expected: 'House' },
    { id: 'vocab.e.2', prompt: 'Translate: مَاء', expected: 'Water' },
    { id: 'vocab.e.3', prompt: 'Translate: شَمْس', expected: 'Sun' },
    { id: 'vocab.e.4', prompt: 'Translate: كِتَاب', expected: 'Book' },
    { id: 'vocab.e.5', prompt: 'Translate: أُمّ', expected: 'Mother' },
  ],
  medium: [
    { id: 'vocab.m.1', prompt: 'Translate: مَدْرَسَة', expected: 'School' },
    { id: 'vocab.m.2', prompt: 'Translate: مُسْتَشْفَى', expected: 'Hospital' },
    { id: 'vocab.m.3', prompt: 'Translate: صَدِيق', expected: 'Friend' },
    { id: 'vocab.m.4', prompt: 'Translate: طَرِيق', expected: 'Road / way' },
    { id: 'vocab.m.5', prompt: 'Translate: سَعَادَة', expected: 'Happiness' },
  ],
  advanced: [
    { id: 'vocab.a.1', prompt: 'Translate: اِسْتِغْفَار', expected: 'Seeking forgiveness' },
    { id: 'vocab.a.2', prompt: 'Translate: تَقْوَى', expected: 'God-consciousness / piety' },
    { id: 'vocab.a.3', prompt: 'Translate: مَسْؤُولِيَّة', expected: 'Responsibility' },
    { id: 'vocab.a.4', prompt: 'Translate: حَضَارَة', expected: 'Civilisation' },
    { id: 'vocab.a.5', prompt: 'Translate: اِجْتِهَاد', expected: 'Diligence / independent reasoning' },
  ],
};

export const ARABIC_COMPREHENSION = {
  easy: [
    {
      id: 'comp.e.1',
      passage: 'ذَهَبَ أَحْمَدُ إِلَى الْمَدْرَسَةِ صَبَاحًا، وَتَعَلَّمَ دَرْسًا جَدِيدًا.',
      questions: [
        'Who went to school?',
        'When did he go?',
        'What did he do there?',
      ],
    },
  ],
  medium: [
    {
      id: 'comp.m.1',
      passage:
        'تُحِبُّ فَاطِمَةُ الْقِرَاءَةَ كَثِيرًا، وَفِي كُلِّ يَوْمٍ تَقْرَأُ كِتَابًا جَدِيدًا. تَقُولُ أُمُّهَا: "الْقِرَاءَةُ غِذَاءُ الْعَقْلِ".',
      questions: [
        'What does Fatima love?',
        'How often does she read?',
        'What did her mother say about reading?',
      ],
    },
  ],
  advanced: [
    {
      id: 'comp.a.1',
      passage:
        'الْعِلْمُ نُورٌ يَهْدِي الْإِنْسَانَ إِلَى الطَّرِيقِ الصَّحِيحِ، وَالْجَهْلُ ظَلَامٌ يُبْعِدُهُ عَنْ سَعَادَةِ الدُّنْيَا وَالْآخِرَةِ. لِذَلِكَ حَثَّ الْإِسْلَامُ عَلَى طَلَبِ الْعِلْمِ مِنَ الْمَهْدِ إِلَى اللَّحْدِ.',
      questions: [
        'What does the passage compare knowledge to?',
        'What is the consequence of ignorance, according to the passage?',
        'What duration does Islam encourage seeking knowledge for?',
      ],
    },
  ],
};

export const ARABIC_WRITING = {
  easy: [
    { id: 'write.e.1', prompt: 'Write your name in Arabic.' },
    { id: 'write.e.2', prompt: 'Write the numbers 1 to 10 in Arabic words.' },
    { id: 'write.e.3', prompt: 'Write 3 simple words you know.' },
  ],
  medium: [
    { id: 'write.m.1', prompt: 'Write a 2-sentence introduction about yourself in Arabic.' },
    { id: 'write.m.2', prompt: 'Write 3 sentences about your family.' },
    { id: 'write.m.3', prompt: 'Dictation: write what the evaluator reads aloud (a short phrase).' },
  ],
  advanced: [
    { id: 'write.a.1', prompt: 'Write a short paragraph (3–5 sentences) about your daily routine.' },
    { id: 'write.a.2', prompt: 'Write a short paragraph about a Prophet you love and why.' },
    { id: 'write.a.3', prompt: 'Dictation: write a full sentence with diacritics as the evaluator reads.' },
  ],
};

export const ARABIC_SPEAKING = {
  easy: [
    { id: 'speak.e.1', prompt: 'Introduce yourself in Arabic (name, age, country).' },
    { id: 'speak.e.2', prompt: 'Greet the evaluator using a full Islamic greeting.' },
    { id: 'speak.e.3', prompt: 'Count from 1 to 10 out loud in Arabic.' },
  ],
  medium: [
    { id: 'speak.m.1', prompt: 'Describe your family in 3–4 sentences.' },
    { id: 'speak.m.2', prompt: 'Describe your favourite food and why you like it.' },
    { id: 'speak.m.3', prompt: 'Ask the evaluator 3 questions in Arabic.' },
  ],
  advanced: [
    { id: 'speak.a.1', prompt: 'Tell a short story (3–5 sentences) about something that happened to you this week.' },
    { id: 'speak.a.2', prompt: "Explain in Arabic why you want to learn Qur'an and Arabic." },
    { id: 'speak.a.3', prompt: 'Have a 1-minute free conversation with the evaluator on any topic.' },
  ],
};

export const ARABIC_SKILLS = [
  { key: 'grammar',       label: 'Grammar (نحو)',          type: 'mcq',     content: ARABIC_GRAMMAR },
  { key: 'vocab',         label: 'Vocabulary (مفردات)',     type: 'expect',  content: ARABIC_VOCAB },
  { key: 'comprehension', label: 'Reading comprehension',   type: 'passage', content: ARABIC_COMPREHENSION },
  { key: 'writing',       label: 'Writing (كتابة)',         type: 'prompt',  content: ARABIC_WRITING },
  { key: 'speaking',      label: 'Speaking (محادثة)',       type: 'prompt',  content: ARABIC_SPEAKING },
];
