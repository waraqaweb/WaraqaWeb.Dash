import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import FloatingTimezone from '../../components/ui/FloatingTimezone';
import api from '../../api/axios';
import ConfirmModal from '../../components/ui/ConfirmModal';
import Toast from '../../components/ui/Toast';
import { fetchLibraryStorageUsage } from '../../api/library';
import { getSubjectsCatalogCached, saveSubjectsCatalog } from '../../services/subjectsCatalog';

const parseLinesOrComma = (text) => {
  if (!text) return [];
  const raw = String(text)
    .split(/\r?\n/)
    .flatMap((line) => line.split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(raw));
};

const joinLines = (items) => (Array.isArray(items) ? items.filter(Boolean).join('\n') : '');

const removeItemFromTextList = (text, itemToRemove) => {
  const next = parseLinesOrComma(text).filter((x) => x !== itemToRemove);
  return joinLines(next);
};

const addItemsToTextList = (text, itemsToAdd) => {
  const current = parseLinesOrComma(text);
  const incoming = parseLinesOrComma(itemsToAdd);
  return joinLines(Array.from(new Set([...(current || []), ...(incoming || [])])));
};

const SECTION_ORDER = ['general', 'branding', 'library', 'subjectsCatalog'];

const formatBytes = (bytes = 0) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
};

const Settings = () => {
  const { user, socket } = useAuth();

  const dashboardVersion = import.meta?.env?.VITE_BUILD_VERSION || import.meta?.env?.VITE_APP_VERSION || null;
  const dashboardBuildTime = import.meta?.env?.VITE_BUILD_TIME || null;

  // Compact/condensed layout toggle (defaults to condensed for dense Google-like UI)
  const [condensed, setCondensed] = useState(true);
  const [activeSection, setActiveSection] = useState('general');
  const [firstClassWindowHours, setFirstClassWindowHours] = useState(24);
  const [savingWindow, setSavingWindow] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    // fetch admin setting
    const fetchSetting = async () => {
      try {
        const res = await api.get('/settings/firstClassWindowHours');
        if (res.data && res.data.setting) {
          setFirstClassWindowHours(Number(res.data.setting.value) || 24);
        }
      } catch (err) {
        // Setting doesn't exist yet - use default value
        if (err.response?.status === 404) {
          setFirstClassWindowHours(24); // Default value
        }
      }
    };
    fetchSetting();
  }, []);

  // Branding (logo/title/slogan) - admin only
  const [branding, setBranding] = useState({ logo: null, title: 'Waraqa', slogan: '' });
  const [logoFile, setLogoFile] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [toast, setToast] = useState(null);

  // Maintenance (admin)
  const [generatingRecurring, setGeneratingRecurring] = useState(false);

  // App version (from backend)
  const [appVersion, setAppVersion] = useState(null);
  const [appBuildTime, setAppBuildTime] = useState(null);

  // Library storage indicator (admin)
  const [libraryUsage, setLibraryUsage] = useState(null);
  const [libraryUsageError, setLibraryUsageError] = useState(null);

  // Subjects/Courses/Levels catalog (admin)
  const [subjectsCatalogLoading, setSubjectsCatalogLoading] = useState(false);
  const [subjectsCatalogSaving, setSubjectsCatalogSaving] = useState(false);
  const [subjectsCatalogError, setSubjectsCatalogError] = useState(null);
  const [subjectsCatalogRaw, setSubjectsCatalogRaw] = useState(null);
  const [subjectsCatalogTree, setSubjectsCatalogTree] = useState([]);
  const [catalogSubjectsText, setCatalogSubjectsText] = useState('');
  const [catalogLevelsText, setCatalogLevelsText] = useState('');
  const [catalogTopicsBySubjectText, setCatalogTopicsBySubjectText] = useState({});
  const [subjectsCatalogStep, setSubjectsCatalogStep] = useState(1);
  const [topicsActiveSubject, setTopicsActiveSubject] = useState('');
  const [quickAddSubjects, setQuickAddSubjects] = useState('');
  const [quickAddLevels, setQuickAddLevels] = useState('');

  useEffect(() => {
    if (user?.role !== 'admin') return;
    (async () => {
      try {
        const res = await api.get('/settings/branding');
        if (res.data?.branding) setBranding(res.data.branding);
      } catch (e) {
        // ignore
      }
    })();
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    let cancelled = false;

    (async () => {
      try {
        setSubjectsCatalogLoading(true);
        setSubjectsCatalogError(null);
        const catalog = await getSubjectsCatalogCached({ ttlMs: 0 });
        if (cancelled) return;

        setSubjectsCatalogRaw(catalog?.raw || null);
        setSubjectsCatalogTree(Array.isArray(catalog?.tree) ? catalog.tree : []);

        const subjects = Array.isArray(catalog?.subjects) ? catalog.subjects : [];
        const levels = Array.isArray(catalog?.levels) ? catalog.levels : [];
        const topicsBySubject = catalog?.topicsBySubject && typeof catalog.topicsBySubject === 'object'
          ? catalog.topicsBySubject
          : {};

        setCatalogSubjectsText(joinLines(subjects));
        setCatalogLevelsText(joinLines(levels));

        const topicsText = {};
        for (const s of subjects) {
          const list = Array.isArray(topicsBySubject?.[s]) ? topicsBySubject[s] : [];
          topicsText[s] = joinLines(list);
        }
        setCatalogTopicsBySubjectText(topicsText);

        // Choose a default subject for the topics step.
        setTopicsActiveSubject((prev) => {
          if (prev && subjects.includes(prev)) return prev;
          return subjects[0] || '';
        });
      } catch (e) {
        if (!cancelled) {
          setSubjectsCatalogError(e?.response?.data?.message || e?.message || 'Failed to load subjects catalog');
          setSubjectsCatalogRaw(null);
          setSubjectsCatalogTree([]);
          setCatalogSubjectsText('');
          setCatalogLevelsText('');
          setCatalogTopicsBySubjectText({});
          setTopicsActiveSubject('');
        }
      } finally {
        if (!cancelled) setSubjectsCatalogLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.role]);

  useEffect(() => {
    // Ensure active section is valid for role.
    if (user?.role === 'admin') return;
    setActiveSection('general');
  }, [user?.role]);

  const adminSections = useMemo(() => {
    if (user?.role !== 'admin') return [{ key: 'general', label: 'General' }];
    return [
      { key: 'general', label: 'General' },
      { key: 'branding', label: 'Branding' },
      { key: 'library', label: 'Library' },
      { key: 'subjectsCatalog', label: 'Subjects Catalog' },
    ];
  }, [user?.role]);

  const subjectsList = useMemo(() => parseLinesOrComma(catalogSubjectsText), [catalogSubjectsText]);
  const levelsList = useMemo(() => parseLinesOrComma(catalogLevelsText), [catalogLevelsText]);

  const ensureTopicsMapSync = useCallback((nextSubjects) => {
    setCatalogTopicsBySubjectText((prev) => {
      const nextMap = { ...(prev || {}) };
      for (const s of nextSubjects) {
        if (typeof nextMap[s] !== 'string') nextMap[s] = '';
      }
      for (const key of Object.keys(nextMap)) {
        if (!nextSubjects.includes(key)) delete nextMap[key];
      }
      return nextMap;
    });
  }, []);

  const saveCatalog = useCallback(async () => {
    // Prevent overwriting a hierarchical v2 catalog with the legacy v1 editor.
    if (subjectsCatalogRaw?.version === 2) {
      throw new Error('This catalog is version 2 (hierarchical). Editing from this screen is disabled to avoid overwriting it.');
    }

    const subjects = parseLinesOrComma(catalogSubjectsText);
    const levels = parseLinesOrComma(catalogLevelsText);
    const topicsBySubject = {};
    for (const s of subjects) {
      topicsBySubject[s] = parseLinesOrComma(catalogTopicsBySubjectText?.[s] || '');
    }

    const saved = await saveSubjectsCatalog({
      version: 1,
      subjects,
      levels,
      topicsBySubject,
    });

    // Normalize UI back to saved values (ensures dedupe/trim consistency).
    setCatalogSubjectsText(joinLines(saved?.subjects || subjects));
    setCatalogLevelsText(joinLines(saved?.levels || levels));
    ensureTopicsMapSync(saved?.subjects || subjects);
    setTopicsActiveSubject((prev) => {
      const list = saved?.subjects || subjects;
      if (prev && list.includes(prev)) return prev;
      return list[0] || '';
    });
  }, [catalogSubjectsText, catalogLevelsText, catalogTopicsBySubjectText, ensureTopicsMapSync]);

  const isV2SubjectsCatalog = subjectsCatalogRaw?.version === 2;

  const subjectsCatalogCounts = useMemo(() => {
    const tree = Array.isArray(subjectsCatalogTree) ? subjectsCatalogTree : [];
    const subjectCount = tree.length;
    const courseCount = tree.reduce((sum, s) => sum + (Array.isArray(s?.courses) ? s.courses.length : 0), 0);
    const levelCount = tree.reduce(
      (sum, s) =>
        sum +
        (Array.isArray(s?.courses) ? s.courses.reduce((ss, c) => ss + (Array.isArray(c?.levels) ? c.levels.length : 0), 0) : 0),
      0
    );
    return { subjectCount, courseCount, levelCount };
  }, [subjectsCatalogTree]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/version');
        if (cancelled) return;
        setAppVersion(res.data?.version || null);
        setAppBuildTime(res.data?.buildTime || null);
      } catch (e) {
        if (cancelled) return;
        setAppVersion(null);
        setAppBuildTime(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    let cancelled = false;

    (async () => {
      try {
        setLibraryUsageError(null);
        const usage = await fetchLibraryStorageUsage();
        if (!cancelled) setLibraryUsage(usage);
      } catch (e) {
        if (!cancelled) {
          setLibraryUsage(null);
          setLibraryUsageError(e?.response?.data?.message || e?.message || 'Failed to load library storage usage');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.role]);

  return (
    <div className={`p-6 bg-background min-h-screen`}> 
      <div className="max-w-7xl mx-auto">
        <FloatingTimezone />
        <div className={`mb-4 ${condensed ? 'text-sm' : 'text-base'}`}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className={`font-semibold ${condensed ? 'text-lg' : 'text-2xl'}`}>Settings</h1>
              {(appVersion || appBuildTime || dashboardVersion || dashboardBuildTime) && (
                <div className="text-xs text-muted-foreground mt-1">
                  API: <span className="font-medium text-foreground">{appVersion || 'unknown'}</span>
                  {appBuildTime ? <span> • API Built: {new Date(appBuildTime).toLocaleString()}</span> : null}
                  {dashboardVersion ? <span> • Dashboard: <span className="font-medium text-foreground">{dashboardVersion}</span></span> : null}
                  {dashboardBuildTime ? <span> • Dashboard Built: {new Date(dashboardBuildTime).toLocaleString()}</span> : null}
                </div>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCondensed(s => !s)}
                className="text-xs px-2 py-1 border rounded bg-white"
                title="Toggle compact view"
              >
                {condensed ? 'Compact' : 'Comfort'}
              </button>
            </div>
          </div>
        </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="lg:w-64 flex-shrink-0">
          <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sections</div>
            </div>
            <div className="p-2">
              {adminSections.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setActiveSection(s.key)}
                  className={`w-full text-left px-3 py-2 rounded text-sm border ${activeSection === s.key ? 'bg-muted border-border' : 'bg-card border-transparent hover:bg-muted'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-4">
        {/* Timezone converter moved to floating widget to keep page body cleaner. */}
        {/* Floating widget component will be rendered separately (fixed position). */}
        
        {/* Feedback card */}
        {user?.role === 'admin' && activeSection === 'general' && (
          <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden p-4 flex items-start justify-between">
            <div>
              <div className="font-medium mb-2">Feedback Settings</div>
              <div className="flex items-center space-x-3">
                <input type="number" min={1} value={firstClassWindowHours} onChange={(e)=>setFirstClassWindowHours(Number(e.target.value))} className="px-3 py-2 border rounded w-32" />
                <div className="text-sm text-muted">Controls how long after class end the first-class modal can appear.</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={()=>setConfirmOpen(true)} className={`text-xs px-2 py-1 bg-gray-100 text-gray-800 border border-gray-200 rounded ${savingWindow ? 'opacity-70' : ''}`}>Save</button>
            </div>
          </div>
        )}

        {/* Branding card */}
        {user?.role === 'admin' && activeSection === 'branding' && (
          <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden p-4">
            <div className="flex items-start justify-between">
              <div className="font-medium">Branding</div>
              <div className="flex items-center gap-2">
                <button onClick={async ()=>{ try { await api.put('/settings/branding.title', {value: branding.title}); await api.put('/settings/branding.slogan', {value: branding.slogan}); setToast({type:'success', message:'Branding saved'}); if (socket && socket.emit) socket.emit('branding:updated', {branding:{...branding}}); } catch(err){ console.error(err); setToast({type:'error', message:'Save failed'}); } }} className="text-xs px-2 py-1 bg-gray-100 text-gray-800 border border-gray-200 rounded">Save</button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
              <div className="md:col-span-1 flex items-center justify-center">
                <div className="h-28 w-28 bg-card rounded border border-border overflow-hidden flex items-center justify-center">
                  {branding.logo?.url ? (
                    <img src={branding.logo.url} alt="logo" className="h-full w-full object-contain" />
                  ) : branding.logo?.dataUri ? (
                    <img src={branding.logo.dataUri} alt="logo" className="h-full w-full object-contain" />
                  ) : (
                    <div className="text-xs text-muted-foreground">No logo</div>
                  )}
                </div>
              </div>

              <div className="md:col-span-2">
                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3">
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e)=>{
                    const f = e.target.files && e.target.files[0];
                    if (f) {
                      const allowed = ['image/png','image/jpeg','image/webp'];
                      const maxBytes = 5*1024*1024;
                      if (!allowed.includes(f.type)) { setToast({type:'error', message:'Unsupported file type.'}); setLogoFile(null); return; }
                      if (f.size > maxBytes) { setToast({type:'error', message:'File too large (max 5MB).'}); setLogoFile(null); return; }
                    }
                    setLogoFile(f);
                  }} className="text-sm" />

                  <button onClick={async ()=>{
                    if (!logoFile) { setToast({type:'error', message:'Select file first.'}); return; }
                    setUploadingLogo(true);
                    try {
                      const fd = new FormData(); fd.append('file', logoFile);
                      const res = await api.post('/settings/branding/logo', fd, { headers: {'Content-Type':'multipart/form-data'} });
                      if (res.data?.success) { setBranding(b=>({...b, logo: res.data.setting.value})); setToast({type:'success', message: res.data.fallback? 'Saved (fallback)' : 'Uploaded'}); if (socket && socket.emit) socket.emit('branding:updated', {branding:{...branding, logo: res.data.setting.value}}); }
                    } catch(err){ console.error('Logo upload failed', err); setToast({type:'error', message: err.response?.data?.message || err.message || 'Upload failed'}); } finally { setUploadingLogo(false); }
                  }} className="text-xs px-2 py-1 bg-gray-100 text-gray-800 border border-gray-200 rounded">{uploadingLogo? 'Uploading' : 'Upload'}</button>
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input type="text" value={branding.title||''} onChange={(e)=>setBranding(b=>({...b, title: e.target.value}))} className="px-3 py-2 border rounded w-full truncate" placeholder="Site title" />
                  <input type="text" value={branding.slogan||''} onChange={(e)=>setBranding(b=>({...b, slogan: e.target.value}))} className="px-3 py-2 border rounded w-full truncate" placeholder="Slogan" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Library storage card */}
        {user?.role === 'admin' && activeSection === 'library' && (
          <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">Library Storage</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Shows how much storage is used by uploaded library files.
                </div>
              </div>
              <button
                onClick={async () => {
                  try {
                    setLibraryUsageError(null);
                    const usage = await fetchLibraryStorageUsage();
                    setLibraryUsage(usage);
                    setToast({ type: 'success', message: 'Storage updated' });
                  } catch (e) {
                    setLibraryUsageError(e?.response?.data?.message || e?.message || 'Failed to refresh storage');
                  }
                }}
                className="text-xs px-2 py-1 bg-gray-100 text-gray-800 border border-gray-200 rounded"
              >
                Refresh
              </button>
            </div>

            {libraryUsageError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {libraryUsageError}
              </div>
            )}

            {libraryUsage && (
              <div className="mt-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    Used <span className="font-medium text-foreground">{formatBytes(libraryUsage.usedBytes)}</span> of{' '}
                    <span className="font-medium text-foreground">{formatBytes(libraryUsage.maxBytes)}</span>
                  </span>
                  <span>
                    Remaining <span className="font-medium text-foreground">{formatBytes(libraryUsage.remainingBytes)}</span>
                  </span>
                  {libraryUsage.uploadMaxBytes ? (
                    <span>
                      Max upload <span className="font-medium text-foreground">{formatBytes(libraryUsage.uploadMaxBytes)}</span>
                    </span>
                  ) : null}
                </div>

                {(() => {
                  const percent = Math.max(0, Math.min(Number(libraryUsage.percentUsed || 0), 1));
                  const warning = Number(libraryUsage.thresholds?.warningPercent ?? 0.7);
                  const critical = Number(libraryUsage.thresholds?.criticalPercent ?? 0.9);
                  const barColor = percent >= critical ? 'bg-red-500' : percent >= warning ? 'bg-yellow-500' : 'bg-emerald-500';
                  const label = percent >= critical ? 'High' : percent >= warning ? 'Warning' : 'Good';

                  return (
                    <div className="mt-3">
                      <div className="h-2 w-full rounded bg-muted overflow-hidden">
                        <div className={`h-full ${barColor}`} style={{ width: `${Math.round(percent * 100)}%` }} />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span>Status: <span className="font-medium text-foreground">{label}</span></span>
                        <span>{Math.round(percent * 100)}%</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* Subjects / Courses / Levels catalog */}
        {user?.role === 'admin' && activeSection === 'subjectsCatalog' && (
          <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">Subjects Catalog</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Used for class subject dropdowns, library folder subjects/levels, and class report lesson topics.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={subjectsCatalogSaving || subjectsCatalogLoading || isV2SubjectsCatalog}
                  onClick={async () => {
                    try {
                      setSubjectsCatalogSaving(true);
                      await saveCatalog();
                      setToast({ type: 'success', message: 'Subjects catalog saved' });
                    } catch (e) {
                      console.error(e);
                      setToast({ type: 'error', message: e?.response?.data?.message || e?.message || 'Save failed' });
                    } finally {
                      setSubjectsCatalogSaving(false);
                    }
                  }}
                  className="text-xs px-2 py-1 bg-gray-100 text-gray-800 border border-gray-200 rounded disabled:opacity-70"
                  title={isV2SubjectsCatalog ? 'Disabled: v2 catalog is managed via outline seed script' : 'Save'}
                >
                  {subjectsCatalogSaving ? 'Saving' : 'Save'}
                </button>
              </div>
            </div>

            {subjectsCatalogLoading ? (
              <div className="mt-3 text-sm text-muted-foreground">Loading…</div>
            ) : (
              <div className="mt-4">
                {subjectsCatalogError ? (
                  <div className="mb-3 text-sm text-red-600">{subjectsCatalogError}</div>
                ) : null}

                {isV2SubjectsCatalog ? (
                  <div className="text-sm">
                    <div className="text-xs text-muted-foreground">
                      This catalog is <span className="font-medium text-foreground">version 2 (hierarchical)</span>. Editing is disabled here to avoid overwriting it.
                      Update by editing <span className="font-medium text-foreground">/opt/waraqa/draft</span> on the droplet and re-running the seed script.
                    </div>

                    <div className="mt-3 text-xs text-muted-foreground">
                      Subjects: <span className="font-medium text-foreground">{subjectsCatalogCounts.subjectCount}</span> · Courses: <span className="font-medium text-foreground">{subjectsCatalogCounts.courseCount}</span> · Levels: <span className="font-medium text-foreground">{subjectsCatalogCounts.levelCount}</span>
                    </div>

                    {subjectsCatalogTree.length === 0 ? (
                      <div className="mt-3 text-sm text-muted-foreground">No catalog tree found.</div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {subjectsCatalogTree.map((subject) => (
                          <div key={subject?.name || JSON.stringify(subject)} className="border border-border rounded p-3 bg-card">
                            <div className="font-medium">{subject?.name || 'Untitled subject'}</div>

                            {Array.isArray(subject?.courses) && subject.courses.length > 0 ? (
                              <div className="mt-2 space-y-2">
                                {subject.courses.map((course) => (
                                  <div key={`${subject?.name || 'subject'}::${course?.name || 'course'}`} className="pl-3 border-l border-border">
                                    <div className="text-sm font-medium">{course?.name || 'Untitled course'}</div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      Levels: {Array.isArray(course?.levels) ? course.levels.length : 0}
                                    </div>

                                    {Array.isArray(course?.levels) && course.levels.length > 0 ? (
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        {course.levels.map((lvl) => (
                                          <span key={`${course?.name || 'course'}::${lvl?.name || 'level'}`} className="px-2 py-1 rounded border text-xs bg-card">
                                            {lvl?.name || 'Untitled level'}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="mt-2 text-sm text-muted-foreground">No levels.</div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="mt-2 text-sm text-muted-foreground">No courses.</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      {[
                        { step: 1, label: 'Subjects' },
                        { step: 2, label: 'Levels' },
                        { step: 3, label: 'Topics' },
                      ].map((s) => (
                        <button
                          key={s.step}
                          type="button"
                          onClick={() => setSubjectsCatalogStep(s.step)}
                          className={`text-xs px-2 py-1 border rounded ${subjectsCatalogStep === s.step ? 'bg-muted border-border' : 'bg-card border-border hover:bg-muted'}`}
                        >
                          {s.step}. {s.label}
                        </button>
                      ))}
                    </div>

                {/* Step 1: Subjects */}
                {subjectsCatalogStep === 1 && (
                  <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="text-sm">
                      <div className="font-medium">Subjects / courses</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Add subjects using comma-separated entry or one per line. They will be trimmed + deduplicated on save.
                      </div>

                      <div className="mt-3 flex gap-2">
                        <input
                          value={quickAddSubjects}
                          onChange={(e) => setQuickAddSubjects(e.target.value)}
                          className="flex-1 px-3 py-2 border rounded text-sm"
                          placeholder="Type a subject (comma-separated supported)…"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const nextText = addItemsToTextList(catalogSubjectsText, quickAddSubjects);
                            setCatalogSubjectsText(nextText);
                            const nextSubjects = parseLinesOrComma(nextText);
                            ensureTopicsMapSync(nextSubjects);
                            setTopicsActiveSubject((prev) => (prev && nextSubjects.includes(prev) ? prev : nextSubjects[0] || ''));
                            setQuickAddSubjects('');
                          }}
                          className="text-xs px-3 py-2 border rounded bg-card hover:bg-muted"
                        >
                          Add
                        </button>
                      </div>

                      <div className="mt-3">
                        <textarea
                          rows={8}
                          value={catalogSubjectsText}
                          onChange={(e) => {
                            const next = e.target.value;
                            setCatalogSubjectsText(next);
                            const nextSubjects = parseLinesOrComma(next);
                            ensureTopicsMapSync(nextSubjects);
                            setTopicsActiveSubject((prev) => (prev && nextSubjects.includes(prev) ? prev : nextSubjects[0] || ''));
                          }}
                          className="w-full px-3 py-2 border rounded text-sm"
                          placeholder="Foundation\nTajweed Basics\nBasic Arabic"
                        />
                        <div className="mt-2 text-xs text-muted-foreground">Total: {subjectsList.length}</div>
                      </div>
                    </div>

                    <div className="text-sm">
                      <div className="font-medium">Current subjects</div>
                      <div className="text-xs text-muted-foreground mt-1">Click a subject to remove it.</div>
                      {subjectsList.length === 0 ? (
                        <div className="mt-3 text-sm text-muted-foreground">No subjects yet.</div>
                      ) : (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {subjectsList.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => {
                                const nextText = removeItemFromTextList(catalogSubjectsText, s);
                                setCatalogSubjectsText(nextText);
                                const nextSubjects = parseLinesOrComma(nextText);
                                ensureTopicsMapSync(nextSubjects);
                                setTopicsActiveSubject((prev) => (prev && nextSubjects.includes(prev) ? prev : nextSubjects[0] || ''));
                              }}
                              className="px-2 py-1 rounded border text-xs bg-card hover:bg-muted"
                              title="Remove"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Step 2: Levels */}
                {subjectsCatalogStep === 2 && (
                  <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="text-sm">
                      <div className="font-medium">Levels</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Used in the Library and anywhere else levels are needed. Comma-separated or one per line.
                      </div>

                      <div className="mt-3 flex gap-2">
                        <input
                          value={quickAddLevels}
                          onChange={(e) => setQuickAddLevels(e.target.value)}
                          className="flex-1 px-3 py-2 border rounded text-sm"
                          placeholder="Type a level (comma-separated supported)…"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const nextText = addItemsToTextList(catalogLevelsText, quickAddLevels);
                            setCatalogLevelsText(nextText);
                            setQuickAddLevels('');
                          }}
                          className="text-xs px-3 py-2 border rounded bg-card hover:bg-muted"
                        >
                          Add
                        </button>
                      </div>

                      <div className="mt-3">
                        <textarea
                          rows={8}
                          value={catalogLevelsText}
                          onChange={(e) => setCatalogLevelsText(e.target.value)}
                          className="w-full px-3 py-2 border rounded text-sm"
                          placeholder="Beginner\nIntermediate\nAdvanced"
                        />
                        <div className="mt-2 text-xs text-muted-foreground">Total: {levelsList.length}</div>
                      </div>
                    </div>

                    <div className="text-sm">
                      <div className="font-medium">Current levels</div>
                      <div className="text-xs text-muted-foreground mt-1">Click a level to remove it.</div>
                      {levelsList.length === 0 ? (
                        <div className="mt-3 text-sm text-muted-foreground">No levels yet.</div>
                      ) : (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {levelsList.map((lvl) => (
                            <button
                              key={lvl}
                              type="button"
                              onClick={() => setCatalogLevelsText(removeItemFromTextList(catalogLevelsText, lvl))}
                              className="px-2 py-1 rounded border text-xs bg-card hover:bg-muted"
                              title="Remove"
                            >
                              {lvl}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Step 3: Topics */}
                {subjectsCatalogStep === 3 && (
                  <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="text-sm lg:col-span-1">
                      <div className="font-medium">Choose a subject</div>
                      <div className="text-xs text-muted-foreground mt-1">Pick a subject to edit its lesson topics.</div>

                      {subjectsList.length === 0 ? (
                        <div className="mt-3 text-sm text-muted-foreground">Add subjects first.</div>
                      ) : (
                        <select
                          value={topicsActiveSubject}
                          onChange={(e) => setTopicsActiveSubject(e.target.value)}
                          className="mt-3 w-full px-3 py-2 border rounded text-sm bg-background"
                        >
                          {subjectsList.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      )}

                      {topicsActiveSubject ? (
                        <div className="mt-3 text-xs text-muted-foreground">
                          Topics for <span className="font-medium text-foreground">{topicsActiveSubject}</span>: {parseLinesOrComma(catalogTopicsBySubjectText?.[topicsActiveSubject] || '').length}
                        </div>
                      ) : null}
                    </div>

                    <div className="text-sm lg:col-span-2">
                      <div className="font-medium">Lesson topics</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Enter topics comma-separated or one per line. If empty, teachers can type a custom topic.
                      </div>

                      {!topicsActiveSubject ? (
                        <div className="mt-3 text-sm text-muted-foreground">Select a subject to edit topics.</div>
                      ) : (
                        <>
                          <div className="mt-3">
                            <textarea
                              rows={10}
                              value={catalogTopicsBySubjectText?.[topicsActiveSubject] || ''}
                              onChange={(e) =>
                                setCatalogTopicsBySubjectText((prev) => ({
                                  ...(prev || {}),
                                  [topicsActiveSubject]: e.target.value,
                                }))
                              }
                              className="w-full px-3 py-2 border rounded text-sm"
                              placeholder="Topic 1\nTopic 2"
                            />
                          </div>

                          <div className="mt-3">
                            <div className="text-xs font-medium text-muted-foreground">Preview (click to remove)</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {parseLinesOrComma(catalogTopicsBySubjectText?.[topicsActiveSubject] || '').length === 0 ? (
                                <div className="text-sm text-muted-foreground">No topics yet.</div>
                              ) : (
                                parseLinesOrComma(catalogTopicsBySubjectText?.[topicsActiveSubject] || '').map((t) => (
                                  <button
                                    key={t}
                                    type="button"
                                    onClick={() =>
                                      setCatalogTopicsBySubjectText((prev) => ({
                                        ...(prev || {}),
                                        [topicsActiveSubject]: removeItemFromTextList(prev?.[topicsActiveSubject] || '', t),
                                      }))
                                    }
                                    className="px-2 py-1 rounded border text-xs bg-card hover:bg-muted"
                                    title="Remove"
                                  >
                                    {t}
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setSubjectsCatalogStep((s) => Math.max(1, s - 1))}
                    className="text-xs px-3 py-2 border rounded bg-card hover:bg-muted"
                    disabled={subjectsCatalogStep === 1}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubjectsCatalogStep((s) => Math.min(3, s + 1))}
                    className="text-xs px-3 py-2 border rounded bg-card hover:bg-muted"
                    disabled={subjectsCatalogStep === 3}
                  >
                    Next
                  </button>
                </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

          {/* Maintenance card */}
          {user?.role === 'admin' && activeSection === 'general' && (
            <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">Maintenance</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Manual tools for low-usage operations.
                  </div>
                </div>
                <button
                  disabled={generatingRecurring}
                  onClick={async () => {
                    setGeneratingRecurring(true);
                    try {
                      const res = await api.post('/classes/maintenance/generate-recurring');
                      const count = res.data?.count;
                      setToast({
                        type: 'success',
                        message: `Recurring generation complete${typeof count === 'number' ? ` (${count} classes created)` : ''}`,
                      });
                    } catch (err) {
                      setToast({
                        type: 'error',
                        message: err?.response?.data?.message || err?.message || 'Failed to generate recurring classes',
                      });
                    } finally {
                      setGeneratingRecurring(false);
                    }
                  }}
                  className={`text-xs px-2 py-1 bg-gray-100 text-gray-800 border border-gray-200 rounded ${generatingRecurring ? 'opacity-70' : ''}`}
                  title="Generate upcoming recurring class instances now"
                >
                  {generatingRecurring ? 'Generating…' : 'Generate Recurring Classes Now'}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
      <ConfirmModal
        open={confirmOpen}
        title="Save Feedback Settings"
        message={`Are you sure you want to set the first-class feedback window to ${firstClassWindowHours} hours?`}
        onCancel={()=>setConfirmOpen(false)}
        onConfirm={async ()=>{
          setConfirmOpen(false);
          try {
            setSavingWindow(true);
            const res = await api.put('/settings/firstClassWindowHours', { value: firstClassWindowHours });
            if (res.data && res.data.success) {
              // show small toast (simple)
              // TODO: replace with styled toast component
            }
          } catch (err) {
            console.error('Save setting error', err);
          } finally { setSavingWindow(false); }
        }}
        confirmText="Save"
        cancelText="Cancel"
      />
      {toast && (
        <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />
      )}
      </div>
    </div>
  );
};

export default Settings;
