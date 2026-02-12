const REQUEST_STATUSES = ['pending', 'done', 'rejected', 'delayed'];

const REQUEST_CATEGORIES = [
  'class_modification',
  'student_management',
  'academic_followup',
  'financial',
  'administrative',
];

const REQUEST_TYPES = {
  change_class_time: { category: 'class_modification', label: 'Change Class Time' },
  change_curriculum: { category: 'class_modification', label: 'Change Curriculum' },
  change_duration: { category: 'class_modification', label: 'Change Duration' },
  change_repetition: { category: 'class_modification', label: 'Change Repetition' },
  add_extra_class: { category: 'class_modification', label: 'Add Extra Class' },
  cancel_class: { category: 'class_modification', label: 'Cancel Class' },
  resume_student: { category: 'class_modification', label: 'Resume Student' },
  change_teacher: { category: 'class_modification', label: 'Change Teacher' },

  add_new_student: { category: 'student_management', label: 'Add New Student' },
  end_work_with_student: { category: 'student_management', label: 'End Work With Student' },

  student_follow_up_meeting: { category: 'academic_followup', label: 'Student Follow-Up Meeting' },
  guardian_meeting_request: { category: 'academic_followup', label: 'Guardian Meeting Request' },
  extend_class_report: { category: 'academic_followup', label: 'Extend Class Report' },

  invoice_review: { category: 'financial', label: 'Invoice Review' },
  invoice_investigation: { category: 'financial', label: 'Invoice Investigation' },

  admin_call_request: { category: 'administrative', label: 'Admin Call Request' },
  complaint: { category: 'administrative', label: 'Complaint' },
  suggestion: { category: 'administrative', label: 'Suggestion' },
  end_work_with_us: { category: 'administrative', label: 'End Work With Us' },
  other_request: { category: 'administrative', label: 'Other Request' },
};

const REQUEST_TYPE_KEYS = Object.keys(REQUEST_TYPES);

module.exports = {
  REQUEST_STATUSES,
  REQUEST_CATEGORIES,
  REQUEST_TYPES,
  REQUEST_TYPE_KEYS,
};
