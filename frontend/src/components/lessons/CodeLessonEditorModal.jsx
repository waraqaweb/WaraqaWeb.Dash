import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

const DEFAULT_FORM = {
  subject: '',
  lessonTitle: '',
  summary: '',
  format: 'full-html',
  html: '',
  css: ''
};

const FORMAT_HELP = {
  'full-html': {
    title: 'Full HTML document',
    description: 'Paste a complete HTML document (include html, head, and body tags).'
  },
  'html-css': {
    title: 'HTML + CSS (split)',
    description: 'Paste HTML body content in the HTML box and CSS rules in the CSS box.'
  },
  'react-cdn': {
    title: 'React (CDN + JSX)',
    description: 'Paste React code. Imports are supported in preview (react, react-dom/client, lucide-react).'
  }
};

const CodeLessonEditorModal = ({ open, onClose, onSubmit }) => {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const stripCodeFences = (value = '') => {
    const trimmed = value.trim();
    if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
      return trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
    }
    return value;
  };

  const normalizeGemini = () => {
    setForm((prev) => ({
      ...prev,
      html: stripCodeFences(prev.html),
      css: stripCodeFences(prev.css)
    }));
  };

  useEffect(() => {
    if (!open) return;
    setForm(DEFAULT_FORM);
    setError('');
  }, [open]);

  const helper = useMemo(() => FORMAT_HELP[form.format], [form.format]);

  if (!open) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.subject.trim()) {
      setError('Subject is required.');
      return;
    }
    if (!form.lessonTitle.trim()) {
      setError('Lesson title is required.');
      return;
    }
    if (!form.html.trim()) {
      setError('Code content is required.');
      return;
    }
    if (form.format === 'html-css' && !form.css.trim()) {
      setError('CSS content is required for split format.');
      return;
    }
    setError('');
    setSubmitting(true);
    const result = await onSubmit({
      subject: form.subject.trim(),
      lessonTitle: form.lessonTitle.trim(),
      summary: form.summary.trim(),
      format: form.format,
      html: stripCodeFences(form.html),
      css: form.format === 'html-css' || form.format === 'react-cdn' ? stripCodeFences(form.css) : ''
    });
    setSubmitting(false);
    if (result?.success) {
      onClose();
    } else {
      setError(result?.message || 'Unable to save lesson.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-4xl overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-emerald-100 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-600">New code lesson</p>
            <h2 className="text-lg font-semibold text-foreground">Create a code presentation</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-emerald-50" type="button">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>
          )}

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
            Choose React (CDN + JSX) to preview React components. Imports are supported for react, react-dom/client, and lucide-react.
            If you paste Gemini output, click “Clean Gemini output” to remove code fences.
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              <span className="text-muted-foreground">Subject</span>
              <input
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                value={form.subject}
                onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
                placeholder="e.g. HTML, CSS, JavaScript"
              />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Lesson title</span>
              <input
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                value={form.lessonTitle}
                onChange={(event) => setForm((prev) => ({ ...prev, lessonTitle: event.target.value }))}
                placeholder="e.g. Flexbox Layout Basics"
              />
            </label>
          </div>

          <label className="text-sm">
            <span className="text-muted-foreground">Summary</span>
            <textarea
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              rows={3}
              value={form.summary}
              onChange={(event) => setForm((prev) => ({ ...prev, summary: event.target.value }))}
              placeholder="Short description shown on the welcome screen."
            />
          </label>

          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm">
            <p className="font-semibold text-emerald-800">Code format</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className={`rounded-xl border px-3 py-2 ${form.format === 'full-html' ? 'border-emerald-400 bg-white' : 'border-emerald-100 bg-white/70'}`}>
                <input
                  type="radio"
                  name="format"
                  value="full-html"
                  checked={form.format === 'full-html'}
                  onChange={(event) => setForm((prev) => ({ ...prev, format: event.target.value }))}
                  className="mr-2"
                />
                <span className="font-semibold text-emerald-800">Full HTML document</span>
                <p className="text-xs text-emerald-700/80 mt-1">Include html, head, style, and body tags.</p>
              </label>
              <label className={`rounded-xl border px-3 py-2 ${form.format === 'html-css' ? 'border-emerald-400 bg-white' : 'border-emerald-100 bg-white/70'}`}>
                <input
                  type="radio"
                  name="format"
                  value="html-css"
                  checked={form.format === 'html-css'}
                  onChange={(event) => setForm((prev) => ({ ...prev, format: event.target.value }))}
                  className="mr-2"
                />
                <span className="font-semibold text-emerald-800">HTML + CSS split</span>
                <p className="text-xs text-emerald-700/80 mt-1">HTML body in one box, CSS rules in another.</p>
              </label>
              <label className={`rounded-xl border px-3 py-2 ${form.format === 'react-cdn' ? 'border-emerald-400 bg-white' : 'border-emerald-100 bg-white/70'}`}>
                <input
                  type="radio"
                  name="format"
                  value="react-cdn"
                  checked={form.format === 'react-cdn'}
                  onChange={(event) => setForm((prev) => ({ ...prev, format: event.target.value }))}
                  className="mr-2"
                />
                <span className="font-semibold text-emerald-800">React + JSX</span>
                <p className="text-xs text-emerald-700/80 mt-1">Imports supported (react, react-dom/client, lucide-react).</p>
              </label>
            </div>
            <p className="mt-3 text-xs text-emerald-700/80">{helper?.description}</p>
          </div>

          <div className="space-y-4">
            <label className="text-sm">
              <span className="text-muted-foreground">
                {form.format === 'react-cdn' ? 'React component (JSX)' : 'HTML code'}
              </span>
              <textarea
                className="mt-1 h-40 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs"
                value={form.html}
                onChange={(event) => setForm((prev) => ({ ...prev, html: event.target.value }))}
                placeholder={
                  form.format === 'react-cdn'
                    ? "function App(){return (<div className='card'>Hello</div>)}\nconst root = ReactDOM.createRoot(document.getElementById('root'));\nroot.render(<App />);"
                    : form.format === 'full-html'
                      ? '<!doctype html>\n<html>\n  <head>...</head>\n  <body>...</body>\n</html>'
                      : '<section>...</section>'
                }
              />
            </label>

            <div>
              <button
                type="button"
                onClick={normalizeGemini}
                className="rounded-full border border-emerald-200 px-4 py-2 text-[11px] font-semibold text-emerald-700"
              >
                Clean Gemini output
              </button>
            </div>

            {(form.format === 'html-css' || form.format === 'react-cdn') && (
              <label className="text-sm">
                <span className="text-muted-foreground">CSS code</span>
                <textarea
                  className="mt-1 h-32 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs"
                  value={form.css}
                  onChange={(event) => setForm((prev) => ({ ...prev, css: event.target.value }))}
                  placeholder=".card { display: flex; }"
                />
              </label>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-emerald-200 px-4 py-2 text-xs font-semibold text-emerald-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-full bg-emerald-600 px-5 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {submitting ? 'Saving...' : 'Save lesson'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CodeLessonEditorModal;
