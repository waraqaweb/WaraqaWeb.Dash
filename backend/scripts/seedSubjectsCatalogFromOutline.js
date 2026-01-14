require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Setting = require('../models/Setting');

const SUBJECTS_CATALOG_KEY = 'education.subjectsCatalog';

const normalizeLine = (line) => {
  if (line == null) return '';
  return String(line)
    .replace(/\uFEFF/g, '')
    .replace(/\r/g, '')
    .trim();
};

const parseOutline = (text) => {
  const lines = String(text || '')
    .split(/\n/)
    .map((l) => l.replace(/^\s+/, ''));

  /**
   * Output shape:
   * {
   *   version: 2,
   *   subjects: [{ name, courses: [{ name, levels: [{ name, topics: [] }] }] }]
   * }
   */
  const subjects = [];

  let currentSubject = null;
  let currentCourse = null;
  let currentLevel = null;

  const ensureSubject = (name) => {
    if (!name) return;
    if (!currentSubject || currentSubject.name !== name) {
      currentSubject = { name, courses: [] };
      subjects.push(currentSubject);
      currentCourse = null;
      currentLevel = null;
    }
  };

  const ensureCourse = (name) => {
    if (!currentSubject) return;
    if (!name) return;
    const last = currentSubject.courses[currentSubject.courses.length - 1];
    if (!last || last.name !== name) {
      currentCourse = { name, levels: [] };
      currentSubject.courses.push(currentCourse);
      currentLevel = null;
    } else {
      currentCourse = last;
    }
  };

  const ensureLevel = (name) => {
    if (!currentSubject) return;
    // Some outlines place levels directly under a subject (no explicit course line).
    // In that case, create an implicit course under the subject so levels/topics are preserved.
    if (!currentCourse) {
      ensureCourse(currentSubject.name);
    }
    if (!name) return;
    const last = currentCourse.levels[currentCourse.levels.length - 1];
    if (!last || last.name !== name) {
      currentLevel = { name, topics: [] };
      currentCourse.levels.push(currentLevel);
    } else {
      currentLevel = last;
    }
  };

  const pushTopic = (topic) => {
    if (!currentLevel) return;
    if (!topic) return;
    currentLevel.topics.push(topic);
  };

  const isProbablyLevelLabel = (name) => /^level\s*\d+/i.test(name);

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line) continue;

    // Ignore common outline headers.
    if (/^courses$/i.test(line)) continue;

    // Ignore common non-outline lines from draft files.
    if (/^(cd\s+|git\s+|chmod\s+|\.\/deploy\/)/i.test(line)) continue;
    if (/^#+\s*/.test(line)) continue;

    // Topics
    if (line.startsWith('---')) {
      const topic = normalizeLine(line.replace(/^---+\s*/, ''));
      if (topic) pushTopic(topic);
      continue;
    }

    // Level
    if (line.startsWith('--')) {
      const levelName = normalizeLine(line.replace(/^--+\s*/, ''));
      if (levelName) ensureLevel(levelName);
      continue;
    }

    // Course
    if (line.startsWith('-')) {
      const courseName = normalizeLine(line.replace(/^-+\s*/, ''));
      if (courseName) ensureCourse(courseName);
      continue;
    }

    // No dashes: either a new Subject or (sometimes) a Level label like "Level 1".
    if (currentCourse && isProbablyLevelLabel(line)) {
      ensureLevel(line);
      continue;
    }

    ensureSubject(line);
  }

  return {
    version: 2,
    subjects,
  };
};

async function main() {
  const argPath = process.argv[2];
  if (!argPath) {
    console.error('Usage: node backend/scripts/seedSubjectsCatalogFromOutline.js <path-to-outline-file>');
    console.error('Example: node backend/scripts/seedSubjectsCatalogFromOutline.js ./draft');
    process.exit(1);
  }

  const resolved = path.isAbsolute(argPath) ? argPath : path.resolve(process.cwd(), argPath);
  const inputText = fs.readFileSync(resolved, 'utf8');
  const value = parseOutline(inputText);

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
  await mongoose.connect(mongoUri);

  const setting = await Setting.findOneAndUpdate(
    { key: SUBJECTS_CATALOG_KEY },
    {
      key: SUBJECTS_CATALOG_KEY,
      value,
      description: 'Seeded from outline (Subject > Course > Level > Topics)',
    },
    { upsert: true, new: true }
  );

  const subjectCount = value.subjects.length;
  const courseCount = value.subjects.reduce((sum, s) => sum + (s.courses?.length || 0), 0);
  const levelCount = value.subjects.reduce(
    (sum, s) => sum + (s.courses || []).reduce((ss, c) => ss + (c.levels?.length || 0), 0),
    0
  );

  console.log('✅ Seeded subjects catalog:', {
    key: SUBJECTS_CATALOG_KEY,
    subjects: subjectCount,
    courses: courseCount,
    levels: levelCount,
    settingId: String(setting._id),
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
