/**
 * DST (Daylight Saving Time) Service
 * 
 * Handles DST transitions, notifications, and automatic class time adjustments
 * Student timezone is always the anchor for class times
 */

const moment = require('moment-timezone');
const Class = require('../models/Class');
const User = require('../models/User');
const Notification = require('../models/Notification');
const notificationService = require('./notificationService');

/**
 * Get DST transitions for a timezone in a given year
 * @param {string} timezone - Timezone to check
 * @param {number} year - Year to check (default: current year)
 * @returns {Array} Array of DST transitions
 */
const getDSTTransitions = (timezone, year = new Date().getFullYear()) => {
  try {
    const transitions = [];
    const startOfYear = moment.tz(`${year}-01-01`, timezone);
    const endOfYear = moment.tz(`${year}-12-31`, timezone);
    
    // Check each month for offset changes
    for (let month = 0; month < 12; month++) {
      const startOfMonth = moment.tz(`${year}-${(month + 1).toString().padStart(2, '0')}-01`, timezone);
      const midMonth = startOfMonth.clone().add(15, 'days');
      const endOfMonth = startOfMonth.clone().endOf('month');
      
      // Check for transitions
      if (startOfMonth.utcOffset() !== midMonth.utcOffset()) {
        const transition = findDSTTransition(timezone, startOfMonth, midMonth);
        if (transition) transitions.push(transition);
      }
      
      if (midMonth.utcOffset() !== endOfMonth.utcOffset()) {
        const transition = findDSTTransition(timezone, midMonth, endOfMonth);
        if (transition) transitions.push(transition);
      }
    }
    
    return transitions;
  } catch (error) {
    console.error('Get DST transitions error:', error);
    return [];
  }
};

/**
 * Find exact DST transition between two dates
 * @param {string} timezone - Timezone
 * @param {moment} start - Start date
 * @param {moment} end - End date
 * @returns {object|null} Transition info
 */
const findDSTTransition = (timezone, start, end) => {
  try {
    let current = start.clone();
    const endTime = end.clone();
    
    while (current.isBefore(endTime)) {
      const next = current.clone().add(1, 'hour');
      
      if (current.utcOffset() !== next.utcOffset()) {
        const offsetDiff = next.utcOffset() - current.utcOffset();
        
        return {
          date: next.toDate(),
          timezone,
          type: offsetDiff > 0 ? 'spring_forward' : 'fall_back',
          offsetBefore: current.utcOffset(),
          offsetAfter: next.utcOffset(),
          timeDifference: Math.abs(offsetDiff) // in minutes
        };
      }
      
      current = next;
    }
    
    return null;
  } catch (error) {
    console.error('Find DST transition error:', error);
    return null;
  }
};

/**
 * Check for upcoming DST transitions and send warnings
 * @param {number} warningDays - Days before transition to warn
 */
const checkAndNotifyDSTTransitions = async (warningDays = 7) => {
  try {
    console.log('🕰️ Checking for upcoming DST transitions...');
    
    // Get all unique timezones from users
    const userTimezones = await User.distinct('timezone');
    const now = new Date();
    const warningDate = new Date(now.getTime() + (warningDays * 24 * 60 * 60 * 1000));
    
    for (const timezone of userTimezones) {
      if (!timezone) continue;
      
      // Get DST transitions for this timezone
      const transitions = getDSTTransitions(timezone);
      
      // Find transitions within warning period
      const upcomingTransitions = transitions.filter(transition => {
        const transitionDate = new Date(transition.date);
        return transitionDate > now && transitionDate <= warningDate;
      });
      
      for (const transition of upcomingTransitions) {
        await sendDSTWarningNotification(transition, timezone);
      }
    }
  } catch (error) {
    console.error('Check and notify DST transitions error:', error);
  }
};

/**
 * Send DST warning notification to users
 * @param {object} transition - DST transition info
 * @param {string} timezone - Timezone
 */
const sendDSTWarningNotification = async (transition, timezone) => {
  try {
    // Find users in this timezone
    const users = await User.find({ timezone, isActive: true });
    
    if (users.length === 0) return;
    
    const daysUntil = Math.ceil((new Date(transition.date) - new Date()) / (1000 * 60 * 60 * 24));
    const action = transition.type === 'spring_forward' ? 'move forward' : 'move back';
    const direction = transition.type === 'spring_forward' ? 'ahead' : 'back';
    const hours = transition.timeDifference / 60;
    const amount = `${hours} hour${hours !== 1 ? 's' : ''}`;
    
    let title, message;
    
    const dateLabel = moment(transition.date).format('ddd, MMM D, YYYY');

    if (daysUntil === 0) {
      title = 'Daylight saving time update';
      message = `Daylight saving time changes today. Clocks ${action} by ${amount} (${direction}). Your class times will stay correct in your local time.`;
    } else if (daysUntil === 1) {
      title = 'Daylight saving time update';
      message = `Daylight saving time changes tomorrow. Clocks ${action} by ${amount} (${direction}). Your class times will stay correct in your local time.`;
    } else {
      title = 'Daylight saving time update';
      message = `Daylight saving time changes on ${dateLabel}. Clocks ${action} by ${amount} (${direction}). Your class times will stay correct in your local time.`;
    }

    await Promise.allSettled(users.map((u) => (
      notificationService.createNotification({
        userId: u._id,
        title,
        message,
        type: 'info',
        relatedTo: 'dst_transition',
        metadata: {
          transition,
          timezone,
          daysUntil
        }
      })
    )));
    
    console.log(`📧 Sent DST warning to ${users.length} users in ${timezone}`);
  } catch (error) {
    console.error('Send DST warning notification error:', error);
  }
};

/**
 * Adjust class times for DST transitions (student timezone anchored)
 * @param {object} transition - DST transition info
 */
const adjustClassTimesForDST = async (transition) => {
  try {
    console.log(`🔄 Adjusting class times for DST transition in ${transition.timezone}...`);
    
    const transitionDate = new Date(transition.date);
    const oneDayAfter = new Date(transitionDate.getTime() + (24 * 60 * 60 * 1000));
    
    // Find classes where student timezone matches the transition timezone
    // and class is scheduled after the transition
    const classesToAdjust = await Class.find({
      scheduledDate: { $gte: transitionDate },
      anchoredTimezone: 'student',
      $or: [
        { 'student.timezone': transition.timezone },
        // For embedded students, check the guardian's students array
        {
          'student.guardianId': {
            $in: await User.find({
              'guardianInfo.students.timezone': transition.timezone
            }).distinct('_id')
          }
        }
      ]
    }).populate('student.guardianId').populate('teacher');
    
    let adjustedCount = 0;
    
    for (const classDoc of classesToAdjust) {
      try {
        // Get student timezone
        let studentTimezone = transition.timezone;
        
        if (classDoc.student.guardianId) {
          const guardian = classDoc.student.guardianId;
          const student = guardian.guardianInfo?.students?.id(classDoc.student.studentId);
          if (student?.timezone) {
            studentTimezone = student.timezone;
          }
        }
        
        // Only adjust if student timezone matches transition timezone
        if (studentTimezone !== transition.timezone) continue;
        
        const originalTime = new Date(classDoc.scheduledDate);
        
        // Calculate adjusted time to maintain student's local time
        const adjustedTime = adjustClassTimeForDSTTransition(
          originalTime,
          transition,
          studentTimezone
        );
        
        if (adjustedTime.getTime() !== originalTime.getTime()) {
          // Update class time
          classDoc.scheduledDate = adjustedTime;
          
          // Record the adjustment
          if (!classDoc.dstInfo) {
            classDoc.dstInfo = { dstAdjustments: [] };
          }
          
          classDoc.dstInfo.dstAdjustments.push({
            adjustmentDate: new Date(),
            reason: `DST ${transition.type} transition`,
            oldTime: originalTime,
            newTime: adjustedTime,
            affectedTimezone: transition.timezone,
            adjustmentType: transition.type
          });
          
          classDoc.dstInfo.lastDSTCheck = new Date();
          
          await classDoc.save();
          adjustedCount++;
          
          // Notify teacher and student about the adjustment
          await notifyClassTimeAdjustment(classDoc, originalTime, adjustedTime, transition);
        }
      } catch (error) {
        console.error(`Error adjusting class ${classDoc._id}:`, error);
      }
    }
    
    console.log(`✅ Adjusted ${adjustedCount} classes for DST transition in ${transition.timezone}`);
    return adjustedCount;
  } catch (error) {
    console.error('Adjust class times for DST error:', error);
    return 0;
  }
};

/**
 * Calculate adjusted class time for DST transition
 * @param {Date} originalTime - Original class time
 * @param {object} transition - DST transition info
 * @param {string} studentTimezone - Student's timezone
 * @returns {Date} Adjusted class time
 */
const adjustClassTimeForDSTTransition = (originalTime, transition, studentTimezone) => {
  try {
    // Student timezone is the anchor - maintain the local time in student's timezone
    const studentMoment = moment.tz(originalTime, studentTimezone);
    
    // The student's local time should remain the same
    // Convert back to UTC with the new DST offset
    return studentMoment.utc().toDate();
  } catch (error) {
    console.error('Adjust class time for DST transition error:', error);
    return originalTime;
  }
};

/**
 * Notify users about class time adjustments due to DST
 * @param {object} classDoc - Class document
 * @param {Date} originalTime - Original class time
 * @param {Date} newTime - New class time
 * @param {object} transition - DST transition info
 */
const notifyClassTimeAdjustment = async (classDoc, originalTime, newTime, transition) => {
  try {
    const recipients = [classDoc.teacher._id];
    
    // Add student/guardian to recipients
    if (classDoc.student.guardianId) {
      recipients.push(classDoc.student.guardianId._id);
    }
    
    const action = transition.type === 'spring_forward' ? 'spring forward' : 'fall back';
    const originalTimeStr = moment(originalTime).format('dddd, MMMM Do, YYYY [at] h:mm A');
    const newTimeStr = moment(newTime).format('dddd, MMMM Do, YYYY [at] h:mm A');
    
    await notificationService.createNotification({
      recipients,
      title: '🕰️ Class Time Adjusted for Daylight Saving Time',
      message: `Due to daylight saving time (clocks ${action}), your class "${classDoc.title}" has been automatically adjusted from ${originalTimeStr} to ${newTimeStr}. The class time remains consistent in the student's local timezone.`,
      type: 'info',
      relatedTo: 'class',
      relatedId: classDoc._id,
      metadata: {
        originalTime,
        newTime,
        transition,
        adjustmentReason: 'dst_transition'
      }
    });
  } catch (error) {
    console.error('Notify class time adjustment error:', error);
  }
};

/**
 * Check for DST transitions and adjust classes (scheduled job)
 */
const performDSTCheck = async () => {
  try {
    console.log('🔍 Performing scheduled DST check...');
    
    // Send warnings for upcoming transitions (7 days ahead)
    await checkAndNotifyDSTTransitions(7);
    
    // Check for transitions happening today and adjust classes
    const today = new Date();
    const tomorrow = new Date(today.getTime() + (24 * 60 * 60 * 1000));
    
    // Get all unique timezones
    const userTimezones = await User.distinct('timezone');
    
    for (const timezone of userTimezones) {
      if (!timezone) continue;
      
      const transitions = getDSTTransitions(timezone);
      const todayTransitions = transitions.filter(transition => {
        const transitionDate = new Date(transition.date);
        return transitionDate >= today && transitionDate < tomorrow;
      });
      
      for (const transition of todayTransitions) {
        await adjustClassTimesForDST(transition);
      }
    }
    
    console.log('✅ DST check completed');
  } catch (error) {
    console.error('Perform DST check error:', error);
  }
};

/**
 * Get DST info for a specific timezone
 * @param {string} timezone - Timezone to check
 * @returns {object} DST information
 */
const getDSTInfo = (timezone) => {
  try {
    const currentYear = new Date().getFullYear();
    const transitions = getDSTTransitions(timezone, currentYear);
    const now = new Date();
    
    const upcomingTransitions = transitions.filter(t => new Date(t.date) > now);
    const recentTransitions = transitions.filter(t => new Date(t.date) <= now);
    
    return {
      timezone,
      currentYear,
      hasDST: transitions.length > 0,
      transitions,
      upcomingTransitions,
      recentTransitions,
      nextTransition: upcomingTransitions.length > 0 ? upcomingTransitions[0] : null,
      lastTransition: recentTransitions.length > 0 ? recentTransitions[recentTransitions.length - 1] : null
    };
  } catch (error) {
    console.error('Get DST info error:', error);
    return {
      timezone,
      hasDST: false,
      transitions: [],
      upcomingTransitions: [],
      recentTransitions: [],
      nextTransition: null,
      lastTransition: null
    };
  }
};

module.exports = {
  getDSTTransitions,
  checkAndNotifyDSTTransitions,
  adjustClassTimesForDST,
  performDSTCheck,
  getDSTInfo,
  sendDSTWarningNotification
};