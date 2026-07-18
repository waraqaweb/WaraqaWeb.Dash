import React from 'react';
import { ExternalLink } from 'lucide-react';

const GOOGLE_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfLK5DuXIGA5UNVgNHHhJXpiy9NJRhobB0BOwRFJE38z3rdgA/viewform';

export default function PublicTeacherContractPage() {
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      window.location.replace(GOOGLE_FORM_URL);
    }, 800);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-800">
      <section className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Waraqa Job application</p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-950">Welcome to Waraqa Teamwork!</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Applications are collected through the official Waraqa Google Form so uploads are saved to Google Drive and responses are saved to the linked Google Sheet.
        </p>
        <a href={GOOGLE_FORM_URL} className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white hover:bg-primary/90">
          Open application form
          <ExternalLink className="h-4 w-4" />
        </a>
      </section>
    </main>
  );
}