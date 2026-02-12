import React, { useCallback, useEffect, useMemo, useState } from 'react';
import LessonStudio from '../../components/lessons/LessonStudio';
import TestStudio from '../../components/lessons/TestStudio';
import LessonStudioViewer from '../../components/lessons/LessonStudioViewer';
import { createLibraryFolder, createLibraryItem, deleteLibraryItem, fetchFolderContents, fetchTree, reorderLibraryItems, updateLibraryItem } from '../../api/library';
import { Plus, Folder, Settings, Link2, GripVertical } from 'lucide-react';
import api from '../../api/axios';
import { useSearch } from '../../contexts/SearchContext';
import { useAuth } from '../../contexts/AuthContext';

const LESSONS_FOLDER_NAME = 'Lessons';
const TESTS_FOLDER_NAME = 'Tests';

const PresenterPage = ({ isActive, isPublic = false, allowedSubjects = [] }) => {
  const { isAdmin } = useAuth();
  const isAdminUser = typeof isAdmin === 'function' ? isAdmin() : Boolean(isAdmin);
  const [lessonsFolderId, setLessonsFolderId] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [selectedLesson, setSelectedLesson] = useState(null);
  const [testsFolderId, setTestsFolderId] = useState(null);
  const [tests, setTests] = useState([]);
  const [selectedTest, setSelectedTest] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [testSubjectFilter, setTestSubjectFilter] = useState('');
  const [activeTab, setActiveTab] = useState('lessons');
  const [addLessonOpen, setAddLessonOpen] = useState(false);
  const [editLessonOpen, setEditLessonOpen] = useState(false);
  const [lessonToEdit, setLessonToEdit] = useState(null);
  const [addTestOpen, setAddTestOpen] = useState(false);
  const [editTestOpen, setEditTestOpen] = useState(false);
  const [testToEdit, setTestToEdit] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accessScope, setAccessScope] = useState('admin');
  const [publicLink, setPublicLink] = useState('');
  const [accessEntries, setAccessEntries] = useState([]);
  const [accessDraft, setAccessDraft] = useState({ email: '', password: '', folders: [] });
  const [folderSearch, setFolderSearch] = useState('');
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [showUserResults, setShowUserResults] = useState(false);
  const [hadithDraft, setHadithDraft] = useState('');
  const [hadithList, setHadithList] = useState([]);
  const { searchTerm: globalSearchTerm } = useSearch();

  const lessonDraftStorageKey = 'lessonStudio:addDraft:v1';

  const [dragLessonId, setDragLessonId] = useState(null);
  const [dragLessonOverIndex, setDragLessonOverIndex] = useState(null);
  const [dragLessonOverPosition, setDragLessonOverPosition] = useState('before');

  const resolveLessonsFolder = useCallback(async () => {
    const { tree } = await fetchTree();
    const locate = (nodes) => {
      for (const node of nodes || []) {
        if ((node.displayName || '').toLowerCase() === LESSONS_FOLDER_NAME.toLowerCase()) return node;
        if (node.children?.length) {
          const found = locate(node.children);
          if (found) return found;
        }
      }
      return null;
    };
    const existing = locate(tree || []);
    if (existing) return existing.id || existing._id;
    const created = await createLibraryFolder({ displayName: LESSONS_FOLDER_NAME, parentFolder: null });
    return created?.id || created?._id || null;
  }, []);

  const resolveTestsFolder = useCallback(async () => {
    const { tree } = await fetchTree();
    const locate = (nodes) => {
      for (const node of nodes || []) {
        if ((node.displayName || '').toLowerCase() === TESTS_FOLDER_NAME.toLowerCase()) return node;
        if (node.children?.length) {
          const found = locate(node.children);
          if (found) return found;
        }
      }
      return null;
    };
    const existing = locate(tree || []);
    if (existing) return existing.id || existing._id;
    const created = await createLibraryFolder({ displayName: TESTS_FOLDER_NAME, parentFolder: null });
    return created?.id || created?._id || null;
  }, []);

  const loadLessons = useCallback(async () => {
    const folderId = await resolveLessonsFolder();
    setLessonsFolderId(folderId);
    if (!folderId) {
      setLessons([]);
      return;
    }
    const payload = await fetchFolderContents(folderId, { limit: 200 });
    const items = (payload?.items || []).filter((item) => item.contentType === 'lesson');
    setLessons(items);
  }, [resolveLessonsFolder]);

  const loadTests = useCallback(async () => {
    const folderId = await resolveTestsFolder();
    setTestsFolderId(folderId);
    if (!folderId) {
      setTests([]);
      return;
    }
    const payload = await fetchFolderContents(folderId, { limit: 200 });
    const items = (payload?.items || []).filter((item) => item.contentType === 'test');
    setTests(items);
  }, [resolveTestsFolder]);

  useEffect(() => {
    if (!isActive) return;
    loadLessons();
    loadTests();
  }, [isActive, loadLessons, loadTests]);

  const subjects = useMemo(() => {
    const counts = new Map();
    lessons.forEach((lesson) => {
      const subject = lesson.subject || lesson.metadata?.lessonStudio?.subject || 'General';
      counts.set(subject, (counts.get(subject) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [lessons]);

  const testSubjects = useMemo(() => {
    const counts = new Map();
    tests.forEach((test) => {
      const subject = test.subject || test.metadata?.testStudio?.subject || 'General';
      counts.set(subject, (counts.get(subject) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [tests]);

  const allowedSubjectSet = useMemo(() =>
    new Set((allowedSubjects || []).map((s) => String(s || '').toLowerCase().trim()).filter(Boolean)),
    [allowedSubjects]
  );

  const filteredLessons = useMemo(() => {
    const q = (globalSearchTerm || '').trim().toLowerCase();
    return lessons.filter((lesson) => {
      const subject = lesson.subject || lesson.metadata?.lessonStudio?.subject || 'General';
      if (isPublic) {
        if (!allowedSubjectSet.size) return false;
        if (!allowedSubjectSet.has(String(subject).toLowerCase().trim())) return false;
      }
      if (subjectFilter && subject !== subjectFilter) return false;
      if (!q) return true;
      const haystack = `${lesson.displayName || ''} ${lesson.description || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [lessons, globalSearchTerm, subjectFilter, isPublic, allowedSubjectSet]);

  const filteredTests = useMemo(() => {
    const q = (globalSearchTerm || '').trim().toLowerCase();
    return tests.filter((test) => {
      const subject = test.subject || test.metadata?.testStudio?.subject || 'General';
      if (isPublic) {
        if (!allowedSubjectSet.size) return false;
        if (!allowedSubjectSet.has(String(subject).toLowerCase().trim())) return false;
      }
      if (testSubjectFilter && subject !== testSubjectFilter) return false;
      if (!q) return true;
      const haystack = `${test.displayName || ''} ${test.description || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [tests, globalSearchTerm, testSubjectFilter, isPublic, allowedSubjectSet]);

  const lessonsBySubject = useMemo(() => {
    const map = new Map();
    lessons.forEach((lesson) => {
      const subject = lesson.subject || lesson.metadata?.lessonStudio?.subject || 'General';
      if (isPublic) {
        if (!allowedSubjectSet.size) return;
        if (!allowedSubjectSet.has(String(subject).toLowerCase().trim())) return;
      }
      if (!map.has(subject)) map.set(subject, []);
      map.get(subject).push(lesson);
    });
    return map;
  }, [lessons, isPublic, allowedSubjectSet]);

  const testsBySubject = useMemo(() => {
    const map = new Map();
    tests.forEach((test) => {
      const subject = test.subject || test.metadata?.testStudio?.subject || 'General';
      if (isPublic) {
        if (!allowedSubjectSet.size) return;
        if (!allowedSubjectSet.has(String(subject).toLowerCase().trim())) return;
      }
      if (!map.has(subject)) map.set(subject, []);
      map.get(subject).push(test);
    });
    return map;
  }, [tests, isPublic, allowedSubjectSet]);

  useEffect(() => {
    if (!isActive) return;
    try {
      const raw = JSON.parse(localStorage.getItem('presenterSettings') || '{}');
      if (raw.accessScope) setAccessScope(raw.accessScope);
      if (raw.publicLink) setPublicLink(raw.publicLink);
      if (Array.isArray(raw.accessEntries)) setAccessEntries(raw.accessEntries);
      if (Array.isArray(raw.hadithList)) setHadithList(raw.hadithList);
    } catch (e) {
      // ignore
    }
  }, [isActive]);

  const subjectOptions = useMemo(() => {
    const combined = new Map();
    subjects.forEach((item) => combined.set(item.name, item.name));
    testSubjects.forEach((item) => combined.set(item.name, item.name));
    return Array.from(combined.values()).map((name) => ({ id: name, label: name }));
  }, [subjects, testSubjects]);

  useEffect(() => {
    if (!settingsOpen) return;
    const query = accessDraft.email.trim();
    if (!query) {
      setUserSearchResults([]);
      setUserSearchLoading(false);
      setShowUserResults(false);
      return;
    }
    setShowUserResults(true);
    setUserSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.get('/vacations/search-users', {
          params: { query }
        });
        setUserSearchResults(res.data?.users || []);
      } catch (e) {
        setUserSearchResults([]);
      } finally {
        setUserSearchLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [accessDraft.email, settingsOpen]);

  const persistSettings = (next) => {
    try {
      localStorage.setItem('presenterSettings', JSON.stringify(next));
    } catch (e) {
      // ignore
    }
  };

  const saveSettings = () => {
    const presenterPublicLink = `${window.location.origin}/interactive-learning`;
    const payload = {
      accessScope,
      publicLink: presenterPublicLink,
      accessEntries,
      hadithList
    };
    persistSettings(payload);
    setSettingsOpen(false);
  };

  const handleSaveLesson = async (payload) => {
    setSaving(true);
    setStatus('');
    try {
      const folderId = lessonsFolderId || (await resolveLessonsFolder());
      if (!folderId) throw new Error('Lessons folder unavailable');
      const lessonData = {
        subject: payload.subject,
        title: payload.title,
        subtitle: payload.subtitle,
        objective: payload.objective,
        sections: payload.sections
      };
      const created = await createLibraryItem({
        folder: folderId,
        displayName: payload.title || 'Untitled lesson',
        description: payload.objective,
        subject: payload.subject,
        contentType: 'lesson',
        allowDownload: false,
        isSecret: false,
        inheritsSecret: true,
        metadata: { lessonStudio: lessonData }
      });
      await loadLessons();
      setSelectedLesson(created || null);
      setStatus('Lesson saved successfully.');
      return true;
    } catch (error) {
      setStatus(error?.response?.data?.message || error.message || 'Unable to save lesson.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateLesson = async (payload) => {
    if (!lessonToEdit) return;
    setSaving(true);
    setStatus('');
    try {
      const lessonData = {
        subject: payload.subject,
        title: payload.title,
        subtitle: payload.subtitle,
        objective: payload.objective,
        sections: payload.sections
      };
      await updateLibraryItem(lessonToEdit.id || lessonToEdit._id, {
        displayName: payload.title || 'Untitled lesson',
        description: payload.objective,
        subject: payload.subject,
        metadata: { lessonStudio: lessonData }
      });
      await loadLessons();
      setStatus('Lesson updated successfully.');
      return true;
    } catch (error) {
      setStatus(error?.response?.data?.message || error.message || 'Unable to update lesson.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const persistLessonOrderForSubject = useCallback(
    async (subjectName, orderedIds) => {
      if (!isAdminUser || isPublic) return;
      if (!subjectName) return;
      if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;

      // Optimistic UI: update orderIndex locally first.
      const orderStep = 10;
      const indexById = new Map(orderedIds.map((id, idx) => [String(id), (idx + 1) * orderStep]));
      setLessons((prev) =>
        (prev || []).map((item) => {
          const id = String(item?.id || item?._id || '');
          if (!indexById.has(id)) return item;
          return { ...item, orderIndex: indexById.get(id) };
        })
      );

      try {
        await reorderLibraryItems(orderedIds);
      } catch (e) {
        // Best-effort: refresh from server if persist fails.
        await loadLessons();
      }
    },
    [isAdminUser, isPublic, loadLessons]
  );

  const handleSaveTest = async (payload) => {
    setSaving(true);
    setStatus('');
    try {
      const folderId = testsFolderId || (await resolveTestsFolder());
      if (!folderId) throw new Error('Tests folder unavailable');
      const testData = {
        subject: payload.subject,
        title: payload.title,
        subtitle: payload.subtitle,
        instructions: payload.instructions,
        sections: payload.sections
      };
      const created = await createLibraryItem({
        folder: folderId,
        displayName: payload.title || 'Untitled assessment',
        description: payload.instructions,
        subject: payload.subject,
        contentType: 'test',
        allowDownload: false,
        isSecret: false,
        inheritsSecret: true,
        metadata: { testStudio: testData }
      });
      await loadTests();
      setSelectedTest(created || null);
      setStatus('Assessment saved successfully.');
    } catch (error) {
      setStatus(error?.response?.data?.message || error.message || 'Unable to save assessment.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateTest = async (payload) => {
    if (!testToEdit) return;
    setSaving(true);
    setStatus('');
    try {
      const testData = {
        subject: payload.subject,
        title: payload.title,
        subtitle: payload.subtitle,
        instructions: payload.instructions,
        sections: payload.sections
      };
      await updateLibraryItem(testToEdit.id || testToEdit._id, {
        displayName: payload.title || 'Untitled assessment',
        description: payload.instructions,
        subject: payload.subject,
        metadata: { testStudio: testData }
      });
      await loadTests();
      setStatus('Assessment updated successfully.');
    } catch (error) {
      setStatus(error?.response?.data?.message || error.message || 'Unable to update assessment.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLesson = async (lesson) => {
    if (!lesson) return;
    if (!window.confirm('Delete this lesson?')) return;
    setSaving(true);
    try {
      await deleteLibraryItem(lesson.id || lesson._id);
      await loadLessons();
      if (selectedLesson && (selectedLesson.id || selectedLesson._id) === (lesson.id || lesson._id)) {
        setSelectedLesson(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTest = async (test) => {
    if (!test) return;
    if (!window.confirm('Delete this assessment?')) return;
    setSaving(true);
    try {
      await deleteLibraryItem(test.id || test._id);
      await loadTests();
      if (selectedTest && (selectedTest.id || selectedTest._id) === (test.id || test._id)) {
        setSelectedTest(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSubjectMaterials = async (subjectName) => {
    if (!subjectName) return;
    if (!window.confirm(`Delete all lessons under "${subjectName}"?`)) return;
    setSaving(true);
    try {
      const subjectLessons = lessonsBySubject.get(subjectName) || [];
      await Promise.all(subjectLessons.map((lesson) => deleteLibraryItem(lesson.id || lesson._id)));
      await loadLessons();
      if (subjectFilter === subjectName) setSubjectFilter('');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSubjectTests = async (subjectName) => {
    if (!subjectName) return;
    if (!window.confirm(`Delete all assessments under "${subjectName}"?`)) return;
    setSaving(true);
    try {
      const subjectTests = testsBySubject.get(subjectName) || [];
      await Promise.all(subjectTests.map((test) => deleteLibraryItem(test.id || test._id)));
      await loadTests();
      if (testSubjectFilter === subjectName) setTestSubjectFilter('');
    } finally {
      setSaving(false);
    }
  };

  if (!isActive) return null;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#2C736C]">Waraqa Curricula</p>
            <h1 className="text-2xl font-semibold text-foreground">Interactive learning</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                loadLessons();
                loadTests();
              }}
              className="text-xs text-[#2C736C]"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {['lessons', 'tests'].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-full border px-4 py-1.5 text-xs font-semibold ${
                activeTab === tab
                  ? 'border-[#2C736C]/40 bg-[#2C736C]/10 text-[#2C736C]'
                  : 'border-slate-200 text-slate-600'
              }`}
            >
              {tab === 'lessons' ? 'Lessons' : 'Tests'}
            </button>
          ))}
        </div>

        {activeTab === 'lessons' ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr,0.8fr]">
            <div className="space-y-4">
              {subjects.map((subject) => {
                const isActive = subjectFilter === subject.name;
                return (
                  <div
                    key={subject.name}
                    className={`rounded-3xl border bg-white p-5 shadow-sm transition ${
                      isActive ? 'border-[#2C736C]/40 bg-[#2C736C]/10 ring-1 ring-[#2C736C]/20' : 'border-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <button
                        type="button"
                        onClick={() => setSubjectFilter(isActive ? '' : subject.name)}
                        className="flex flex-1 items-center justify-between gap-4 text-left"
                      >
                        <div className="flex items-center gap-4">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2C736C]/10 text-[#2C736C]">
                            <Folder className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground">{subject.name}</p>
                            <p className="text-xs text-muted-foreground">{subject.count} lessons</p>
                          </div>
                        </div>
                        <span className="text-xs text-[#2C736C]">{isActive ? 'Selected' : 'Open'}</span>
                      </button>
                      {isAdminUser && !isPublic && (
                        <button
                          type="button"
                          onClick={() => handleDeleteSubjectMaterials(subject.name)}
                          className="rounded-full border border-rose-200 px-3 py-1 text-[10px] font-semibold text-rose-700"
                        >
                          Delete materials
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#2C736C]">Lessons</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {subjectFilter ? `Showing lessons for ${subjectFilter}.` : 'Select a subject to view lessons.'}
              </p>
              <div className="mt-4 space-y-2">
                {(subjectFilter ? (lessonsBySubject.get(subjectFilter) || []) : []).map((lesson, rowIdx) => (
                  <div
                    key={lesson.id || lesson._id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-[#2C736C]/10 px-3 py-2 text-left text-xs font-semibold text-[#2C736C]"
                    onDragOver={(event) => {
                      if (!dragLessonId) return;
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      const mid = rect.top + rect.height / 2;
                      const pos = event.clientY < mid ? 'before' : 'after';
                      setDragLessonOverIndex(rowIdx);
                      setDragLessonOverPosition(pos);
                    }}
                    onDrop={async (event) => {
                      event.preventDefault();
                      if (!dragLessonId) return;
                      const targetList = (lessonsBySubject.get(subjectFilter) || []).slice();
                      const fromIndex = targetList.findIndex((l) => String(l.id || l._id) === String(dragLessonId));
                      if (fromIndex < 0) return;

                      let toIndex = rowIdx + (dragLessonOverPosition === 'after' ? 1 : 0);
                      toIndex = Math.max(0, Math.min(targetList.length, toIndex));

                      const [moved] = targetList.splice(fromIndex, 1);
                      const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
                      targetList.splice(insertIndex, 0, moved);

                      setDragLessonId(null);
                      setDragLessonOverIndex(null);

                      const orderedIds = targetList.map((l) => String(l.id || l._id)).filter(Boolean);
                      await persistLessonOrderForSubject(subjectFilter, orderedIds);
                    }}
                  >
                    {isAdminUser && !isPublic && (
                      <div className="flex items-center">
                        <button
                          type="button"
                          className="mr-2 inline-flex items-center rounded-full border border-[#2C736C]/20 bg-white px-2 py-1 text-[#2C736C]"
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move';
                            setDragLessonId(String(lesson.id || lesson._id));
                          }}
                          onDragEnd={() => {
                            setDragLessonId(null);
                            setDragLessonOverIndex(null);
                          }}
                          title="Drag to reorder"
                        >
                          <GripVertical className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedLesson(lesson)}
                      className="flex-1 text-left"
                    >
                      <p>{lesson.displayName}</p>
                      <p className="text-[10px] text-[#2C736C]/80">{lesson.metadata?.lessonStudio?.subtitle || 'Lesson'}</p>
                    </button>
                    {isAdminUser && !isPublic && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setLessonToEdit(lesson);
                            setEditLessonOpen(true);
                          }}
                          className="rounded-full border border-[#2C736C]/30 px-2 py-1 text-[10px] text-[#2C736C]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteLesson(lesson)}
                          className="rounded-full border border-rose-200 px-2 py-1 text-[10px] text-rose-700"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {!subjectFilter && (
                  <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500">
                    Choose a folder on the left to display its lessons.
                  </div>
                )}
              </div>
            </div>

            {addLessonOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                <div className="h-full w-full max-w-none overflow-y-auto rounded-3xl bg-white shadow-2xl ring-2 ring-[#2C736C]/20">
                  <LessonStudio
                    onSave={async (payload) => {
                      const ok = await handleSaveLesson(payload);
                      if (ok) {
                        try { localStorage.removeItem(lessonDraftStorageKey); } catch (e) {}
                      }
                      setAddLessonOpen(false);
                    }}
                    saving={saving}
                    status={status}
                    onClose={() => setAddLessonOpen(false)}
                    title="Add lesson"
                  />
                </div>
              </div>
            )}
            {editLessonOpen && lessonToEdit && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                <div className="h-full w-full max-w-none overflow-y-auto rounded-3xl bg-white shadow-2xl ring-2 ring-[#2C736C]/20">
                  <LessonStudio
                    initialLesson={lessonToEdit}
                    onSave={async (payload) => {
                      await handleUpdateLesson(payload);
                      setEditLessonOpen(false);
                      setLessonToEdit(null);
                    }}
                    saving={saving}
                    status={status}
                    onClose={() => {
                      setEditLessonOpen(false);
                      setLessonToEdit(null);
                    }}
                    title="Edit lesson"
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr,0.8fr]">
            <div className="space-y-4">
              {testSubjects.map((subject) => {
                const isActive = testSubjectFilter === subject.name;
                return (
                  <div
                    key={subject.name}
                    className={`rounded-3xl border bg-white p-5 shadow-sm transition ${
                      isActive ? 'border-[#2C736C]/40 bg-[#2C736C]/10 ring-1 ring-[#2C736C]/20' : 'border-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <button
                        type="button"
                        onClick={() => setTestSubjectFilter(isActive ? '' : subject.name)}
                        className="flex flex-1 items-center justify-between gap-4 text-left"
                      >
                        <div className="flex items-center gap-4">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2C736C]/10 text-[#2C736C]">
                            <Folder className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground">{subject.name}</p>
                            <p className="text-xs text-muted-foreground">{subject.count} tests</p>
                          </div>
                        </div>
                        <span className="text-xs text-[#2C736C]">{isActive ? 'Selected' : 'Open'}</span>
                      </button>
                      {isAdminUser && !isPublic && (
                        <button
                          type="button"
                          onClick={() => handleDeleteSubjectTests(subject.name)}
                          className="rounded-full border border-rose-200 px-3 py-1 text-[10px] font-semibold text-rose-700"
                        >
                          Delete materials
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#2C736C]">Tests</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {testSubjectFilter ? `Showing tests for ${testSubjectFilter}.` : 'Select a subject to view tests.'}
              </p>
              <div className="mt-4 space-y-2">
                {(testSubjectFilter ? (testsBySubject.get(testSubjectFilter) || []) : []).map((test) => (
                  <div
                    key={test.id || test._id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-[#2C736C]/10 px-3 py-2 text-left text-xs font-semibold text-[#2C736C]"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedTest(test)}
                      className="flex-1 text-left"
                    >
                      <p>{test.displayName}</p>
                      <p className="text-[10px] text-[#2C736C]/80">{test.metadata?.testStudio?.subtitle || 'Assessment'}</p>
                    </button>
                    {isAdminUser && !isPublic && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setTestToEdit(test);
                            setEditTestOpen(true);
                          }}
                          className="rounded-full border border-[#2C736C]/30 px-2 py-1 text-[10px] text-[#2C736C]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTest(test)}
                          className="rounded-full border border-rose-200 px-2 py-1 text-[10px] text-rose-700"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {!testSubjectFilter && (
                  <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500">
                    Choose a folder on the left to display its tests.
                  </div>
                )}
              </div>
            </div>

            {addTestOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                <div className="h-full w-full max-w-none overflow-y-auto rounded-3xl bg-white shadow-2xl ring-2 ring-[#2C736C]/20">
                  <TestStudio
                    onSave={async (payload) => {
                      await handleSaveTest(payload);
                      setAddTestOpen(false);
                    }}
                    saving={saving}
                    status={status}
                    onClose={() => setAddTestOpen(false)}
                    title="Add assessment"
                  />
                </div>
              </div>
            )}
            {editTestOpen && testToEdit && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                <div className="h-full w-full max-w-none overflow-y-auto rounded-3xl bg-white shadow-2xl ring-2 ring-[#2C736C]/20">
                  <TestStudio
                    initialTest={testToEdit}
                    onSave={async (payload) => {
                      await handleUpdateTest(payload);
                      setEditTestOpen(false);
                      setTestToEdit(null);
                    }}
                    saving={saving}
                    status={status}
                    onClose={() => {
                      setEditTestOpen(false);
                      setTestToEdit(null);
                    }}
                    title="Edit assessment"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {isAdminUser && !isPublic && (
        <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex flex-col items-center gap-1 text-[#2C736C]"
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#2C736C]/40 bg-white shadow-sm hover:bg-[#2C736C]/10">
              <Settings className="h-5 w-5" />
            </span>
            <span className="text-[10px] font-semibold">Settings</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (activeTab === 'tests') {
                setAddTestOpen(true);
              } else {
                setAddLessonOpen(true);
              }
            }}
            className="flex flex-col items-center gap-1 text-[#2C736C]"
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#2C736C] text-white shadow-sm hover:bg-[#245b56]">
              <Plus className="h-5 w-5" />
            </span>
            <span className="text-[10px] font-semibold">Add</span>
          </button>
        </div>
      )}

      {selectedLesson && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm p-2 sm:p-4">
          <div className="h-full w-full overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="h-full w-full overflow-hidden">
              <LessonStudioViewer lesson={selectedLesson} onClose={() => setSelectedLesson(null)} />
            </div>
          </div>
        </div>
      )}

      {selectedTest && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm p-2 sm:p-4">
          <div className="h-full w-full overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="h-full w-full overflow-hidden">
              <LessonStudioViewer lesson={selectedTest} onClose={() => setSelectedTest(null)} />
            </div>
          </div>
        </div>
      )}

      {settingsOpen && !isPublic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-2xl ring-2 ring-[#2C736C]/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#2C736C]">Settings</p>
                <h2 className="text-xl font-semibold text-foreground">Interactive learning</h2>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-6">
              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-700">Access settings</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {['admin', 'all'].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setAccessScope(value)}
                      className={`rounded-full border px-4 py-2 text-xs font-semibold ${
                        accessScope === value
                          ? 'border-[#2C736C]/40 bg-[#2C736C]/10 text-[#2C736C]'
                          : 'border-slate-200 text-slate-600'
                      }`}
                    >
                      {value === 'admin' ? 'Admin only' : 'All users'}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {accessScope === 'admin'
                    ? 'Only admins plus the access emails below can open the presenter.'
                    : 'All dashboard users plus the access emails below can open the presenter.'}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-700">Public link</p>
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <Link2 className="h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={`${window.location.origin}/interactive-learning`}
                    readOnly
                    className="w-full bg-transparent text-sm text-slate-700 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const link = `${window.location.origin}/interactive-learning`;
                      navigator.clipboard?.writeText(link);
                    }}
                    className="rounded-full border border-slate-200 px-3 py-1 text-[11px] text-slate-600"
                  >
                    Copy
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500">Share this link to open the presenter without the dashboard shell.</p>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-700">Subject-specific access</p>
                <p className="text-xs text-slate-500">Add external users with email + password to access selected subjects.</p>
                <div className="mt-3 grid gap-2">
                  {accessEntries.map((entry, idx) => (
                    <div key={`${entry.email}-${idx}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                      <div className="font-semibold text-slate-700">{entry.email}</div>
                      <div className="text-slate-500">{entry.folders?.length ? entry.folders.join(', ') : 'All subjects'}</div>
                      <button
                        type="button"
                        onClick={() => setAccessEntries((prev) => prev.filter((_, i) => i !== idx))}
                        className="rounded-full border border-rose-200 px-2 py-1 text-[10px] text-rose-700"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="relative z-20">
                    <input
                      type="email"
                      placeholder="Email"
                      value={accessDraft.email}
                      onChange={(event) => {
                        setAccessDraft((prev) => ({ ...prev, email: event.target.value }));
                        setShowUserResults(Boolean(event.target.value.trim()));
                      }}
                      onFocus={() => setShowUserResults(Boolean(accessDraft.email.trim()))}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    />
                    {showUserResults && accessDraft.email.trim() && (
                      <div className="absolute z-50 mt-1 w-full rounded-xl border border-slate-200 bg-white text-xs shadow-lg">
                        {userSearchLoading ? (
                          <div className="px-3 py-2 text-slate-500">Searching...</div>
                        ) : userSearchResults.length > 0 ? (
                          <div className="max-h-48 overflow-auto">
                            {userSearchResults.map((user) => (
                              <button
                                key={user._id || user.email}
                                type="button"
                                onClick={() => {
                                  setAccessDraft((prev) => ({ ...prev, email: user.email || '' }));
                                  setShowUserResults(false);
                                }}
                                className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-slate-50"
                              >
                                <span className="font-semibold text-slate-700">{`${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email}</span>
                                <span className="text-[11px] text-slate-500">{user.email}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="px-3 py-2 text-slate-500">No users found</div>
                        )}
                      </div>
                    )}
                  </div>
                  <input
                    type="password"
                    placeholder="Password"
                    value={accessDraft.password}
                    onChange={(event) => setAccessDraft((prev) => ({ ...prev, password: event.target.value }))}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                  />
                  <div className="relative z-10 rounded-xl border border-slate-200 px-2 py-2 text-xs">
                    <input
                      type="text"
                      placeholder="Search subjects"
                      value={folderSearch}
                      onChange={(event) => setFolderSearch(event.target.value)}
                      className="w-full bg-transparent text-xs text-slate-700 outline-none"
                    />
                    {folderSearch.trim() && (
                      <div className="mt-2 max-h-28 space-y-1 overflow-auto">
                        {subjectOptions
                          .filter((opt) => opt.label.toLowerCase().includes((folderSearch || '').toLowerCase()))
                          .map((opt) => {
                            const selected = accessDraft.folders.includes(opt.label);
                            return (
                              <button
                                key={opt.id || opt.label}
                                type="button"
                                onClick={() => {
                                  setAccessDraft((prev) => ({
                                    ...prev,
                                    folders: selected
                                      ? prev.folders.filter((f) => f !== opt.label)
                                      : [...prev.folders, opt.label]
                                  }));
                                }}
                                className={`flex w-full items-center justify-between rounded-lg border px-2 py-1 text-left ${
                                  selected ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700'
                                }`}
                              >
                                <span className="truncate">{opt.label}</span>
                                <input type="checkbox" checked={selected} readOnly />
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </div>
                {accessDraft.folders.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {accessDraft.folders.map((folder) => (
                      <span key={folder} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                        {folder}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (!accessDraft.email || !accessDraft.password) return;
                      setAccessEntries((prev) => [...prev, {
                        email: accessDraft.email,
                        password: accessDraft.password,
                        folders: accessDraft.folders
                      }]);
                      setAccessDraft({ email: '', password: '', folders: [] });
                      setFolderSearch('');
                    }}
                    className="rounded-full bg-[#2C736C] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Add access
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-700">Hadith rotations</p>
                <p className="text-xs text-slate-500">Add multiple hadith lines; one will be shown each time the presenter opens.</p>
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={hadithDraft}
                    onChange={(event) => setHadithDraft(event.target.value)}
                    placeholder="Hadith text..."
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!hadithDraft.trim()) return;
                      setHadithList((prev) => [...prev, hadithDraft.trim()]);
                      setHadithDraft('');
                    }}
                    className="rounded-full bg-[#2C736C] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-3 space-y-2">
                  {hadithList.map((item, idx) => (
                    <div key={`${item}-${idx}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                      <span className="text-slate-700">{item}</span>
                      <button
                        type="button"
                        onClick={() => setHadithList((prev) => prev.filter((_, i) => i !== idx))}
                        className="rounded-full border border-rose-200 px-2 py-1 text-[10px] text-rose-700"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-full border border-slate-200 px-4 py-2 text-xs text-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveSettings}
                className="rounded-full bg-[#2C736C] px-4 py-2 text-xs font-semibold text-white"
              >
                Save settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PresenterPage;