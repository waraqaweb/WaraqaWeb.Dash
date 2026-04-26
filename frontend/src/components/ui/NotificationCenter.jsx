import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { makeCacheKey, readCache, writeCache } from '../../utils/sessionCache';
import { useAuth } from '../../contexts/AuthContext';
import { Bell, Calendar, X } from 'lucide-react';
import { formatDateTimeDDMMMYYYYhhmmA } from '../../utils/date';
import RescheduleRequestDetailsModal from '../dashboard/RescheduleRequestDetailsModal';
import {
  bindAudioUnlockOnUserGesture,
  playClassStartSound,
  playGeneralNotificationSound,
} from '../../utils/notificationSounds';
import {
  canUseBrowserNotifications,
  getNotificationPreferences,
} from '../../utils/notificationPreferences';

const isBrowserOffline = () => {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  } catch (e) {
    return false;
  }
};

const buildClassNotificationLink = (classId, { tab = 'previous' } = {}) => {
  if (!classId) return '';
  const params = new URLSearchParams();
  params.set('tab', tab);
  params.set('layout', 'list');
  params.set('page', '1');
  params.set('open', String(classId));
  return `/dashboard/classes?${params.toString()}`;
};

const resolveNotificationActionLink = (notification) => {
  const rawLink = typeof notification?.actionLink === 'string' ? notification.actionLink.trim() : '';
  const classId = notification?.metadata?.classId || notification?.relatedId;
  const relatedTo = notification?.relatedTo || notification?.metadata?.relatedTo;
  const kind = notification?.metadata?.kind;

  if (classId && (kind === 'report_extension' || /^\/classes\/[^/]+\/report(?:\/)?(?:\?|$)/i.test(rawLink))) {
    return buildClassNotificationLink(classId, { tab: 'previous' });
  }

  if (classId && relatedTo === 'class' && !rawLink) {
    return buildClassNotificationLink(classId, { tab: 'previous' });
  }

  return rawLink;
};

const NotificationCenter = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentVacation, setCurrentVacation] = useState(null);
  const [rescheduleActionLoading, setRescheduleActionLoading] = useState(null);
  const [rescheduleDetailsOpen, setRescheduleDetailsOpen] = useState(false);
  const [rescheduleDetailsNotification, setRescheduleDetailsNotification] = useState(null);
  const [deleteLoadingId, setDeleteLoadingId] = useState(null);
  const initializedNotificationsRef = useRef(false);
  const seenNotificationIdsRef = useRef(new Set());
  const classAlertedKeysRef = useRef(new Set());
  const notificationsInFlightRef = useRef(false);
  const classAlertsInFlightRef = useRef(false);
  const [notificationPrefs, setNotificationPrefs] = useState(() => getNotificationPreferences(user?._id));
  const [resolveUninvoicedState, setResolveUninvoicedState] = useState({
    loading: false,
    message: null,
    error: null
  });
  const [uninvoicedLessonsState, setUninvoicedLessonsState] = useState({
    loading: false,
    lessons: [],
    total: 0,
    sinceDays: null,
    error: null
  });

  useEffect(() => {
    bindAudioUnlockOnUserGesture();
  }, []);

  useEffect(() => {
    if (user) {
      if (isBrowserOffline()) return;
      fetchNotifications();
      checkCurrentVacation();
      checkClassStartAlerts();
    }
  }, [user]);

  useEffect(() => {
    setNotificationPrefs(getNotificationPreferences(user?._id));
  }, [user?._id]);

  useEffect(() => {
    const handlePrefsChanged = (event) => {
      const changedUserId = event?.detail?.userId;
      const activeUserId = user?._id || 'anon';
      if (!changedUserId || String(changedUserId) !== String(activeUserId)) return;
      setNotificationPrefs(getNotificationPreferences(user?._id));
    };

    window.addEventListener('notification-preferences-changed', handlePrefsChanged);
    return () => window.removeEventListener('notification-preferences-changed', handlePrefsChanged);
  }, [user?._id]);

  useEffect(() => {
    if (!user) return undefined;
    if (!notificationPrefs.liveAlertsEnabled) return undefined;

    const interval = setInterval(() => {
      if (isBrowserOffline()) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      fetchNotifications({ showLoading: false });
      checkClassStartAlerts();
    }, 30000);

    return () => clearInterval(interval);
  }, [user, notificationPrefs.liveAlertsEnabled]);

  useEffect(() => {
    if (!isOpen || user?.role !== 'admin') return;
    const hasUninvoicedWarningAlert = notifications.some(isUninvoicedWarning);
    if (hasUninvoicedWarningAlert) fetchUninvoicedLessons();
  }, [isOpen, user?.role, notifications]);

  const fetchNotifications = async ({ showLoading = true } = {}) => {
    if (isBrowserOffline()) return;
    if (notificationsInFlightRef.current) return;
    if (showLoading) setLoading(true);
    notificationsInFlightRef.current = true;
    try {
      const res = await api.get('/notifications');
      const nextNotifications = Array.isArray(res.data.notifications) ? res.data.notifications : [];
      const nextUnreadCount = Number(res.data.unreadCount || 0);

      if (!initializedNotificationsRef.current) {
        seenNotificationIdsRef.current = new Set(nextNotifications.map((notification) => String(notification._id)));
        initializedNotificationsRef.current = true;
      } else {
        const newUnreadNotifications = nextNotifications.filter((notification) => (
          !notification.isRead && !seenNotificationIdsRef.current.has(String(notification._id))
        ));

        if (newUnreadNotifications.length > 0 && notificationPrefs.notificationSoundEnabled) {
          playGeneralNotificationSound();
        }

        if (newUnreadNotifications.length > 0 && notificationPrefs.liveAlertsEnabled && canUseBrowserNotifications() && Notification.permission === 'granted') {
          newUnreadNotifications.slice(0, 3).forEach((notification) => {
            const title = getNotificationTitleText(notification);
            const body = getNotificationMessageText(notification) || 'You have a new notification.';
            try {
              new Notification(title, { body, tag: `notif-${notification._id}` });
            } catch (e) {
              // ignore browser notification failures
            }
          });
        }

        nextNotifications.forEach((notification) => {
          seenNotificationIdsRef.current.add(String(notification._id));
        });
      }

      setNotifications(nextNotifications);
      setUnreadCount(nextUnreadCount);
    } catch (err) {
      if (err?.isOffline) return;
      console.error('Error fetching notifications:', err);
    } finally {
      notificationsInFlightRef.current = false;
      if (showLoading) setLoading(false);
    }
  };

  const checkClassStartAlerts = async () => {
    if (isBrowserOffline()) return;
    if (classAlertsInFlightRef.current) return;
    classAlertsInFlightRef.current = true;
    try {
      if (!notificationPrefs.liveAlertsEnabled) return;
      const role = user?.role;
      if (!['admin', 'teacher', 'guardian'].includes(role)) return;

      const now = Date.now();
      const rangeStart = new Date(now - 5 * 60 * 1000).toISOString();
      const rangeEnd = new Date(now + 15 * 60 * 1000).toISOString();
      const res = await api.get('/classes', {
        params: {
          filter: 'upcoming',
          page: 1,
          limit: 30,
          dateFrom: rangeStart,
          dateTo: rangeEnd,
        },
      });

      const classes = Array.isArray(res.data?.classes) ? res.data.classes : [];
      for (const classItem of classes) {
        const classId = classItem?._id;
        const scheduledRaw = classItem?.scheduledDate;
        if (!classId || !scheduledRaw) continue;

        const startMs = new Date(scheduledRaw).getTime();
        if (!Number.isFinite(startMs)) continue;

        const alertKey = `${classId}:${startMs}`;
        if (classAlertedKeysRef.current.has(alertKey)) continue;

        const diffMs = now - startMs;
        const shouldAlert = diffMs >= 0 && diffMs <= 2 * 60 * 1000;
        if (!shouldAlert) continue;

        classAlertedKeysRef.current.add(alertKey);

        if (canUseBrowserNotifications() && Notification.permission === 'granted') {
          const studentName = classItem?.student?.studentName || 'Student';
          const subject = classItem?.subject || 'Class';
          try {
            new Notification('Class is starting now', {
              body: `${subject} • ${studentName}`,
              tag: `class-start-${classId}`,
            });
          } catch (e) {
            // ignore browser notification failures
          }
        }

        const allowClassSound = role !== 'admin' && notificationPrefs.classStartSoundEnabled;
        if (allowClassSound) {
          playClassStartSound();
        }
      }
    } catch (err) {
      // ignore class alert failures to avoid interrupting notification center
    } finally {
      classAlertsInFlightRef.current = false;
    }
  };

  const checkCurrentVacation = async () => {
    if (isBrowserOffline()) return;
    try {
      const cacheKey = makeCacheKey('system-vacations:current');
      const cached = readCache(cacheKey, { deps: ['system-vacations'] });
      if (cached.hit && cached.value) {
        if (cached.value.isActive) setCurrentVacation(cached.value.vacation);
        else setCurrentVacation(null);
        if (cached.ageMs < 60_000) return;
      }

      const res = await api.get('/system-vacations/current');
      if (res.data.isActive) {
        setCurrentVacation(res.data.vacation);
      } else {
        setCurrentVacation(null);
      }
      writeCache(cacheKey, res.data, { ttlMs: 60_000, deps: ['system-vacations'] });
    } catch (err) {
      if (err?.isOffline) return;
      console.error('Error checking current vacation:', err);
    }
  };

  const markAsRead = async (notificationIds) => {
    try {
      await api.post('/notifications/mark-read', { notificationIds });
      await fetchNotifications(); // Refresh notifications
    } catch (err) {
      console.error('Error marking notifications as read:', err);
    }
  };

  const markAllAsRead = async () => {
    const unreadIds = notifications.filter(n => !n.isRead).map(n => n._id);
    if (unreadIds.length > 0) {
      await markAsRead(unreadIds);
    }
  };

  const userTimezone = user?.timezone || user?.guardianInfo?.timezone || user?.teacherInfo?.timezone;

  const formatNotificationTimestamp = (dateString) => {
    return formatDateTimeDDMMMYYYYhhmmA(dateString, { timeZone: userTimezone });
  };

  const isActionableReschedule = (notification) => {
    const kind = notification?.metadata?.kind;
    const classId = notification?.metadata?.classId || notification?.relatedId;
    return Boolean(
      notification?.actionRequired &&
      (kind === 'class_reschedule_request') &&
      classId
    );
  };

  const isRescheduleRequestNotification = (notification) => {
    const kind = notification?.metadata?.kind;
    const classId = notification?.metadata?.classId || notification?.relatedId;
    return Boolean(kind === 'class_reschedule_request' && classId);
  };

  const isUninvoicedLessonsNotification = (notification) => {
    const kind = notification?.metadata?.kind;
    const relatedId = notification?.relatedId;
    const title = notification?.title || '';
    return (
      kind === 'uninvoiced_lessons' ||
      kind === 'uninvoiced_lessons_resolved' ||
      relatedId === 'uninvoiced-lessons' ||
      relatedId === 'uninvoiced-lessons-resolved' ||
      title.toLowerCase().includes('uninvoiced lessons')
    );
  };

  const isUninvoicedWarning = (notification) => {
    const kind = notification?.metadata?.kind;
    return kind === 'uninvoiced_lessons' || (
      isUninvoicedLessonsNotification(notification) &&
      kind !== 'uninvoiced_lessons_resolved' &&
      notification?.type !== 'success'
    );
  };

  const isUninvoicedResolved = (notification) => {
    const kind = notification?.metadata?.kind;
    return kind === 'uninvoiced_lessons_resolved' || (
      isUninvoicedLessonsNotification(notification) &&
      notification?.type === 'success'
    );
  };

  const getUninvoicedReasonLabel = (_lesson) => {
    return ''; // reason labels removed; the resolve action handles it
  };

  const fetchUninvoicedLessons = async () => {
    setUninvoicedLessonsState((prev) => ({
      ...prev,
      loading: true,
      error: null
    }));
    try {
      const cacheKey = makeCacheKey('audit:uninvoiced-lessons');
      const cached = readCache(cacheKey, { deps: ['audit'] });
      if (cached.hit && cached.value) {
        setUninvoicedLessonsState({
          loading: false,
          lessons: cached.value.lessons || [],
          total: cached.value.total || 0,
          sinceDays: cached.value.sinceDays || null,
          error: null
        });
        if (cached.ageMs < 60_000) return;
      }

      const res = await api.get('/invoices/uninvoiced-lessons');
      const payload = {
        lessons: res.data.lessons || [],
        total: res.data.total || 0,
        sinceDays: res.data.sinceDays || null
      };
      setUninvoicedLessonsState({
        loading: false,
        lessons: payload.lessons,
        total: payload.total,
        sinceDays: payload.sinceDays,
        error: null
      });
      writeCache(cacheKey, payload, { ttlMs: 60_000, deps: ['audit'] });
    } catch (err) {
      setUninvoicedLessonsState((prev) => ({
        ...prev,
        loading: false,
        error: err.response?.data?.message || 'Failed to load uninvoiced lessons'
      }));
    }
  };

  const handleResolveUninvoicedLessons = async (notification) => {
    if (resolveUninvoicedState.loading) return;
    setResolveUninvoicedState({ loading: true, message: null, error: null });
    try {
      const res = await api.post('/invoices/uninvoiced-lessons/resolve', {
        sinceDays: uninvoicedLessonsState.sinceDays || 90,
        includeCancelled: false
      });

      const summary = res.data?.summary;
      const parts = [];
      if (summary?.attached > 0) parts.push(`${summary.attached} attached`);
      if (summary?.created > 0) parts.push(`${summary.created} new invoice(s)`);
      if (summary?.skipped > 0) parts.push(`${summary.skipped} already resolved`);
      const message = parts.length ? parts.join(', ') + '.' : 'All lessons resolved.';

      if (notification?._id && !notification.isRead) {
        await markAsRead([notification._id]);
      }

      setResolveUninvoicedState({ loading: false, message, error: null });
      await fetchUninvoicedLessons();
      await fetchNotifications();
    } catch (err) {
      setResolveUninvoicedState({
        loading: false,
        message: null,
        error: err.response?.data?.message || 'Failed to resolve uninvoiced lessons'
      });
    }
  };

  const handleOpenActionLink = async (notification) => {
    const link = resolveNotificationActionLink(notification);
    if (!link) return;
    try {
      if (!notification.isRead) {
        await markAsRead([notification._id]);
      }
    } catch (e) {
      // ignore
    }

    if (/^https?:\/\//i.test(link)) {
      window.open(link, '_blank', 'noopener,noreferrer');
    } else {
      navigate(link);
      setIsOpen(false);
    }
  };

  const openRescheduleDetails = async (notification) => {
    setRescheduleDetailsNotification(notification);
    setRescheduleDetailsOpen(true);
    if (notification && !notification.isRead) {
      await markAsRead([notification._id]);
    }
  };

  const handleRescheduleDecision = async (notification, decision) => {
    const classId = notification?.metadata?.classId || notification?.relatedId;
    if (!classId) return;

    try {
      setRescheduleActionLoading(notification._id);
      await api.post(`/classes/${classId}/reschedule-request/decision`, { decision });

      // Mark this notification as read and refresh list.
      if (!notification.isRead) {
        await markAsRead([notification._id]);
      } else {
        await fetchNotifications();
      }
    } catch (err) {
      console.error('Reschedule decision failed:', err);
      alert(err.response?.data?.message || 'Failed to update reschedule request');
    } finally {
      setRescheduleActionLoading(null);
    }
  };

  const handleDeleteNotification = async (notificationId) => {
    if (!notificationId) return;
    try {
      setDeleteLoadingId(notificationId);
      await api.delete(`/notifications/${notificationId}`);
      await fetchNotifications();
    } catch (err) {
      console.error('Error deleting notification:', err);
    } finally {
      setDeleteLoadingId(null);
    }
  };

  const getNotificationIcon = (type, relatedTo) => {
    if (relatedTo === 'vacation') return <Calendar className="h-4 w-4" />;
    return <Bell className="h-4 w-4" />;
  };

  const getNotificationColor = (type) => {
    switch (type) {
      case 'success': return 'text-green-600 bg-green-50 border-green-200';
      case 'warning': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'error': return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-blue-600 bg-blue-50 border-blue-200';
    }
  };

  const normalizeNotificationText = (value) => (value || '').trim();

  const getNotificationTitleText = (notification) => {
    const title = normalizeNotificationText(notification?.title);
    return title || 'Notification';
  };

  const getNotificationMessageText = (notification) => {
    const title = normalizeNotificationText(notification?.title);
    let message = normalizeNotificationText(notification?.message);
    if (!message) return '';

    if (title) {
      const lowerTitle = title.toLowerCase();
      const lowerMessage = message.toLowerCase();

      if (lowerMessage === lowerTitle) return '';

      if (lowerMessage.startsWith(lowerTitle)) {
        message = message.slice(title.length).trim();
        message = message.replace(/^(-|:|–|—)+\s*/, '');
        if (!message) return '';
      } else if (lowerTitle.startsWith(lowerMessage)) {
        return '';
      }
    }

    return message;
  };

  const getActionLabel = (notification) => {
    if (!notification) return 'Open';
    if (notification.actionLabel) return notification.actionLabel;
    const relatedTo = notification.relatedTo || notification?.metadata?.relatedTo;
    const link = notification.actionLink || '';
    if (/\/dashboard\/invoices/.test(link) || relatedTo === 'invoice') return 'Open invoice';
    if (/\/dashboard\/salaries/.test(link) || relatedTo === 'teacher_invoice' || relatedTo === 'teacher_payment') return 'Open salary';
    if (/\/dashboard\/users/.test(link) || relatedTo === 'user') return 'Open user';
    if (/\/dashboard\/vacations/.test(link) || relatedTo === 'vacation') return 'Open vacation';
    if (/\/dashboard\/library/.test(link) || relatedTo === 'library_share') return 'Open library';
    if (/\/dashboard\/profile/.test(link) || relatedTo === 'profile') return 'Open profile';
    if (relatedTo === 'class') return 'Open class';
    return 'Open';
  };

  return (
    <div className="relative">
      {/* Notification Bell */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative inline-flex items-center justify-center rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-400"
        aria-label="Open notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-h-96 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
            <div className="flex items-center space-x-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-300"
                aria-label="Close notifications"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Current System Vacation */}
          {currentVacation && (
            <div className="p-4 bg-green-50 border-b border-green-200">
              <div className="flex items-start space-x-3">
                <div className="text-green-600 mt-1">
                  <Calendar className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-green-800">
                    🎉 Active: {currentVacation.name}
                  </h4>
                  <p className="text-sm text-green-700 mt-1">
                    {currentVacation.message}
                  </p>
                  <p className="text-xs text-green-600 mt-2">
                    Until: {formatDateTimeDDMMMYYYYhhmmA(currentVacation.endDate, { timeZone: userTimezone })}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Notifications List */}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-gray-500">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Bell className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                <p>No notifications yet</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {notifications.map((notification) => (
                  <div
                    key={notification._id}
                    className={`p-4 hover:bg-gray-50 transition-colors ${
                      !notification.isRead ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => {
                      // For admin reschedule requests: open details instead of a blind mark-read.
                      if (user?.role === 'admin' && isRescheduleRequestNotification(notification)) {
                        openRescheduleDetails(notification);
                        return;
                      }

                      if (!notification.isRead) markAsRead([notification._id]);
                    }}
                  >
                    <div className="flex items-start space-x-3">
                      <div className={`p-1 rounded-full ${getNotificationColor(notification.type)}`}>
                        {getNotificationIcon(notification.type, notification.relatedTo)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <h4 className="text-sm font-medium text-gray-900 whitespace-normal break-words">
                            {getNotificationTitleText(notification)}
                          </h4>
                          {!notification.isRead && (
                            <div className="h-2 w-2 bg-blue-500 rounded-full flex-shrink-0 ml-2 mt-1"></div>
                          )}
                        </div>
                        {getNotificationMessageText(notification) && (
                          <p className="text-sm text-gray-600 mt-1 whitespace-normal break-words">
                            {getNotificationMessageText(notification)}
                          </p>
                        )}

                        {user?.role === 'admin' && isUninvoicedWarning(notification) && (
                          <div className="mt-2 text-xs text-gray-600">
                            {uninvoicedLessonsState.loading ? (
                              <p className="text-gray-400">Loading details...</p>
                            ) : uninvoicedLessonsState.error ? (
                              <p className="text-red-600">{uninvoicedLessonsState.error}</p>
                            ) : uninvoicedLessonsState.total === 0 ? (
                              <p className="text-green-600">All lessons are now invoiced.</p>
                            ) : (
                              <>
                                <ul className="mt-1 space-y-0.5">
                                  {uninvoicedLessonsState.lessons.slice(0, 5).map((lesson) => (
                                    <li key={lesson.classId} className="text-gray-600">
                                      {formatDateTimeDDMMMYYYYhhmmA(lesson.scheduledDate, { timeZone: userTimezone })}
                                      {' · '}{lesson?.teacher?.name || '?'}
                                      {' · '}{lesson?.student?.name || '?'}
                                      {' · '}{lesson?.guardian?.name || '?'}
                                    </li>
                                  ))}
                                </ul>
                                {uninvoicedLessonsState.total > 5 && (
                                  <p className="mt-1 text-gray-400">+{uninvoicedLessonsState.total - 5} more</p>
                                )}
                              </>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleResolveUninvoicedLessons(notification);
                                }}
                                disabled={resolveUninvoicedState.loading}
                                className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground disabled:opacity-60"
                              >
                                {resolveUninvoicedState.loading ? 'Resolving…' : 'Resolve'}
                              </button>
                              {resolveUninvoicedState.message && (
                                <span className="text-green-700">{resolveUninvoicedState.message}</span>
                              )}
                              {resolveUninvoicedState.error && (
                                <span className="text-red-700">{resolveUninvoicedState.error}</span>
                              )}
                            </div>
                          </div>
                        )}

                        {user?.role === 'admin' && isUninvoicedResolved(notification) && (
                          <div className="mt-2 text-xs text-gray-600">
                            {(() => {
                              const details = notification?.metadata?.details || [];
                              if (!details.length) return null;
                              return (
                                <ul className="mt-1 space-y-0.5">
                                  {details.slice(0, 8).map((d, i) => (
                                    <li key={d.classId || i} className="text-gray-600">
                                      <span className="text-green-600">✓</span>
                                      {' '}{d.studentName || '?'}
                                      {d.guardianName ? ` → ${d.guardianName}` : ''}
                                      {d.action === 'attached' && d.target ? ` (${d.target})` : ''}
                                      {d.action === 'created' ? ' (new invoice)' : ''}
                                    </li>
                                  ))}
                                  {details.length > 8 && (
                                    <li className="text-gray-400">+{details.length - 8} more</li>
                                  )}
                                </ul>
                              );
                            })()}
                          </div>
                        )}

                        {notification?.metadata?.kind === 'class_event' &&
                          ['rescheduled', 'time_changed'].includes(notification.metadata?.eventType) &&
                          notification.metadata?.oldDate ? (
                          <div className="mt-2 grid grid-cols-[28px_1fr] gap-x-1.5 gap-y-0.5 text-xs">
                            <span className="text-gray-400 font-medium pt-px">Was</span>
                            <span className="text-gray-400 line-through">{formatDateTimeDDMMMYYYYhhmmA(notification.metadata.oldDate, { timeZone: userTimezone })}</span>
                            <span className="text-gray-700 font-medium pt-px">Now</span>
                            <span className="text-gray-800 font-semibold">{formatDateTimeDDMMMYYYYhhmmA(notification.metadata.scheduledDate, { timeZone: userTimezone })}</span>
                          </div>
                        ) : notification?.metadata?.scheduledDate ? (
                          <p className="text-xs text-gray-500 mt-2">
                            Lesson time: {formatDateTimeDDMMMYYYYhhmmA(notification.metadata.scheduledDate, { timeZone: userTimezone })}
                          </p>
                        ) : null}

                        {notification?.metadata?.kind === 'class_reschedule_request' && notification?.metadata?.proposedDate && (
                          <p className="text-xs text-gray-500 mt-2">
                            Proposed: {formatDateTimeDDMMMYYYYhhmmA(notification.metadata.proposedDate, { timeZone: userTimezone })}
                          </p>
                        )}

                        {isActionableReschedule(notification) && (
                          <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                            {user?.role === 'admin' ? (
                              <button
                                type="button"
                                onClick={() => openRescheduleDetails(notification)}
                                className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground"
                              >
                                Review request
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  disabled={rescheduleActionLoading === notification._id}
                                  onClick={() => handleRescheduleDecision(notification, 'approved')}
                                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground disabled:opacity-60"
                                >
                                  Accept
                                </button>
                                <button
                                  type="button"
                                  disabled={rescheduleActionLoading === notification._id}
                                  onClick={() => handleRescheduleDecision(notification, 'rejected')}
                                  className="px-3 py-1.5 rounded-md text-xs font-medium border border-border text-muted-foreground hover:text-foreground disabled:opacity-60"
                                >
                                  Decline
                                </button>
                              </>
                            )}
                          </div>
                        )}
                        {!isActionableReschedule(notification) && !isUninvoicedResolved(notification) && notification?.actionLink && (
                          <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => handleOpenActionLink(notification)}
                              className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground"
                            >
                              {getActionLabel(notification)}
                            </button>
                          </div>
                        )}
                        <div className="mt-2 flex items-center justify-between">
                          <p className="text-xs text-gray-400">
                            {formatNotificationTimestamp(notification.createdAt)}
                          </p>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteNotification(notification._id);
                            }}
                            disabled={deleteLoadingId === notification._id}
                            className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-60"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="border-t border-gray-200 bg-gray-50 p-3">
              <button
                onClick={() => {
                  setIsOpen(false);
                  // You could navigate to a full notifications page here
                }}
                className="w-full text-center text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
              >
                View all notifications
              </button>
            </div>
          )}
        </div>
      )}

      {/* Overlay to close dropdown when clicking outside */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      <RescheduleRequestDetailsModal
        isOpen={rescheduleDetailsOpen}
        notification={rescheduleDetailsNotification}
        userTimezone={userTimezone}
        onClose={() => {
          setRescheduleDetailsOpen(false);
          setRescheduleDetailsNotification(null);
        }}
        onDecision={async () => {
          await fetchNotifications();
        }}
      />
    </div>
  );
};

export default NotificationCenter;