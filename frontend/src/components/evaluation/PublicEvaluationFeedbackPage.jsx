/**
 * Public, tokenised feedback page for the Waraqa evaluation.
 * No login required — opened from the email link.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/axios';
import { FEEDBACK_QUESTIONS } from '../../data/evaluationContent';

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

const PublicEvaluationFeedbackPage = () => {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true, error: null, studentName: '', alreadySubmitted: false });
  const [ratings, setRatings] = useState({});
  const [comment, setComment] = useState('');
  const [heardAboutUs, setHeardAboutUs] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const { data } = await api.get(`/evaluations/feedback/${token}`);
        if (!cancel) setState({ loading: false, error: null, ...data });
      } catch (err) {
        if (!cancel) setState({ loading: false, error: err?.response?.data?.message || 'Link is no longer valid', studentName: '', alreadySubmitted: false });
      }
    })();
    return () => { cancel = true; };
  }, [token]);

  const canSubmit = useMemo(
    () => FEEDBACK_QUESTIONS.every((q) => ratings[q.key]) && heardAboutUs.trim().length > 0,
    [ratings, heardAboutUs]
  );

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await api.post(`/evaluations/feedback/${token}`, { ratings, comment, heardAboutUs });
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
        <h1 className="text-xl font-semibold mb-1">How was your Waraqa evaluation?</h1>
        <p className="text-sm text-gray-600 mb-5">
          {state.studentName ? `Hi ${state.studentName} — ` : ''}your honest feedback takes about 30 seconds and helps us serve you better.
        </p>
        <form onSubmit={submit}>
          {FEEDBACK_QUESTIONS.map((q) => (
            <RatingRow
              key={q.key}
              label={q.label}
              value={ratings[q.key]}
              onChange={(v) => setRatings((r) => ({ ...r, [q.key]: v }))}
            />
          ))}
          <div className="mt-3">
            <div className="text-sm font-medium mb-1">Anything you&apos;d like to share?</div>
            <textarea
              className="w-full border border-gray-300 rounded p-2 text-sm min-h-[90px]"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium mb-1">How did you hear about Waraqa?</div>
              <div className="text-xs text-gray-500">Required</div>
            </div>
            <input
              className="w-full border border-gray-300 rounded p-2 text-sm"
              value={heardAboutUs}
              onChange={(e) => setHeardAboutUs(e.target.value)}
              placeholder="Friend, WhatsApp, Instagram, Google, school, teacher recommendation..."
              maxLength={500}
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

export default PublicEvaluationFeedbackPage;
