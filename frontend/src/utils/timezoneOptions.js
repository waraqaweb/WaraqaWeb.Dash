// frontend/src/utils/timezoneOptions.js

import moment from "moment-timezone";

/**
 * Generates a full searchable list of time zones with:
 * - City name
 * - Country name
 * - Current GMT offset
 *
 * Example: "Cairo, Egypt (GMT+03:00)"
 */
export const getTimezoneOptions = () => {
  const zones = moment.tz.names().filter((tz) => tz !== 'Asia/Jerusalem');

  const options = zones.map((tz) => {
    const normalizedTz = tz === 'Asia/Hebron' || tz === 'Asia/Gaza' ? 'Asia/Hebron' : tz;
    const offset = moment.tz(tz).utcOffset();
    const sign = offset >= 0 ? "+" : "-";
    const hours = Math.floor(Math.abs(offset) / 60);
    const minutes = Math.abs(offset) % 60;

    const gmtOffset = `GMT${sign}${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}`;

    // Extract city and country (best effort)
    const parts = normalizedTz.split("/");
    let city = parts[1] ? parts[1].replace(/_/g, " ") : parts[0];
    let region = parts[0].replace(/_/g, " ");

    if (normalizedTz === 'Asia/Hebron') {
      city = 'Hebron';
      region = 'Palestine';
    }

    return {
      value: normalizedTz,
      label: `${city} (${region}) ${gmtOffset}`,
    };
  });

  return options.filter((option, index, array) => array.findIndex((item) => item.value === option.value) === index);
};
