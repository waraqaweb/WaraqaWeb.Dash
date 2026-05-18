import React, { useMemo, useState } from 'react';
import { Copy, Check, X, Code2, Eye, Code } from 'lucide-react';

const CodeLessonViewer = ({ lesson, onClose }) => {
  const [copied, setCopied] = useState('');
  const [showCode, setShowCode] = useState(false);
  if (!lesson) return null;
  const data = lesson.metadata?.codeLesson || {};
  const formatLabel =
    data.format === 'html-css'
      ? 'HTML + CSS (split)'
      : data.format === 'react-cdn'
        ? 'React (CDN + JSX)'
        : 'Full HTML document';

  const copyToClipboard = async (value, key) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    } catch (error) {
      console.error('Copy failed', error);
    }
  };

  const stripCodeFences = (value = '') => {
    const trimmed = value.trim();
    if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
      return trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
    }
    return value;
  };

  const normalizedHtml = stripCodeFences(data.html || '');
  const normalizedCss = stripCodeFences(data.css || '');

  const hasCss = Boolean(normalizedCss && normalizedCss.trim().length > 0);

  const previewHtml = useMemo(() => {
    const safeHtml = normalizedHtml.replace(/<\/script>/gi, '<\\/script>');
    const safeCss = normalizedCss.replace(/<\/style>/gi, '<\\/style>');
    if (data.format === 'react-cdn') {
      const hasRender = /(createRoot\s*\(|ReactDOM\.createRoot\s*\(|root\.render\s*\()/m.test(normalizedHtml);
      const bootstrap = hasRender
        ? ''
        : `\nif (typeof App !== 'undefined') {\n  const createRootFn = (window.ReactDOMClient && window.ReactDOMClient.createRoot) || (typeof createRoot !== 'undefined' && createRoot);\n  if (createRootFn) {\n    const root = createRootFn(document.getElementById('root'));\n    root.render(React.createElement(App));\n  }\n}`;

      return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>${safeCss}</style>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script>
      window.__RAW_CODE__ = decodeURIComponent(${JSON.stringify(encodeURIComponent(safeHtml))});
    </script>
    <script>
      (async () => {
        try {
          const raw = window.__RAW_CODE__ || '';
          const importRegex = new RegExp('^\\s*import\\s+([^;]+)\\s+from\\s+[\\\"\\\']([^\\\"\\\']+)[\\\"\\\'];?', 'gm');
          const imports = [];
          const lucideNames = [];
          const body = raw.replace(importRegex, (_, spec, source) => {
            const trimmedSpec = spec.trim();
            const trimmedSource = source.trim();
            imports.push({ spec: trimmedSpec, source: trimmedSource });
            if (trimmedSource === 'lucide-react') {
              const braceMatch = trimmedSpec.match(/\{([\s\S]+)\}/);
              if (braceMatch) {
                braceMatch[1]
                  .split(',')
                  .map((part) => part.trim())
                  .filter(Boolean)
                  .forEach((part) => {
                    const [imported, local] = part.split(/\s+as\s+/i).map((s) => s.trim());
                    lucideNames.push(local || imported);
                  });
              }
            }
            return '';
          });
          const cleaned = body
            .replace(/^\\s*import\\s+type\\s+[^;]+;?$/gm, '')
            .replace(/export\\s+default\\s+/g, '');
          const cleanedNoImports = cleaned
            .replace(/(^|\\n)\\s*import[\\s\\S]*?;?/g, '\\n')
            .replace(/^\\s*[\\w\\s{},*]+\\s+from\\s+['"][^'"]+['"];?\\s*$/gm, '');

          const resolveSource = (src) => {
            if (src === 'react') return 'https://esm.sh/react@18';
            if (src === 'react-dom/client') return 'https://esm.sh/react-dom@18/client';
            if (src === 'lucide-react') return 'https://esm.sh/lucide-react@0.453.0';
            return src;
          };

          const bindImports = async () => {
            const scope = {};
            for (const imp of imports) {
              const mod = await import(resolveSource(imp.source));
              const spec = imp.spec;
              if (spec.startsWith('{')) {
                const names = spec.replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
                names.forEach((name) => {
                  const parts = name.split(/\\s+as\\s+/i).map((s) => s.trim());
                  const imported = parts[0];
                  const local = parts[1];
                  scope[local || imported] = mod[imported];
                });
              } else if (spec.startsWith('*')) {
                const local = spec.split(/\\s+as\\s+/i)[1]?.trim();
                if (local) scope[local] = mod;
              } else if (spec.includes('{')) {
                const parts = spec.split('{');
                const defaultName = parts[0].trim();
                const named = parts[1];
                scope[defaultName] = mod.default || mod;
                const names = named.replace('}', '').split(',').map((s) => s.trim()).filter(Boolean);
                names.forEach((name) => {
                  const parts = name.split(/\\s+as\\s+/i).map((s) => s.trim());
                  const imported = parts[0];
                  const local = parts[1];
                  scope[local || imported] = mod[imported];
                });
              } else {
                scope[spec.trim()] = mod.default || mod;
              }
            }
            return scope;
          };

          const scope = await bindImports();
          const reactMod = scope.React || (await import(resolveSource('react')));
          const domMod = scope.ReactDOMClient || (await import(resolveSource('react-dom/client')));
          if (!scope.React) scope.React = reactMod.default || reactMod;
          if (!scope.ReactDOMClient) scope.ReactDOMClient = domMod;
          if (!scope.createRoot && domMod.createRoot) scope.createRoot = domMod.createRoot;
          if (!scope.useState && scope.React?.useState) scope.useState = scope.React.useState;
          if (!scope.useEffect && scope.React?.useEffect) scope.useEffect = scope.React.useEffect;
          if (!scope.useMemo && scope.React?.useMemo) scope.useMemo = scope.React.useMemo;
          if (!scope.useRef && scope.React?.useRef) scope.useRef = scope.React.useRef;
          if (!scope.useCallback && scope.React?.useCallback) scope.useCallback = scope.React.useCallback;

          if (lucideNames.length) {
            lucideNames.forEach((name) => {
              if (!scope[name]) {
                scope[name] = (props) => scope.React.createElement('span', props, name);
              }
            });
          }

          const declared = new Set();
          const declRegex = /\b(function|class)\s+([A-Z][A-Za-z0-9_]*)|\b(const|let|var)\s+([A-Z][A-Za-z0-9_]*)/g;
          let declMatch;
          while ((declMatch = declRegex.exec(cleanedNoImports))) {
            const name = declMatch[2] || declMatch[4];
            if (name) declared.add(name);
          }

          const usedComponents = new Set();
          const jsxRegex = /<([A-Z][A-Za-z0-9_]*)\b/g;
          let jsxMatch;
          while ((jsxMatch = jsxRegex.exec(cleanedNoImports))) {
            const name = jsxMatch[1];
            if (name) usedComponents.add(name);
          }

          usedComponents.forEach((name) => {
            if (declared.has(name)) return;
            if (scope[name]) return;
            scope[name] = (props) => scope.React.createElement('span', props, name);
          });
          const prelude = Object.keys(scope)
            .map((key) => 'const ' + key + ' = __scope__[' + JSON.stringify(key) + '];')
            .join('\\n');

          if (scope.React) window.React = scope.React;
          if (scope.ReactDOMClient) window.ReactDOMClient = scope.ReactDOMClient;
          if (!window.ReactDOMClient && scope.createRoot) window.ReactDOMClient = { createRoot: scope.createRoot };

          const compiled = window.Babel.transform(cleanedNoImports, { presets: ['react'] }).code;
          const bootstrap = ${JSON.stringify(bootstrap)};
          const runner = new Function('__scope__', prelude + '\\n' + compiled + '\\n' + bootstrap);
          runner(scope);
        } catch (err) {
          document.body.innerHTML = '<pre style="white-space:pre-wrap;color:#b91c1c">' + (err && err.stack ? err.stack : err) + '</pre>';
        }
      })();
    </script>
  </body>
</html>`;
    }
    if (data.format === 'html-css') {
      return `<!doctype html><html><head><style>${safeCss}</style></head><body>${safeHtml}</body></html>`;
    }
    return safeHtml;
  }, [data.format, normalizedCss, normalizedHtml]);

  const codeBlocks = useMemo(() => {
    if (data.format === 'html-css') {
      return [
        { label: 'HTML', value: normalizedHtml },
        { label: 'CSS', value: normalizedCss }
      ];
    }
    return [{ label: 'Code', value: normalizedHtml }];
  }, [data.format, normalizedCss, normalizedHtml]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-5xl overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-emerald-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-emerald-600 p-3 text-white">
              <Code2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-600">Code lesson</p>
              <h2 className="text-lg font-semibold text-foreground">{lesson.displayName}</h2>
              <p className="text-xs text-emerald-700/80">{lesson.subject || 'General'} • {formatLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-emerald-50" type="button">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-6 p-6 lg:grid-cols-[1fr,260px]">
          <div className="space-y-4">
            {lesson.description && (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-emerald-900">
                {lesson.description}
              </div>
            )}

            {!showCode && (
              <div className="rounded-2xl border border-emerald-200 bg-white">
                <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-2">
                  <span className="text-xs font-semibold text-emerald-700">Live preview</span>
                  <button
                    type="button"
                    onClick={() => setShowCode(true)}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700"
                  >
                    <Code className="h-3 w-3" />
                    Show code
                  </button>
                </div>
                <iframe
                  title="lesson-preview"
                  sandbox="allow-scripts"
                  className="h-[520px] w-full bg-white"
                  srcDoc={previewHtml}
                />
              </div>
            )}

            {showCode && (
              <div className="space-y-4">
                {codeBlocks.map((block) => (
                  <div key={block.label} className="rounded-2xl border border-border bg-white">
                    <div className="flex items-center justify-between border-b border-border px-4 py-2">
                      <span className="text-xs font-semibold text-emerald-700">{block.label}</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => copyToClipboard(block.value, block.label)}
                          className="inline-flex items-center gap-1 rounded-full border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700"
                        >
                          {copied === block.label ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          {copied === block.label ? 'Copied' : 'Copy'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowCode(false)}
                          className="inline-flex items-center gap-1 rounded-full border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700"
                        >
                          <Eye className="h-3 w-3" />
                          Show preview
                        </button>
                      </div>
                    </div>
                    <pre className="max-h-[420px] overflow-auto bg-slate-950 p-4 text-xs text-emerald-100">
                      <code>{block.value}</code>
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-900 p-4 text-white">
              <p className="text-sm font-semibold">Lesson details</p>
              <dl className="mt-3 space-y-2 text-xs text-emerald-100/80">
                <div>
                  <dt className="uppercase tracking-[0.2em] text-[10px] text-emerald-200">Subject</dt>
                  <dd className="text-sm text-white">{lesson.subject || 'General'}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.2em] text-[10px] text-emerald-200">Format</dt>
                  <dd className="text-sm text-white">{formatLabel}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.2em] text-[10px] text-emerald-200">CSS included</dt>
                  <dd className="text-sm text-white">{hasCss ? 'Yes' : 'No'}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CodeLessonViewer;
