const Class = require('../models/Class');
const { generateRecurringClasses } = require('../utils/generateRecurringClasses');

async function runGenerateRecurringClasses(options = {}) {
  const patterns = await Class.findPatternsNeedingGeneration();
  let totalCreated = 0;
  for (const p of patterns) {
    try {
      const perDayMap = new Map();
      if (Array.isArray(p.recurrenceDetails)) {
        for (const slot of p.recurrenceDetails) {
          const d = Number(slot.dayOfWeek);
          const [hh, mm] = (slot.time || '').split(':').map((s) => parseInt(s, 10));
          const entry = { hours: hh, minutes: mm, duration: slot.duration || p.duration, timezone: slot.timezone || p.timezone };
          const existing = perDayMap.get(d) || [];
          existing.push(entry);
          perDayMap.set(d, existing);
        }
      }

      const generated = await generateRecurringClasses(p, p.recurrence?.generationPeriodMonths || 2, perDayMap);
      totalCreated += generated.length;
    } catch (err) {
      console.error('Error generating classes for pattern', p._id, err && err.message);
    }
  }
  console.log(`[jobs] generateRecurringClassesJob: created ${totalCreated} classes`);
  return totalCreated;
}

module.exports = { runGenerateRecurringClasses };
