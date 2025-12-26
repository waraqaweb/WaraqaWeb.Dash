import React, { useState, useRef, useEffect } from 'react';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';

const MonthlyFeedbackModal = ({ open, onClose, prompt, onSubmitted }) => {
  useAuth();
  const [classStars, setClassStars] = useState(Math.round(8 / 2));
  const [teacherStars, setTeacherStars] = useState(Math.round(8 / 2));
  const [progressEvaluation, setProgressEvaluation] = useState(8);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const firstInputRef = useRef(null);
  const notesRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    if (firstInputRef.current) firstInputRef.current.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !notesRef.current) return;
    const ta = notesRef.current;
    ta.style.height = '0px';
    const h = Math.max(80, Math.min(300, ta.scrollHeight));
    ta.style.height = h + 'px';
  }, [open, notes]);

  if (!open || !prompt) return null;

  const teacher = prompt.teacher || {};
  const teacherSummary = {
    _id: teacher._id || prompt.teacherId,
    firstName: teacher.firstName || prompt.teacherFirstName || '',
    lastName: teacher.lastName || prompt.teacherLastName || ''
  };

  const buildFeedbackSummary = (extra = {}) => ({
    teacher: teacherSummary,
    teacherName: `${teacherSummary.firstName || ''} ${teacherSummary.lastName || ''}`.trim() || 'Teacher',
    classId: prompt.classId,
    scheduledDate: prompt.scheduledDate || null,
    ...extra,
  });

  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      const payload = {
        type: 'monthly',
        teacherId: teacher._id || prompt.teacherId,
        classRating: (Number(classStars) || 0) * 2,
        teacherRating: (Number(teacherStars) || 0) * 2,
        progressEvaluation,
        notes,
      };
      const res = await api.post('/feedbacks', payload);
      if (res.data && res.data.success) {
        const serverFeedback = res.data.feedback || res.data.data;
        onSubmitted && onSubmitted({
          action: 'submitted',
          type: 'monthly',
          feedback: serverFeedback || buildFeedbackSummary({
            classRating: payload.classRating,
            teacherRating: payload.teacherRating,
            progressEvaluation: payload.progressEvaluation,
            notes: payload.notes,
            createdAt: new Date().toISOString(),
          })
        });
        onClose();
      }
    } catch (err) {
      console.error('Submit monthly feedback error', err);
      alert('Failed to submit feedback');
      onSubmitted && onSubmitted({ action: 'error', type: 'monthly', error: err });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemindLater = async () => {
    try {
      await api.post(`/feedbacks/monthly/dismiss`, { teacherId: teacher._id, classId: prompt.classId });
      // notify parent to refresh prompts, then close
      onSubmitted && onSubmitted({ action: 'dismissed', type: 'monthly', feedback: buildFeedbackSummary() });
      onClose();
    } catch (err) {
      console.error('Dismiss monthly prompt error', err);
      onSubmitted && onSubmitted({ action: 'error', type: 'monthly', error: err });
      onClose();
    }
  };

  const StarInput = ({ value, onChange, label }) => {
    const stars = [1,2,3,4,5];
    return (
      <div className="flex items-center gap-3" aria-label={label}>
        <div className="text-sm text-muted-foreground w-40">{label}</div>
        <div className="flex items-center space-x-1">
          {stars.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              className={`transition transform hover:scale-110 ${s <= value ? 'text-yellow-400' : 'text-gray-300'}`}
              aria-pressed={s === value}
              aria-label={`${s} star`}
            >
              <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.97a1 1 0 00.95.69h4.18c.969 0 1.371 1.24.588 1.81l-3.384 2.455a1 1 0 00-.363 1.118l1.287 3.97c.3.921-.755 1.688-1.54 1.118L10 13.347l-3.384 2.455c-.784.57-1.84-.197-1.54-1.118l1.287-3.97a1 1 0 00-.363-1.118L2.615 9.397c-.783-.57-.38-1.81.588-1.81h4.18a1 1 0 00.95-.69l1.286-3.97z"/></svg>
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black opacity-40" onClick={onClose}></div>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 z-10" role="dialog" aria-modal="true" aria-labelledby="monthly-title">
        <div className="flex items-center gap-3 mb-3 justify-between">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center text-lg font-semibold">{(teacher.firstName||'T').charAt(0)}</div>
            <div>
              <h3 id="monthly-title" className="text-lg font-bold">Monthly check-in: How is {teacher.firstName} {teacher.lastName} doing?</h3>
              <p className="text-sm text-muted-foreground">This short follow-up helps us track progress and class quality.</p>
            </div>
          </div>
          <div className="ml-4">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">Monthly</span>
          </div>
        </div>

        <div className="space-y-3">
          <StarInput label="Attendance on time" value={classStars} onChange={setClassStars} />
          <StarInput label="Connection quality" value={teacherStars} onChange={setTeacherStars} />
          <label className="block">
            <div className="text-sm font-medium mb-1">How would you evaluate progress (0-10)</div>
            <input type="range" min="0" max="10" value={progressEvaluation} onChange={(e)=>setProgressEvaluation(Number(e.target.value))} />
            <div className="text-sm">{progressEvaluation} / 10</div>
          </label>

          <label className="block mt-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium mb-1">Any other notes (optional)</div>
              <div className="text-xs text-muted-foreground">{notes.length}/2000</div>
            </div>
            <textarea ref={notesRef} value={notes} onChange={(e)=>setNotes(e.target.value)} className="w-full p-2 border rounded-md resize-none" rows={3} placeholder="Share something about progress, teacher, or class logistics..." maxLength={2000} />
          </label>
        </div>

        <div className="mt-4 flex justify-end space-x-2">
          <button onClick={handleRemindLater} className="btn-secondary">Not now</button>
          <button onClick={onClose} className="btn-ghost">Close</button>
          <button onClick={handleSubmit} disabled={submitting} className="btn-submit">{submitting ? 'Sending...' : 'Give feedback'}</button>
        </div>
      </div>
    </div>
  );
};

export default MonthlyFeedbackModal;
