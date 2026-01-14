import api from '../api/axios';

const STORAGE_KEY = 'waraqa:subjectsCatalog:v1';
const DEFAULT_TTL_MS = 15 * 60 * 1000;

const safeJsonParse = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (e) {
    return null;
  }
};

const toName = (item) => {
  if (!item) return '';
  if (typeof item === 'string') return item.trim();
  if (typeof item === 'object') return String(item.name || item.label || item.value || '').trim();
  return '';
};

const normalizeNameList = (list) => {
  if (!Array.isArray(list)) return [];
  const names = list.map(toName).filter(Boolean);
  return Array.from(new Set(names));
};

const normalizeTopicsBySubject = (topicsBySubject) => {
  if (!topicsBySubject || typeof topicsBySubject !== 'object') return {};
  const result = {};
  for (const [subject, rawTopics] of Object.entries(topicsBySubject)) {
    const key = String(subject || '').trim();
    if (!key) continue;
    result[key] = normalizeNameList(rawTopics);
  }
  return result;
};

export const normalizeSubjectsCatalog = (raw) => {
  const value = raw && typeof raw === 'object' ? raw : null;

  // v2 shape (hierarchical): { version: 2, subjects: [{ name, courses:[{ name, levels:[{ name, topics:[] }]}]}] }
  // We keep backwards-compat for existing UI by deriving:
  // - subjects: the list of LEVEL names ("--...") since those are the items that appear in the app today.
  // - topicsBySubject: topics per LEVEL.
  // - levels: optional global list (used in some UIs); keep existing value.levels if provided.
  if (value?.version === 2 && Array.isArray(value?.subjects)) {
    const derivedSubjects = [];
    const derivedTopicsBySubject = {};

    const seen = new Set();
    const isGenericLevel = (name) => /^level\s*\d+/i.test(name);

    const reserveKey = (key) => {
      if (!key) return null;
      if (!seen.has(key)) {
        seen.add(key);
        return key;
      }
      return null;
    };

    const getLevelKey = ({ courseName, levelName }) => {
      const base = String(levelName || '').trim();
      const course = String(courseName || '').trim();
      if (!base) return '';

      // If a level label is generic ("Level 1") or collides, prefix with course.
      if (isGenericLevel(base)) {
        return `${course} - ${base}`.trim();
      }

      const reserved = reserveKey(base);
      if (reserved) return reserved;
      return `${course} - ${base}`.trim();
    };

    for (const subject of value.subjects) {
      const courses = Array.isArray(subject?.courses) ? subject.courses : [];
      for (const course of courses) {
        const courseName = toName(course?.name);
        const levels = Array.isArray(course?.levels) ? course.levels : [];
        for (const level of levels) {
          const levelName = toName(level?.name);
          const key = getLevelKey({ courseName, levelName });
          if (!key) continue;

          derivedSubjects.push(key);
          const topics = normalizeNameList(level?.topics);
          // Keep topics as a list (deduped) but preserve order across duplicates in input is not possible here.
          // For most UIs, dedupe is preferred.
          derivedTopicsBySubject[key] = topics;
        }
      }
    }

    // Keep any explicit global levels list if present, otherwise default empty so existing fallbacks apply.
    const levels = normalizeNameList(value?.levels);
    return {
      raw: value,
      subjects: derivedSubjects,
      levels,
      topicsBySubject: derivedTopicsBySubject,
      // Extra fields for future use (non-breaking)
      tree: value.subjects,
    };
  }

  // v1 / legacy shape
  const subjects = normalizeNameList(value?.subjects);
  const levels = normalizeNameList(value?.levels);
  const topicsBySubject = normalizeTopicsBySubject(value?.topicsBySubject);

  return {
    raw: value,
    subjects,
    levels,
    topicsBySubject,
  };
};

export const fetchSubjectsCatalog = async () => {
  const res = await api.get('/settings/subjects-catalog');
  const raw = res.data?.catalog || null;
  return normalizeSubjectsCatalog(raw);
};

export const getSubjectsCatalogCached = async ({ ttlMs = DEFAULT_TTL_MS } = {}) => {
  const now = Date.now();
  const cached = safeJsonParse(sessionStorage.getItem(STORAGE_KEY));
  if (cached && cached.expiresAt && cached.expiresAt > now && cached.data) {
    return cached.data;
  }

  try {
    const data = await fetchSubjectsCatalog();
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        expiresAt: now + ttlMs,
        data,
      })
    );
    return data;
  } catch (e) {
    // If fetch fails but we have stale data, use it.
    if (cached?.data) return cached.data;
    return normalizeSubjectsCatalog(null);
  }
};

export const saveSubjectsCatalog = async (catalogValue) => {
  const res = await api.put('/settings/subjects-catalog', { value: catalogValue });
  const data = normalizeSubjectsCatalog(res.data?.catalog || null);
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      expiresAt: Date.now() + DEFAULT_TTL_MS,
      data,
    })
  );
  return data;
};
