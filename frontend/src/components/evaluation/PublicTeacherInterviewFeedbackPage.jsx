/**
 * Public, tokenised post-interview feedback page for teacher candidates.
 * No login required — opened from the WhatsApp/email link sent after an
 * interview. Mirrors PublicEvaluationFeedbackPage.jsx.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/axios';

// Five HR-style questions covering the recruitment/interview experience.
export const TEACHER_INTERVIEW_FEEDBACK_QUESTIONS = [
  { key: 'communication', label: 'How clear and timely was our communication throughout the process?' },
  { key: 'scheduling', label: 'How easy was it to book and complete your interview?' },
  { key: 'professionalism', label: 'How professional and respectful was your interviewer?' },
  { key: 'roleClarity', label: 'Were the role expectations and next steps explained clearly?' },
  { key: 'overallExperience', label: 'Overall, how would you rate your experience with our hiring process?' },
];

const RatingRow = ({ label, value, onChange }) => (
  <div className="mb-3">
    <div className="text-sm font-medium mb-1">{label}</div>
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`h-9 w-9 rounded border text-sm font-medium transition ${value === n ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-gray-300 hover:bg-gray-50'}`}
        >{n}</button>
      ))}
    </div>
  </div>
);

const PublicTeacherInterviewFeedbackPage = () => {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true, error: null, teacherName: '', alreadySubmitted: false });
  const [ratings, setRatings] = useState({});
  const [improvementSuggestions, setImprovementSuggestions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { data } = await api.get(`/teacher-interview-feedback/${token}`);
        if (!cancel) setState({ loading: false, error: null, ...data });
      } catch (err) {
        if (!cancel) setState({ loading: false, error: err?.response?.data?.message || 'Link is no longer valid', teacherName: '', alreadySubmitted: false });
      }
    })();
    return () => { cancel = true; };
  }, [token]);

  const canSubmit = useMemo(
    () => TEACHER_INTERVIEW_FEEDBACK_QUESTIONS.every((q) => ratings[q.key]),
    [ratings]
  );

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await api.post(`/teacher-interview-feedback/${token}`, { ratings, improvementSuggestions });
      setDone(true);
    } catch (err) {
      setState((s) => ({ ...s, error: err?.response?.data?.message || 'Failed to submit feedback' }));
    } finally {
      setSubmitting(false);
    }
  };

  if (state.loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading…</div>;
  }
  if (state.error && !done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl border border-rose-200 p-6 text-center">
          <h1 className="text-lg font-semibold text-rose-700 mb-2">We couldn&apos;t open this link</h1>
          <p className="text-sm text-gray-600">{state.error}</p>
        </div>
      </div>
    );
  }
  if (done || state.alreadySubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl border border-emerald-200 p-6 text-center">
          <h1 className="text-lg font-semibold text-emerald-700 mb-2">Jazākum Allāhu khayran!</h1>
          <p className="text-sm text-gray-600">Your feedback has been received — we&apos;re grateful for your time.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-xl mx-auto bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h1 className="text-xl font-semibold mb-1">How was your interview experience with us?</h1>
        <p className="text-sm text-gray-600 mb-5">
          {state.teacherName ? `Hi ${state.teacherName} — ` : ''}your honest feedback takes about 30 seconds and helps us make the hiring process easier and more productive for future candidates.
        </p>
        <form onSubmit={submit}>
          {TEACHER_INTERVIEW_FEEDBACK_QUESTIONS.map((q) => (
            <RatingRow
              key={q.key}
              label={q.label}
              value={ratings[q.key]}
              onChange={(v) => setRatings((r) => ({ ...r, [q.key]: v }))}
            />
          ))}
          <div className="mt-3">
            <div className="text-sm font-medium mb-1">Is there anything we could do better?</div>
            <textarea
              className="w-full border border-gray-300 rounded p-2 text-sm min-h-[90px]"
              value={improvementSuggestions}
              onChange={(e) => setImprovementSuggestions(e.target.value)}
              placeholder="Optional — anything that would make the process easier or more productive"
            />
          </div>
          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="mt-4 w-full bg-emerald-600 text-white rounded py-2 font-medium disabled:opacity-50"
          >
            {submitting ? 'Sending…' : 'Send feedback'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PublicTeacherInterviewFeedbackPage;
