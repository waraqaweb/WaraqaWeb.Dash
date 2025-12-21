import React, { useState, useRef, useEffect } from 'react';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';

const FirstClassFeedbackModal = ({ open, onClose, prompt, onSubmitted }) => {
  const { user } = useAuth();
  const guardianStudents = user?.guardianInfo?.students || [];

  const [studentId, setStudentId] = useState(guardianStudents[0]?._id || null);
  // store star values 0-5 (convert to 0-10 on submit)
  const [firstClassStars, setFirstClassStars] = useState(Math.round(8 / 2));
  const [teacherPerfStars, setTeacherPerfStars] = useState(Math.round(8 / 2));
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
    studentId: studentId || undefined,
    ...extra,
  });

  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      const payload = {
        type: 'first_class',
        teacherId: teacher._id || prompt.teacherId,
        classId: prompt.classId,
        studentId: studentId || undefined,
        // convert star (0-5) to 0-10 scale
        firstClassRating: (Number(firstClassStars) || 0) * 2,
        teacherPerformanceRating: (Number(teacherPerfStars) || 0) * 2,
        notes,
      };
      const res = await api.post('/feedbacks', payload);
      if (res.data && res.data.success) {
        const serverFeedback = res.data.feedback || res.data.data;
        onSubmitted && onSubmitted({
          action: 'submitted',
          type: 'first_class',
          feedback: serverFeedback || buildFeedbackSummary({
            firstClassRating: payload.firstClassRating,
            teacherPerformanceRating: payload.teacherPerformanceRating,
            notes: payload.notes,
            createdAt: new Date().toISOString(),
          })
        });
        onClose();
      }
    } catch (err) {
      console.error('Submit first class feedback error', err);
      alert('Failed to submit feedback');
      onSubmitted && onSubmitted({ action: 'error', type: 'first_class', error: err });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemindLater = async () => {
    // Dismiss for now but still allow monthly reappearance - we create a dismissed record so first-class prompt won't repeat
    try {
      await api.post(`/feedbacks/first_class/dismiss`, { teacherId: teacher._id, classId: prompt.classId });
      // notify parent to refresh prompts, then close
      onSubmitted && onSubmitted({ action: 'dismissed', type: 'first_class', feedback: buildFeedbackSummary() });
      onClose();
    } catch (err) {
      console.error('Dismiss first class prompt error', err);
      onSubmitted && onSubmitted({ action: 'error', type: 'first_class', error: err });
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
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 z-10" role="dialog" aria-modal="true" aria-labelledby="fc-title">
        <div className="flex items-center gap-3 mb-3 justify-between">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center text-lg font-semibold">{(teacher.firstName||'T').charAt(0)}</div>
            <div>
              <h3 id="fc-title" className="text-lg font-bold">How was your first class with {teacher.firstName} {teacher.lastName}?</h3>
              <p className="text-sm text-muted-foreground">This prompt appears once after your first class — your honest feedback helps us improve.</p>
            </div>
          </div>
          <div className="ml-4">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">First class</span>
          </div>
        </div>

        <div className="space-y-3">
          {user?.role === 'guardian' && guardianStudents.length > 0 && (
            <label className="block">
              <div className="text-sm font-medium mb-1">Which child is this feedback for?</div>
              <select ref={firstInputRef} value={studentId || ''} onChange={(e)=>setStudentId(e.target.value)} className="px-3 py-2 border rounded-md w-full">
                {guardianStudents.map(s => (
                  <option key={s._id} value={s._id}>{s.firstName} {s.lastName}</option>
                ))}
              </select>
            </label>
          )}

          <div className="space-y-3">
            <StarInput label="First class" value={firstClassStars} onChange={setFirstClassStars} />
            <StarInput label="Teacher performance" value={teacherPerfStars} onChange={setTeacherPerfStars} />
          </div>

          <label className="block mt-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium mb-1">Write an optional feedback</div>
              <div className="text-xs text-muted-foreground">{notes.length}/2000</div>
            </div>
            <textarea ref={notesRef} value={notes} onChange={(e)=>setNotes(e.target.value)} className="w-full p-2 border rounded-md resize-none" rows={3} placeholder="Share something about the class..." maxLength={2000} />
          </label>
        </div>

        <div className="mt-4 flex justify-end space-x-2">
          <button onClick={handleRemindLater} className="btn-secondary">Remind me later</button>
          <button onClick={onClose} className="btn-ghost">Close</button>
          <button onClick={handleSubmit} disabled={submitting} className="btn-submit">{submitting ? 'Sending...' : 'Send feedback'}</button>
        </div>
      </div>
    </div>
  );
};

export default FirstClassFeedbackModal;
