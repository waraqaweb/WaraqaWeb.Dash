import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import FloatingTimezone from '../../components/ui/FloatingTimezone';
import api from '../../api/axios';
import ConfirmModal from '../../components/ui/ConfirmModal';
import Toast from '../../components/ui/Toast';
import { fetchLibraryStorageUsage } from '../../api/library';
import { makeCacheKey, readCache, writeCache } from '../../utils/sessionCache';
import { getSubjectsCatalogCached, saveSubjectsCatalog } from '../../services/subjectsCatalog';
import { REQUESTS_VISIBILITY_OPTIONS } from '../../utils/requestsVisibility';
import {
  canUseBrowserNotifications,
  getNotificationPreferences,
  requestBrowserNotificationPermission,
  setNotificationPreferences,
} from '../../utils/notificationPreferences';
import { getHomepageAnnouncementContainerClass, getHomepageAnnouncementTextClass } from '../../utils/homepageAnnouncement';

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

const SECTION_ORDER = [
  'general',
  'feedback',
  'reports',
  'meetings',
  'access',
  'appearance',
  'cleanup',
  'branding',
  'library',
  'subjectsCatalog',
];

const formatBytes = (bytes = 0) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
};

const SETTINGS_SECTION_STORAGE_KEY = 'waraqa.settings.activeSection.v1';
const BRANDING_TAB_STORAGE_KEY = 'waraqa.settings.brandingTab.v1';
const WHATSAPP_DRAFT_STORAGE_PREFIX = 'waraqa.settings.whatsappDraft.v1';

const normalizeWhatsappPhone = (value) => String(value || '').replace(/\D+/g, '');

const normalizeWhatsappPhoneWithCountryCode = (value) => {
  const digits = normalizeWhatsappPhone(value);
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  return digits;
};

const validateWhatsappPhone = (value) => {
  const normalized = normalizeWhatsappPhoneWithCountryCode(value);
  if (!normalized) {
    return { ok: false, normalized, reason: 'Missing number' };
  }
  if (!/^[1-9][0-9]{7,14}$/.test(normalized)) {
    return {
      ok: false,
      normalized,
      reason: 'Invalid format (must include country code and digits only)',
    };
  }
  return { ok: true, normalized, reason: null };
};

const interpolateWhatsappTemplate = (template, recipient) => {
  const values = {
    firstName: recipient?.firstName || '',
    lastName: recipient?.lastName || '',
    fullName: `${recipient?.firstName || ''} ${recipient?.lastName || ''}`.trim(),
    epithet: recipient?.epithet || '',
    timezone: recipient?.timezone || '',
    country: recipient?.country || '',
  };

  return String(template || '').replace(/\{\{\s*(firstName|lastName|fullName|epithet|timezone|country)\s*\}\}/g, (_, key) => values[key] || '');
};

const Settings = () => {
  const { user, socket } = useAuth();

  const dashboardVersion = import.meta?.env?.VITE_BUILD_VERSION || import.meta?.env?.VITE_APP_VERSION || null;
  const dashboardBuildTime = import.meta?.env?.VITE_BUILD_TIME || null;

  // Compact/condensed layout toggle (defaults to condensed for dense Google-like UI)
  const [condensed, setCondensed] = useState(true);
  const [activeSection, setActiveSection] = useState(() => {
    try {
      return localStorage.getItem(SETTINGS_SECTION_STORAGE_KEY) || 'general';
    } catch (e) {
      return 'general';
    }
  });
  const [firstClassWindowHours, setFirstClassWindowHours] = useState(24);
  const [savingWindow, setSavingWindow] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [unreportedCleanupDays, setUnreportedCleanupDays] = useState(30);
  const [savingCleanupDays, setSavingCleanupDays] = useState(false);
  const [whiteboardRetentionDays, setWhiteboardRetentionDays] = useState(90);
  const [savingWhiteboardRetention, setSavingWhiteboardRetention] = useState(false);
  const [teacherReportWindowHours, setTeacherReportWindowHours] = useState(72);
  const [adminExtensionHours, setAdminExtensionHours] = useState(24);
  const [savingReportWindow, setSavingReportWindow] = useState(false);
  const [presenterAccess, setPresenterAccess] = useState('admin');
  const [savingPresenterAccess, setSavingPresenterAccess] = useState(false);
  const [requestsVisibility, setRequestsVisibility] = useState('all_users');
  const [savingRequestsVisibility, setSavingRequestsVisibility] = useState(false);
  const [dashboardDecorationEnabled, setDashboardDecorationEnabled] = useState(false);
  const [dashboardDecorationOffsetX, setDashboardDecorationOffsetX] = useState(0);
  const [dashboardDecorationOffsetY, setDashboardDecorationOffsetY] = useState(0);
  const [dashboardDecorationItems, setDashboardDecorationItems] = useState({
    crescents: { count: 2, scale: 1 },
    stars: { count: 4, scale: 1 },
    dots: { count: 6, scale: 1 },
    lanterns: { count: 3, scale: 0.8 },
  });
  const [savingDashboardDecoration, setSavingDashboardDecoration] = useState(false);
  const [homepageAnnouncement, setHomepageAnnouncement] = useState({
    message: '',
    fontSize: 'text-sm',
    fontWeight: 'font-medium',
    italic: false,
    align: 'left',
    tone: 'default',
    backgroundColor: 'card',
    borderColor: 'default',
  });
  const [savingHomepageAnnouncement, setSavingHomepageAnnouncement] = useState(false);
  const [meetingFollowupPrompts, setMeetingFollowupPrompts] = useState({
    enabled: true,
    guardian: { enabled: true, cadenceDays: 30, lookbackDays: 30, triggerAt: null },
    teacher: { enabled: true, cadenceDays: 30, lookbackDays: 30, triggerAt: null },
  });
  const [savingMeetingFollowupPrompts, setSavingMeetingFollowupPrompts] = useState(false);
  const [notificationPrefs, setNotificationPrefsState] = useState(() => getNotificationPreferences(user?._id));
  const [notificationPermission, setNotificationPermission] = useState(() => {
    if (!canUseBrowserNotifications()) return 'unsupported';
    return Notification.permission;
  });

  useEffect(() => {
    if (user?.role !== 'admin') return;
    const fetchPresenterAccess = async () => {
        try {
            const cacheKey = makeCacheKey('settings:presenterAccess');
            const cached = readCache(cacheKey, { deps: ['settings'] });
            if (cached.hit && cached.value) {
                setPresenterAccess(cached.value.value || 'admin');
                if (cached.ageMs < 60_000) return;
            }
            const res = await api.get('/settings/presenterAccess').catch(() => null);
            if (res?.data?.setting) {
                setPresenterAccess(res.data.setting.value || 'admin');
                writeCache(cacheKey, { value: res.data.setting.value }, { ttlMs: 60_000, deps: ['settings'] });
            }
        } catch (err) { }
    };
    fetchPresenterAccess();
  }, [user?.role]);

  useEffect(() => {
    setNotificationPrefsState(getNotificationPreferences(user?._id));
    if (canUseBrowserNotifications()) {
      setNotificationPermission(Notification.permission);
    } else {
      setNotificationPermission('unsupported');
    }
  }, [user?._id]);

  const updateNotificationPreference = useCallback((key, value) => {
    const next = {
      ...notificationPrefs,
      [key]: value,
    };
    setNotificationPrefsState(next);
    setNotificationPreferences(user?._id, next);
  }, [notificationPrefs, user?._id]);

  const handleEnableBrowserAlerts = useCallback(async () => {
    const result = await requestBrowserNotificationPermission();
    setNotificationPermission(result);
    if (result === 'granted') {
      setToast({ type: 'success', message: 'Browser alerts enabled' });
    } else if (result === 'denied') {
      setToast({ type: 'error', message: 'Browser alerts are blocked in your browser settings' });
    }
  }, []);

  const triggerMeetingFollowup = useCallback(async (target) => {
    const nowIso = new Date().toISOString();
    const next = (prev) => ({
      ...prev,
      [target]: { ...prev[target], triggerAt: nowIso }
    });
    setMeetingFollowupPrompts(next);
    try {
      setSavingMeetingFollowupPrompts(true);
      const value = next(meetingFollowupPrompts);
      const res = await api.put('/settings/meetingFollowupPrompts', { value });
      if (res.data?.success) {
        const cacheKey = makeCacheKey('settings:meetingFollowupPrompts');
        writeCache(cacheKey, { value }, { ttlMs: 60_000, deps: ['settings'] });
        setToast({ type: 'success', message: 'Follow-up trigger sent' });
      }
    } catch (err) {
      setToast({ type: 'error', message: err?.response?.data?.message || err?.message || 'Failed to trigger follow-up' });
    } finally {
      setSavingMeetingFollowupPrompts(false);
    }
  }, [meetingFollowupPrompts]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    const fetchRequestsVisibility = async () => {
      try {
        const cacheKey = makeCacheKey('settings:requestsVisibility');
        const cached = readCache(cacheKey, { deps: ['settings'] });
        if (cached.hit && cached.value) {
          setRequestsVisibility(cached.value.value || 'all_users');
          if (cached.ageMs < 60_000) return;
        }
        const res = await api.get('/settings/requestsVisibility');
        const value = res?.data?.setting?.value || 'all_users';
        setRequestsVisibility(value);
        writeCache(cacheKey, { value }, { ttlMs: 60_000, deps: ['settings'] });
      } catch (err) {
        setRequestsVisibility('all_users');
      }
    };
    fetchRequestsVisibility();
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    const fetchDashboardDecoration = async () => {
      try {
        const cacheKey = makeCacheKey('settings:dashboardDecoration');
        const cached = readCache(cacheKey, { deps: ['settings'] });
        if (cached.hit && cached.value) {
          const value = cached.value.value || cached.value;
          setDashboardDecorationEnabled(Boolean(value?.enabled));
          setDashboardDecorationOffsetX(Number(value?.offsetX || 0));
          setDashboardDecorationOffsetY(Number(value?.offsetY || 0));
          if (cached.ageMs < 60_000) return;
        }
        const res = await api.get('/settings/dashboardDecoration');
        const value = res?.data?.setting?.value || { enabled: true, offsetX: 0, offsetY: 0 };
        setDashboardDecorationEnabled(Boolean(value.enabled));
        setDashboardDecorationOffsetX(Number(value.offsetX || 0));
        setDashboardDecorationOffsetY(Number(value.offsetY || 0));
        if (value.items && typeof value.items === 'object') {
          setDashboardDecorationItems((prev) => ({
            ...prev,
            ...value.items,
          }));
        }
        writeCache(cacheKey, { value }, { ttlMs: 60_000, deps: ['settings'] });
      } catch (err) {
        setDashboardDecorationEnabled(false);
        setDashboardDecorationOffsetX(0);
        setDashboardDecorationOffsetY(0);
      }
    };
    fetchDashboardDecoration();
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    const fetchHomepageAnnouncement = async () => {
      try {
        const cacheKey = makeCacheKey('settings:homepageAnnouncement');
        const cached = readCache(cacheKey, { deps: ['settings'] });
        if (cached.hit && cached.value) {
          const value = cached.value.value || cached.value;
          if (value && typeof value === 'object') {
            setHomepageAnnouncement((prev) => ({ ...prev, ...value }));
          }
          if (cached.ageMs < 60_000) return;
        }
        const res = await api.get('/settings/homepage-announcement');
        const value = res?.data?.setting?.value || null;
        if (value && typeof value === 'object') {
          setHomepageAnnouncement((prev) => ({ ...prev, ...value }));
          writeCache(cacheKey, { value }, { ttlMs: 60_000, deps: ['settings'] });
        }
      } catch (err) {
        // keep defaults
      }
    };
    fetchHomepageAnnouncement();
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    const fetchMeetingFollowupPrompts = async () => {
      try {
        const cacheKey = makeCacheKey('settings:meetingFollowupPrompts');
        const cached = readCache(cacheKey, { deps: ['settings'] });
        if (cached.hit && cached.value) {
          const value = cached.value.value || cached.value;
          if (value && typeof value === 'object') setMeetingFollowupPrompts(value);
          if (cached.ageMs < 60_000) return;
        }
        const res = await api.get('/settings/meetingFollowupPrompts');
        const value = res?.data?.setting?.value || null;
        if (value && typeof value === 'object') {
          setMeetingFollowupPrompts(value);
          writeCache(cacheKey, { value }, { ttlMs: 60_000, deps: ['settings'] });
        }
      } catch (err) {
        // keep defaults
      }
    };
    fetchMeetingFollowupPrompts();
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    // fetch admin setting
    const fetchSetting = async () => {
      try {
        const cacheKey = makeCacheKey('settings:firstClassWindowHours', user?._id || 'admin', { key: 'firstClassWindowHours' });
        const cached = readCache(cacheKey, { deps: ['settings'] });
        if (cached.hit && cached.value) {
          setFirstClassWindowHours(Number(cached.value.value || cached.value) || 24);
          if (cached.ageMs < 60_000) return;
        }
        const res = await api.get('/settings/firstClassWindowHours');
        if (res.data && res.data.setting) {
          setFirstClassWindowHours(Number(res.data.setting.value) || 24);
          writeCache(cacheKey, res.data.setting, { ttlMs: 5 * 60_000, deps: ['settings'] });
        }
      } catch (err) {
        // Setting doesn't exist yet - use default value
        if (err.response?.status === 404) {
          setFirstClassWindowHours(24); // Default value
        }
      }
    };
    fetchSetting();
  }, [user?._id, user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    // fetch cleanup days setting
    const fetchCleanupSetting = async () => {
      try {
        const cacheKey = makeCacheKey('settings:unreportedCleanupDays', user?._id || 'admin', { key: 'unreportedClassCleanupDays' });
        const cached = readCache(cacheKey, { deps: ['settings'] });
        if (cached.hit && cached.value) {
          setUnreportedCleanupDays(Number(cached.value.value || cached.value) || 30);
          if (cached.ageMs < 60_000) return;
        }
        const res = await api.get('/settings/unreportedClassCleanupDays');
        if (res.data && res.data.setting) {
          setUnreportedCleanupDays(Number(res.data.setting.value) || 30);
          writeCache(cacheKey, res.data.setting, { ttlMs: 5 * 60_000, deps: ['settings'] });
        }
      } catch (err) {
        if (err.response?.status === 404) {
          setUnreportedCleanupDays(30);
        }
      }
    };
    fetchCleanupSetting();
  }, [user?._id, user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    const fetchWhiteboardRetention = async () => {
      try {
        const cacheKey = makeCacheKey('settings:whiteboardRetentionDays', user?._id || 'admin', { key: 'whiteboardScreenshotRetentionDays' });
        const cached = readCache(cacheKey, { deps: ['settings'] });
        if (cached.hit && cached.value) {
          setWhiteboardRetentionDays(Number(cached.value.value || cached.value) || 90);
          if (cached.ageMs < 60_000) return;
        }
        const res = await api.get('/settings/whiteboardScreenshotRetentionDays');
        if (res.data && res.data.setting) {
          setWhiteboardRetentionDays(Number(res.data.setting.value) || 90);
          writeCache(cacheKey, res.data.setting, { ttlMs: 5 * 60_000, deps: ['settings'] });
        }
      } catch (err) {
        if (err.response?.status === 404) {
          setWhiteboardRetentionDays(90);
        }
      }
    };
    fetchWhiteboardRetention();
  }, [user?._id, user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    const fetchReportWindowSettings = async () => {
      try {
        const cacheKey = makeCacheKey('settings:teacherReportWindowHours', user?._id || 'admin', { key: 'teacher_report_window_hours' });
        const cached = readCache(cacheKey, { deps: ['settings'] });
        if (cached.hit && cached.value) {
          setTeacherReportWindowHours(Number(cached.value.value || cached.value) || 72);
          if (cached.ageMs < 60_000) return;
        }
        const res = await api.get('/settings/teacher_report_window_hours');
        if (res.data?.setting) {
          setTeacherReportWindowHours(Number(res.data.setting.value) || 72);
          writeCache(cacheKey, res.data.setting, { ttlMs: 5 * 60_000, deps: ['settings'] });
        }
      } catch (err) {
        if (err.response?.status === 404) setTeacherReportWindowHours(72);
      }
    };
    fetchReportWindowSettings();
  }, [user?._id, user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    const fetchAdminExtensionSettings = async () => {
      try {
        const cacheKey = makeCacheKey('settings:adminExtensionHours', user?._id || 'admin', { key: 'admin_extension_hours' });
        const cached = readCache(cacheKey, { deps: ['settings'] });
        if (cached.hit && cached.value) {
          setAdminExtensionHours(Number(cached.value.value || cached.value) || 24);
          if (cached.ageMs < 60_000) return;
        }
        const res = await api.get('/settings/admin_extension_hours');
        if (res.data?.setting) {
          setAdminExtensionHours(Number(res.data.setting.value) || 24);
          writeCache(cacheKey, res.data.setting, { ttlMs: 5 * 60_000, deps: ['settings'] });
        }
      } catch (err) {
        if (err.response?.status === 404) setAdminExtensionHours(24);
      }
    };
    fetchAdminExtensionSettings();
  }, [user?._id, user?.role]);

  // Branding (logo/title/slogan) - admin only
  const [branding, setBranding] = useState({ logo: null, title: 'Waraqa', slogan: '' });
  const [logoFile, setLogoFile] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [brandingTab, setBrandingTab] = useState(() => {
    try {
      return localStorage.getItem(BRANDING_TAB_STORAGE_KEY) || 'branding';
    } catch (e) {
      return 'branding';
    }
  });

  const [waAudience, setWaAudience] = useState('active_guardians');
  const [waTimezoneFilter, setWaTimezoneFilter] = useState('');
  const [waCountryFilter, setWaCountryFilter] = useState('');
  const [waRecipients, setWaRecipients] = useState([]);
  const [waRecipientOptions, setWaRecipientOptions] = useState({ guardianTimezones: [], guardianCountries: [] });
  const [waLoadingRecipients, setWaLoadingRecipients] = useState(false);
  const [waSending, setWaSending] = useState(false);
  const [waRetryingFailed, setWaRetryingFailed] = useState(false);
  const [waSendProgress, setWaSendProgress] = useState(null);
  const [waSelectedRecipientIds, setWaSelectedRecipientIds] = useState([]);
  const [waPhoneEdits, setWaPhoneEdits] = useState({});
  const [waSavingPhoneId, setWaSavingPhoneId] = useState(null);
  const [waLastSendReport, setWaLastSendReport] = useState(null);
  const [waMessageDraft, setWaMessageDraft] = useState({
    welcome: 'Assalamu Alaikum',
    body: '',
    regards: 'Jazak Allah Khair',
    imageUrl: '',
  });
  const [waImageFile, setWaImageFile] = useState(null);
  const [waUploadingImage, setWaUploadingImage] = useState(false);
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

  const homepageAnnouncementPreviewContainerClass = getHomepageAnnouncementContainerClass({
    tone: homepageAnnouncement?.tone,
    align: homepageAnnouncement?.align,
    backgroundColor: homepageAnnouncement?.backgroundColor,
    borderColor: homepageAnnouncement?.borderColor,
    baseClassName: 'mt-2 rounded-xl border px-4 py-3',
  });
  const homepageAnnouncementPreviewTextClass = getHomepageAnnouncementTextClass({
    fontSize: homepageAnnouncement?.fontSize,
    fontWeight: homepageAnnouncement?.fontWeight,
    italic: homepageAnnouncement?.italic,
  });

  useEffect(() => {
    if (user?.role !== 'admin') return;
    (async () => {
      try {
        const cacheKey = makeCacheKey('settings:branding', user?._id || 'admin', { key: 'branding' });
        const cached = readCache(cacheKey, { deps: ['settings'] });
        if (cached.hit && cached.value) {
          if (cached.value?.branding) setBranding(cached.value.branding);
          if (cached.ageMs < 60_000) return;
        }
        const res = await api.get('/settings/branding');
        if (res.data?.branding) {
          setBranding(res.data.branding);
          writeCache(cacheKey, res.data, { ttlMs: 5 * 60_000, deps: ['settings'] });
        }
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

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_SECTION_STORAGE_KEY, activeSection);
    } catch (e) {
      // ignore storage errors
    }
  }, [activeSection]);

  useEffect(() => {
    try {
      localStorage.setItem(BRANDING_TAB_STORAGE_KEY, brandingTab);
    } catch (e) {
      // ignore storage errors
    }
  }, [brandingTab]);

  useEffect(() => {
    if (user?.role !== 'admin' || !user?._id) return;
    try {
      const raw = localStorage.getItem(`${WHATSAPP_DRAFT_STORAGE_PREFIX}:${user._id}`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (parsed.messageDraft && typeof parsed.messageDraft === 'object') {
          setWaMessageDraft((prev) => ({ ...prev, ...parsed.messageDraft }));
        }
        if (parsed.audience) setWaAudience(String(parsed.audience));
        if (typeof parsed.timezone === 'string') setWaTimezoneFilter(parsed.timezone);
        if (typeof parsed.country === 'string') setWaCountryFilter(parsed.country);
        if (parsed.brandingTab === 'branding' || parsed.brandingTab === 'whatsapp') {
          setBrandingTab(parsed.brandingTab);
        }
      }
    } catch (e) {
      // ignore corrupted draft
    }
  }, [user?._id, user?.role]);

  useEffect(() => {
    if (user?.role !== 'admin' || !user?._id) return;
    try {
      localStorage.setItem(
        `${WHATSAPP_DRAFT_STORAGE_PREFIX}:${user._id}`,
        JSON.stringify({
          messageDraft: waMessageDraft,
          audience: waAudience,
          timezone: waTimezoneFilter,
          country: waCountryFilter,
          brandingTab,
        })
      );
    } catch (e) {
      // ignore storage errors
    }
  }, [user?._id, user?.role, waMessageDraft, waAudience, waTimezoneFilter, waCountryFilter, brandingTab]);

  const fetchWhatsappRecipients = useCallback(async () => {
    if (user?.role !== 'admin') return;
    setWaLoadingRecipients(true);
    try {
      const params = {
        audience: waAudience,
      };
      if (waAudience === 'guardians_timezone' && waTimezoneFilter) params.timezone = waTimezoneFilter;
      if (waAudience === 'guardians_country' && waCountryFilter) params.country = waCountryFilter;

      const res = await api.get('/settings/whatsapp-recipients', { params });
      const recipients = Array.isArray(res?.data?.recipients) ? res.data.recipients : [];
      setWaRecipients(recipients);
      setWaRecipientOptions({
        guardianTimezones: Array.isArray(res?.data?.options?.guardianTimezones) ? res.data.options.guardianTimezones : [],
        guardianCountries: Array.isArray(res?.data?.options?.guardianCountries) ? res.data.options.guardianCountries : [],
      });
      setWaSelectedRecipientIds((prev) => {
        const validIds = new Set(recipients.map((r) => r.id));
        const retained = (prev || []).filter((id) => validIds.has(id));
        if (retained.length) return retained;
        return recipients.map((r) => r.id);
      });
    } catch (err) {
      setWaRecipients([]);
      setToast({ type: 'error', message: err?.response?.data?.message || err?.message || 'Failed to load WhatsApp recipients' });
    } finally {
      setWaLoadingRecipients(false);
    }
  }, [user?.role, waAudience, waTimezoneFilter, waCountryFilter]);

  useEffect(() => {
    if (user?.role !== 'admin' || activeSection !== 'branding' || brandingTab !== 'whatsapp') return;
    fetchWhatsappRecipients();
  }, [user?.role, activeSection, brandingTab, fetchWhatsappRecipients]);

  const adminSections = useMemo(() => {
    if (user?.role !== 'admin') return [{ key: 'general', label: 'General' }];
    return [
      { key: 'general', label: 'General' },
      { key: 'feedback', label: 'Feedback' },
      { key: 'reports', label: 'Reports' },
      { key: 'meetings', label: 'Meetings' },
      { key: 'access', label: 'Access' },
      { key: 'appearance', label: 'Appearance' },
      { key: 'cleanup', label: 'Cleanup' },
      { key: 'branding', label: 'Branding' },
      { key: 'library', label: 'Library' },
      { key: 'subjectsCatalog', label: 'Subjects Catalog' },
    ];
  }, [user?.role]);

  const subjectsList = useMemo(() => parseLinesOrComma(catalogSubjectsText), [catalogSubjectsText]);
  const levelsList = useMemo(() => parseLinesOrComma(catalogLevelsText), [catalogLevelsText]);
  const waSelectedIdSet = useMemo(() => new Set(waSelectedRecipientIds), [waSelectedRecipientIds]);
  const waSelectedRecipients = useMemo(
    () => waRecipients.filter((r) => waSelectedIdSet.has(r.id)),
    [waRecipients, waSelectedIdSet]
  );
  const waPreviewRecipient = waSelectedRecipients[0] || waRecipients[0] || null;
  const waInvalidSelectedRecipients = useMemo(
    () => waSelectedRecipients
      .map((recipient) => ({
        recipient,
        validation: validateWhatsappPhone(recipient.phone),
      }))
      .filter((entry) => !entry.validation.ok),
    [waSelectedRecipients]
  );

  const buildWhatsappMessageForRecipient = useCallback((recipient) => {
    const welcomePrefix = interpolateWhatsappTemplate(waMessageDraft.welcome, recipient).trim();
    const firstName = String(recipient?.firstName || '').trim();
    const epithet = String(recipient?.epithet || '').trim();
    const salutationName = [epithet, firstName].filter(Boolean).join(' ').trim();
    const welcomeLine = [welcomePrefix, salutationName].filter(Boolean).join(' ').trim();
    const body = interpolateWhatsappTemplate(waMessageDraft.body, recipient).trim();
    const regards = interpolateWhatsappTemplate(waMessageDraft.regards, recipient).trim();
    const imageUrl = String(waMessageDraft.imageUrl || '').trim();

    return [welcomeLine, body, regards, imageUrl].filter(Boolean).join('\n\n');
  }, [waMessageDraft]);

  const handleUploadWhatsappImage = useCallback(async () => {
    if (!waImageFile) {
      setToast({ type: 'error', message: 'Select an image first' });
      return;
    }
    try {
      setWaUploadingImage(true);
      const fd = new FormData();
      fd.append('file', waImageFile);
      const res = await api.post('/settings/whatsapp-broadcast/image', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const imageUrl = res?.data?.image?.url || '';
      if (!imageUrl) {
        setToast({ type: 'error', message: 'Upload failed: no image URL returned' });
        return;
      }
      setWaMessageDraft((prev) => ({ ...prev, imageUrl }));
      setToast({ type: 'success', message: 'Image uploaded for WhatsApp message' });
    } catch (err) {
      setToast({ type: 'error', message: err?.response?.data?.message || err?.message || 'Failed to upload image' });
    } finally {
      setWaUploadingImage(false);
    }
  }, [waImageFile]);

  const handleSendTestToAdminWhatsapp = useCallback(() => {
    const adminRecipient = {
      firstName: user?.firstName || 'Admin',
      lastName: user?.lastName || '',
      epithet: user?.guardianInfo?.epithet || '',
      timezone: user?.timezone || '',
      country: user?.uiPreferences?.timezoneCountry || '',
    };
    const validation = validateWhatsappPhone(user?.phone);
    if (!validation.ok) {
      setToast({ type: 'error', message: `Admin phone is not ready for WhatsApp: ${validation.reason}` });
      return;
    }
    const message = buildWhatsappMessageForRecipient(adminRecipient);
    const url = `https://wa.me/${validation.normalized}?text=${encodeURIComponent(message)}`;
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      setToast({ type: 'error', message: 'Popup blocked. Allow popups and try again.' });
      return;
    }
    setToast({ type: 'success', message: 'Opened test WhatsApp chat to admin number' });
  }, [user, buildWhatsappMessageForRecipient]);

  const handleSaveRecipientPhone = useCallback(async (recipientId) => {
    const draftPhone = waPhoneEdits[recipientId];
    const validation = validateWhatsappPhone(draftPhone);
    if (!validation.ok) {
      setToast({ type: 'error', message: `Cannot save phone: ${validation.reason}` });
      return;
    }

    try {
      setWaSavingPhoneId(recipientId);
      await api.put(`/users/${recipientId}`, { phone: `+${validation.normalized}` });
      setWaRecipients((prev) => prev.map((recipient) => (
        recipient.id === recipientId
          ? { ...recipient, phone: validation.normalized }
          : recipient
      )));
      setWaPhoneEdits((prev) => ({ ...prev, [recipientId]: validation.normalized }));
      setToast({ type: 'success', message: 'Phone updated successfully' });
    } catch (err) {
      setToast({ type: 'error', message: err?.response?.data?.message || err?.message || 'Failed to save phone' });
    } finally {
      setWaSavingPhoneId(null);
    }
  }, [waPhoneEdits]);

  const askWhatsappSendStatus = useCallback((recipient) => {
    const recipientName = `${recipient.firstName || ''} ${recipient.lastName || ''}`.trim() || 'this recipient';
    const sent = window.confirm(
      `After sending in WhatsApp, click OK if the message was sent to ${recipientName}.\nClick Cancel to mark as not sent.`
    );

    if (sent) {
      return {
        ok: true,
      };
    }

    const reasonInput = window.prompt(
      `Marking ${recipientName} as not sent. Optional reason:`,
      'Not confirmed as sent'
    );

    return {
      ok: false,
      reason: String(reasonInput || '').trim() || 'Not confirmed as sent',
    };
  }, []);

  const runWhatsappSendAttempt = useCallback(async (recipients) => {
    const selected = Array.isArray(recipients) ? recipients : [];
    const sent = [];
    const failed = [];

    for (let index = 0; index < selected.length; index += 1) {
      const recipient = selected[index];
      setWaSendProgress({
        current: index + 1,
        total: selected.length,
        name: `${recipient.firstName || ''} ${recipient.lastName || ''}`.trim() || 'Unknown recipient',
      });

      const validation = validateWhatsappPhone(recipient.phone);
      if (!validation.ok) {
        failed.push({
          id: recipient.id,
          name: `${recipient.firstName || ''} ${recipient.lastName || ''}`.trim(),
          role: recipient.role,
          reason: validation.reason,
          currentPhone: recipient.phone || '',
          suggestedPhone: validation.normalized || '',
        });
        continue;
      }

      const message = buildWhatsappMessageForRecipient(recipient);
      const url = `https://wa.me/${validation.normalized}?text=${encodeURIComponent(message)}`;
      const openedWindow = window.open(url, '_blank', 'noopener,noreferrer');
      if (!openedWindow) {
        failed.push({
          id: recipient.id,
          name: `${recipient.firstName || ''} ${recipient.lastName || ''}`.trim(),
          role: recipient.role,
          reason: 'Popup blocked while opening WhatsApp tab',
          currentPhone: recipient.phone || '',
          suggestedPhone: validation.normalized || '',
        });
        continue;
      }

      const status = askWhatsappSendStatus(recipient);
      if (!status.ok) {
        failed.push({
          id: recipient.id,
          name: `${recipient.firstName || ''} ${recipient.lastName || ''}`.trim(),
          role: recipient.role,
          reason: status.reason || 'Not sent',
          currentPhone: recipient.phone || '',
          suggestedPhone: validation.normalized || '',
        });
        continue;
      }

      sent.push({
        id: recipient.id,
        name: `${recipient.firstName || ''} ${recipient.lastName || ''}`.trim(),
        role: recipient.role,
        phone: validation.normalized,
      });
    }

    return {
      attempted: selected.length,
      sent,
      failed,
    };
  }, [askWhatsappSendStatus, buildWhatsappMessageForRecipient]);

  const handleSendWhatsappCampaign = useCallback(async () => {
    const selected = waSelectedRecipients;
    if (!selected.length) {
      setToast({ type: 'error', message: 'No selected recipients with valid WhatsApp numbers' });
      return;
    }

    setWaSending(true);
    try {
      const result = await runWhatsappSendAttempt(selected);
      setWaLastSendReport({ timestamp: new Date().toISOString(), ...result });
      setToast({
        type: result.failed.length ? 'error' : 'success',
        message: result.failed.length
          ? `Sent ${result.sent.length}/${result.attempted}. ${result.failed.length} not sent — see report below.`
          : `Sent ${result.sent.length} WhatsApp message${result.sent.length === 1 ? '' : 's'} successfully.`,
      });
    } finally {
      setWaSendProgress(null);
      setWaSending(false);
    }
  }, [waSelectedRecipients, runWhatsappSendAttempt]);

  const handleRetryFailedOnly = useCallback(async () => {
    const failedIds = Array.isArray(waLastSendReport?.failed) ? waLastSendReport.failed.map((f) => f.id) : [];
    if (!failedIds.length) {
      setToast({ type: 'error', message: 'No failed recipients to retry' });
      return;
    }

    const failedSet = new Set(failedIds);
    const retryTargets = waRecipients.filter((recipient) => failedSet.has(recipient.id));
    if (!retryTargets.length) {
      setToast({ type: 'error', message: 'Failed recipients are no longer in the current list. Reload recipients first.' });
      return;
    }

    setWaRetryingFailed(true);
    try {
      const result = await runWhatsappSendAttempt(retryTargets);
      setWaLastSendReport({ timestamp: new Date().toISOString(), ...result });
      setToast({
        type: result.failed.length ? 'error' : 'success',
        message: result.failed.length
          ? `Retry sent ${result.sent.length}/${result.attempted}. ${result.failed.length} still not sent.`
          : `Retry succeeded for all ${result.sent.length} recipient${result.sent.length === 1 ? '' : 's'}.`,
      });
    } finally {
      setWaSendProgress(null);
      setWaRetryingFailed(false);
    }
  }, [waLastSendReport, waRecipients, runWhatsappSendAttempt]);

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

  const normalizeCatalogName = useCallback((v) => {
    const s = String(v ?? '').trim();
    return s;
  }, []);

  const sanitizeUniqueNames = useCallback((list) => {
    const seen = new Set();
    const result = [];

    for (const item of Array.isArray(list) ? list : []) {
      const name = normalizeCatalogName(item);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(name);
    }

    return result;
  }, [normalizeCatalogName]);

  const sanitizeV2SubjectsTree = useCallback((tree) => {
    const nextSubjects = [];
    const subjectNamesSeen = new Set();

    for (const subject of Array.isArray(tree) ? tree : []) {
      const subjectName = normalizeCatalogName(subject?.name);
      if (!subjectName) continue;
      const subjectKey = subjectName.toLowerCase();
      if (subjectNamesSeen.has(subjectKey)) continue;
      subjectNamesSeen.add(subjectKey);

      const courses = [];
      const courseNamesSeen = new Set();
      for (const course of Array.isArray(subject?.courses) ? subject.courses : []) {
        const courseName = normalizeCatalogName(course?.name);
        if (!courseName) continue;
        const courseKey = courseName.toLowerCase();
        if (courseNamesSeen.has(courseKey)) continue;
        courseNamesSeen.add(courseKey);

        const levels = [];
        const levelNamesSeen = new Set();
        for (const level of Array.isArray(course?.levels) ? course.levels : []) {
          const levelName = normalizeCatalogName(level?.name);
          if (!levelName) continue;
          const levelKey = levelName.toLowerCase();
          if (levelNamesSeen.has(levelKey)) continue;
          levelNamesSeen.add(levelKey);

          const topics = sanitizeUniqueNames(level?.topics);
          levels.push({ name: levelName, topics });
        }

        courses.push({ name: courseName, levels });
      }

      nextSubjects.push({ name: subjectName, courses });
    }

    return nextSubjects;
  }, [normalizeCatalogName, sanitizeUniqueNames]);

  const saveCatalogV1 = useCallback(async () => {
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

    // Ensure UI reflects the saved shape (v1) even if it used to be v2.
    setSubjectsCatalogRaw(saved?.raw || {
      version: 1,
      subjects,
      levels,
      topicsBySubject,
    });
    setSubjectsCatalogTree([]);

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

  const saveCatalogV2 = useCallback(async () => {
    const subjects = sanitizeV2SubjectsTree(subjectsCatalogTree);

    const saved = await saveSubjectsCatalog({
      version: 2,
      subjects,
    });

    setSubjectsCatalogRaw(saved?.raw || { version: 2, subjects });
    setSubjectsCatalogTree(Array.isArray(saved?.tree) ? saved.tree : subjects);
  }, [sanitizeV2SubjectsTree, subjectsCatalogTree]);

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
        
        {activeSection === 'general' && (
          <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden p-4">
            <div className="font-medium mb-2">Notifications & Sounds</div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Live alerts observer</div>
                  <div className="text-xs text-muted-foreground">Instantly checks and delivers class-time and new-notification alerts.</div>
                </div>
                <button
                  type="button"
                  onClick={() => updateNotificationPreference('liveAlertsEnabled', !notificationPrefs.liveAlertsEnabled)}
                  className={`text-xs px-3 py-1.5 rounded border ${notificationPrefs.liveAlertsEnabled ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-foreground'}`}
                >
                  {notificationPrefs.liveAlertsEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">New notification sound</div>
                  <div className="text-xs text-muted-foreground">Plays a distinct sound when a new notification arrives.</div>
                </div>
                <button
                  type="button"
                  onClick={() => updateNotificationPreference('notificationSoundEnabled', !notificationPrefs.notificationSoundEnabled)}
                  className={`text-xs px-3 py-1.5 rounded border ${notificationPrefs.notificationSoundEnabled ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-foreground'}`}
                >
                  {notificationPrefs.notificationSoundEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>

              {(user?.role === 'teacher' || user?.role === 'guardian') && (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Class start sound</div>
                    <div className="text-xs text-muted-foreground">Plays a separate sound when your class start time arrives.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateNotificationPreference('classStartSoundEnabled', !notificationPrefs.classStartSoundEnabled)}
                    className={`text-xs px-3 py-1.5 rounded border ${notificationPrefs.classStartSoundEnabled ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-foreground'}`}
                  >
                    {notificationPrefs.classStartSoundEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Browser popup permission</div>
                  <div className="text-xs text-muted-foreground">
                    {notificationPermission === 'granted' ? 'Browser popups are enabled.' : notificationPermission === 'denied' ? 'Browser popups are blocked.' : 'Enable browser popups for delivery alerts.'}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={notificationPermission === 'granted' || notificationPermission === 'unsupported'}
                  onClick={handleEnableBrowserAlerts}
                  className={`text-xs px-3 py-1.5 rounded border ${notificationPermission === 'granted' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-card border-border text-foreground disabled:opacity-60'}`}
                >
                  {notificationPermission === 'granted' ? 'Allowed' : notificationPermission === 'unsupported' ? 'Unsupported' : 'Allow'}
                </button>
              </div>
            </div>
          </div>
        )}

        {user?.role === 'admin' && activeSection === 'feedback' && (
          <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <div className="text-sm font-semibold text-foreground">Feedback Prompts</div>
              <div className="text-xs text-muted-foreground">Timing rules for first-class feedback requests.</div>
            </div>
            <div className="p-4 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Feedback prompts</div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <input type="number" min={1} value={firstClassWindowHours} onChange={(e)=>setFirstClassWindowHours(Number(e.target.value))} className="px-3 py-2 border rounded w-28" />
                  <div className="text-sm text-muted">Hours after class end before first-class feedback appears.</div>
                </div>
              </div>
              <div className="flex items-start justify-end">
                <button onClick={()=>setConfirmOpen(true)} className={`text-xs px-3 py-1.5 bg-gray-100 text-gray-800 border border-gray-200 rounded ${savingWindow ? 'opacity-70' : ''}`}>Save</button>
              </div>
            </div>
          </div>
        )}

        {user?.role === 'admin' && activeSection === 'reports' && (
          <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <div className="text-sm font-semibold text-foreground">Report Submission</div>
              <div className="text-xs text-muted-foreground">Control report windows and admin extensions.</div>
            </div>
            <div className="p-4 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Report submission</div>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="text-xs text-muted-foreground">
                    Teacher window (hours)
                    <input type="number" min={1} value={teacherReportWindowHours} onChange={(e)=>setTeacherReportWindowHours(Number(e.target.value))} className="mt-1 px-3 py-2 border rounded w-full" />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    Admin extension (hours)
                    <input type="number" min={1} value={adminExtensionHours} onChange={(e)=>setAdminExtensionHours(Number(e.target.value))} className="mt-1 px-3 py-2 border rounded w-full" />
                  </label>
                </div>
              </div>
              <div className="flex items-start justify-end">
                <button
                  disabled={savingReportWindow}
                  onClick={async ()=>{
                    try {
                      setSavingReportWindow(true);
                      const [teacherRes, adminRes] = await Promise.all([
                        api.put('/settings/teacher_report_window_hours', { value: teacherReportWindowHours }),
                        api.put('/settings/admin_extension_hours', { value: adminExtensionHours })
                      ]);
                      if (teacherRes.data?.success || adminRes.data?.success) {
                        const teacherKey = makeCacheKey('settings:teacherReportWindowHours', user?._id || 'admin', { key: 'teacher_report_window_hours' });
                        writeCache(teacherKey, teacherRes.data?.setting || { value: teacherReportWindowHours }, { ttlMs: 5 * 60_000, deps: ['settings'] });
                        const adminKey = makeCacheKey('settings:adminExtensionHours', user?._id || 'admin', { key: 'admin_extension_hours' });
                        writeCache(adminKey, adminRes.data?.setting || { value: adminExtensionHours }, { ttlMs: 5 * 60_000, deps: ['settings'] });
                        setToast({ type: 'success', message: 'Report settings saved' });
                      }
                    } catch (err) {
                      setToast({ type: 'error', message: err?.response?.data?.message || err?.message || 'Failed to save report settings' });
                    } finally {
                      setSavingReportWindow(false);
                    }
                  }}
                  className={`text-xs px-3 py-1.5 bg-gray-100 text-gray-800 border border-gray-200 rounded ${savingReportWindow ? 'opacity-70' : ''}`}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {user?.role === 'admin' && activeSection === 'meetings' && (
          <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <div className="text-sm font-semibold text-foreground">Meeting Follow-ups</div>
              <div className="text-xs text-muted-foreground">Cadence and on-demand prompts for guardians and teachers.</div>
            </div>
            <div className="p-4 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Meeting follow-ups</div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setMeetingFollowupPrompts((prev) => ({ ...prev, enabled: !prev.enabled }))}
                    className={`text-xs px-3 py-1.5 rounded border ${meetingFollowupPrompts.enabled ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-foreground'}`}
                  >
                    {meetingFollowupPrompts.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMeetingFollowupPrompts((prev) => ({
                      ...prev,
                      enabled: false,
                      guardian: { ...prev.guardian, enabled: false },
                      teacher: { ...prev.teacher, enabled: false },
                    }))}
                    className="text-xs px-3 py-1.5 rounded border border-border bg-card text-foreground"
                  >
                    Disable all
                  </button>
                  <div className="text-xs text-muted-foreground">Show only if no meeting in the last 30 days.</div>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">Guardian follow-up</div>
                      <button
                        type="button"
                        onClick={() => setMeetingFollowupPrompts((prev) => ({
                          ...prev,
                          guardian: { ...prev.guardian, enabled: !prev.guardian.enabled },
                        }))}
                        className={`text-xs px-2 py-1 rounded border ${meetingFollowupPrompts.guardian?.enabled ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-card border-border text-foreground'}`}
                      >
                        {meetingFollowupPrompts.guardian?.enabled ? 'On' : 'Off'}
                      </button>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <label className="text-xs text-muted-foreground">Cadence</label>
                      <select
                        value={meetingFollowupPrompts.guardian?.cadenceDays || 30}
                        onChange={(e) => setMeetingFollowupPrompts((prev) => ({
                          ...prev,
                          guardian: { ...prev.guardian, cadenceDays: Number(e.target.value) }
                        }))}
                        className="px-2 py-1 border rounded text-xs bg-white"
                      >
                        <option value={7}>Weekly</option>
                        <option value={30}>Monthly</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => triggerMeetingFollowup('guardian')}
                        className="text-xs px-2 py-1 rounded border border-border bg-card text-foreground"
                      >
                        Trigger now
                      </button>
                    </div>
                    {meetingFollowupPrompts.guardian?.triggerAt && (
                      <div className="mt-2 text-xs text-muted-foreground">Last trigger: {new Date(meetingFollowupPrompts.guardian.triggerAt).toLocaleString()}</div>
                    )}
                  </div>

                  <div className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">Teacher sync</div>
                      <button
                        type="button"
                        onClick={() => setMeetingFollowupPrompts((prev) => ({
                          ...prev,
                          teacher: { ...prev.teacher, enabled: !prev.teacher.enabled },
                        }))}
                        className={`text-xs px-2 py-1 rounded border ${meetingFollowupPrompts.teacher?.enabled ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-card border-border text-foreground'}`}
                      >
                        {meetingFollowupPrompts.teacher?.enabled ? 'On' : 'Off'}
                      </button>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <label className="text-xs text-muted-foreground">Cadence</label>
                      <select
                        value={meetingFollowupPrompts.teacher?.cadenceDays || 30}
                        onChange={(e) => setMeetingFollowupPrompts((prev) => ({
                          ...prev,
                          teacher: { ...prev.teacher, cadenceDays: Number(e.target.value) }
                        }))}
                        className="px-2 py-1 border rounded text-xs bg-white"
                      >
                        <option value={7}>Weekly</option>
                        <option value={30}>Monthly</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => triggerMeetingFollowup('teacher')}
                        className="text-xs px-2 py-1 rounded border border-border bg-card text-foreground"
                      >
                        Trigger now
                      </button>
                    </div>
                    {meetingFollowupPrompts.teacher?.triggerAt && (
                      <div className="mt-2 text-xs text-muted-foreground">Last trigger: {new Date(meetingFollowupPrompts.teacher.triggerAt).toLocaleString()}</div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-start justify-end">
                <button
                  disabled={savingMeetingFollowupPrompts}
                  onClick={async () => {
                    try {
                      setSavingMeetingFollowupPrompts(true);
                      const value = meetingFollowupPrompts;
                      const res = await api.put('/settings/meetingFollowupPrompts', { value });
                      if (res.data?.success) {
                        const cacheKey = makeCacheKey('settings:meetingFollowupPrompts');
                        writeCache(cacheKey, { value }, { ttlMs: 60_000, deps: ['settings'] });
                        setToast({ type: 'success', message: 'Meeting follow-up settings saved' });
                      }
                    } catch (err) {
                      setToast({ type: 'error', message: err?.response?.data?.message || err?.message || 'Failed to save follow-up settings' });
                    } finally {
                      setSavingMeetingFollowupPrompts(false);
                    }
                  }}
                  className={`text-xs px-3 py-1.5 bg-gray-100 text-gray-800 border border-gray-200 rounded ${savingMeetingFollowupPrompts ? 'opacity-70' : ''}`}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {user?.role === 'admin' && activeSection === 'access' && (
          <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <div className="text-sm font-semibold text-foreground">Requests & Access</div>
              <div className="text-xs text-muted-foreground">Configure visibility and presenter permissions.</div>
            </div>
            <div className="p-4 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Requests and access</div>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="text-xs text-muted-foreground">
                    Requests visibility
                    <select
                      value={requestsVisibility}
                      onChange={(e) => setRequestsVisibility(e.target.value)}
                      className="mt-1 px-3 py-2 border rounded w-full bg-white"
                    >
                      {REQUESTS_VISIBILITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-muted-foreground">
                    Presenter access
                    <select
                      value={presenterAccess}
                      onChange={(e) => setPresenterAccess(e.target.value)}
                      className="mt-1 px-3 py-2 border rounded w-full bg-white"
                    >
                      <option value="admin">Admin Only</option>
                      <option value="all">Everyone (Beta)</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="flex items-start justify-end">
                <div className="flex items-center gap-2">
                  <button
                    disabled={savingRequestsVisibility}
                    onClick={async () => {
                      try {
                        setSavingRequestsVisibility(true);
                        const res = await api.put('/settings/requestsVisibility', { value: requestsVisibility });
                        if (res.data?.success) {
                          const cacheKey = makeCacheKey('settings:requestsVisibility');
                          writeCache(cacheKey, { value: requestsVisibility }, { ttlMs: 60_000, deps: ['settings'] });
                          setToast({ type: 'success', message: 'Requests visibility saved' });
                        }
                      } catch (err) {
                        setToast({ type: 'error', message: err?.response?.data?.message || err?.message || 'Failed to save requests visibility' });
                      } finally {
                        setSavingRequestsVisibility(false);
                      }
                    }}
                    className={`text-xs px-3 py-1.5 bg-gray-100 text-gray-800 border border-gray-200 rounded ${savingRequestsVisibility ? 'opacity-70' : ''}`}
                  >
                    Save
                  </button>
                  <button
                    disabled={savingPresenterAccess}
                    onClick={async () => {
                      try {
                        setSavingPresenterAccess(true);
                        const res = await api.put('/settings/presenterAccess', { value: presenterAccess });
                        if (res.data?.success) {
                          const cacheKey = makeCacheKey('settings:presenterAccess');
                          writeCache(cacheKey, { value: presenterAccess }, { ttlMs: 60_000, deps: ['settings'] });
                          setToast({ type: 'success', message: 'Presenter access saved' });
                        }
                      } catch(e) {
                        setToast({ type: 'error', message: 'Failed to save' });
                      } finally {
                        setSavingPresenterAccess(false);
                      }
                    }}
                    className={`text-xs px-3 py-1.5 bg-gray-100 text-gray-800 border border-gray-200 rounded ${savingPresenterAccess ? 'opacity-70' : ''}`}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {user?.role === 'admin' && activeSection === 'appearance' && (
          <div className="space-y-4">
            <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <div className="text-sm font-semibold text-foreground">Homepage Message Banner</div>
                <div className="text-xs text-muted-foreground">Shown to all users (including admins) on the dashboard homepage only. Hidden when message is empty.</div>
              </div>
              <div className="p-4 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
                <div>
                  <label className="text-xs text-muted-foreground">
                    Message
                    <textarea
                      rows={4}
                      value={homepageAnnouncement.message}
                      onChange={(e) => setHomepageAnnouncement((prev) => ({ ...prev, message: e.target.value }))}
                      placeholder="Write a message for all users..."
                      className="mt-1 px-3 py-2 border rounded w-full"
                    />
                  </label>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <label className="text-xs text-muted-foreground">
                      Font size
                      <select
                        value={homepageAnnouncement.fontSize}
                        onChange={(e) => setHomepageAnnouncement((prev) => ({ ...prev, fontSize: e.target.value }))}
                        className="mt-1 px-3 py-2 border rounded w-full bg-card"
                      >
                        <option value="text-sm">Small</option>
                        <option value="text-base">Medium</option>
                        <option value="text-lg">Large</option>
                      </select>
                    </label>
                    <label className="text-xs text-muted-foreground">
                      Font weight
                      <select
                        value={homepageAnnouncement.fontWeight}
                        onChange={(e) => setHomepageAnnouncement((prev) => ({ ...prev, fontWeight: e.target.value }))}
                        className="mt-1 px-3 py-2 border rounded w-full bg-card"
                      >
                        <option value="font-normal">Normal</option>
                        <option value="font-medium">Medium</option>
                        <option value="font-semibold">Semibold</option>
                      </select>
                    </label>
                    <label className="text-xs text-muted-foreground">
                      Alignment
                      <select
                        value={homepageAnnouncement.align}
                        onChange={(e) => setHomepageAnnouncement((prev) => ({ ...prev, align: e.target.value }))}
                        className="mt-1 px-3 py-2 border rounded w-full bg-card"
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                    <label className="text-xs text-muted-foreground">
                      Background color
                      <select
                        value={homepageAnnouncement.backgroundColor || 'card'}
                        onChange={(e) => setHomepageAnnouncement((prev) => ({ ...prev, backgroundColor: e.target.value }))}
                        className="mt-1 px-3 py-2 border rounded w-full bg-card"
                      >
                        <option value="card">Card</option>
                        <option value="muted">Muted</option>
                        <option value="primary">Primary</option>
                        <option value="success">Success</option>
                        <option value="warning">Warning</option>
                        <option value="info">Info</option>
                      </select>
                    </label>
                    <label className="text-xs text-muted-foreground">
                      Border color
                      <select
                        value={homepageAnnouncement.borderColor || 'default'}
                        onChange={(e) => setHomepageAnnouncement((prev) => ({ ...prev, borderColor: e.target.value }))}
                        className="mt-1 px-3 py-2 border rounded w-full bg-card"
                      >
                        <option value="default">Default</option>
                        <option value="primary">Primary</option>
                        <option value="success">Success</option>
                        <option value="warning">Warning</option>
                        <option value="info">Info</option>
                        <option value="muted">Muted</option>
                      </select>
                    </label>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => setHomepageAnnouncement((prev) => ({ ...prev, italic: !prev.italic }))}
                        className={`text-xs px-3 py-2 rounded border ${homepageAnnouncement.italic ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-foreground'}`}
                      >
                        {homepageAnnouncement.italic ? 'Italic enabled' : 'Italic disabled'}
                      </button>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Live preview</div>
                    <div className={homepageAnnouncementPreviewContainerClass}>
                      <p className={homepageAnnouncementPreviewTextClass}>
                        {String(homepageAnnouncement.message || '').trim() || 'Your message preview appears here.'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex items-start justify-end">
                  <button
                    disabled={savingHomepageAnnouncement}
                    onClick={async () => {
                      try {
                        setSavingHomepageAnnouncement(true);
                        const value = {
                          message: String(homepageAnnouncement.message || ''),
                          fontSize: homepageAnnouncement.fontSize || 'text-sm',
                          fontWeight: homepageAnnouncement.fontWeight || 'font-medium',
                          italic: Boolean(homepageAnnouncement.italic),
                          align: homepageAnnouncement.align || 'left',
                          tone: homepageAnnouncement.tone || 'default',
                          backgroundColor: homepageAnnouncement.backgroundColor || 'card',
                          borderColor: homepageAnnouncement.borderColor || 'default',
                        };
                        const res = await api.put('/settings/homepage-announcement', { value });
                        if (res.data?.success) {
                          const cacheKey = makeCacheKey('settings:homepageAnnouncement');
                          writeCache(cacheKey, { value }, { ttlMs: 60_000, deps: ['settings'] });
                          setToast({ type: 'success', message: 'Homepage message saved' });
                        }
                      } catch (err) {
                        setToast({ type: 'error', message: err?.response?.data?.message || err?.message || 'Failed to save homepage message' });
                      } finally {
                        setSavingHomepageAnnouncement(false);
                      }
                    }}
                    className={`text-xs px-3 py-1.5 bg-gray-100 text-gray-800 border border-gray-200 rounded ${savingHomepageAnnouncement ? 'opacity-70' : ''}`}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <div className="text-sm font-semibold text-foreground">Dashboard Decoration</div>
                <div className="text-xs text-muted-foreground">Control the festive ornament system and offsets.</div>
              </div>
              <div className="p-4 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Dashboard decoration</div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setDashboardDecorationEnabled((prev) => !prev)}
                      className={`text-xs px-3 py-1.5 rounded border ${dashboardDecorationEnabled ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-foreground'}`}
                    >
                      {dashboardDecorationEnabled ? 'Visible' : 'Hidden'}
                    </button>
                    <div className="text-xs text-muted-foreground">Festive header ornament controls.</div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="text-xs text-muted-foreground">
                      Horizontal offset (px)
                      <input
                        type="number"
                        value={dashboardDecorationOffsetX}
                        onChange={(e) => setDashboardDecorationOffsetX(Number(e.target.value))}
                        className="mt-1 px-3 py-2 border rounded w-full"
                      />
                    </label>
                    <label className="text-xs text-muted-foreground">
                      Vertical offset (px)
                      <input
                        type="number"
                        value={dashboardDecorationOffsetY}
                        onChange={(e) => setDashboardDecorationOffsetY(Number(e.target.value))}
                        className="mt-1 px-3 py-2 border rounded w-full"
                      />
                    </label>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3">
                    <div className="text-xs text-muted-foreground">Item counts (1-12) and sizes</div>
                    {[
                      { key: 'crescents', label: 'Crescents' },
                      { key: 'stars', label: 'Stars' },
                      { key: 'dots', label: 'Dots' },
                      { key: 'lanterns', label: 'Lanterns' },
                    ].map((item) => (
                      <div key={item.key} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="text-sm text-foreground sm:col-span-1">{item.label}</div>
                        <label className="text-xs text-muted-foreground">
                          Count
                          <input
                            type="number"
                            min={0}
                            max={12}
                            value={dashboardDecorationItems[item.key]?.count ?? 0}
                            onChange={(e) =>
                              setDashboardDecorationItems((prev) => ({
                                ...prev,
                                [item.key]: {
                                  ...prev[item.key],
                                  count: Number(e.target.value),
                                },
                              }))
                            }
                            className="mt-1 px-3 py-2 border rounded w-full"
                          />
                        </label>
                        <label className="text-xs text-muted-foreground">
                          Size (scale)
                          <input
                            type="number"
                            step="0.1"
                            min={0.3}
                            max={2}
                            value={dashboardDecorationItems[item.key]?.scale ?? 1}
                            onChange={(e) =>
                              setDashboardDecorationItems((prev) => ({
                                ...prev,
                                [item.key]: {
                                  ...prev[item.key],
                                  scale: Number(e.target.value),
                                },
                              }))
                            }
                            className="mt-1 px-3 py-2 border rounded w-full"
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-start justify-end">
                  <button
                    disabled={savingDashboardDecoration}
                    onClick={async () => {
                      try {
                        setSavingDashboardDecoration(true);
                        const value = {
                          enabled: Boolean(dashboardDecorationEnabled),
                          offsetX: Number(dashboardDecorationOffsetX || 0),
                          offsetY: Number(dashboardDecorationOffsetY || 0),
                          items: dashboardDecorationItems,
                        };
                        const res = await api.put('/settings/dashboardDecoration', { value });
                        if (res.data?.success) {
                          const cacheKey = makeCacheKey('settings:dashboardDecoration');
                          writeCache(cacheKey, { value }, { ttlMs: 60_000, deps: ['settings'] });
                          setToast({ type: 'success', message: 'Decoration settings saved' });
                        }
                      } catch (err) {
                        setToast({ type: 'error', message: err?.response?.data?.message || err?.message || 'Failed to save decoration settings' });
                      } finally {
                        setSavingDashboardDecoration(false);
                      }
                    }}
                    className={`text-xs px-3 py-1.5 bg-gray-100 text-gray-800 border border-gray-200 rounded ${savingDashboardDecoration ? 'opacity-70' : ''}`}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {user?.role === 'admin' && activeSection === 'cleanup' && (
          <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <div className="text-sm font-semibold text-foreground">Cleanup & Retention</div>
              <div className="text-xs text-muted-foreground">Retention windows for unreported classes and whiteboards.</div>
            </div>
            <div className="p-4 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Cleanup and retention</div>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="text-xs text-muted-foreground">
                    Unreported class cleanup (days)
                    <input type="number" min={1} value={unreportedCleanupDays} onChange={(e)=>setUnreportedCleanupDays(Number(e.target.value))} className="mt-1 px-3 py-2 border rounded w-full" />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    Whiteboard retention (days)
                    <input type="number" min={1} value={whiteboardRetentionDays} onChange={(e)=>setWhiteboardRetentionDays(Number(e.target.value))} className="mt-1 px-3 py-2 border rounded w-full" />
                  </label>
                </div>
              </div>
              <div className="flex items-start justify-end">
                <div className="flex items-center gap-2">
                  <button
                    disabled={savingCleanupDays}
                    onClick={async ()=>{
                      try {
                        setSavingCleanupDays(true);
                        const res = await api.put('/settings/unreportedClassCleanupDays', { value: unreportedCleanupDays });
                        if (res.data?.success) {
                          const cacheKey = makeCacheKey('settings:unreportedCleanupDays', user?._id || 'admin', { key: 'unreportedClassCleanupDays' });
                          writeCache(cacheKey, res.data.setting || { value: unreportedCleanupDays }, { ttlMs: 5 * 60_000, deps: ['settings'] });
                          setToast({ type: 'success', message: 'Cleanup settings saved' });
                        }
                      } catch (err) {
                        setToast({ type: 'error', message: err?.response?.data?.message || err?.message || 'Failed to save cleanup settings' });
                      } finally {
                        setSavingCleanupDays(false);
                      }
                    }}
                    className={`text-xs px-3 py-1.5 bg-gray-100 text-gray-800 border border-gray-200 rounded ${savingCleanupDays ? 'opacity-70' : ''}`}
                  >
                    Save
                  </button>
                  <button
                    disabled={savingWhiteboardRetention}
                    onClick={async ()=>{
                      try {
                        setSavingWhiteboardRetention(true);
                        const res = await api.put('/settings/whiteboardScreenshotRetentionDays', { value: whiteboardRetentionDays });
                        if (res.data?.success) {
                          const cacheKey = makeCacheKey('settings:whiteboardRetentionDays', user?._id || 'admin', { key: 'whiteboardScreenshotRetentionDays' });
                          writeCache(cacheKey, res.data.setting || { value: whiteboardRetentionDays }, { ttlMs: 5 * 60_000, deps: ['settings'] });
                          setToast({ type: 'success', message: 'Whiteboard retention saved' });
                        }
                      } catch (err) {
                        setToast({ type: 'error', message: err?.response?.data?.message || err?.message || 'Failed to save retention settings' });
                      } finally {
                        setSavingWhiteboardRetention(false);
                      }
                    }}
                    className={`text-xs px-3 py-1.5 bg-gray-100 text-gray-800 border border-gray-200 rounded ${savingWhiteboardRetention ? 'opacity-70' : ''}`}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Branding card */}
        {user?.role === 'admin' && activeSection === 'branding' && (
          <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden p-4">
            <div className="flex items-center gap-2 border-b border-border pb-3 mb-4">
              <button
                type="button"
                onClick={() => setBrandingTab('branding')}
                className={`text-xs px-3 py-1.5 rounded border ${brandingTab === 'branding' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-foreground'}`}
              >
                Branding Assets
              </button>
              <button
                type="button"
                onClick={() => setBrandingTab('whatsapp')}
                className={`text-xs px-3 py-1.5 rounded border ${brandingTab === 'whatsapp' ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-foreground'}`}
              >
                WhatsApp Messaging
              </button>
            </div>

            {brandingTab === 'branding' && (
              <>
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
              </>
            )}

            {brandingTab === 'whatsapp' && (
              <div className="space-y-4">
                <div>
                  <div className="font-medium">WhatsApp Messaging</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Build a personalized message (welcome + body + regards), target recipients, and open WhatsApp chats instantly.
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-border p-3 space-y-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Recipients</div>
                    <label className="text-xs text-muted-foreground block">
                      Audience
                      <select value={waAudience} onChange={(e) => setWaAudience(e.target.value)} className="mt-1 px-3 py-2 border rounded w-full bg-card">
                        <option value="active_guardians">Active guardians</option>
                        <option value="inactive_guardians">Inactive guardians</option>
                        <option value="all_guardians">All guardians</option>
                        <option value="active_teachers">Active teachers only</option>
                        <option value="inactive_teachers">Inactive teachers only</option>
                        <option value="guardians_timezone">Guardians from a specific timezone</option>
                        <option value="guardians_country">Guardians from a specific country (from timezone)</option>
                      </select>
                    </label>

                    {waAudience === 'guardians_timezone' && (
                      <label className="text-xs text-muted-foreground block">
                        Timezone
                        <select value={waTimezoneFilter} onChange={(e) => setWaTimezoneFilter(e.target.value)} className="mt-1 px-3 py-2 border rounded w-full bg-card">
                          <option value="">Select timezone</option>
                          {waRecipientOptions.guardianTimezones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                        </select>
                      </label>
                    )}

                    {waAudience === 'guardians_country' && (
                      <label className="text-xs text-muted-foreground block">
                        Country
                        <select value={waCountryFilter} onChange={(e) => setWaCountryFilter(e.target.value)} className="mt-1 px-3 py-2 border rounded w-full bg-card">
                          <option value="">Select country</option>
                          {waRecipientOptions.guardianCountries.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </label>
                    )}

                    <div className="flex items-center gap-2">
                      <button type="button" onClick={fetchWhatsappRecipients} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-800 border border-gray-200 rounded" disabled={waLoadingRecipients}>
                        {waLoadingRecipients ? 'Loading...' : 'Load recipients'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setWaSelectedRecipientIds(waRecipients.map((r) => r.id))}
                        className="text-xs px-3 py-1.5 border border-border rounded"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={() => setWaSelectedRecipientIds([])}
                        className="text-xs px-3 py-1.5 border border-border rounded"
                      >
                        Clear
                      </button>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      Loaded: {waRecipients.length} • Selected: {waSelectedRecipients.length} • Valid phones: {waRecipients.filter((r) => validateWhatsappPhone(r.phone).ok).length}
                    </div>
                    {waInvalidSelectedRecipients.length > 0 && (
                      <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                        {waInvalidSelectedRecipients.length} selected recipient(s) need phone fixes before sending.
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-border p-3 space-y-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Message template</div>
                    <label className="text-xs text-muted-foreground block">
                      Welcome (before epithet + first name)
                      <input
                        type="text"
                        value={waMessageDraft.welcome}
                        onChange={(e) => setWaMessageDraft((prev) => ({ ...prev, welcome: e.target.value }))}
                        className="mt-1 px-3 py-2 border rounded w-full"
                        placeholder="Assalamu Alaikum"
                      />
                    </label>
                    <label className="text-xs text-muted-foreground block">
                      Message body
                      <textarea
                        rows={5}
                        value={waMessageDraft.body}
                        onChange={(e) => setWaMessageDraft((prev) => ({ ...prev, body: e.target.value }))}
                        className="mt-1 px-3 py-2 border rounded w-full"
                        placeholder="Your main message..."
                      />
                    </label>
                    <label className="text-xs text-muted-foreground block">
                      Regards / closing
                      <input
                        type="text"
                        value={waMessageDraft.regards}
                        onChange={(e) => setWaMessageDraft((prev) => ({ ...prev, regards: e.target.value }))}
                        className="mt-1 px-3 py-2 border rounded w-full"
                        placeholder="Jazak Allah Khair"
                      />
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
                      <label className="text-xs text-muted-foreground block">
                        Image URL (optional)
                        <input
                          type="text"
                          value={waMessageDraft.imageUrl}
                          onChange={(e) => setWaMessageDraft((prev) => ({ ...prev, imageUrl: e.target.value }))}
                          className="mt-1 px-3 py-2 border rounded w-full"
                          placeholder="https://..."
                        />
                      </label>
                      <div className="flex flex-col gap-2">
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={(e) => setWaImageFile(e.target.files?.[0] || null)}
                          className="text-xs"
                        />
                        <button
                          type="button"
                          onClick={handleUploadWhatsappImage}
                          disabled={waUploadingImage}
                          className="text-xs px-3 py-1.5 bg-gray-100 text-gray-800 border border-gray-200 rounded"
                        >
                          {waUploadingImage ? 'Uploading...' : 'Upload image'}
                        </button>
                      </div>
                    </div>

                    <div className="text-[11px] text-muted-foreground">
                      Supports variables: {'{{firstName}}'}, {'{{lastName}}'}, {'{{fullName}}'}, {'{{epithet}}'}, {'{{timezone}}'}, {'{{country}}'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Preview</div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {waPreviewRecipient
                        ? `Preview for ${waPreviewRecipient.firstName} ${waPreviewRecipient.lastName}${waPreviewRecipient.epithet ? ` (${waPreviewRecipient.epithet})` : ''}`
                        : 'Load recipients to preview'}
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap rounded border border-border bg-muted/30 p-3 text-sm text-foreground">
                      {waPreviewRecipient ? buildWhatsappMessageForRecipient(waPreviewRecipient) : 'No preview available.'}
                    </pre>
                  </div>

                  <div className="rounded-lg border border-border p-3">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Recipients</div>
                    <div className="mt-2 max-h-64 overflow-auto space-y-2">
                      {waRecipients.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No recipients loaded.</div>
                      ) : waRecipients.map((recipient) => {
                        const checked = waSelectedIdSet.has(recipient.id);
                        const hasPhone = Boolean(normalizeWhatsappPhone(recipient.phone));
                        return (
                          <label key={recipient.id} className="flex items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setWaSelectedRecipientIds((prev) => {
                                  if (e.target.checked) return Array.from(new Set([...(prev || []), recipient.id]));
                                  return (prev || []).filter((id) => id !== recipient.id);
                                });
                              }}
                            />
                            <span className="text-foreground">
                              {recipient.firstName} {recipient.lastName}
                              {recipient.epithet ? ` • ${recipient.epithet}` : ''}
                              {recipient.timezone ? ` • ${recipient.timezone}` : ''}
                              {recipient.country ? ` • ${recipient.country}` : ''}
                              {!hasPhone ? ' • No WhatsApp number' : ''}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSendTestToAdminWhatsapp}
                    className="text-xs px-3 py-1.5 rounded border bg-card border-border text-foreground"
                  >
                    Send test to admin WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={handleSendWhatsappCampaign}
                    disabled={waSending}
                    className={`text-xs px-3 py-1.5 rounded border ${waSending ? 'opacity-60' : ''} bg-primary text-primary-foreground border-primary`}
                  >
                    {waSending ? 'Sending one by one...' : 'Send via WhatsApp'}
                  </button>
                  <div className="text-xs text-muted-foreground">
                    {waSendProgress
                      ? `In progress: ${waSendProgress.current}/${waSendProgress.total} • ${waSendProgress.name}`
                      : 'Messages are sent one by one with confirmation after each recipient.'}
                  </div>
                </div>

                <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
                  Suggestions: test with one recipient first, use timezone/country filters for focused campaigns, and keep your body short with a clear next step. If you include an image URL, it is added into the message so recipients can open it from WhatsApp.
                </div>

                {waLastSendReport && (
                  <div className="rounded-lg border border-border p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium text-foreground">Last send report</div>
                      {waLastSendReport.failed.length > 0 && (
                        <button
                          type="button"
                          onClick={handleRetryFailedOnly}
                          disabled={waRetryingFailed}
                          className={`text-xs px-3 py-1.5 rounded border border-border bg-card text-foreground ${waRetryingFailed ? 'opacity-60' : ''}`}
                        >
                          {waRetryingFailed ? 'Retrying...' : 'Retry failed only'}
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Attempted: {waLastSendReport.attempted} • Sent: {waLastSendReport.sent.length} • Not sent: {waLastSendReport.failed.length}
                    </div>

                    {waLastSendReport.failed.length > 0 ? (
                      <div className="space-y-3">
                        {waLastSendReport.failed.map((entry) => {
                          const recipient = waRecipients.find((r) => r.id === entry.id);
                          const draftValue = waPhoneEdits[entry.id] ?? recipient?.phone ?? entry.currentPhone ?? '';
                          const validation = validateWhatsappPhone(draftValue);
                          return (
                            <div key={`wa-failure-${entry.id}`} className="rounded border border-rose-200 bg-rose-50 p-3">
                              <div className="text-sm font-medium text-rose-800">{entry.name || 'Unknown user'}</div>
                              <div className="mt-1 text-xs text-rose-700">Reason: {entry.reason}</div>
                              <div className="mt-1 text-xs text-rose-700">Current: {entry.currentPhone || '—'}</div>
                              <div className="mt-2 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
                                <label className="text-xs text-rose-800">
                                  Fix phone (with country code)
                                  <input
                                    type="text"
                                    value={draftValue}
                                    onChange={(e) => setWaPhoneEdits((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                                    className="mt-1 px-3 py-2 border rounded w-full bg-white"
                                    placeholder="e.g. +9665..."
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => handleSaveRecipientPhone(entry.id)}
                                  disabled={waSavingPhoneId === entry.id || !validation.ok}
                                  className={`text-xs px-3 py-2 rounded border ${waSavingPhoneId === entry.id ? 'opacity-60' : ''} bg-white border-rose-300 text-rose-700`}
                                >
                                  {waSavingPhoneId === entry.id ? 'Saving...' : 'Save number'}
                                </button>
                              </div>
                              {!validation.ok && (
                                <div className="mt-1 text-[11px] text-rose-700">{validation.reason}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-xs text-emerald-700">All selected recipients were marked as sent.</div>
                    )}
                  </div>
                )}
              </div>
            )}
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
                  disabled={subjectsCatalogSaving || subjectsCatalogLoading}
                  onClick={async () => {
                    try {
                      setSubjectsCatalogSaving(true);
                      // Always use the simple (v1) editor + save shape.
                      await saveCatalogV1();
                      setToast({ type: 'success', message: 'Subjects catalog saved' });
                    } catch (e) {
                      console.error(e);
                      setToast({ type: 'error', message: e?.response?.data?.message || e?.message || 'Save failed' });
                    } finally {
                      setSubjectsCatalogSaving(false);
                    }
                  }}
                  className="text-xs px-2 py-1 bg-gray-100 text-gray-800 border border-gray-200 rounded disabled:opacity-70"
                  title="Save"
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

                {
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
                }
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
