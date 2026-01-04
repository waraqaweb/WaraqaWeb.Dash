import React from 'react';
import { X, Calendar, Users, Clock, AlertCircle } from 'lucide-react';

const handlingLabelMap = {
  hold: 'Put classes on hold',
  reschedule: 'Reschedule / hold',
  cancel: 'Cancel classes',
  substitute: 'Assign substitute'
};

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatDuration = (minutes) => {
  if (!minutes) return '0m';
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const parts = [];
  if (hrs) parts.push(`${hrs}h`);
  if (mins) parts.push(`${mins}m`);
  return parts.join(' ') || '0m';
};

const handlingLabel = (handling) => {
  if (!handling) return 'No action configured';
  return handlingLabelMap[handling] || handling;
};

const VacationDetailsModal = ({ isOpen, onClose, vacation, impact, loading, error }) => {
  if (!isOpen) return null;

  const safeImpact = impact || null;
  const students = safeImpact?.students || [];
  const status = vacation?.lifecycleStatus || vacation?.status;
  const totalMinutes = safeImpact?.totalMinutes || 0;
  const totalHours = totalMinutes ? (totalMinutes / 60).toFixed(1) : null;
  const approvedByName = vacation && typeof vacation.approvedBy === 'object' && vacation.approvedBy !== null
    ? (vacation.approvedBy.fullName || [vacation.approvedBy.firstName, vacation.approvedBy.lastName].filter(Boolean).join(' ').trim())
    : null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Vacation impact details</h2>
            {(vacation?.user?.fullName || vacation?.userName) && (
              <p className="text-sm text-gray-500">{vacation?.user?.fullName || vacation?.userName}</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-500">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-3"></div>
              <p>Loading vacation details…</p>
            </div>
          ) : error ? (
            <div className="flex items-start space-x-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700">
              <AlertCircle className="h-5 w-5 mt-0.5" />
              <div>
                <p className="font-medium">Unable to load impact information</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          ) : !vacation ? (
            <p className="text-gray-500">No vacation selected.</p>
          ) : (
            <>
              <section className="space-y-3">
                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                  <span className="inline-flex items-center space-x-2 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full">
                    <Calendar className="h-4 w-4" />
                    <span>{formatDateTime(vacation.startDate)} – {formatDateTime(vacation.effectiveEndDate || vacation.actualEndDate || vacation.endDate)}</span>
                  </span>
                  {status && (
                    <span className="inline-flex items-center space-x-2 bg-gray-100 text-gray-700 px-3 py-1.5 rounded-full capitalize">
                      <Clock className="h-4 w-4" />
                      <span>{status}</span>
                    </span>
                  )}
                </div>
                <p className="text-gray-700">
                  <span className="font-medium">Reason:</span> {vacation.reason || '—'}
                </p>
                {approvedByName && (
                  <p className="text-sm text-gray-500">Approved by {approvedByName}</p>
                )}
              </section>

              <section className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
                  <Users className="h-5 w-5 text-blue-600" />
                  <span>Impacted students</span>
                </h3>

                <div className="flex flex-wrap gap-3 text-sm">
                  <span className="inline-flex items-center space-x-2 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full">
                    <Users className="h-4 w-4" />
                    <span>{safeImpact?.totalStudents || 0} student{(safeImpact?.totalStudents || 0) === 1 ? '' : 's'}</span>
                  </span>
                  <span className="inline-flex items-center space-x-2 bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-full">
                    <Calendar className="h-4 w-4" />
                    <span>{safeImpact?.totalClasses || 0} class{(safeImpact?.totalClasses || 0) === 1 ? '' : 'es'}</span>
                  </span>
                  {totalHours && (
                    <span className="inline-flex items-center space-x-2 bg-purple-50 text-purple-700 px-3 py-1.5 rounded-full">
                      <Clock className="h-4 w-4" />
                      <span>{totalHours} hours affected</span>
                    </span>
                  )}
                </div>

                {students.length === 0 ? (
                  <p className="text-gray-500">No scheduled classes fall within this vacation window.</p>
                ) : (
                  <div className="space-y-4">
                    {students.map((student) => (
                      <div key={student.studentId} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                          <div>
                            <p className="text-base font-semibold text-gray-900">{student.studentName}</p>
                            {student.guardianName && (
                              <p className="text-sm text-gray-500">
                                Guardian: {student.guardianName}{student.guardianEmail ? ` · ${student.guardianEmail}` : ''}
                              </p>
                            )}
                            <p className="text-sm text-gray-500">
                              {student.classes.length} class{student.classes.length === 1 ? '' : 'es'} between {formatDateTime(student.firstClassStart)} and {formatDateTime(student.lastClassEnd)}
                            </p>
                          </div>
                          <div className="text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                            {handlingLabel(student.configuredHandling?.handling)}
                          </div>
                        </div>
                        {student.classes.length > 0 && (
                          <ul className="mt-3 space-y-2 text-sm text-gray-600">
                            {student.classes.map((cls) => (
                              <li key={cls.classId || `${student.studentId}-${cls.scheduledDate}`} className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2">
                                <span>
                                  {formatDateTime(cls.scheduledDate)} · {cls.subject || 'Class'}
                                </span>
                                <span className="text-gray-500">{formatDuration(cls.duration)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default VacationDetailsModal;
