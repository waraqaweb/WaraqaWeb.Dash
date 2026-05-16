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

export const READING_LETTERS = {
  easy: {
    label: 'Easy · isolated letters in order',
    description: 'Read each letter clearly with its short fatha sound.',
    groups: [
      { id: 'a1', title: 'First group', letters: ['ا', 'ب', 'ت', 'ث'] },
      { id: 'a2', title: 'Second group', letters: ['ج', 'ح', 'خ'] },
      { id: 'a3', title: 'Third group', letters: ['د', 'ذ', 'ر', 'ز'] },
      { id: 'a4', title: 'Fourth group', letters: ['س', 'ش'] },
    ],
  },
  medium: {
    label: 'Medium · similar shapes',
    description: 'Focus on telling apart letters that look almost identical.',
    groups: [
      { id: 'm1', title: 'Dots above / below / inside', letters: ['ب', 'ت', 'ث', 'ن', 'ي'] },
      { id: 'm2', title: 'Same body, different dots', letters: ['ج', 'ح', 'خ'] },
      { id: 'm3', title: 'Same body, different dots', letters: ['د', 'ذ'] },
      { id: 'm4', title: 'Same body, different dots', letters: ['ر', 'ز'] },
      { id: 'm5', title: 'Same body, different dots', letters: ['س', 'ش'] },
      { id: 'm6', title: 'Same body, different dots', letters: ['ص', 'ض'] },
      { id: 'm7', title: 'Same body, different dots', letters: ['ط', 'ظ'] },
      { id: 'm8', title: 'Same body, different dots', letters: ['ع', 'غ'] },
      { id: 'm9', title: 'Same body, different dots', letters: ['ف', 'ق'] },
    ],
  },
  advanced: {
    label: 'Advanced · similar sounds',
    description: 'Compare letters that learners commonly confuse when pronouncing.',
    groups: [
      { id: 'p1', title: 'Heavy vs light س / ص', letters: ['س', 'ص'] },
      { id: 'p2', title: 'Heavy vs light ت / ط', letters: ['ت', 'ط'] },
      { id: 'p3', title: 'Heavy vs light د / ض', letters: ['د', 'ض'] },
      { id: 'p4', title: 'Heavy vs light ذ / ظ', letters: ['ذ', 'ظ'] },
      { id: 'p5', title: 'ح / ه', letters: ['ح', 'ه'] },
      { id: 'p6', title: 'ع / ء', letters: ['ع', 'ء'] },
      { id: 'p7', title: 'ق / ك', letters: ['ق', 'ك'] },
      { id: 'p8', title: 'ث / س / ص', letters: ['ث', 'س', 'ص'] },
    ],
  },
};

// Words progression (Noor Al-Bayan style). Each step asks the student to read
// 4–6 words; admin marks correct / partial / incorrect.
export const READING_WORDS = [
  // ─── Fatha only ────────────────────────────────────────────────────────────
  { id: 'w-3l-fatha', level: 'easy', title: '3 letters · fatha only',
    items: ['كَتَبَ', 'ذَهَبَ', 'فَتَحَ', 'رَسَمَ', 'جَلَسَ'] },
  { id: 'w-4l-fatha', level: 'easy', title: '4 letters · fatha only',
    items: ['ذَهَبَتْ', 'كَتَبَتْ', 'لَعِبَتْ', 'ضَرَبَتْ'] },
  { id: 'w-5l-fatha', level: 'easy', title: '5 letters · fatha only',
    items: ['شَجَرَةٌ → شَجَرَ', 'مَدْرَسَ', 'مَلْعَبَ'] },

  // ─── Fatha + kasra ─────────────────────────────────────────────────────────
  { id: 'w-fatha-kasra', level: 'easy', title: 'Fatha + kasra',
    items: ['كَتِفَ', 'عَلِمَ', 'سَمِعَ', 'شَرِبَ', 'لَعِبَ'] },
  // ─── Fatha + kasra + dhamma ────────────────────────────────────────────────
  { id: 'w-fatha-kasra-dhamma', level: 'medium', title: 'Fatha + kasra + dhamma',
    items: ['كَتُبَ', 'سَهُلَ', 'كَرُمَ', 'حَسُنَ'] },

  // ─── Long vowels (big alif / waw / yaa) ────────────────────────────────────
  { id: 'w-long-alif', level: 'medium', title: 'Long vowel · alif',
    items: ['قَالَ', 'بَابٌ', 'مَالٌ', 'نَامَ', 'نَارٌ'] },
  { id: 'w-long-waw', level: 'medium', title: 'Long vowel · waw',
    items: ['نُورٌ', 'يَقُولُ', 'يَكْتُبُونَ', 'مُؤْمِنُونَ'] },
  { id: 'w-long-yaa', level: 'medium', title: 'Long vowel · yaa',
    items: ['فِيلٌ', 'سَعِيدٌ', 'كَرِيمٌ', 'مُؤْمِنِينَ'] },

  // ─── Short / dagger alif (small alif / waw / yaa) ──────────────────────────
  { id: 'w-dagger', level: 'medium', title: 'Small (dagger) alif / waw / yaa',
    items: ['هَٰذَا', 'ذَٰلِكَ', 'الرَّحْمَٰنِ', 'هَٰؤُلَاءِ'] },

  // ─── Tanween ───────────────────────────────────────────────────────────────
  { id: 'w-tanween-fath', level: 'medium', title: 'Tanween · fatha',
    items: ['كِتَابًا', 'وَلَدًا', 'بَابًا', 'مَطَرًا'] },
  { id: 'w-tanween-kasr', level: 'medium', title: 'Tanween · kasra',
    items: ['كِتَابٍ', 'وَلَدٍ', 'بَابٍ', 'بَيْتٍ'] },
  { id: 'w-tanween-damm', level: 'medium', title: 'Tanween · dhamma',
    items: ['كِتَابٌ', 'وَلَدٌ', 'بَابٌ', 'بَيْتٌ'] },

  // ─── Lam shamsiyya / qamariyya ─────────────────────────────────────────────
  { id: 'w-lam-shamsi', level: 'advanced', title: 'Lām shamsiyya (silent ل, shadda on next)',
    items: ['الشَّمْسُ', 'النَّجْمُ', 'الرَّحْمَٰنُ', 'التِّينُ'] },
  { id: 'w-lam-qamari', level: 'advanced', title: 'Lām qamariyya (clear ل, sukūn)',
    items: ['الْقَمَرُ', 'الْكِتَابُ', 'الْبَيْتُ', 'الْعَالَمِينَ'] },

  // ─── Sukun ─────────────────────────────────────────────────────────────────
  { id: 'w-sukun', level: 'advanced', title: 'Sukūn',
    items: ['اكْتُبْ', 'اقْرَأْ', 'يَجْلِسْ', 'مَكْتَبْ'] },

  // ─── Shadda ────────────────────────────────────────────────────────────────
  { id: 'w-shadda', level: 'advanced', title: 'Shadda',
    items: ['مُحَمَّدٌ', 'سَلَّمَ', 'كَرَّرَ', 'حَدَّثَ'] },
  { id: 'w-shadda-tanween', level: 'advanced', title: 'Shadda + tanween',
    items: ['مَحَلٍّ', 'صَفٍّ', 'حَقًّا', 'مَرَّةً'] },

  // ─── Two words → three short → full sentence ───────────────────────────────
  { id: 'w-two-words', level: 'advanced', title: 'Two words together',
    items: ['ذَهَبَ زَيْدٌ', 'قَرَأَ الْوَلَدُ', 'فَتَحَ الْبَابَ'] },
  { id: 'w-three-words', level: 'advanced', title: 'Three short words',
    items: ['ذَهَبَ الْوَلَدُ إِلَى', 'قَرَأَ زَيْدٌ كِتَابًا'] },
  { id: 'w-full-sentence', level: 'advanced', title: 'Full short sentence',
    items: ['ذَهَبَ مُحَمَّدٌ إِلَى الْمَدْرَسَةِ مَعَ أَخِيهِ.'] },

  // ─── Silent letters ────────────────────────────────────────────────────────
  { id: 'w-silent', level: 'advanced', title: 'Silent letters',
    items: ['عَمْرٌو', 'مِائَةٌ', 'أُولَٰئِكَ', 'قَالُوا'] },

  // ─── Stopping rules ────────────────────────────────────────────────────────
  { id: 'w-stop', level: 'advanced', title: 'Stopping on different diacritics',
    items: [
      'هُوَ كَرِيمٌ → هُوَ كَرِيمْ',
      'في الْمَدْرَسَةِ → في الْمَدْرَسَهْ',
      'كَرِيمًا → كَرِيمَا',
    ],
  },
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
