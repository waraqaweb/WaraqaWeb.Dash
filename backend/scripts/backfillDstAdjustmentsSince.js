require('dotenv').config();

const mongoose = require('mongoose');
const Class = require('../models/Class');
const dstService = require('../services/dstService');
const { resolveStudentTimezone } = require('../services/classTimezoneService');
const { DEFAULT_TIMEZONE } = require('../utils/timezoneUtils');

const ACTIVE_CLASS_STATUSES = ['scheduled', 'in_progress'];

const parseArgs = (argv = []) => {
	const args = {
		since: '2026-01-15T00:00:00.000Z',
		until: '',
		dryRun: false,
	};

	for (const raw of argv) {
		if (raw === '--dry-run') args.dryRun = true;
		if (raw.startsWith('--since=')) args.since = raw.split('=')[1] || args.since;
		if (raw.startsWith('--until=')) args.until = raw.split('=')[1] || '';
	}

	return args;
};

const toDate = (value, fallback = null) => {
	if (!value) return fallback;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? fallback : date;
};

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const since = toDate(args.since);
	const until = toDate(args.until, new Date());

	if (!since || !until) {
		throw new Error('Invalid --since or --until date');
	}

	const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/waraqadb';
	await mongoose.connect(mongoUri);

	console.log(`[backfillDstAdjustmentsSince] start since=${since.toISOString()} until=${until.toISOString()} dryRun=${args.dryRun}`);

	const classes = await Class.find({
		anchoredTimezone: 'student',
		status: { $in: ACTIVE_CLASS_STATUSES },
		scheduledDate: { $gte: since, $lte: until },
		hidden: { $ne: true },
	})
		.select('student timeAnchor timezone scheduledDate')
		.populate('student.guardianId', 'timezone guardianInfo.students')
		.lean();

	const timezoneSet = new Set();
	for (const classDoc of classes) {
		const studentTimezone = resolveStudentTimezone({
			guardianDoc: classDoc?.student?.guardianId,
			studentId: classDoc?.student?.studentId,
			fallbackTimezone: classDoc?.timeAnchor?.timezone || classDoc?.timezone || DEFAULT_TIMEZONE,
		});
		if (studentTimezone) timezoneSet.add(studentTimezone);
	}

	const transitions = [];
	const years = [];
	for (let year = since.getUTCFullYear(); year <= until.getUTCFullYear(); year += 1) {
		years.push(year);
	}

	for (const timezone of Array.from(timezoneSet)) {
		for (const year of years) {
			const yearTransitions = await dstService.getDSTTransitions(timezone, year);
			transitions.push(
				...yearTransitions.filter((transition) => transition.date >= since && transition.date <= until)
			);
		}
	}

	transitions.sort((a, b) => a.date - b.date);

	let processedTransitions = 0;
	let affectedClasses = 0;
	let adjustedClasses = 0;

	for (const transition of transitions) {
		processedTransitions += 1;
		const impactPreview = await dstService.buildTransitionImpactPreview(transition, {
			startDate: transition.date > since ? transition.date : since,
			endDate: until,
		});

		const pendingCount = Number(impactPreview?.summary?.pendingClasses || 0);
		if (!pendingCount) continue;

		affectedClasses += pendingCount;
		console.log(`[backfillDstAdjustmentsSince] transition=${transition.timezone} at=${transition.date.toISOString()} pendingClasses=${pendingCount}`);

		if (!args.dryRun) {
			const result = await dstService.adjustClassTimesForDST(transition, {
				startDate: transition.date > since ? transition.date : since,
				endDate: until,
				source: 'backfill',
			});
			adjustedClasses += Number(result?.adjustedCount || 0);
			console.log(`[backfillDstAdjustmentsSince] adjusted=${result?.adjustedCount || 0} skippedAlreadyApplied=${result?.skippedAlreadyApplied || 0}`);
		}
	}

	console.log('[backfillDstAdjustmentsSince] done', {
		discoveredClasses: classes.length,
		trackedTimezones: timezoneSet.size,
		processedTransitions,
		affectedClasses,
		adjustedClasses: args.dryRun ? 0 : adjustedClasses,
		dryRun: args.dryRun,
	});

	await mongoose.connection.close();
}

main().catch(async (error) => {
	console.error('[backfillDstAdjustmentsSince] fatal', error);
	try {
		await mongoose.connection.close();
	} catch (closeErr) {
		console.error('[backfillDstAdjustmentsSince] close error', closeErr);
	}
	process.exitCode = 1;
});
