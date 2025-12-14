'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import type { MarketingTeacher } from '@/lib/marketingClient';

const toDisplayName = (teacher: MarketingTeacher) => {
  if (teacher.firstName) {
    const lastInitial = teacher.lastName ? `${teacher.lastName.charAt(0).toUpperCase()}.` : '';
    return `${teacher.firstName} ${lastInitial}`.trim();
  }
  return teacher.name || 'Teacher profile';
};

const TeachersSection = ({ teachers }: { teachers: MarketingTeacher[] }) => {
  const [languageFilter, setLanguageFilter] = useState('All');

  const { languageOptions, filteredTeachers } = useMemo(() => {
    const languageSet = new Set<string>();
    teachers.forEach((teacher) => {
      (teacher.languages || []).forEach((entry) => {
        if (entry) languageSet.add(entry.trim());
      });
    });
    const options = ['All', ...Array.from(languageSet).sort((a, b) => a.localeCompare(b))];
    const filtered = languageFilter === 'All'
      ? teachers
      : teachers.filter((teacher) =>
          (teacher.languages || []).some((lang) => lang.toLowerCase() === languageFilter.toLowerCase())
        );
    return { languageOptions: options, filteredTeachers: filtered };
  }, [teachers, languageFilter]);

  const renderList = (label: string, items?: string[]) => (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">{label}</p>
      {items && items.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-400">Not provided yet.</p>
      )}
    </div>
  );

  if (!teachers.length) {
    return (
      <section className="py-24">
        <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white/40 p-12 text-center shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">Teacher Profiles</p>
          <h2 className="mt-3 text-3xl font-semibold text-slate-900">Teacher grid goes live once profiles are published.</h2>
          <p className="mt-3 text-slate-600">Admins can publish profiles inside the Marketing Hub to reveal them here.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="py-24" id="teachers">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-sky-500">Meet the teachers</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900">Dedicated instructors families can meet before they enroll</h1>
          <p className="mt-4 text-lg text-slate-600">Every card below syncs with the Marketing Hub so only the teachers your team marks as published appear here.</p>
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-3">
          {languageOptions.map((option) => {
            const isActive = languageFilter === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setLanguageFilter(option)}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>

        <div className="mt-4 text-sm text-slate-500">
          Showing {filteredTeachers.length} of {teachers.length} published teachers
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {filteredTeachers.map((teacher) => (
            <article key={teacher._id} className="rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-sm">
              <div className="flex items-center gap-4">
                {teacher.avatar ? (
                  <Image
                    src={teacher.avatar}
                    alt={toDisplayName(teacher)}
                    width={80}
                    height={80}
                    className="h-20 w-20 rounded-2xl object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-100 text-lg font-semibold text-slate-500">
                    {toDisplayName(teacher).charAt(0)}
                  </div>
                )}
                <div>
                  <p className="text-lg font-semibold text-slate-900">{toDisplayName(teacher)}</p>
                  <p className="text-sm text-slate-500">{teacher.role || 'Instructor'}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    {teacher.gender && <span>{teacher.gender}</span>}
                    {teacher.country && <span>{teacher.country}</span>}
                    {teacher.yearsExperience ? <span>{teacher.yearsExperience}+ yrs</span> : null}
                  </div>
                </div>
              </div>

              <p className="mt-4 text-sm text-slate-600">{teacher.bio || 'Bio coming soon from the marketing team.'}</p>

              <div className="mt-4 flex flex-wrap gap-2">
                {(teacher.languages || []).map((lang) => (
                  <span key={lang} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                    {lang}
                  </span>
                ))}
              </div>

              <div className="mt-6 grid gap-6">
                {renderList('Certificates', teacher.credentials)}
                {renderList('Additional certificates', teacher.additionalCertificates)}
                {renderList('Education', teacher.education)}
                {renderList('Courses taught', teacher.teachesCourses)}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export { TeachersSection };
