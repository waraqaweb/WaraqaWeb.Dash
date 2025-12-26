import React, { useState, useEffect, useRef } from 'react';

const LANGUAGES = ['Arabic','English','French','Spanish','German','Turkish','Urdu','Hindi','Bengali','Chinese','Japanese','Korean','Other'];

export default function SpokenLanguagesSelect({ value = [], onChange }) {
  const [input, setInput] = useState('');
  const [filtered, setFiltered] = useState([]);

  useEffect(() => {
    const f = input.trim().length > 0
      ? LANGUAGES.filter(l => l.toLowerCase().includes(input.toLowerCase()) && !(value||[]).includes(l))
      : [];
    setFiltered(f.slice(0, 30));
  }, [input, value]);

  const add = (s) => { onChange([...(value||[]), s]); setInput(''); };
  const remove = (s) => { onChange((value||[]).filter(x => x !== s)); };

  const [highlight, setHighlight] = useState(-1);
  const listRef = useRef(null);

  useEffect(() => { setHighlight(filtered.length ? 0 : -1); }, [filtered]);
  useEffect(() => {
    if (highlight >= 0 && listRef.current) {
      const nodes = listRef.current.querySelectorAll('div');
      const el = nodes[highlight];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlight]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(filtered.length - 1, (h < 0 ? 0 : h + 1))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(0, h <= 0 ? 0 : h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (highlight >= 0 && filtered[highlight]) { add(filtered[highlight]); } }
    else if (e.key === 'Escape') { setInput(''); }
  };

  return (
    <div>
      <div className="relative">
        <input value={input} onChange={(e)=>setInput(e.target.value)} placeholder="Add language (type to search)..." className="w-full border rounded px-2 py-1" onKeyDown={handleKeyDown} onBlur={() => setTimeout(() => setInput(''), 150)} />
        {input.trim().length > 0 && (
          <div ref={listRef} className="absolute left-0 right-0 top-full mt-1 bg-white border rounded shadow max-h-40 overflow-auto z-50">
            {filtered.map((s,i) => (
              <div key={i} className={`p-2 cursor-pointer ${i === highlight ? 'bg-gray-100' : ''}`} onMouseDown={(e)=>{ e.preventDefault(); add(s); }}>{s}</div>
            ))}
            {filtered.length === 0 && <div className="p-2 text-sm text-gray-500">No matches</div>}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mt-2">
        {(value||[]).map((s,i) => (
          <div key={i} className="flex items-center gap-2 rounded-full bg-slate-100 px-2 py-1 text-sm">
            <span>{s}</span>
            <button
              type="button"
              onClick={() => remove(s)}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold text-red-600 hover:bg-red-50"
              aria-label={`Remove ${s}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
