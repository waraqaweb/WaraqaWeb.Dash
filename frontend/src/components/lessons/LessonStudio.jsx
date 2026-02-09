import React, { useEffect, useMemo, useState } from 'react';
import { Plus, BookOpen, Layers, StickyNote, MessageCircle, Save, Copy, X } from 'lucide-react';
import { subjects as fallbackSubjects } from '../../constants/reportTopicsConfig';
import { getSubjectsCatalogCached } from '../../services/subjectsCatalog';
import SearchSelect from '../ui/SearchSelect';
import RichTextEditor from '../ui/RichTextEditor';
import RichTextToolbar from '../ui/RichTextToolbar';

const createExplanationPart = () => ({ text: '', mediaUrl: '' });

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

const LessonStudio = ({ onSave, saving, status, onClose, title = 'Lesson Studio', initialLesson = null }) => {
  const [lessonMeta, setLessonMeta] = useState({
    subject: '',
    title: '',
    subtitle: '',
    objective: ''
  });
  const [sections, setSections] = useState([defaultSection(0)]);
  const [activeSection, setActiveSection] = useState(0);
  const [subjectOptions, setSubjectOptions] = useState(Array.isArray(fallbackSubjects) ? fallbackSubjects : []);
  const [examplesEditorOpen, setExamplesEditorOpen] = useState(false);
  const [examplesDraft, setExamplesDraft] = useState('');
  const [activeEditorRef, setActiveEditorRef] = useState(null);
  const [showStatusToast, setShowStatusToast] = useState(false);

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
    const nextSections = Array.isArray(meta.sections) && meta.sections.length
      ? meta.sections
      : [defaultSection(0)];
    setSections(
      nextSections.map((section, idx) => {
        const explanation = section?.explanation || defaultExplanation();
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
          }
        };
      })
    );
    setActiveSection(0);
  }, [initialLesson]);

  const current = sections[activeSection];

  const updateSection = (patch) => {
    setSections((prev) => prev.map((section, idx) => (idx === activeSection ? { ...section, ...patch } : section)));
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

  const splitExamples = (raw) =>
    raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  const parseExamplesFromText = (raw) =>
    raw
      .split('\n')
      .flatMap((line) => line.split(',').map((item) => item.trim()))
      .filter(Boolean);

  const [showAllExamples, setShowAllExamples] = useState(false);

  useEffect(() => {
    setShowAllExamples(false);
  }, [activeSection]);

  useEffect(() => {
    if (!status) return;
    setShowStatusToast(true);
    const timer = setTimeout(() => setShowStatusToast(false), 3500);
    return () => clearTimeout(timer);
  }, [status]);

  const toolButtons = useMemo(
    () => [
      { label: 'Add section', icon: Plus, action: () => setSections((prev) => [...prev, defaultSection(prev.length)]) },
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
      }) }
    ],
    []
  );

  const isModal = Boolean(onClose);

  return (
    <>
      <div className="min-h-screen bg-background text-[15px] text-foreground">
        {status && showStatusToast && (
          <div className="pointer-events-none fixed left-1/2 top-6 z-50 -translate-x-1/2">
            <div className="whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 shadow-lg">
              {status}
            </div>
          </div>
        )}
        <div className={`${isModal ? 'max-w-none px-6 py-6' : 'mx-auto max-w-7xl px-6 py-8'}`}>
        <div className={`${isModal ? 'mb-6' : 'mb-8'} flex items-start justify-between gap-4`}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">{title}</p>
            <h1 className="text-3xl font-bold text-foreground">Teaching platform</h1>
            <p className="text-base text-muted-foreground">Build structured lessons with guided sections, notes, and questions.</p>
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

        <div className="grid gap-5 lg:grid-cols-[0.2fr,1fr,64px]">
          <div className="space-y-4">
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <div className="space-y-5">
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
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-base"
                    rows={2}
                    value={lessonMeta.title}
                    onChange={(event) => setLessonMeta((prev) => ({ ...prev, title: event.target.value }))}
                    placeholder="Noon Sakinah Foundations"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-muted-foreground">Subtitle</span>
                  <textarea
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-base"
                    rows={2}
                    value={lessonMeta.subtitle}
                    onChange={(event) => setLessonMeta((prev) => ({ ...prev, subtitle: event.target.value }))}
                    placeholder="Pronunciation clarity and rules"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-muted-foreground">Lesson objective</span>
                  <div className="mt-2">
                    <RichTextEditor
                      value={lessonMeta.objective}
                      onChange={(value) => setLessonMeta((prev) => ({ ...prev, objective: value }))}
                      minHeight={120}
                      showToolbar={false}
                      onFocus={setActiveEditorRef}
                    />
                  </div>
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl bg-white p-5 shadow-sm">
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
                  className="w-full border-b border-slate-300 bg-transparent px-1 py-2 text-lg font-semibold text-foreground outline-none"
                  value={current?.title || ''}
                  onChange={(event) => updateSection({ title: event.target.value })}
                  placeholder="Section title"
                />
              </div>

              <div className="mt-4 rounded-2xl bg-white p-4">
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

              <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
                <div className="space-y-4">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase text-slate-600">Adults explanation</p>
                      <button
                        type="button"
                        onClick={() => copyExplanation('adults', 'beginner', 'adults', 'advanced')}
                        className="text-[10px] text-slate-600 flex items-center gap-1"
                      >
                        <Copy className="h-3 w-3" />
                        Copy beginner → advanced
                      </button>
                    </div>
                    <div className="mt-3 space-y-3">
                      <div className="text-xs font-semibold text-slate-700">
                        <div className="flex items-center justify-between">
                          <span>Beginner</span>
                          <button
                            type="button"
                            onClick={() => addExplanationPart('adults', 'beginner')}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600"
                          >
                            <Plus className="h-3 w-3" />
                            Add part
                          </button>
                        </div>
                        <div className="mt-2 space-y-3">
                          {normalizeExplanationParts(current?.explanation?.adults?.beginner).map((part, partIndex) => (
                            <div key={`adults-beginner-${partIndex}`} className="rounded-xl border border-slate-200 bg-white/70 p-3">
                              <div className="flex items-center justify-between">
                                <p className="text-[10px] font-semibold text-slate-500">Part {partIndex + 1}</p>
                                {normalizeExplanationParts(current?.explanation?.adults?.beginner).length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeExplanationPart('adults', 'beginner', partIndex)}
                                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500"
                                  >
                                    <X className="h-3 w-3" />
                                    Remove
                                  </button>
                                )}
                              </div>
                              <div className="mt-2">
                                <RichTextEditor
                                  value={part?.text || ''}
                                  onChange={(value) => updateExplanationPart('adults', 'beginner', partIndex, 'text', value)}
                                  minHeight={120}
                                  compact
                                  showToolbar={false}
                                  onFocus={setActiveEditorRef}
                                />
                              </div>
                              <div className="mt-2">
                                <input
                                  type="file"
                                  accept="image/*,.svg"
                                  className="block w-full text-[11px] text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-slate-700"
                                  onChange={(event) => handleMediaUpload(event.target.files?.[0], (dataUrl) => updateExplanationPart('adults', 'beginner', partIndex, 'mediaUrl', dataUrl))}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="text-xs font-semibold text-slate-700">
                        <div className="flex items-center justify-between">
                          <span>Advanced</span>
                          <button
                            type="button"
                            onClick={() => addExplanationPart('adults', 'advanced')}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600"
                          >
                            <Plus className="h-3 w-3" />
                            Add part
                          </button>
                        </div>
                        <div className="mt-2 space-y-3">
                          {normalizeExplanationParts(current?.explanation?.adults?.advanced).map((part, partIndex) => (
                            <div key={`adults-advanced-${partIndex}`} className="rounded-xl border border-slate-200 bg-white/70 p-3">
                              <div className="flex items-center justify-between">
                                <p className="text-[10px] font-semibold text-slate-500">Part {partIndex + 1}</p>
                                {normalizeExplanationParts(current?.explanation?.adults?.advanced).length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeExplanationPart('adults', 'advanced', partIndex)}
                                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500"
                                  >
                                    <X className="h-3 w-3" />
                                    Remove
                                  </button>
                                )}
                              </div>
                              <div className="mt-2">
                                <RichTextEditor
                                  value={part?.text || ''}
                                  onChange={(value) => updateExplanationPart('adults', 'advanced', partIndex, 'text', value)}
                                  minHeight={120}
                                  compact
                                  showToolbar={false}
                                  onFocus={setActiveEditorRef}
                                />
                              </div>
                              <div className="mt-2">
                                <input
                                  type="file"
                                  accept="image/*,.svg"
                                  className="block w-full text-[11px] text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-slate-700"
                                  onChange={(event) => handleMediaUpload(event.target.files?.[0], (dataUrl) => updateExplanationPart('adults', 'advanced', partIndex, 'mediaUrl', dataUrl))}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase text-slate-600">Kids explanation</p>
                      <button
                        type="button"
                        onClick={() => copyExplanation('kids', 'beginner', 'kids', 'advanced')}
                        className="text-[10px] text-slate-600 flex items-center gap-1"
                      >
                        <Copy className="h-3 w-3" />
                        Copy beginner → advanced
                      </button>
                    </div>
                    <div className="mt-3 space-y-3">
                      <div className="text-xs font-semibold text-slate-700">
                        <div className="flex items-center justify-between">
                          <span>Beginner</span>
                          <button
                            type="button"
                            onClick={() => addExplanationPart('kids', 'beginner')}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600"
                          >
                            <Plus className="h-3 w-3" />
                            Add part
                          </button>
                        </div>
                        <div className="mt-2 space-y-3">
                          {normalizeExplanationParts(current?.explanation?.kids?.beginner).map((part, partIndex) => (
                            <div key={`kids-beginner-${partIndex}`} className="rounded-xl border border-slate-200 bg-white/70 p-3">
                              <div className="flex items-center justify-between">
                                <p className="text-[10px] font-semibold text-slate-500">Part {partIndex + 1}</p>
                                {normalizeExplanationParts(current?.explanation?.kids?.beginner).length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeExplanationPart('kids', 'beginner', partIndex)}
                                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500"
                                  >
                                    <X className="h-3 w-3" />
                                    Remove
                                  </button>
                                )}
                              </div>
                              <div className="mt-2">
                                <RichTextEditor
                                  value={part?.text || ''}
                                  onChange={(value) => updateExplanationPart('kids', 'beginner', partIndex, 'text', value)}
                                  minHeight={120}
                                  compact
                                  showToolbar={false}
                                  onFocus={setActiveEditorRef}
                                />
                              </div>
                              <div className="mt-2">
                                <input
                                  type="file"
                                  accept="image/*,.svg"
                                  className="block w-full text-[11px] text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-slate-700"
                                  onChange={(event) => handleMediaUpload(event.target.files?.[0], (dataUrl) => updateExplanationPart('kids', 'beginner', partIndex, 'mediaUrl', dataUrl))}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="text-xs font-semibold text-slate-700">
                        <div className="flex items-center justify-between">
                          <span>Advanced</span>
                          <button
                            type="button"
                            onClick={() => addExplanationPart('kids', 'advanced')}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600"
                          >
                            <Plus className="h-3 w-3" />
                            Add part
                          </button>
                        </div>
                        <div className="mt-2 space-y-3">
                          {normalizeExplanationParts(current?.explanation?.kids?.advanced).map((part, partIndex) => (
                            <div key={`kids-advanced-${partIndex}`} className="rounded-xl border border-slate-200 bg-white/70 p-3">
                              <div className="flex items-center justify-between">
                                <p className="text-[10px] font-semibold text-slate-500">Part {partIndex + 1}</p>
                                {normalizeExplanationParts(current?.explanation?.kids?.advanced).length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeExplanationPart('kids', 'advanced', partIndex)}
                                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500"
                                  >
                                    <X className="h-3 w-3" />
                                    Remove
                                  </button>
                                )}
                              </div>
                              <div className="mt-2">
                                <RichTextEditor
                                  value={part?.text || ''}
                                  onChange={(value) => updateExplanationPart('kids', 'advanced', partIndex, 'text', value)}
                                  minHeight={120}
                                  compact
                                  showToolbar={false}
                                  onFocus={setActiveEditorRef}
                                />
                              </div>
                              <div className="mt-2">
                                <input
                                  type="file"
                                  accept="image/*,.svg"
                                  className="block w-full text-[11px] text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-slate-700"
                                  onChange={(event) => handleMediaUpload(event.target.files?.[0], (dataUrl) => updateExplanationPart('kids', 'advanced', partIndex, 'mediaUrl', dataUrl))}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl bg-white p-4">
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

                  <div className="rounded-2xl bg-white p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <MessageCircle className="h-4 w-4 text-slate-500" />
                      Questions
                    </div>
                    <div className="mt-3 space-y-4">
                      {current?.questions?.map((question, idx) => (
                        <div key={`question-${idx}`} className="rounded-xl border border-border bg-slate-50/60 p-3">
                          <select
                            className="w-full rounded-lg border border-border bg-white px-2 py-2 text-sm"
                            value={question.type}
                            onChange={(event) => updateQuestion(idx, { type: event.target.value })}
                          >
                            {QUESTION_TYPES.map((type) => (
                              <option key={type.value} value={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                          <div className="mt-2">
                            <RichTextEditor
                              value={question.prompt}
                              onChange={(value) => updateQuestion(idx, { prompt: value })}
                              minHeight={70}
                              compact
                              showToolbar={false}
                              onFocus={setActiveEditorRef}
                              placeholder="Question prompt"
                            />
                          </div>
                          <div className="mt-2">
                            <input
                              type="file"
                              accept="image/*,.svg"
                              className="block w-full text-[11px] text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-slate-700"
                              onChange={(event) => handleMediaUpload(event.target.files?.[0], (dataUrl) => updateQuestion(idx, { mediaUrl: dataUrl }))}
                            />
                          </div>

                          {question.type === 'multiple-choice' || question.type === 'recognize-letter' ? (
                            <div className="mt-2 space-y-2">
                              {question.options.map((opt, optIdx) => (
                                <div key={`q-${idx}-opt-${optIdx}`}>
                                  <RichTextEditor
                                    value={opt}
                                    onChange={(value) => {
                                      const next = [...question.options];
                                      next[optIdx] = value;
                                      updateQuestion(idx, { options: next });
                                    }}
                                    minHeight={60}
                                    compact
                                    showToolbar={false}
                                    onFocus={setActiveEditorRef}
                                    placeholder={`Option ${optIdx + 1}`}
                                  />
                                </div>
                              ))}
                              <button type="button" onClick={() => addQuestionOption(idx)} className="text-[10px] text-slate-600">
                                + Add option
                              </button>
                              <label className="flex items-center gap-1 text-[10px] text-slate-600">
                                Correct
                                <input
                                  type="number"
                                  min="1"
                                  max={question.options.length}
                                  value={question.answerIndex + 1}
                                  onChange={(event) => updateQuestion(idx, { answerIndex: Number(event.target.value) - 1 })}
                                  className="w-10 rounded border border-border px-1"
                                />
                              </label>
                            </div>
                          ) : question.type === 'correct-incorrect' ? (
                            <div className="mt-2 flex items-center gap-2 text-xs">
                              <label className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  checked={question.isCorrect === true}
                                  onChange={() => updateQuestion(idx, { isCorrect: true })}
                                />
                                Correct
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  checked={question.isCorrect === false}
                                  onChange={() => updateQuestion(idx, { isCorrect: false })}
                                />
                                Incorrect
                              </label>
                            </div>
                          ) : (
                            <div className="mt-2">
                              <RichTextEditor
                                value={question.answerText}
                                onChange={(value) => updateQuestion(idx, { answerText: value })}
                                minHeight={70}
                                compact
                                showToolbar={false}
                                onFocus={setActiveEditorRef}
                                placeholder="Suggested answer or teacher notes"
                              />
                            </div>
                          )}

                          <div className="mt-2">
                            <RichTextEditor
                              value={question.note}
                              onChange={(value) => updateQuestion(idx, { note: value })}
                              minHeight={70}
                              compact
                              showToolbar={false}
                              onFocus={setActiveEditorRef}
                              placeholder="Explanation or feedback"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <BookOpen className="h-4 w-4 text-slate-500" />
                        Examples
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setExamplesDraft((current?.examples || []).join('\n'));
                          setExamplesEditorOpen(true);
                        }}
                        className="text-[11px] text-slate-600"
                      >
                        Open editor
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {(showAllExamples ? current?.examples : (current?.examples || []).slice(0, 10))?.map((example, idx) => (
                        <div key={`example-${idx}`}>
                          <RichTextEditor
                            value={example}
                            onChange={(value) => updateArrayItem('examples', idx, value)}
                            minHeight={80}
                            compact
                            showToolbar={false}
                            onFocus={setActiveEditorRef}
                            placeholder="Example text..."
                          />
                        </div>
                      ))}
                    </div>
                    {(current?.examples?.length || 0) > 10 && (
                      <button
                        type="button"
                        onClick={() => setShowAllExamples((prev) => !prev)}
                        className="mt-2 text-[11px] text-slate-600"
                      >
                        {showAllExamples ? 'Show fewer' : 'Show more examples'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
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
                className="rounded-full bg-slate-900 p-3 text-white shadow-lg disabled:opacity-60"
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
                    className="rounded-full border border-border bg-white p-3 text-slate-600 shadow-sm hover:border-slate-300"
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
      {examplesEditorOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-5xl rounded-3xl border border-border bg-white p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Examples</p>
              <h3 className="text-lg font-semibold text-foreground">Manage examples</h3>
            </div>
            <button
              type="button"
              onClick={() => setExamplesEditorOpen(false)}
              className="rounded-full border border-border px-3 py-1 text-xs text-slate-600"
            >
              Close
            </button>
          </div>
          <textarea
            className="mt-4 h-80 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm"
            value={examplesDraft}
            onChange={(event) => setExamplesDraft(event.target.value)}
            placeholder="Examples..."
          />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setExamplesDraft((current?.examples || []).join('\n'));
              }}
              className="rounded-full border border-border px-4 py-2 text-xs text-slate-600"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => {
                const nextExamples = parseExamplesFromText(examplesDraft);
                setSections((prev) => prev.map((section, idx) => (idx === activeSection ? { ...section, examples: nextExamples } : section)));
                setExamplesEditorOpen(false);
              }}
              className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
            >
              Save examples
            </button>
          </div>
        </div>
      </div>
      )}
    </>
  );
};

export default LessonStudio;
