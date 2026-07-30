/*
  Cleanup duplicate Google Calendar events for Waraqa meetings.

  Dedup key: title suffix after ':' (case-insensitive), e.g.
    "Waraqa New Teacher Interview: Hassan Mohammad" -> "hassan mohammad"

  Keeps one event per identifier and deletes the rest.

  Usage:
    node scripts/cleanupGoogleCalendarMeetingDuplicates.js --dry-run
    node scripts/cleanupGoogleCalendarMeetingDuplicates.js --apply
*/

const path = require('path');
const { google } = require('googleapis');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const CALENDAR_SCOPE = ['https://www.googleapis.com/auth/calendar'];
const WARAQA_PREFIXES = [
  'Waraqa Evaluation Session:',
  'Waraqa Follow-up Meeting:',
  'Waraqa Teacher Sync:',
  'Waraqa New Teacher Interview:'
];

const normalizePrivateKey = (raw) => {
  if (!raw) return '';
  let key = String(raw).trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, '\n');
};

const getConfig = () => {
  return {
    calendarId: (process.env.GOOGLE_CALENDAR_ID || '').trim(),
    clientEmail: (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim(),
    privateKey: normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || ''),
  };
};

const extractIdentifier = (summary) => {
  const raw = String(summary || '').trim();
  if (!raw) return '';
  const idx = raw.indexOf(':');
  if (idx === -1) return '';
  return raw.slice(idx + 1).trim().toLowerCase();
};

const isWaraqaMeetingSummary = (summary) => {
  const raw = String(summary || '').trim();
  if (!raw) return false;
  return WARAQA_PREFIXES.some((prefix) => raw.startsWith(prefix));
};

const parseDate = (event) => {
  const raw = event?.start?.dateTime || event?.start?.date || null;
  if (!raw) return new Date(0);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return new Date(0);
  return parsed;
};

const hasMeetingLink = (event) => {
  const meetingId = event?.extendedProperties?.private?.waraqaMeetingId;
  return Boolean(meetingId);
};

const chooseKeeper = (events) => {
  const sorted = [...events].sort((a, b) => {
    const aLinked = hasMeetingLink(a) ? 1 : 0;
    const bLinked = hasMeetingLink(b) ? 1 : 0;
    if (aLinked !== bLinked) return bLinked - aLinked;

    const at = parseDate(a).getTime();
    const bt = parseDate(b).getTime();
    if (at !== bt) return bt - at;

    const aUpdated = new Date(a.updated || 0).getTime();
    const bUpdated = new Date(b.updated || 0).getTime();
    return bUpdated - aUpdated;
  });

  return sorted[0] || null;
};

const parseArgs = () => {
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;
  return { apply, dryRun };
};

async function loadAllRelevantEvents(calendar, calendarId) {
  const all = [];
  let pageToken;

  const now = new Date();
  const from = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 730 * 24 * 60 * 60 * 1000);

  for (let i = 0; i < 40; i += 1) {
    const res = await calendar.events.list({
      calendarId,
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: true,
      showDeleted: false,
      maxResults: 2500,
      orderBy: 'startTime',
      pageToken,
    });

    const items = Array.isArray(res?.data?.items) ? res.data.items : [];
    all.push(...items.filter((e) => e && e.status !== 'cancelled' && isWaraqaMeetingSummary(e.summary)));

    pageToken = res?.data?.nextPageToken;
    if (!pageToken) break;
  }

  return all;
}

async function main() {
  const { apply, dryRun } = parseArgs();
  const { calendarId, clientEmail, privateKey } = getConfig();
  if (!calendarId || !clientEmail || !privateKey) {
    throw new Error('Missing GOOGLE_CALENDAR_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: CALENDAR_SCOPE,
  });
  const calendar = google.calendar({ version: 'v3', auth });

  const events = await loadAllRelevantEvents(calendar, calendarId);
  const groups = new Map();

  for (const event of events) {
    const identifier = extractIdentifier(event.summary);
    if (!identifier) continue;
    if (!groups.has(identifier)) groups.set(identifier, []);
    groups.get(identifier).push(event);
  }

  const duplicates = [];
  for (const [identifier, group] of groups.entries()) {
    if (group.length <= 1) continue;
    const keeper = chooseKeeper(group);
    const toDelete = group.filter((e) => e.id !== keeper.id);
    duplicates.push({ identifier, keeper, toDelete });
  }

  let deleted = 0;
  const sample = [];
  for (const group of duplicates) {
    sample.push({
      identifier: group.identifier,
      keep: group.keeper.summary,
      removeCount: group.toDelete.length,
    });

    if (!apply) continue;

    for (const ev of group.toDelete) {
      await calendar.events.delete({
        calendarId,
        eventId: ev.id,
        sendUpdates: 'none',
      });
      deleted += 1;
    }
  }

  console.log('Google calendar meeting duplicate cleanup complete.');
  console.log({
    mode: dryRun ? 'dry-run' : 'apply',
    scannedWaraqaEvents: events.length,
    duplicateIdentifierGroups: duplicates.length,
    duplicateEventsToRemove: duplicates.reduce((sum, g) => sum + g.toDelete.length, 0),
    deleted,
    sample: sample.slice(0, 20),
  });
}

main().catch((error) => {
  console.error('cleanupGoogleCalendarMeetingDuplicates failed:', error.message || error);
  process.exitCode = 1;
});
