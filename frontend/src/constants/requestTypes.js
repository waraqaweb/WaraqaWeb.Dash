export const REQUEST_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'done', label: 'Done' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'delayed', label: 'Delayed' },
];

export const REQUEST_CATEGORIES = [
  { value: 'class_modification', label: 'Class Modifications' },
  { value: 'student_management', label: 'Student Management' },
  { value: 'academic_followup', label: 'Academic & Follow-up' },
  { value: 'financial', label: 'Financial' },
  { value: 'administrative', label: 'Administrative' },
];

const BASE_FIELDS = [
  { key: 'studentId', label: 'Student', type: 'student' },
];

export const REQUEST_TYPE_CONFIG = {
  change_class_time: {
    label: 'Change Class Time',
    category: 'class_modification',
    roles: ['teacher', 'guardian'],
    fields: [
      ...BASE_FIELDS,
      { key: 'changeScope', label: 'Change Scope', type: 'select', options: [
        { value: 'one_class', label: 'One class only' },
        { value: 'permanent', label: 'Permanent change' },
      ] },
      { key: 'currentSchedule', label: 'Current schedule', type: 'text' },
      { key: 'newTime', label: 'New time', type: 'time' },
      { key: 'effectiveDate', label: 'Effective date', type: 'date' },
      { key: 'updateRepetition', label: 'Update repetition pattern', type: 'checkbox' },
      { key: 'newRepetitionDays', label: 'New repetition days', type: 'days' },
      { key: 'reason', label: 'Reason', type: 'textarea', required: true },
    ],
  },
  change_curriculum: {
    label: 'Change Curriculum',
    category: 'class_modification',
    roles: ['teacher', 'guardian'],
    fields: [
      ...BASE_FIELDS,
      { key: 'currentCurriculum', label: 'Current curriculum', type: 'text' },
      { key: 'newCurriculum', label: 'New curriculum', type: 'text', required: true },
      { key: 'effectiveDate', label: 'Effective date', type: 'date' },
      { key: 'reason', label: 'Reason', type: 'textarea', required: true },
    ],
  },
  change_duration: {
    label: 'Change Duration',
    category: 'class_modification',
    roles: ['teacher', 'guardian'],
    fields: [
      ...BASE_FIELDS,
      { key: 'currentDuration', label: 'Current duration (minutes)', type: 'number' },
      { key: 'newDuration', label: 'New duration', type: 'select', options: [
        { value: '30', label: '30 minutes' },
        { value: '45', label: '45 minutes' },
        { value: '60', label: '60 minutes' },
      ], required: true },
      { key: 'effectiveDate', label: 'Effective date', type: 'date' },
      { key: 'reason', label: 'Reason', type: 'textarea', required: true },
    ],
  },
  change_repetition: {
    label: 'Change Repetition (Weekly Pattern)',
    category: 'class_modification',
    roles: ['teacher', 'guardian'],
    fields: [
      ...BASE_FIELDS,
      { key: 'currentRepetition', label: 'Current repetition', type: 'text' },
      { key: 'newRepetitionDays', label: 'New repetition days', type: 'days', required: true },
      { key: 'startDate', label: 'Start date', type: 'date' },
      { key: 'periodType', label: 'Period type', type: 'select', options: [
        { value: 'permanent', label: 'Permanent' },
        { value: 'temporary', label: 'Temporary' },
      ] },
      { key: 'reason', label: 'Reason', type: 'textarea', required: true },
    ],
  },
  add_extra_class: {
    label: 'Add Extra Class',
    category: 'class_modification',
    roles: ['teacher', 'guardian'],
    fields: [
      ...BASE_FIELDS,
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'time', label: 'Time', type: 'time', required: true },
      { key: 'duration', label: 'Duration (minutes)', type: 'select', options: [
        { value: '30', label: '30 minutes' },
        { value: '45', label: '45 minutes' },
        { value: '60', label: '60 minutes' },
      ], required: true },
      { key: 'reason', label: 'Reason', type: 'textarea', required: true },
    ],
  },
  cancel_class: {
    label: 'Cancel Class',
    category: 'class_modification',
    roles: ['teacher', 'guardian'],
    fields: [
      ...BASE_FIELDS,
      { key: 'cancelScope', label: 'Cancel scope', type: 'select', options: [
        { value: 'one_class', label: 'One class' },
        { value: 'all_upcoming', label: 'All upcoming classes' },
      ], required: true },
      { key: 'date', label: 'Class date (if one class)', type: 'date' },
      { key: 'reason', label: 'Reason', type: 'textarea', required: true },
    ],
  },
  resume_student: {
    label: 'Resume Student',
    category: 'class_modification',
    roles: ['guardian', 'teacher'],
    fields: [
      ...BASE_FIELDS,
      { key: 'preferredStartDate', label: 'Preferred start date', type: 'date' },
      { key: 'preferredTime', label: 'Preferred time', type: 'time' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  change_teacher: {
    label: 'Change Teacher',
    category: 'class_modification',
    roles: ['guardian', 'teacher'],
    fields: [
      ...BASE_FIELDS,
      { key: 'currentTeacher', label: 'Current teacher', type: 'text' },
      { key: 'preferredTeacher', label: 'Preferred teacher (optional)', type: 'text' },
      { key: 'reason', label: 'Reason', type: 'textarea', required: true },
    ],
  },

  add_new_student: {
    label: 'Add New Student',
    category: 'student_management',
    roles: ['guardian', 'teacher'],
    fields: [
      { key: 'firstName', label: 'First name', type: 'text', required: true },
      { key: 'lastName', label: 'Last name', type: 'text', required: true },
      { key: 'age', label: 'Age', type: 'number' },
      { key: 'gender', label: 'Gender', type: 'select', options: [
        { value: 'male', label: 'Male' },
        { value: 'female', label: 'Female' },
      ] },
      { key: 'level', label: 'Level', type: 'text' },
      { key: 'preferredSchedule', label: 'Preferred schedule', type: 'text' },
      { key: 'timezone', label: 'Timezone', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  end_work_with_student: {
    label: 'End Work With Student',
    category: 'student_management',
    roles: ['guardian', 'teacher'],
    fields: [
      ...BASE_FIELDS,
      { key: 'finalDate', label: 'Final date', type: 'date', required: true },
      { key: 'reason', label: 'Reason', type: 'textarea', required: true },
    ],
  },

  student_follow_up_meeting: {
    label: 'Student Follow-Up Meeting',
    category: 'academic_followup',
    roles: ['guardian', 'teacher'],
    fields: [
      ...BASE_FIELDS,
      { key: 'preferredTime', label: 'Preferred time', type: 'time' },
      { key: 'topic', label: 'Topic', type: 'text', required: true },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  guardian_meeting_request: {
    label: 'Guardian Meeting Request',
    category: 'academic_followup',
    roles: ['guardian', 'teacher'],
    fields: [
      { key: 'preferredTime', label: 'Preferred time', type: 'time' },
      { key: 'topic', label: 'Topic', type: 'text', required: true },
      { key: 'urgencyLevel', label: 'Urgency level', type: 'select', options: [
        { value: 'normal', label: 'Normal' },
        { value: 'high', label: 'High' },
        { value: 'urgent', label: 'Urgent' },
      ] },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  extend_class_report: {
    label: 'Extend Class Report',
    category: 'academic_followup',
    roles: ['teacher'],
    fields: [
      ...BASE_FIELDS,
      { key: 'classId', label: 'Related class ID', type: 'text' },
      { key: 'explanation', label: 'Additional explanation', type: 'textarea', required: true },
    ],
  },

  invoice_review: {
    label: 'Invoice Review',
    category: 'financial',
    roles: ['guardian', 'teacher'],
    fields: [
      { key: 'invoiceId', label: 'Invoice ID', type: 'text' },
      { key: 'issue', label: 'Describe issue', type: 'textarea', required: true },
      { key: 'attachment', label: 'Attachment link (optional)', type: 'text' },
    ],
  },
  invoice_investigation: {
    label: 'Invoice Investigation',
    category: 'financial',
    roles: ['guardian', 'teacher'],
    fields: [
      { key: 'invoiceId', label: 'Invoice ID', type: 'text' },
      { key: 'problem', label: 'Problem details', type: 'textarea', required: true },
      { key: 'supportingDetails', label: 'Supporting details', type: 'textarea' },
    ],
  },

  admin_call_request: {
    label: 'Admin Call Request',
    category: 'administrative',
    roles: ['guardian', 'teacher'],
    fields: [
      { key: 'preferredTime', label: 'Preferred time', type: 'time' },
      { key: 'subject', label: 'Subject', type: 'text', required: true },
      { key: 'urgencyLevel', label: 'Urgency level', type: 'select', options: [
        { value: 'normal', label: 'Normal' },
        { value: 'high', label: 'High' },
        { value: 'urgent', label: 'Urgent' },
      ] },
    ],
  },
  complaint: {
    label: 'Complaint',
    category: 'administrative',
    roles: ['guardian', 'teacher'],
    fields: [
      { key: 'relatedTo', label: 'Related to', type: 'select', options: [
        { value: 'teacher', label: 'Teacher' },
        { value: 'admin', label: 'Admin' },
        { value: 'system', label: 'System' },
        { value: 'invoice', label: 'Invoice' },
        { value: 'other', label: 'Other' },
      ] },
      { key: 'fullDescription', label: 'Full description', type: 'textarea', required: true },
    ],
  },
  suggestion: {
    label: 'Suggestion',
    category: 'administrative',
    roles: ['guardian', 'teacher'],
    fields: [
      { key: 'category', label: 'Suggestion category', type: 'select', options: [
        { value: 'dashboard', label: 'Dashboard' },
        { value: 'curriculum', label: 'Curriculum' },
        { value: 'communication', label: 'Communication' },
        { value: 'other', label: 'Other' },
      ] },
      { key: 'suggestionDetails', label: 'Suggestion details', type: 'textarea', required: true },
    ],
  },
  end_work_with_us: {
    label: 'End Work With Us',
    category: 'administrative',
    roles: ['guardian', 'teacher'],
    fields: [
      ...BASE_FIELDS,
      { key: 'finalDate', label: 'Final date', type: 'date' },
      { key: 'reason', label: 'Reason', type: 'textarea', required: true },
    ],
  },
  other_request: {
    label: 'Other Request',
    category: 'administrative',
    roles: ['guardian', 'teacher'],
    fields: [
      { key: 'requestSubject', label: 'Subject', type: 'text', required: true },
      { key: 'details', label: 'Details', type: 'textarea', required: true },
    ],
  },
};

export const REQUEST_TYPES = Object.entries(REQUEST_TYPE_CONFIG).map(([value, config]) => ({
  value,
  label: config.label,
  category: config.category,
  roles: config.roles,
}));

export const REQUEST_TYPE_LABEL_MAP = Object.entries(REQUEST_TYPE_CONFIG).reduce((acc, [key, val]) => {
  acc[key] = val.label;
  return acc;
}, {});

export const REQUEST_CATEGORY_LABEL_MAP = REQUEST_CATEGORIES.reduce((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});
