import moment from "moment-timezone";

export const formatUtcToTz = (utcDate, timezone = "UTC") => {
  if (!utcDate) return "";
  return moment.utc(utcDate).tz(timezone).format("ddd MMM DD, YYYY [at] hh:mm A");
};

// 🔹 ADD THIS FUNCTION
export const formatTzToUtc = (date, timezone = "UTC") => {
  if (!date) return "";
  return moment.tz(date, timezone).utc().toDate();
};

export function nowOffsetLabel(tz) {
  const m = moment.tz(moment(), tz);
  const offset = m.utcOffset(); // minutes
  const sign = offset >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const mm = String(Math.abs(offset) % 60).padStart(2, '0');
  return `(UTC${sign}${hh}:${mm})`;
}

export function timezoneOptions() {
  return moment.tz.names()
    .filter(z => !z.startsWith("Etc/") && !z.includes("SystemV") && !z.includes("US/") && !z.includes("Canada/") && !z.includes("Mexico/"))
    .map(z => ({ value: z, label: `${nowOffsetLabel(z)} ${z}` }));
}
