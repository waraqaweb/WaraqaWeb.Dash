// services/vacationService.js
// Handles vacation logic for teachers and students, including class scheduling impact

const Class = require('../models/Class');
const User = require('../models/User');
const Vacation = require('../models/Vacation');
const UnavailablePeriod = require('../models/UnavailablePeriod');

function getEffectiveVacationDates(vacation, overrideEndDate = null) {
  const start = vacation.actualStartDate || vacation.startDate;
  const end = overrideEndDate || vacation.actualEndDate || vacation.endDate;
  return {
    start: start ? new Date(start) : null,
    end: end ? new Date(end) : null
  };
}

async function upsertUnavailablePeriodForVacation(vacation, overrideEndDate = null) {
  if (!vacation || vacation.role !== 'teacher') {
    return null;
  }

  const { start, end } = getEffectiveVacationDates(vacation, overrideEndDate);

  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
    return null;
  }

  if (end < start) {
    return null;
  }

  const now = new Date();

  const update = {
    teacherId: vacation.user,
    vacationId: vacation._id,
    startDateTime: start,
    endDateTime: end,
    reason: 'vacation',
    description: vacation.reason,
    affectsScheduledClasses: true,
    status: 'approved',
    isActive: end >= now,
    approvedBy: vacation.approvedBy
  };

  return UnavailablePeriod.findOneAndUpdate(
    { teacherId: vacation.user, vacationId: vacation._id },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function deactivateUnavailablePeriodForVacation(vacation, effectiveEndDate = null) {
  if (!vacation || vacation.role !== 'teacher') {
    return;
  }

  const endOverride = effectiveEndDate ? new Date(effectiveEndDate) : null;
  const updated = await upsertUnavailablePeriodForVacation(vacation, endOverride);

  if (!updated) {
    return;
  }

  if (updated.endDateTime < new Date()) {
    updated.isActive = false;
    await updated.save();
  }
}

/**
 * Update teacher status to inactive during vacation period
 * @param {Object} vacation The vacation object
 */
async function setTeacherInactive(vacation) {
  if (vacation.role === 'teacher') {
    try {
      await User.findByIdAndUpdate(vacation.user, { 
        isActive: false,
        vacationStartDate: vacation.startDate,
        vacationEndDate: vacation.actualEndDate || vacation.endDate
      });
      await upsertUnavailablePeriodForVacation(vacation);
      console.log(`Teacher ${vacation.user} set to inactive for vacation period`);
    } catch (error) {
      console.error('Error setting teacher inactive:', error);
      throw error;
    }
  }
}

/**
 * Reactivate teacher after vacation period
 * @param {string} teacherId The teacher's user ID
 */
async function reactivateTeacher(teacherId) {
  try {
    await User.findByIdAndUpdate(teacherId, { 
      isActive: true,
      $unset: { vacationStartDate: "", vacationEndDate: "" }
    });
    console.log(`Teacher ${teacherId} reactivated after vacation`);
  } catch (error) {
    console.error('Error reactivating teacher:', error);
    throw error;
  }
}

/**
 * Check and update teacher statuses based on vacation periods
 * This should be called periodically (e.g., daily cron job)
 */
async function updateTeacherVacationStatuses() {
  const now = new Date();
  
  try {
    // Find teachers whose vacation has ended and reactivate them
    const endedVacations = await Vacation.find({
      role: 'teacher',
      approvalStatus: 'approved',
      status: { $in: ['approved', 'active', 'ended'] },
      $expr: {
        $lt: [ { $ifNull: ['$actualEndDate', '$endDate'] }, now ]
      }
    }).populate('user');

    for (const vacation of endedVacations) {
      const teacherUserId = vacation.user?._id || vacation.user;
      if (teacherUserId) {
        // Always clear vacation flags once a vacation is ended.
        // This prevents stale vacation window fields from hiding upcoming classes.
        await User.findByIdAndUpdate(teacherUserId, {
          isActive: true,
          $unset: { vacationStartDate: "", vacationEndDate: "" }
        });

        // Safety net: restore future classes that were temporarily put on hold/cancelled
        // because of this vacation but never restored due prior workflow gaps.
        await Class.updateMany(
          {
            teacher: teacherUserId,
            scheduledDate: { $gte: now },
            status: { $in: ['on_hold', 'cancelled'] },
            'cancellation.vacationId': vacation._id,
            'cancellation.isTemporary': true,
          },
          {
            $set: { status: 'scheduled', hidden: false },
            $unset: { cancellation: "" },
          }
        );
      }
      if (vacation.status !== 'ended') {
        vacation.status = 'ended';
        vacation.actualEndDate = vacation.actualEndDate || vacation.endDate;
        vacation.endedAt = vacation.endedAt || now;
        await vacation.save();
      }
      await deactivateUnavailablePeriodForVacation(vacation, vacation.actualEndDate || vacation.endDate);
    }

    // Find teachers whose vacation should start today and deactivate them
    const startingVacations = await Vacation.find({
      role: 'teacher',
      approvalStatus: 'approved',
      status: { $in: ['approved', 'pending'] },
      startDate: { $lte: now },
      $expr: {
        $gte: [ { $ifNull: ['$actualEndDate', '$endDate'] }, now ]
      }
    }).populate('user');

    for (const vacation of startingVacations) {
      if (vacation.user && vacation.user.isActive) {
        await setTeacherInactive(vacation);
      }
      if (vacation.status !== 'active') {
        vacation.status = 'active';
        vacation.actualStartDate = vacation.actualStartDate || now;
        await vacation.save();
      }
      await upsertUnavailablePeriodForVacation(vacation);
    }

    console.log(`Updated vacation statuses: ${endedVacations.length} reactivated, ${startingVacations.length} checked for deactivation`);
  } catch (error) {
    console.error('Error updating teacher vacation statuses:', error);
  }
}

// Check if a user (teacher or student) is on vacation during a given date
async function getVacationForUserOnDate(userId, date) {
  try {
    return await Vacation.findOne({
      user: userId,
      startDate: { $lte: date },
      endDate: { $gte: date },
      approvalStatus: 'approved' // Only consider approved vacations
    });
  } catch (error) {
    console.error('Error checking vacation status:', error);
    throw new Error('Failed to check vacation status');
  }
}

/**
 * For a teacher vacation, assign substitute teachers to students' classes during the vacation period
 * For a student vacation, mark classes as on hold or cancelled
 * This function should be called after creating or updating a vacation
 */
async function applyVacationToClasses(vacation) {
  if (!vacation || !vacation.user || !vacation.startDate || !vacation.endDate) {
    throw new Error('Invalid vacation data provided');
  }

  const effectiveEnd = vacation.actualEndDate || vacation.endDate;
  const startWindow = new Date(vacation.startDate);
  const endWindow = new Date(effectiveEnd);
  const summary = {
    role: vacation.role,
    processedClasses: 0,
    cancelled: 0,
    onHold: 0,
    substituted: 0,
    unchanged: 0,
    impactedStudents: 0,
    impactedStudentIds: [],
    availabilityWindow: null
  };
  const impactedStudentSet = new Set();

  console.log(`Processing ${vacation.role} vacation for user ${vacation.user} from ${vacation.startDate} to ${effectiveEnd}`);
  
  try {
    if (vacation.role === 'teacher') {
      // Find all classes for this teacher during the vacation period
      const classes = await Class.find({
        teacher: vacation.user,
        status: { $nin: ['cancelled', 'cancelled_by_teacher', 'cancelled_by_guardian', 'cancelled_by_admin'] },
        scheduledDate: { $lt: endWindow },
        $expr: {
          $gt: [
            { $add: ['$scheduledDate', { $multiply: ['$duration', 60000] }] },
            startWindow
          ]
        }
      });

      console.log(`Found ${classes.length} classes to process`);

      for (const cls of classes) {
        try {
          summary.processedClasses += 1;
          impactedStudentSet.add(String(cls.student.studentId));
          // Find the handling preference for this student
          const sub = (vacation.substitutes || []).find(s => String(s.studentId) === String(cls.student.studentId));
          
          if (!sub) {
            // If no preference set, default to hold
            cls.status = 'cancelled';
            summary.cancelled += 1;
            if (!cls.cancellation) {
              cls.cancellation = {};
            }
            cls.cancellation.reason = 'Teacher vacation - no preference set';
            cls.cancellation.cancelledBy = vacation.approvedBy;
            cls.cancellation.cancelledAt = new Date();
            cls.cancellation.isTemporary = true;
            cls.cancellation.vacationId = vacation._id;
          } else if (sub.handling === 'substitute' && sub.substituteTeacherId) {
            // Assign substitute teacher
            summary.substituted += 1;
            if (!cls.rescheduleHistory) {
              cls.rescheduleHistory = [];
            }
            cls.rescheduleHistory.push({
              oldDate: cls.scheduledDate,
              newDate: cls.scheduledDate,
              reason: 'Teacher vacation - substitute assigned',
              rescheduledBy: vacation.approvedBy,
              originalTeacher: vacation.user,
              vacationId: vacation._id
            });
            
            cls.teacher = sub.substituteTeacherId;
            cls.status = 'scheduled'; // Keep as scheduled with new teacher
          } else if (sub.handling === 'hold') {
            // Mark as on hold - should not appear in lists
            cls.status = 'on_hold';
            summary.onHold += 1;
            if (!cls.cancellation) {
              cls.cancellation = {};
            }
            cls.cancellation.reason = 'Teacher vacation - class on hold';
            cls.cancellation.cancelledBy = vacation.approvedBy;
            cls.cancellation.cancelledAt = new Date();
            cls.cancellation.isTemporary = true;
            cls.hidden = true; // This will make it not appear in lists
            cls.cancellation.vacationId = vacation._id;
          } else if (sub.handling === 'cancel') {
            // Mark as permanently cancelled
            cls.status = 'cancelled';
            summary.cancelled += 1;
            if (!cls.cancellation) {
              cls.cancellation = {};
            }
            cls.cancellation.reason = 'Teacher vacation - class cancelled';
            cls.cancellation.cancelledBy = vacation.approvedBy;
            cls.cancellation.cancelledAt = new Date();
            cls.cancellation.isTemporary = false;
            cls.cancellation.vacationId = vacation._id;
          } else {
            summary.unchanged += 1;
          }
          await cls.save();
          console.log(`Updated class ${cls._id} with status ${cls.status}`);
        } catch (classError) {
          console.error(`Error processing class ${cls._id}:`, classError);
          // Continue with other classes even if one fails
        }
      }
      summary.impactedStudents = impactedStudentSet.size;
      summary.impactedStudentIds = Array.from(impactedStudentSet);
      const unavailablePeriod = await upsertUnavailablePeriodForVacation(vacation, effectiveEnd);
      summary.availabilityWindow = unavailablePeriod ? {
        start: unavailablePeriod.startDateTime,
        end: unavailablePeriod.endDateTime,
        isActive: unavailablePeriod.isActive
      } : null;
      return summary;
    } else if (vacation.role === 'student') {
      // Find all classes for this student during the vacation period
      const classes = await Class.find({
        'student.studentId': vacation.user,
        status: { $nin: ['cancelled', 'cancelled_by_teacher', 'cancelled_by_guardian', 'cancelled_by_admin'] },
        scheduledDate: { $lt: endWindow },
        $expr: {
          $gt: [
            { $add: ['$scheduledDate', { $multiply: ['$duration', 60000] }] },
            startWindow
          ]
        }
      });

      console.log(`Found ${classes.length} student classes to process`);

      for (const cls of classes) {
        try {
          summary.processedClasses += 1;
          impactedStudentSet.add(String(cls.student.studentId));
          // Student vacations always cancel classes in the window
          cls.status = 'cancelled';
          cls.hidden = false;
          if (!cls.cancellation) {
            cls.cancellation = {};
          }
          cls.cancellation.reason = 'Student vacation';
          cls.cancellation.cancelledBy = vacation.approvedBy;
          cls.cancellation.cancelledAt = new Date();
          cls.cancellation.isTemporary = false;
          cls.cancellation.vacationId = vacation._id;
          summary.cancelled += 1;
          await cls.save();
          console.log(`Updated student class ${cls._id} with status ${cls.status}`);
        } catch (classError) {
          console.error(`Error processing student class ${cls._id}:`, classError);
          // Continue with other classes even if one fails
        }
      }
      summary.impactedStudents = impactedStudentSet.size;
      summary.impactedStudentIds = Array.from(impactedStudentSet);
      return summary;
    }
  } catch (error) {
    console.error('Error applying vacation to classes:', error);
    throw new Error('Failed to apply vacation to classes');
  }

  return summary;
}

async function restoreClassesAfterVacation(vacation, effectiveEndDate, options = {}) {
  if (vacation.role !== 'teacher') {
    return { restored: 0, reassigned: 0 };
  }

  const revertFrom = new Date(effectiveEndDate || Date.now());
  const revertTo = new Date(vacation.endDate);

  if (!(revertTo > revertFrom)) {
    return { restored: 0, reassigned: 0 };
  }

  let restored = 0;
  let reassigned = 0;

  try {
    const cancellableClasses = await Class.find({
      teacher: vacation.user,
      scheduledDate: { $gt: revertFrom, $lte: revertTo },
      'cancellation.vacationId': vacation._id
    });

    for (const cls of cancellableClasses) {
      if (cls.cancellation?.isTemporary !== false) {
        cls.status = 'scheduled';
        cls.hidden = false;
        cls.cancellation = undefined;
        await cls.save();
        restored += 1;
      }
    }

    const substituteMappings = (vacation.substitutes || []).filter(sub => sub.handling === 'substitute' && sub.studentId);
    if (substituteMappings.length > 0) {
      const studentIds = substituteMappings.map(sub => sub.studentId);
      const substituteClasses = await Class.find({
        'student.studentId': { $in: studentIds },
        scheduledDate: { $gt: revertFrom, $lte: revertTo }
      });

      for (const cls of substituteClasses) {
        if (String(cls.teacher) !== String(vacation.user)) {
          cls.teacher = vacation.user;
          cls.hidden = false;
          if (!cls.rescheduleHistory) {
            cls.rescheduleHistory = [];
          }
          cls.rescheduleHistory.push({
            oldDate: cls.scheduledDate,
            newDate: cls.scheduledDate,
            reason: 'Teacher returned early from vacation',
            rescheduledBy: options.endedBy,
            originalTeacher: vacation.user,
            vacationId: vacation._id,
            revertedVacationChange: true
          });
          cls.status = 'scheduled';
          await cls.save();
          reassigned += 1;
        }
      }
    }
    await upsertUnavailablePeriodForVacation(vacation, effectiveEndDate);
  } catch (error) {
    console.error('Error restoring classes after vacation:', error);
    throw new Error('Failed to restore classes after vacation');
  }

  return { restored, reassigned };
}

async function endVacationEarly(vacation, { endDate, reason, endedBy } = {}) {
  if (!vacation) {
    throw new Error('Vacation not found');
  }

  const now = new Date();
  const effectiveEndDate = endDate ? new Date(endDate) : now;

  if (isNaN(effectiveEndDate.getTime())) {
    throw new Error('Invalid end date provided');
  }

  if (effectiveEndDate < vacation.startDate) {
    throw new Error('End date cannot be before the vacation start date');
  }

  const previousEffectiveEnd = vacation.actualEndDate || vacation.endDate;

  vacation.actualEndDate = effectiveEndDate;
  vacation.endedAt = now;
  vacation.endedBy = endedBy || vacation.endedBy;
  vacation.endReason = reason || vacation.endReason;
  const startDate = new Date(vacation.startDate);
  if (effectiveEndDate <= now) {
    vacation.status = 'ended';
  } else if (startDate <= now) {
    vacation.status = 'active';
  } else {
    vacation.status = 'approved';
  }

  await vacation.save();

  const restorationResult = await restoreClassesAfterVacation(vacation, effectiveEndDate, { endedBy });

  await deactivateUnavailablePeriodForVacation(vacation, effectiveEndDate);

  if (vacation.role === 'teacher') {
    await User.findByIdAndUpdate(vacation.user, {
      vacationEndDate: effectiveEndDate
    });
    if (effectiveEndDate <= now) {
      await reactivateTeacher(vacation.user);
    }
  }

  console.log(`Vacation ${vacation._id} ended early. Previous end ${previousEffectiveEnd}, new end ${effectiveEndDate}`);

  return {
    vacation,
    restorationResult
  };
}

async function getTeacherVacationImpact({ teacherId, startDate, endDate, existingMappings = [] }) {
  if (!teacherId || !startDate || !endDate) {
    return {
      teacherId: teacherId || null,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      totalClasses: 0,
      totalStudents: 0,
      totalMinutes: 0,
      students: []
    };
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return {
      teacherId,
      startDate: start,
      endDate: end,
      totalClasses: 0,
      totalStudents: 0,
      totalMinutes: 0,
      students: []
    };
  }

  const existingMap = new Map(
    (existingMappings || []).map(mapping => [
      String(mapping.studentId),
      {
        handling: mapping.handling,
        substituteTeacherId: mapping.substituteTeacherId
      }
    ])
  );

  const classes = await Class.find({
    teacher: teacherId,
    status: { $nin: ['cancelled', 'cancelled_by_teacher', 'cancelled_by_guardian', 'cancelled_by_admin'] },
    scheduledDate: { $lt: end },
    $expr: {
      $gt: [
        { $add: ['$scheduledDate', { $multiply: ['$duration', 60000] }] },
        start
      ]
    }
  })
    .populate({
      path: 'student.guardianId',
      select: 'firstName lastName fullName email phone'
    })
    .sort({ scheduledDate: 1 })
    .lean();

  const grouped = new Map();
  let totalMinutes = 0;

  for (const cls of classes) {
    if (!cls?.student?.studentId) {
      continue;
    }
    const studentId = String(cls.student.studentId);
    totalMinutes += cls.duration || 0;
    const classStart = new Date(cls.scheduledDate);
    const classEnd = new Date(classStart.getTime() + (cls.duration || 0) * 60000);

    let studentEntry = grouped.get(studentId);
    if (!studentEntry) {
      const guardian = cls.student?.guardianId || {};
      const guardianName = guardian.fullName || [guardian.firstName, guardian.lastName].filter(Boolean).join(' ').trim() || null;
      studentEntry = {
        studentId,
        studentName: cls.student?.studentName || 'Unknown Student',
        guardianId: guardian?._id || null,
        guardianName,
        guardianEmail: guardian?.email || null,
        classes: [],
        configuredHandling: existingMap.get(studentId) || null
      };
      grouped.set(studentId, studentEntry);
    }

    studentEntry.classes.push({
      classId: cls._id,
      scheduledDate: classStart,
      endDate: classEnd,
      duration: cls.duration,
      status: cls.status,
      subject: cls.subject,
      timezone: cls.timezone
    });
  }

  const students = Array.from(grouped.values()).map(student => {
    student.classes.sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));
    student.firstClassStart = student.classes[0]?.scheduledDate || null;
    student.lastClassEnd = student.classes[student.classes.length - 1]?.endDate || null;
    return student;
  });

  return {
    teacherId,
    startDate: start,
    endDate: end,
    totalClasses: classes.length,
    totalStudents: students.length,
    totalMinutes,
    students
  };
}

module.exports = {
  getVacationForUserOnDate,
  applyVacationToClasses,
  setTeacherInactive,
  reactivateTeacher,
  updateTeacherVacationStatuses,
  restoreClassesAfterVacation,
  endVacationEarly,
  getTeacherVacationImpact
};