import React, { useEffect, useMemo, useState } from 'react';
import { Plus, MessageCircle, Save } from 'lucide-react';
import { subjects as fallbackSubjects } from '../../constants/reportTopicsConfig';
import { getSubjectsCatalogCached } from '../../services/subjectsCatalog';
import SearchSelect from '../ui/SearchSelect';
import RichTextEditor from '../ui/RichTextEditor';
import RichTextToolbar from '../ui/RichTextToolbar';

const defaultSection = (index) => ({
  id: `section-${Date.now()}-${index}`,
  title: `Section ${index + 1}`,
  questions: [{
    type: 'multiple-choice',
    prompt: '',
    options: [''],
    answerIndex: 0,
    answerText: '',
    isCorrect: true,
    note: '',
    mediaUrl: '',
    points: 1
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
  { value: 'silent-voiced', label: 'Recognize silent vs articulated/voiced' },
  { value: 'drag-drop', label: 'Drag and drop' },
  { value: 'spinner', label: 'Spinner selection' },
  { value: 'reorder', label: 'Reorder word/sentence' },
  { value: 'image-match', label: 'Image matching' },
  { value: 'dictation', label: 'Dictation' }
];

const TestStudio = ({ onSave, saving, status, onClose, title = 'Create assessment', initialTest = null }) => {
  const [testMeta, setTestMeta] = useState({
    subject: '',
    title: '',
    subtitle: '',
    instructions: ''
  });
  const [sections, setSections] = useState([defaultSection(0)]);
  const [activeSection, setActiveSection] = useState(0);
  const [subjectOptions, setSubjectOptions] = useState(Array.isArray(fallbackSubjects) ? fallbackSubjects : []);
  const [activeEditorRef, setActiveEditorRef] = useState(null);

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
    if (!initialTest) return;
    const meta = initialTest.metadata?.testStudio || {};
    setTestMeta({
      subject: meta.subject || initialTest.subject || '',
      title: meta.title || initialTest.displayName || '',
      subtitle: meta.subtitle || '',
      instructions: meta.instructions || ''
    });
    const nextSections = Array.isArray(meta.sections) && meta.sections.length
      ? meta.sections
      : [defaultSection(0)];
    setSections(nextSections);
    setActiveSection(0);
  }, [initialTest]);

  const current = sections[activeSection];

  const updateSection = (patch) => {
    setSections((prev) => prev.map((section, idx) => (idx === activeSection ? { ...section, ...patch } : section)));
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

  const addQuestion = () => {
    setSections((prev) =>
      prev.map((section, idx) => {
        if (idx !== activeSection) return section;
        return {
          ...section,
          questions: [...section.questions, {
            type: 'multiple-choice',
            prompt: '',
            options: [''],
            answerIndex: 0,
            answerText: '',
            isCorrect: true,
            note: '',
            mediaUrl: '',
            points: 1
          }]
        };
      })
    );
  };

  const handleMediaUpload = (file, onComplete) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onComplete?.(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
  };

  const isModal = Boolean(onClose);

  return (
    <div className="min-h-screen bg-background text-[15px] text-foreground">
      <div className={`${isModal ? 'max-w-none px-6 py-6' : 'mx-auto max-w-7xl px-6 py-8'}`}>
        <div className={`${isModal ? 'mb-6' : 'mb-8'} flex items-start justify-between gap-4`}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">Assessment builder</p>
            <h1 className="text-3xl font-bold text-foreground">Interactive test studio</h1>
            <p className="text-base text-muted-foreground">Create structured assessments focused on questions only.</p>
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

        <div className="grid gap-5 lg:grid-cols-[0.3fr,1fr,64px]">
          <div className="space-y-4">
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <div className="space-y-5">
                <label className="text-sm">
                  <span className="text-muted-foreground">Subject</span>
                  <div className="mt-1">
                    <SearchSelect
                      value={testMeta.subject}
                      onChange={(opt) => setTestMeta((prev) => ({ ...prev, subject: opt?.label || '' }))}
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
                  <span className="text-muted-foreground">Test title</span>
                  <textarea
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-base"
                    rows={2}
                    value={testMeta.title}
                    onChange={(event) => setTestMeta((prev) => ({ ...prev, title: event.target.value }))}
                    placeholder="Level 1 Assessment"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-muted-foreground">Subtitle</span>
                  <textarea
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-base"
                    rows={2}
                    value={testMeta.subtitle}
                    onChange={(event) => setTestMeta((prev) => ({ ...prev, subtitle: event.target.value }))}
                    placeholder="Noon Sakinah & Tanween"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-muted-foreground">Instructions</span>
                  <div className="mt-2">
                    <RichTextEditor
                      value={testMeta.instructions}
                      onChange={(value) => setTestMeta((prev) => ({ ...prev, instructions: value }))}
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

              <div className="mt-6 rounded-2xl bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <MessageCircle className="h-4 w-4 text-slate-500" />
                  Questions
                </div>
                <div className="mt-3 space-y-4">
                  {current?.questions?.map((question, idx) => (
                    <div key={`question-${idx}`} className="rounded-xl border border-border bg-slate-50/60 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="flex-1 rounded-lg border border-border bg-white px-2 py-2 text-sm"
                          value={question.type}
                          onChange={(event) => updateQuestion(idx, { type: event.target.value })}
                        >
                          {QUESTION_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                        <label className="flex items-center gap-2 text-xs text-slate-600">
                          Points
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={Number.isFinite(Number(question.points)) ? Number(question.points) : 0}
                            onChange={(event) => updateQuestion(idx, { points: Number(event.target.value) })}
                            className="w-16 rounded-md border border-border px-2 py-1 text-xs"
                          />
                        </label>
                      </div>
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
            </div>
          </div>

          <div className="flex flex-col items-center justify-end gap-3 lg:sticky lg:bottom-6 lg:self-end">
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (typeof onSave !== 'function') return;
                  onSave({
                    ...testMeta,
                    sections
                  });
                }}
                className="rounded-full bg-slate-900 p-3 text-white shadow-lg disabled:opacity-60"
                disabled={saving}
                title={saving ? 'Saving assessment' : 'Save assessment'}
              >
                <Save className="h-4 w-4" />
              </button>
              <span className="text-[10px] font-semibold text-slate-600">Save</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => setSections((prev) => [...prev, defaultSection(prev.length)])}
                className="rounded-full border border-border bg-white p-3 text-slate-600 shadow-sm hover:border-slate-300"
                title="Add section"
              >
                <Plus className="h-4 w-4" />
              </button>
              <span className="text-[10px] font-semibold text-slate-600">Section</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={addQuestion}
                className="rounded-full border border-border bg-white p-3 text-slate-600 shadow-sm hover:border-slate-300"
                title="Add question"
              >
                <MessageCircle className="h-4 w-4" />
              </button>
              <span className="text-[10px] font-semibold text-slate-600">Question</span>
            </div>
            {status && (
              <div className="whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
                {status}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TestStudio;
