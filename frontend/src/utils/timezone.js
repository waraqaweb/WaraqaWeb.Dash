import {
  TIMEZONE_LIST,
  DEFAULT_TIMEZONE as DEFAULT_TIMEZONE_SOURCE,
  getDynamicTimezoneList,
  getCurrentOffsetMinutes
} from './timezoneUtils';

export const DEFAULT_APP_TIMEZONE = DEFAULT_TIMEZONE_SOURCE;
export const MEETING_TIMEZONES = TIMEZONE_LIST;

const cloneTimezoneOption = (option) => ({
  value: option.value,
  label: option.label || option.value,
  country: option.country,
  city: option.city,
  region: option.region,
  offsetMinutes: typeof option.offsetMinutes === 'number'
    ? option.offsetMinutes
    : getCurrentOffsetMinutes(option.value)
});

export const getMeetingTimezoneOptions = ({ dynamicLabels = true } = {}) => {
  const source = dynamicLabels ? getDynamicTimezoneList() : MEETING_TIMEZONES;
  return source
    .map(cloneTimezoneOption)
    .sort((a, b) => {
      const offsetDiff = (a.offsetMinutes ?? 0) - (b.offsetMinutes ?? 0);
      if (offsetDiff !== 0) {
        return offsetDiff;
      }
      return (a.label || a.value).localeCompare(b.label || b.value);
    });
};

export const getPrioritizedMeetingTimezones = (primaryTimezone) => {
  const options = getMeetingTimezoneOptions();
  const normalized = typeof primaryTimezone === 'string' ? primaryTimezone.trim() : '';
  if (!normalized) {
    return options;
  }

  const index = options.findIndex((option) => option.value === normalized);
  if (index === -1) {
    return [
      {
        value: normalized,
        label: normalized,
        offsetMinutes: getCurrentOffsetMinutes(normalized)
      },
      ...options
    ];
  }

  const [selected] = options.splice(index, 1);
  return [selected, ...options];
};

export const getBrowserTimezone = (fallback = DEFAULT_APP_TIMEZONE) => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || fallback;
  } catch (error) {
    console.warn('Unable to detect browser timezone', error);
    return fallback;
  }
};
