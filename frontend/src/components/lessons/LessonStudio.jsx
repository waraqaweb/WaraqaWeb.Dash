import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, BookOpen, Layers, StickyNote, MessageCircle, Save, Copy, X, GripVertical, ArrowUp, ArrowDown, Palette, CheckCircle, XCircle } from 'lucide-react';
import { subjects as fallbackSubjects } from '../../constants/reportTopicsConfig';
import { getSubjectsCatalogCached } from '../../services/subjectsCatalog';
import SearchSelect from '../ui/SearchSelect';
import RichTextEditor from '../ui/RichTextEditor';
import RichTextToolbar from '../ui/RichTextToolbar';

const createExplanationPart = () => ({ text: '', mediaUrl: '' });

const BLOCK_STYLE_PRESETS = [
  // Clearer, higher-contrast palette (keeps existing `value`s for backward compatibility)
  { value: 'sky', label: 'Blue', card: 'border-sky-300 bg-sky-100/70', pill: 'bg-sky-200 text-sky-900', edge: 'border-t-sky-400 border-l-sky-400' },
  { value: 'emerald', label: 'Green', card: 'border-emerald-300 bg-emerald-100/70', pill: 'bg-emerald-200 text-emerald-900', edge: 'border-t-emerald-400 border-l-emerald-400' },
  { value: 'amber', label: 'Yellow', card: 'border-amber-300 bg-amber-100/70', pill: 'bg-amber-200 text-amber-950', edge: 'border-t-amber-400 border-l-amber-400' },
  { value: 'indigo', label: 'Purple', card: 'border-indigo-300 bg-indigo-100/70', pill: 'bg-indigo-200 text-indigo-950', edge: 'border-t-indigo-400 border-l-indigo-400' },
  { value: 'rose', label: 'Pink', card: 'border-rose-300 bg-rose-100/70', pill: 'bg-rose-200 text-rose-950', edge: 'border-t-rose-400 border-l-rose-400' },
  { value: 'slate', label: 'Gray', card: 'border-slate-300 bg-slate-100/70', pill: 'bg-slate-200 text-slate-900', edge: 'border-t-slate-400 border-l-slate-400' },
  { value: 'teal', label: 'Teal', card: 'border-teal-300 bg-teal-100/70', pill: 'bg-teal-200 text-teal-950', edge: 'border-t-teal-400 border-l-teal-400' },
  { value: 'violet', label: 'Violet', card: 'border-violet-300 bg-violet-100/70', pill: 'bg-violet-200 text-violet-950', edge: 'border-t-violet-400 border-l-violet-400' },
  { value: 'lime', label: 'Lime', card: 'border-lime-300 bg-lime-100/70', pill: 'bg-lime-200 text-lime-950', edge: 'border-t-lime-400 border-l-lime-400' },
  { value: 'orange', label: 'Orange', card: 'border-orange-300 bg-orange-100/70', pill: 'bg-orange-200 text-orange-950', edge: 'border-t-orange-400 border-l-orange-400' },
  { value: 'cyan', label: 'Cyan', card: 'border-cyan-300 bg-cyan-100/70', pill: 'bg-cyan-200 text-cyan-950', edge: 'border-t-cyan-400 border-l-cyan-400' }
];

// When adding blocks without an explicit style, auto-cycle through these clearer colors.
const AUTO_BLOCK_STYLE_ORDER = ['sky', 'emerald', 'amber', 'indigo', 'rose', 'slate'];
const AUTO_BLOCK_VARIANT_ORDER = ['filled', 'edge'];

const DEFAULT_EXPLANATION_PRESETS = [
  { id: 'preset-1', title: 'Is it a Stick or a Chair?', style: 'sky' },
  { id: 'preset-2', title: 'Technical Distinction', style: 'emerald' },
  { id: 'preset-3', title: 'The Sound', style: 'amber' },
  { id: 'preset-4', title: 'Writing Workshop', style: 'indigo' },
  { id: 'preset-5', title: 'Tajweed Scholar Zone', style: 'slate' }
];

const createPresetBlock = (overrides = {}) => ({
  id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  title: 'New preset',
  style: 'sky',
  ...overrides
});

const normalizePresetBlocks = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((preset) => {
      if (!preset || typeof preset !== 'object') return null;
      return {
        id: preset.id || `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: typeof preset.title === 'string' ? preset.title : String(preset.title || ''),
        style: preset.style || 'sky'
      };
    })
    .filter(Boolean);
};

const createExplanationBlock = (overrides = {}) => ({
  id: `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  title: 'Explanation block',
  style: 'sky',
  variant: 'filled',
  content: '',
  mediaUrl: '',
  ...overrides
});

const normalizeExplanationBlocks = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map((block, index) => ({
    id: block?.id || `block-${Date.now()}-${index}`,
    title: block?.title || 'Explanation block',
    style: block?.style || 'sky',
    variant: block?.variant === 'edge' ? 'edge' : 'filled',
    content: block?.content || block?.text || '',
    mediaUrl: block?.mediaUrl || ''
  }));
};

const normalizeExplanationParts = (value) => {
  if (Array.isArray(value)) {
    return value.map((part) => ({
      text: part?.text || '',
      mediaUrl: part?.mediaUrl || ''
    }));
  }
  if (typeof value === 'string' && value.trim()) {
    return [{ text: value, mediaUrl: '' }];
  }
  if (value && typeof value === 'object') {
    return [{ text: value.text || '', mediaUrl: value.mediaUrl || '' }];
  }
  return [createExplanationPart()];
};

const defaultExplanation = () => ({
  adults: {
    beginner: [createExplanationPart()],
    advanced: [createExplanationPart()]
  },
  kids: {
    beginner: [createExplanationPart()],
    advanced: [createExplanationPart()]
  }
});

const defaultSection = (index) => ({
  id: `section-${Date.now()}-${index}`,
  title: `Section ${index + 1}`,
  definition: '',
  explanation: defaultExplanation(),
  explanationBlocksStandard: [
    createExplanationBlock({ title: 'Is it a Stick or a Chair?', style: 'sky' }),
    createExplanationBlock({ title: 'Technical Distinction', style: 'emerald' })
  ],
  explanationBlocksKids: [
    createExplanationBlock({ title: 'Is it a Stick or a Chair?', style: 'sky' }),
    createExplanationBlock({ title: 'Technical Distinction', style: 'emerald' })
  ],
  examples: [''],
  notes: [''],
  questions: [{
    type: 'multiple-choice',
    prompt: '',
    options: [''],
    answerIndex: 0,
    answerText: '',
    isCorrect: true,
    note: '',
    mediaUrl: ''
  }]
});

const QUESTION_TYPES = [
  { value: 'read-letter', label: 'Read a letter/word/verse' },
  { value: 'mention', label: 'Mention something' },
  { value: 'enumerate', label: 'Enumerate things' },
  { value: 'correct-incorrect', label: 'Correct or incorrect' },
  { value: 'read-answer', label: 'Read and answer' },
  { value: 'multiple-choice', label: 'Multiple choice' },
  { value: 'write', label: 'Write something' },
  { value: 'discuss', label: 'Discuss something' },
  { value: 'complete-define', label: 'Complete or define' },
  { value: 'convert', label: 'Convert sentence (singular/dual/plural/etc.)' },
  { value: 'sentence-from-words', label: 'Make a sentence from given words' },
  { value: 'recognize-letter', label: 'Recognize letters by sound' },
  { value: 'compare-letters', label: 'Compare two letters in shape' },
  { value: 'letter-shapes', label: 'Recognize letter shapes (begin/middle/end)' },
  { value: 'connect-words', label: 'Connect two words together' },
  { value: 'silent-voiced', label: 'Recognize silent vs articulated/voiced' }
];

const normalizeStudioSections = (inputSections) => {
  const nextSections = Array.isArray(inputSections) && inputSections.length
    ? inputSections
    : [defaultSection(0)];

  return nextSections.map((section, idx) => {
    const explanation = section?.explanation || defaultExplanation();
    const normalizedBlocks = normalizeExplanationBlocks(section?.explanationBlocks);
    const standardBlocks = normalizeExplanationBlocks(section?.explanationBlocksStandard || section?.explanationBlocks);
    const kidsBlocksRaw = normalizeExplanationBlocks(section?.explanationBlocksKids);
    const legacyParts = [
      { label: 'Adults - Beginner', parts: explanation?.adults?.beginner, style: 'sky' },
      { label: 'Adults - Advanced', parts: explanation?.adults?.advanced, style: 'indigo' },
      { label: 'Kids - Beginner', parts: explanation?.kids?.beginner, style: 'emerald' },
      { label: 'Kids - Advanced', parts: explanation?.kids?.advanced, style: 'rose' }
    ];
    const legacyBlocks = legacyParts.flatMap((item) => {
      const parts = normalizeExplanationParts(item.parts);
      return parts.map((part, partIndex) =>
        createExplanationBlock({
          title: parts.length > 1 ? `${item.label} ${partIndex + 1}` : item.label,
          style: item.style,
          content: part?.text || '',
          mediaUrl: part?.mediaUrl || ''
        })
      );
    });

    return {
      ...section,
      id: section?.id || `section-${Date.now()}-${idx}`,
      explanation: {
        adults: {
          beginner: normalizeExplanationParts(explanation?.adults?.beginner),
          advanced: normalizeExplanationParts(explanation?.adults?.advanced)
        },
        kids: {
          beginner: normalizeExplanationParts(explanation?.kids?.beginner),
          advanced: normalizeExplanationParts(explanation?.kids?.advanced)
        }
      },
      explanationBlocksStandard: standardBlocks.length ? standardBlocks : (normalizedBlocks.length ? normalizedBlocks : legacyBlocks),
      explanationBlocksKids: kidsBlocksRaw.length ? kidsBlocksRaw : (standardBlocks.length ? standardBlocks : (normalizedBlocks.length ? normalizedBlocks : legacyBlocks))
    };
  });
};

const LessonStudio = ({ onSave, saving, status, onClose, title = 'Lesson Studio', initialLesson = null, draftKey = '' }) => {
  const [lessonMeta, setLessonMeta] = useState({
    subject: '',
    title: '',
    subtitle: '',
    objective: ''
  });
  const [sections, setSections] = useState([defaultSection(0)]);
  const [activeSection, setActiveSection] = useState(0);
  const [subjectOptions, setSubjectOptions] = useState(Array.isArray(fallbackSubjects) ? fallbackSubjects : []);
  const EXAMPLES_STEP = 10;
  const [examplesInputDraft, setExamplesInputDraft] = useState('');
  const [visibleExamplesCount, setVisibleExamplesCount] = useState(EXAMPLES_STEP);
  const [activeEditorRef, setActiveEditorRef] = useState(null);
  const [showStatusToast, setShowStatusToast] = useState(false);
  const [activeEditorTab, setActiveEditorTab] = useState('explanation');
  const [draggingBlockIndex, setDraggingBlockIndex] = useState(null);
  const [blockDropPreview, setBlockDropPreview] = useState(null);
  const [blockHubOpen, setBlockHubOpen] = useState(false);
  const [blockHubSubject, setBlockHubSubject] = useState('');
  const [blockHubDraft, setBlockHubDraft] = useState({});
  const [blockHubDirty, setBlockHubDirty] = useState(false);
  const [blockHubTab, setBlockHubTab] = useState('subject');
  const [presetDraft, setPresetDraft] = useState(() => normalizePresetBlocks(DEFAULT_EXPLANATION_PRESETS));
  const [presetDirty, setPresetDirty] = useState(false);
  const [audienceView, setAudienceView] = useState('standard');

  const nextAutoStyleIndexRef = useRef(0);
  const nextAutoVariantIndexRef = useRef(0);
  const getNextAutoStyle = () => {
    const order = AUTO_BLOCK_STYLE_ORDER;
    const idx = nextAutoStyleIndexRef.current % order.length;
    nextAutoStyleIndexRef.current += 1;
    return order[idx] || 'sky';
  };
  const getNextAutoVariant = () => {
    const order = AUTO_BLOCK_VARIANT_ORDER;
    const idx = nextAutoVariantIndexRef.current % order.length;
    nextAutoVariantIndexRef.current += 1;
    return order[idx] || 'filled';
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const catalog = await getSubjectsCatalogCached();
        if (cancelled) return;
        if (Array.isArray(catalog?.subjects) && catalog.subjects.length > 0) {
          setSubjectOptions(catalog.subjects);
        }
      } catch (error) {
        // fallbackSubjects already loaded
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!initialLesson) return;
    const meta = initialLesson.metadata?.lessonStudio || {};
    setLessonMeta({
      subject: meta.subject || initialLesson.subject || '',
      title: meta.title || initialLesson.displayName || '',
      subtitle: meta.subtitle || '',
      objective: meta.objective || ''
    });
    setSections(normalizeStudioSections(meta.sections));
    setActiveSection(0);
    setActiveEditorTab('explanation');
  }, [initialLesson]);

  useEffect(() => {
    if (!draftKey || initialLesson) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      if (parsed.lessonMeta && typeof parsed.lessonMeta === 'object') {
        setLessonMeta((prev) => ({
          ...prev,
          subject: parsed.lessonMeta.subject || '',
          title: parsed.lessonMeta.title || '',
          subtitle: parsed.lessonMeta.subtitle || '',
          objective: parsed.lessonMeta.objective || ''
        }));
      }
      if (Array.isArray(parsed.sections)) {
        setSections(normalizeStudioSections(parsed.sections));
      }
      if (Number.isInteger(parsed.activeSection) && parsed.activeSection >= 0) {
        setActiveSection(parsed.activeSection);
      }
      if (typeof parsed.activeEditorTab === 'string') {
        setActiveEditorTab(parsed.activeEditorTab);
      }
      if (parsed.audienceView === 'kids' || parsed.audienceView === 'standard') {
        setAudienceView(parsed.audienceView);
      }
    } catch (error) {
      // ignore storage errors
    }
  }, [draftKey, initialLesson]);

  useEffect(() => {
    if (!draftKey || initialLesson) return;
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          lessonMeta,
          sections,
          activeSection,
          activeEditorTab,
          audienceView
        })
      );
    } catch (error) {
      // ignore storage errors
    }
  }, [draftKey, initialLesson, lessonMeta, sections, activeSection, activeEditorTab, audienceView]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('lessonBlockDefaults');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          setBlockHubDraft(parsed);
        }
      }
      const storedPresets = localStorage.getItem('lessonBlockPresets');
      if (storedPresets) {
        const parsedPresets = JSON.parse(storedPresets);
        if (Array.isArray(parsedPresets)) {
          setPresetDraft(normalizePresetBlocks(parsedPresets));
        }
      }
    } catch (error) {
      // ignore storage errors
    }
  }, []);

  const current = sections[activeSection];

  const definitionStylePreset = useMemo(() => {
    const key = audienceView === 'kids' ? 'explanationBlocksKids' : 'explanationBlocksStandard';
    const first = normalizeExplanationBlocks(current?.[key] || [])[0];
    const styleValue = first?.style || 'sky';
    return BLOCK_STYLE_PRESETS.find((preset) => preset.value === styleValue) || BLOCK_STYLE_PRESETS[0];
  }, [current, audienceView]);

  const getAudienceBlocksKey = () => (audienceView === 'kids' ? 'explanationBlocksKids' : 'explanationBlocksStandard');

  const updateSection = (patch) => {
    setSections((prev) => prev.map((section, idx) => (idx === activeSection ? { ...section, ...patch } : section)));
  };

  const updateExplanationBlock = (index, patch) => {
    setSections((prev) =>
      prev.map((section, idx) => {
        if (idx !== activeSection) return section;
        const key = getAudienceBlocksKey();
        const blocks = normalizeExplanationBlocks(section[key]);
        const next = blocks.map((block, blockIdx) => (blockIdx === index ? { ...block, ...patch } : block));
        return { ...section, [key]: next };
      })
    );
  };

  const addExplanationBlock = (overrides = {}) => {
    const resolvedOverrides = {
      ...overrides,
      style: overrides?.style || getNextAutoStyle(),
      variant: overrides?.variant || getNextAutoVariant(),
    };
    setSections((prev) =>
      prev.map((section, idx) => {
        if (idx !== activeSection) return section;
        const key = getAudienceBlocksKey();
        const blocks = normalizeExplanationBlocks(section[key]);
        return { ...section, [key]: [...blocks, createExplanationBlock(resolvedOverrides)] };
      })
    );
  };

  const saveBlockHub = () => {
    try {
      localStorage.setItem('lessonBlockDefaults', JSON.stringify(blockHubDraft));
    } catch (error) {
      // ignore storage errors
    }
    setBlockHubDirty(false);
  };

  const savePresets = () => {
    try {
      localStorage.setItem('lessonBlockPresets', JSON.stringify(presetDraft));
    } catch (error) {
      // ignore storage errors
    }
    setPresetDirty(false);
  };

  const getSubjectDefaults = (subject) => {
    if (!subject) return [];
    const value = blockHubDraft?.[subject];
    return normalizeExplanationBlocks(value);
  };

  const applySubjectDefaults = (mode = 'replace') => {
    const defaults = getSubjectDefaults(lessonMeta.subject);
    if (!defaults.length) return;
    setSections((prev) =>
      prev.map((section, idx) => {
        if (idx !== activeSection) return section;
        const key = getAudienceBlocksKey();
        const existing = normalizeExplanationBlocks(section[key]);
        const nextBlocks = mode === 'append' ? [...existing, ...defaults] : defaults;
        return { ...section, [key]: nextBlocks };
      })
    );
  };

  const removeExplanationBlock = (index) => {
    setSections((prev) =>
      prev.map((section, idx) => {
        if (idx !== activeSection) return section;
        const key = getAudienceBlocksKey();
        const blocks = normalizeExplanationBlocks(section[key]);
        if (blocks.length <= 1) return section;
        return { ...section, [key]: blocks.filter((_, blockIdx) => blockIdx !== index) };
      })
    );
  };

  const moveExplanationBlock = (fromIndex, toIndex) => {
    setSections((prev) =>
      prev.map((section, idx) => {
        if (idx !== activeSection) return section;
        const key = getAudienceBlocksKey();
        const blocks = normalizeExplanationBlocks(section[key]);
        if (fromIndex < 0 || toIndex < 0 || fromIndex >= blocks.length || toIndex > blocks.length) {
          return section;
        }
        const next = [...blocks];
        const [moved] = next.splice(fromIndex, 1);
        const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
        if (insertAt === fromIndex) return section;
        next.splice(insertAt, 0, moved);
        return { ...section, [key]: next };
      })
    );
  };

  const setExplanationParts = (audience, level, parts) => {
    setSections((prev) =>
      prev.map((section, idx) => {
        if (idx !== activeSection) return section;
        return {
          ...section,
          explanation: {
            ...section.explanation,
            [audience]: {
              ...section.explanation[audience],
              [level]: parts
            }
          }
        };
      })
    );
  };

  const updateExplanationPart = (audience, level, index, field, value) => {
    setSections((prev) =>
      prev.map((section, idx) => {
        if (idx !== activeSection) return section;
        const currentParts = normalizeExplanationParts(section.explanation?.[audience]?.[level]);
        const nextParts = currentParts.map((part, partIdx) =>
          partIdx === index ? { ...part, [field]: value } : part
        );
        return {
          ...section,
          explanation: {
            ...section.explanation,
            [audience]: {
              ...section.explanation[audience],
              [level]: nextParts
            }
          }
        };
      })
    );
  };

  const addExplanationPart = (audience, level) => {
    setSections((prev) =>
      prev.map((section, idx) => {
        if (idx !== activeSection) return section;
        const currentParts = normalizeExplanationParts(section.explanation?.[audience]?.[level]);
        return {
          ...section,
          explanation: {
            ...section.explanation,
            [audience]: {
              ...section.explanation[audience],
              [level]: [...currentParts, createExplanationPart()]
            }
          }
        };
      })
    );
  };

  const removeExplanationPart = (audience, level, index) => {
    setSections((prev) =>
      prev.map((section, idx) => {
        if (idx !== activeSection) return section;
        const currentParts = normalizeExplanationParts(section.explanation?.[audience]?.[level]);
        if (currentParts.length <= 1) return section;
        const nextParts = currentParts.filter((_, partIdx) => partIdx !== index);
        return {
          ...section,
          explanation: {
            ...section.explanation,
            [audience]: {
              ...section.explanation[audience],
              [level]: nextParts
            }
          }
        };
      })
    );
  };

  const updateArrayItem = (key, index, value) => {
    setSections((prev) =>
      prev.map((section, idx) => {
        if (idx !== activeSection) return section;
        const next = [...section[key]];
        next[index] = value;
        return { ...section, [key]: next };
      })
    );
  };

  const addArrayItem = (key, value) => {
    setSections((prev) =>
      prev.map((section, idx) => (idx === activeSection ? { ...section, [key]: [...section[key], value] } : section))
    );
  };

  const updateQuestion = (index, patch) => {
    setSections((prev) =>
      prev.map((section, idx) => {
        if (idx !== activeSection) return section;
        const next = [...section.questions];
        next[index] = { ...next[index], ...patch };
        return { ...section, questions: next };
      })
    );
  };


  const addQuestionOption = (qIndex) => {
    setSections((prev) =>
      prev.map((section, idx) => {
        if (idx !== activeSection) return section;
        const next = [...section.questions];
        const options = [...next[qIndex].options, ''];
        next[qIndex] = { ...next[qIndex], options };
        return { ...section, questions: next };
      })
    );
  };

  const copyExplanation = (fromAudience, fromLevel, toAudience, toLevel) => {
    const value = normalizeExplanationParts(current.explanation?.[fromAudience]?.[fromLevel]);
    setExplanationParts(toAudience, toLevel, value);
  };

  const handleMediaUpload = (file, onComplete) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onComplete?.(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
  };

  const parseExamplesFromText = (raw) =>
    raw
      .replace(/\r/g, '')
      .split(/\n|,/)
      .map((item) => item.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

  useEffect(() => {
    const currentExamples = sections?.[activeSection]?.examples || [];
    setVisibleExamplesCount(EXAMPLES_STEP);
    setExamplesInputDraft((currentExamples || []).join(', '));
  }, [activeSection]);

  useEffect(() => {
    const currentExamples = sections?.[activeSection]?.examples || [];
    setExamplesInputDraft((currentExamples || []).join(', '));
  }, [sections, activeSection]);

  useEffect(() => {
    if (!status) return;
    setShowStatusToast(true);
    const timer = setTimeout(() => setShowStatusToast(false), 3500);
    return () => clearTimeout(timer);
  }, [status]);

  const toolButtons = useMemo(
    () => [
      { label: 'Add section', icon: Plus, action: () => setSections((prev) => [...prev, defaultSection(prev.length)]) },
      { label: 'Add block', icon: Layers, action: () => addExplanationBlock() },
      { label: 'Add example', icon: BookOpen, action: () => addArrayItem('examples', '') },
      { label: 'Add note', icon: StickyNote, action: () => addArrayItem('notes', '') },
      { label: 'Add question', icon: MessageCircle, action: () => addArrayItem('questions', {
        type: 'multiple-choice',
        prompt: '',
        options: [''],
        answerIndex: 0,
        answerText: '',
        isCorrect: true,
        note: '',
        mediaUrl: ''
      }) },
      { label: 'Block hub', icon: Palette, action: () => setBlockHubOpen(true) }
    ],
    []
  );

  const isModal = Boolean(onClose);

  const autoResizeTextarea = (event) => {
    const el = event.target;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const tabStyles = {
    explanation: {
      active: 'border-indigo-600 bg-indigo-600 text-white shadow',
      idle: 'border-indigo-200 bg-indigo-50 text-indigo-700'
    },
    objectives: {
      active: 'border-amber-600 bg-amber-500 text-white shadow',
      idle: 'border-amber-200 bg-amber-50 text-amber-700'
    },
    questions: {
      active: 'border-rose-600 bg-rose-500 text-white shadow',
      idle: 'border-rose-200 bg-rose-50 text-rose-700'
    },
    examples: {
      active: 'border-emerald-600 bg-emerald-600 text-white shadow',
      idle: 'border-emerald-200 bg-emerald-50 text-emerald-700'
    }
  };

  return (
    <>
      <div className="min-h-screen bg-slate-100 text-[15px] text-foreground">
        {status && showStatusToast && (
          <div className="pointer-events-none fixed left-1/2 top-6 z-50 -translate-x-1/2">
            <div className="whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 shadow-lg">
              {status}
            </div>
          </div>
        )}
        <div className={`${isModal ? 'max-w-none px-5 py-5' : 'mx-auto max-w-7xl px-6 py-8'}`}>
        <div className={`${isModal ? 'mb-6' : 'mb-8'} flex items-start justify-between gap-4`}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">{title}</p>
            <h1 className="text-3xl font-bold text-foreground">Teaching platform</h1>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-foreground"
            >
              Close
            </button>
          )}
        </div>

        <div className="sticky top-4 z-20">
          <RichTextToolbar activeRef={activeEditorRef} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr,64px]">
          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid gap-3 lg:grid-cols-3">
                <label className="text-sm">
                  <span className="text-muted-foreground">Subject</span>
                  <div className="mt-1">
                    <SearchSelect
                      value={lessonMeta.subject}
                      onChange={(opt) => setLessonMeta((prev) => ({ ...prev, subject: opt?.label || '' }))}
                      fetchOptions={async (term = '') => {
                        const q = String(term || '').toLowerCase();
                        return (subjectOptions || [])
                          .filter((s) => !q || String(s).toLowerCase().includes(q))
                          .slice(0, 200)
                          .map((s) => ({ id: s, label: s }));
                      }}
                      fetchById={async (id) => (id ? { id, label: id } : null)}
                      placeholder="Select a subject"
                      allowCustom
                    />
                  </div>
                </label>
                <label className="text-sm">
                  <span className="text-muted-foreground">Lesson title</span>
                  <textarea
                    className="mt-1 w-full resize-none rounded-xl border border-slate-300 bg-background px-3 py-2 text-sm leading-6"
                    rows={1}
                    value={lessonMeta.title}
                    onChange={(event) => setLessonMeta((prev) => ({ ...prev, title: event.target.value }))}
                    onInput={autoResizeTextarea}
                    placeholder="Noon Sakinah Foundations"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-muted-foreground">Subtitle</span>
                  <textarea
                    className="mt-1 w-full resize-none rounded-xl border border-slate-300 bg-background px-3 py-2 text-sm leading-6"
                    rows={1}
                    value={lessonMeta.subtitle}
                    onChange={(event) => setLessonMeta((prev) => ({ ...prev, subtitle: event.target.value }))}
                    onInput={autoResizeTextarea}
                    placeholder="Pronunciation clarity and rules"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Sections</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {sections.map((section, idx) => (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setActiveSection(idx)}
                      className={`rounded-full border px-3 py-1 text-sm font-semibold ${
                        idx === activeSection
                          ? 'border-slate-600 bg-slate-100 text-slate-900'
                          : 'border-border text-muted-foreground'
                      }`}
                    >
                      {section.title}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <input
                  className="w-full border-b border-slate-400 bg-transparent px-1 py-2 text-lg font-semibold text-foreground outline-none"
                  value={current?.title || ''}
                  onChange={(event) => updateSection({ title: event.target.value })}
                  placeholder="Section title"
                />
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  {['explanation', 'objectives', 'questions', 'examples'].map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveEditorTab(tab)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                        activeEditorTab === tab ? tabStyles[tab].active : tabStyles[tab].idle
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Audience</span>
                  <div className="inline-flex rounded-full border border-slate-200 bg-white p-1">
                    <button
                      type="button"
                      onClick={() => setAudienceView('standard')}
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                        audienceView === 'standard'
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      Standard
                    </button>
                    <button
                      type="button"
                      onClick={() => setAudienceView('kids')}
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                        audienceView === 'kids'
                          ? 'bg-sky-600 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      Kid
                    </button>
                  </div>
                </div>
              </div>

              {activeEditorTab === 'objectives' && (
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                      <StickyNote className="h-4 w-4 text-amber-600" />
                      Lesson objectives
                    </div>
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-700">Learner goals</span>
                  </div>
                  <div className="mt-3">
                    <RichTextEditor
                      value={lessonMeta.objective}
                      onChange={(value) => setLessonMeta((prev) => ({ ...prev, objective: value }))}
                      minHeight={160}
                      showToolbar={false}
                      onFocus={setActiveEditorRef}
                    />
                  </div>
                </div>
              )}

              {activeEditorTab === 'explanation' && (
                <div className="mt-5 space-y-4">
                  <div className={`rounded-2xl border border-slate-200 bg-white p-4 border-t-4 border-l-4 ${definitionStylePreset.edge || ''}`}>
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="text-xs font-semibold uppercase text-slate-500">Definition</span>
                    </div>
                    <div className="mt-2">
                      <RichTextEditor
                        value={current?.definition || ''}
                        onChange={(value) => updateSection({ definition: value })}
                        minHeight={90}
                        compact
                        showToolbar={false}
                        onFocus={setActiveEditorRef}
                        placeholder="Add a short definition (optional)"
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <Layers className="h-4 w-4 text-slate-500" />
                        Explanation blocks
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => addExplanationBlock()}
                          className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700"
                        >
                          <Plus className="h-3 w-3" />
                          Add block
                        </button>
                        <button
                          type="button"
                          onClick={() => applySubjectDefaults('replace')}
                          className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-700"
                          disabled={!lessonMeta.subject}
                          title={lessonMeta.subject ? 'Apply defaults for selected subject' : 'Select a subject first'}
                        >
                          <Palette className="h-3 w-3" />
                          Apply defaults
                        </button>
                        {presetDraft.map((preset) => (
                          <button
                            key={preset.id || preset.title}
                            type="button"
                            onClick={() => addExplanationBlock({ title: preset.title, style: preset.style })}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold text-slate-500"
                          >
                            {preset.title}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 space-y-4">
                      {normalizeExplanationBlocks(audienceView === 'kids' ? current?.explanationBlocksKids : current?.explanationBlocksStandard).map((block, idx) => {
                        const stylePreset = BLOCK_STYLE_PRESETS.find((preset) => preset.value === block.style) || BLOCK_STYLE_PRESETS[0];
                        const blockShellClass = block.variant === 'edge'
                          ? `bg-white border border-slate-200 border-t-4 border-l-4 ${stylePreset.edge || ''}`
                          : `border ${stylePreset.card}`;
                        const isPreviewBefore = blockDropPreview?.index === idx && blockDropPreview?.position === 'before';
                        const isPreviewAfter = blockDropPreview?.index === idx && blockDropPreview?.position === 'after';
                        return (
                          <div
                            key={block.id}
                            className={`relative rounded-2xl p-4 pt-6 ${blockShellClass}`}
                            onDragOver={(event) => {
                              event.preventDefault();
                              if (draggingBlockIndex === null) return;
                              const rect = event.currentTarget.getBoundingClientRect();
                              const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                              setBlockDropPreview({ index: idx, position });
                            }}
                            onDrop={() => {
                              if (draggingBlockIndex === null) return;
                              const position = blockDropPreview?.index === idx ? blockDropPreview.position : 'after';
                              const targetIndex = position === 'before' ? idx : idx + 1;
                              moveExplanationBlock(draggingBlockIndex, targetIndex);
                              setDraggingBlockIndex(null);
                              setBlockDropPreview(null);
                            }}
                            onDragEnd={() => {
                              setDraggingBlockIndex(null);
                              setBlockDropPreview(null);
                            }}
                          >
                            {isPreviewBefore && (
                              <div className="pointer-events-none absolute left-3 right-3 top-1 h-0.5 rounded bg-indigo-500" />
                            )}
                            {isPreviewAfter && (
                              <div className="pointer-events-none absolute left-3 right-3 bottom-1 h-0.5 rounded bg-indigo-500" />
                            )}
                            <div className="absolute left-4 top-0 -translate-y-1/2">
                              <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1 shadow-sm">
                                <button
                                  type="button"
                                  draggable
                                  onDragStart={(event) => {
                                    setDraggingBlockIndex(idx);
                                    setBlockDropPreview(null);
                                    try {
                                      event.dataTransfer.effectAllowed = 'move';
                                      event.dataTransfer.setData('text/plain', String(idx));
                                    } catch (_) {
                                      // no-op
                                    }
                                  }}
                                  onDragEnd={() => {
                                    setDraggingBlockIndex(null);
                                    setBlockDropPreview(null);
                                  }}
                                  className="cursor-grab rounded-full p-0.5 text-slate-400 hover:bg-slate-100 active:cursor-grabbing"
                                  title="Drag block"
                                >
                                  <GripVertical className="h-3.5 w-3.5" />
                                </button>
                                <input
                                  className="w-48 bg-transparent text-xs font-semibold text-slate-700 outline-none"
                                  value={block.title}
                                  onChange={(event) => updateExplanationBlock(idx, { title: event.target.value })}
                                  placeholder="Block title"
                                />
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${stylePreset.pill}`}>
                                  {stylePreset.label}
                                </span>
                              </div>
                            </div>
                            <div className="absolute right-3 top-0 -translate-y-1/2">
                              <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm">
                                <label className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                                  <Palette className="h-3 w-3" />
                                  <select
                                    className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                                    value={block.style}
                                    onChange={(event) => updateExplanationBlock(idx, { style: event.target.value })}
                                  >
                                    {BLOCK_STYLE_PRESETS.map((preset) => (
                                      <option key={preset.value} value={preset.value}>
                                        {preset.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <button
                                  type="button"
                                  onClick={() => moveExplanationBlock(idx, idx - 1)}
                                  className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600"
                                  title="Move up"
                                >
                                  <ArrowUp className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveExplanationBlock(idx, idx + 1)}
                                  className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600"
                                  title="Move down"
                                >
                                  <ArrowDown className="h-3 w-3" />
                                </button>
                                {normalizeExplanationBlocks(audienceView === 'kids' ? current?.explanationBlocksKids : current?.explanationBlocksStandard).length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeExplanationBlock(idx)}
                                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="mt-1">
                              <RichTextEditor
                                value={block.content}
                                onChange={(value) => updateExplanationBlock(idx, { content: value })}
                                minHeight={120}
                                compact
                                showToolbar={false}
                                onFocus={setActiveEditorRef}
                                placeholder="Write the explanation..."
                              />
                            </div>
                            <div className="mt-2">
                              <input
                                type="file"
                                accept="image/*,.svg"
                                className="block w-full text-[11px] text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-slate-700"
                                onChange={(event) => handleMediaUpload(event.target.files?.[0], (dataUrl) => updateExplanationBlock(idx, { mediaUrl: dataUrl }))}
                              />
                            </div>
                            {block.mediaUrl && (
                              <div className="mt-3 flex justify-center">
                                <img src={block.mediaUrl} alt="Block media" className="max-h-52 rounded-xl border border-slate-200 object-contain" />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <StickyNote className="h-4 w-4 text-slate-500" />
                      Notes
                    </div>
                    <div className="mt-3 space-y-3">
                      {current?.notes?.map((note, idx) => (
                        <div key={`note-${idx}`}>
                          <RichTextEditor
                            value={note}
                            onChange={(value) => updateArrayItem('notes', idx, value)}
                            minHeight={90}
                            compact
                            showToolbar={false}
                            onFocus={setActiveEditorRef}
                            placeholder="Note for teachers or guardians..."
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeEditorTab === 'questions' && (
                <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-rose-900">
                    <MessageCircle className="h-4 w-4 text-rose-600" />
                    Questions
                  </div>
                  <div className="mt-3 space-y-5">
                    {current?.questions?.map((question, idx) => (
                      <div key={`question-${idx}`} className="rounded-2xl border border-rose-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase text-rose-600">Question {idx + 1}</p>
                          <select
                            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
                            value={question.type}
                            onChange={(event) => updateQuestion(idx, { type: event.target.value })}
                          >
                            {QUESTION_TYPES.map((type) => (
                              <option key={type.value} value={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                          <p className="text-[11px] font-semibold uppercase text-slate-500">Prompt</p>
                          <div className="mt-2">
                            <RichTextEditor
                              value={question.prompt}
                              onChange={(value) => updateQuestion(idx, { prompt: value })}
                              minHeight={80}
                              compact
                              showToolbar={false}
                              onFocus={setActiveEditorRef}
                              placeholder="Write the question as learners will see it"
                            />
                          </div>
                        </div>

                        <div className="mt-3">
                          <input
                            type="file"
                            accept="image/*,.svg"
                            className="block w-full text-[11px] text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-rose-100 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-rose-700"
                            onChange={(event) => handleMediaUpload(event.target.files?.[0], (dataUrl) => updateQuestion(idx, { mediaUrl: dataUrl }))}
                          />
                        </div>

                        {question.type === 'multiple-choice' || question.type === 'recognize-letter' ? (
                          <div className="mt-4 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-semibold uppercase text-slate-500">Options</p>
                              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                                <span className="text-[11px] font-semibold text-emerald-700">Correct option</span>
                                <input
                                  type="number"
                                  min="1"
                                  max={question.options.length}
                                  value={question.answerIndex + 1}
                                  onChange={(event) => updateQuestion(idx, { answerIndex: Number(event.target.value) - 1 })}
                                  className="w-16 rounded-lg border border-emerald-300 bg-white px-2 py-1 text-sm font-semibold text-emerald-700"
                                />
                              </div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              {question.options.map((opt, optIdx) => (
                                <div key={`q-${idx}-opt-${optIdx}`} className="relative rounded-xl border border-slate-200 bg-white p-3">
                                  <span className="absolute -top-2 left-3 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                                    Option {optIdx + 1}
                                  </span>
                                  <RichTextEditor
                                    value={opt}
                                    onChange={(value) => {
                                      const next = [...question.options];
                                      next[optIdx] = value;
                                      updateQuestion(idx, { options: next });
                                    }}
                                    minHeight={70}
                                    compact
                                    showToolbar={false}
                                    onFocus={setActiveEditorRef}
                                    placeholder={`Option ${optIdx + 1}`}
                                  />
                                </div>
                              ))}
                            </div>
                            <button type="button" onClick={() => addQuestionOption(idx)} className="text-xs font-semibold text-slate-600">
                              + Add option
                            </button>
                          </div>
                        ) : question.type === 'correct-incorrect' ? (
                          <div className="mt-4 flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => updateQuestion(idx, { isCorrect: true })}
                              className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
                                question.isCorrect === true
                                  ? 'border-emerald-500 bg-emerald-500 text-white'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              }`}
                            >
                              <CheckCircle className="h-4 w-4" />
                              Correct
                            </button>
                            <button
                              type="button"
                              onClick={() => updateQuestion(idx, { isCorrect: false })}
                              className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
                                question.isCorrect === false
                                  ? 'border-rose-500 bg-rose-500 text-white'
                                  : 'border-rose-200 bg-rose-50 text-rose-700'
                              }`}
                            >
                              <XCircle className="h-4 w-4" />
                              Incorrect
                            </button>
                          </div>
                        ) : (
                          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                            <p className="text-[11px] font-semibold uppercase text-slate-500">Suggested answer</p>
                            <div className="mt-2">
                              <RichTextEditor
                                value={question.answerText}
                                onChange={(value) => updateQuestion(idx, { answerText: value })}
                                minHeight={80}
                                compact
                                showToolbar={false}
                                onFocus={setActiveEditorRef}
                                placeholder="Suggested answer or teacher notes"
                              />
                            </div>
                          </div>
                        )}

                        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                          <p className="text-[11px] font-semibold uppercase text-slate-500">Feedback</p>
                          <div className="mt-2">
                            <RichTextEditor
                              value={question.note}
                              onChange={(value) => updateQuestion(idx, { note: value })}
                              minHeight={80}
                              compact
                              showToolbar={false}
                              onFocus={setActiveEditorRef}
                              placeholder="Explanation or feedback"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeEditorTab === 'examples' && (
                <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                      <BookOpen className="h-4 w-4 text-emerald-600" />
                      Examples
                    </div>
                  </div>

                  <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Quick entry (comma separated)</div>
                    <textarea
                      className="mt-2 w-full rounded-lg border border-emerald-200 bg-background px-3 py-2 text-sm leading-6"
                      rows={3}
                      value={examplesInputDraft}
                      onChange={(event) => setExamplesInputDraft(event.target.value)}
                      onBlur={() => {
                        const nextExamples = parseExamplesFromText(examplesInputDraft);
                        setSections((prev) => prev.map((section, idx) => (idx === activeSection ? { ...section, examples: nextExamples } : section)));
                        setVisibleExamplesCount((prev) => Math.max(EXAMPLES_STEP, prev));
                      }}
                      placeholder="word 1, word 2, word 3"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const nextExamples = parseExamplesFromText(examplesInputDraft);
                          setSections((prev) => prev.map((section, idx) => (idx === activeSection ? { ...section, examples: nextExamples } : section)));
                        }}
                        className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-[11px] font-semibold text-emerald-700"
                      >
                        Apply list
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {(current?.examples || []).slice(0, visibleExamplesCount).map((example, idx) => {
                      const exampleIndex = idx;
                      return (
                      <div key={`example-${exampleIndex}`} className="rounded-xl border border-emerald-200 bg-white p-3">
                        <span className="text-[10px] font-semibold uppercase text-emerald-600">Example {exampleIndex + 1}</span>
                        <div className="mt-2">
                          <textarea
                            className="w-full rounded-lg border border-emerald-200 bg-background px-3 py-2 text-sm leading-6"
                            rows={3}
                            value={example}
                            onChange={(event) => updateArrayItem('examples', exampleIndex, event.target.value)}
                            placeholder="Example text..."
                          />
                        </div>
                      </div>
                    );})}
                  </div>
                  {(current?.examples?.length || 0) > visibleExamplesCount && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setVisibleExamplesCount((prev) => Math.min(prev + EXAMPLES_STEP, current?.examples?.length || 0))}
                        className="text-[11px] font-semibold text-emerald-700"
                      >
                        Show more examples
                      </button>
                      <button
                        type="button"
                        onClick={() => setVisibleExamplesCount(current?.examples?.length || EXAMPLES_STEP)}
                        className="text-[11px] font-semibold text-emerald-700"
                      >
                        Expand all
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col items-center justify-end gap-3 lg:sticky lg:bottom-6 lg:self-end">
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (typeof onSave !== 'function') return;
                  onSave({
                    ...lessonMeta,
                    sections
                  });
                }}
                className="rounded-full bg-emerald-600 p-3 text-white shadow-lg disabled:opacity-60"
                disabled={saving}
                title={saving ? 'Saving lesson' : 'Save lesson'}
              >
                <Save className="h-4 w-4" />
              </button>
              <span className="text-[10px] font-semibold text-slate-600">Save</span>
            </div>
            {toolButtons.map((tool) => {
              const Icon = tool.icon;
              return (
                <div key={tool.label} className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={tool.action}
                    className="rounded-full border border-slate-200 bg-white p-3 text-slate-600 shadow-sm hover:border-slate-300"
                    title={tool.label}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                  <span className="text-[10px] font-semibold text-slate-600">{tool.label.replace('Add ', '')}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      </div>
      {blockHubOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-4xl rounded-3xl border border-border bg-white p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Defaults hub</p>
              <h3 className="text-lg font-semibold text-foreground">Lesson block defaults by subject</h3>
            </div>
            <button
              type="button"
              onClick={() => {
                if (blockHubDirty) saveBlockHub();
                if (presetDirty) savePresets();
                setBlockHubOpen(false);
              }}
              className="rounded-full border border-border px-3 py-1 text-xs text-slate-600"
            >
              Close
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { key: 'subject', label: 'Subject defaults' },
              { key: 'presets', label: 'Preset blocks' }
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setBlockHubTab(tab.key)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                  blockHubTab === tab.key
                    ? 'border-indigo-600 bg-indigo-600 text-white shadow'
                    : 'border-slate-300 bg-slate-50 text-slate-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {blockHubTab === 'subject' && (
            <>
              <div className="mt-4 grid gap-4 md:grid-cols-[1fr,1fr]">
                <label className="text-sm">
                  <span className="text-muted-foreground">Subject</span>
                  <div className="mt-1">
                    <SearchSelect
                      value={blockHubSubject}
                      onChange={(opt) => setBlockHubSubject(opt?.label || '')}
                      fetchOptions={async (term = '') => {
                        const q = String(term || '').toLowerCase();
                        return (subjectOptions || [])
                          .filter((s) => !q || String(s).toLowerCase().includes(q))
                          .slice(0, 200)
                          .map((s) => ({ id: s, label: s }));
                      }}
                      fetchById={async (id) => (id ? { id, label: id } : null)}
                      placeholder="Select a subject"
                      allowCustom
                    />
                  </div>
                </label>
                <div className="flex items-end justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!blockHubSubject) return;
                      const defaults = blockHubDraft?.[blockHubSubject];
                      if (defaults && Array.isArray(defaults) && defaults.length) {
                        return;
                      }
                      setBlockHubDraft((prev) => ({
                        ...prev,
                        [blockHubSubject]: presetDraft.map((preset) => createExplanationBlock({ title: preset.title, style: preset.style, variant: getNextAutoVariant() }))
                      }));
                      setBlockHubDirty(true);
                    }}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600"
                    disabled={!blockHubSubject}
                  >
                    Seed from presets
                  </button>
                  <button
                    type="button"
                    onClick={saveBlockHub}
                    className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
                    disabled={!blockHubDirty}
                  >
                    Save defaults
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                {!blockHubSubject && (
                  <p className="text-sm text-slate-500">Choose a subject to manage its default explanation blocks.</p>
                )}
                {blockHubSubject && (
                  <div className="space-y-3">
                    {(normalizeExplanationBlocks(blockHubDraft?.[blockHubSubject]) || []).map((block, idx) => {
                      const stylePreset = BLOCK_STYLE_PRESETS.find((preset) => preset.value === block.style) || BLOCK_STYLE_PRESETS[0];
                      const blockShellClass = block.variant === 'edge'
                        ? `bg-white border border-slate-200 border-t-4 border-l-4 ${stylePreset.edge || ''}`
                        : `border ${stylePreset.card}`;
                      return (
                        <div key={block.id} className={`rounded-2xl p-3 ${blockShellClass}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <input
                              className="w-64 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700"
                              value={block.title}
                              onChange={(event) => {
                                const next = normalizeExplanationBlocks(blockHubDraft?.[blockHubSubject]);
                                next[idx] = { ...next[idx], title: event.target.value };
                                setBlockHubDraft((prev) => ({ ...prev, [blockHubSubject]: next }));
                                setBlockHubDirty(true);
                              }}
                              placeholder="Block title"
                            />
                            <div className="flex items-center gap-2">
                              <select
                                className="rounded-full border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600"
                                value={block.style}
                                onChange={(event) => {
                                  const next = normalizeExplanationBlocks(blockHubDraft?.[blockHubSubject]);
                                  next[idx] = { ...next[idx], style: event.target.value };
                                  setBlockHubDraft((prev) => ({ ...prev, [blockHubSubject]: next }));
                                  setBlockHubDirty(true);
                                }}
                              >
                                {BLOCK_STYLE_PRESETS.map((preset) => (
                                  <option key={preset.value} value={preset.value}>
                                    {preset.label}
                                  </option>
                                ))}
                              </select>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${stylePreset.pill}`}>
                                {stylePreset.label}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  const next = normalizeExplanationBlocks(blockHubDraft?.[blockHubSubject]).filter((_, index) => index !== idx);
                                  setBlockHubDraft((prev) => ({ ...prev, [blockHubSubject]: next }));
                                  setBlockHubDirty(true);
                                }}
                                className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-500"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        const next = normalizeExplanationBlocks(blockHubDraft?.[blockHubSubject]);
                        next.push(createExplanationBlock({ style: getNextAutoStyle(), variant: getNextAutoVariant() }));
                        setBlockHubDraft((prev) => ({ ...prev, [blockHubSubject]: next }));
                        setBlockHubDirty(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700"
                    >
                      <Plus className="h-3 w-3" />
                      Add default block
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {blockHubTab === 'presets' && (
            <>
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-700">Manage preset blocks</p>
                  <button
                    type="button"
                    onClick={savePresets}
                    className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
                    disabled={!presetDirty}
                  >
                    Save presets
                  </button>
                </div>
                <div className="mt-3 space-y-3">
                  {presetDraft.map((preset, idx) => {
                    const stylePreset = BLOCK_STYLE_PRESETS.find((item) => item.value === preset.style) || BLOCK_STYLE_PRESETS[0];
                    return (
                      <div key={preset.id || `preset-${idx}`} className="rounded-2xl border border-slate-200 bg-white p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <input
                            className="w-64 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700"
                            value={preset.title}
                            onChange={(event) => {
                              const next = [...presetDraft];
                              next[idx] = { ...next[idx], title: event.target.value };
                              setPresetDraft(next);
                              setPresetDirty(true);
                            }}
                            placeholder="Preset title"
                          />
                          <div className="flex items-center gap-2">
                            <select
                              className="rounded-full border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600"
                              value={preset.style}
                              onChange={(event) => {
                                const next = [...presetDraft];
                                next[idx] = { ...next[idx], style: event.target.value };
                                setPresetDraft(next);
                                setPresetDirty(true);
                              }}
                            >
                              {BLOCK_STYLE_PRESETS.map((item) => (
                                <option key={item.value} value={item.value}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${stylePreset.pill}`}>
                              {stylePreset.label}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const next = presetDraft.filter((_, index) => index !== idx);
                                setPresetDraft(next);
                                setPresetDirty(true);
                              }}
                              className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-500"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setPresetDraft((prev) => [...prev, createPresetBlock({ style: getNextAutoStyle() })]);
                      setPresetDirty(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700"
                  >
                    <Plus className="h-3 w-3" />
                    Add preset
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      )}
    </>
  );
};

export default LessonStudio;
