import React, { useEffect, useMemo, useState } from 'react';
import PresenterPage from './dashboard/PresenterPage';
import { SearchProvider } from '../contexts/SearchContext';

const PresenterPublicPage = () => {
  const [accessEntries, setAccessEntries] = useState([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [accessGranted, setAccessGranted] = useState(false);
  const [allowedSubjects, setAllowedSubjects] = useState([]);

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('presenterSettings') || '{}');
      if (Array.isArray(raw.accessEntries)) setAccessEntries(raw.accessEntries);
      const prior = sessionStorage.getItem('presenterPublicAccess');
      if (prior === 'granted') setAccessGranted(true);
      const storedSubjects = JSON.parse(sessionStorage.getItem('presenterPublicSubjects') || '[]');
      if (Array.isArray(storedSubjects)) setAllowedSubjects(storedSubjects);
    } catch (e) {
      setAccessEntries([]);
    }
  }, []);

  const allowList = useMemo(() =>
    (accessEntries || []).map((entry) => ({
      email: String(entry.email || '').toLowerCase(),
      password: String(entry.password || '')
    })),
    [accessEntries]
  );

  const handleSubmit = (event) => {
    event.preventDefault();
    const normalizedEmail = String(email || '').toLowerCase().trim();
    const normalizedPassword = String(password || '');
    const match = allowList.find(
      (entry) => entry.email === normalizedEmail && entry.password === normalizedPassword
    );
    if (!match) {
      setError('Access denied. Check your email and password.');
      return;
    }
    setError('');
    const entry = accessEntries.find(
      (item) => String(item.email || '').toLowerCase().trim() === normalizedEmail
        && String(item.password || '') === normalizedPassword
    );
    const subjects = Array.isArray(entry?.folders) ? entry.folders : [];
    setAllowedSubjects(subjects);
    setAccessGranted(true);
    sessionStorage.setItem('presenterPublicAccess', 'granted');
    sessionStorage.setItem('presenterPublicSubjects', JSON.stringify(subjects));
  };

  if (!accessGranted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#2C736C]">Interactive learning</p>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">Enter access details</h1>
          <p className="mt-1 text-xs text-slate-500">Only approved emails can view interactive learning.</p>
          {allowList.length === 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              No public access entries configured. Ask an admin to add your email.
            </div>
          )}
          <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              required
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              required
            />
            {error && <div className="text-xs text-rose-600">{error}</div>}
            <button
              type="submit"
              className="w-full rounded-full bg-[#2C736C] px-4 py-2 text-sm font-semibold text-white"
              disabled={allowList.length === 0}
            >
              View interactive learning
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <SearchProvider>
      <div className="min-h-screen bg-background">
        <div className="fixed right-6 top-6 z-50">
          <button
            type="button"
            onClick={() => {
              sessionStorage.removeItem('presenterPublicAccess');
              sessionStorage.removeItem('presenterPublicSubjects');
              setAccessGranted(false);
              setAllowedSubjects([]);
              setEmail('');
              setPassword('');
            }}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm"
          >
            Log out
          </button>
        </div>
        <PresenterPage isActive isPublic allowedSubjects={allowedSubjects} />
      </div>
    </SearchProvider>
  );
};

export default PresenterPublicPage;
