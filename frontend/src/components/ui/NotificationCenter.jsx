import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { makeCacheKey, readCache, writeCache } from '../../utils/sessionCache';
import { useAuth } from '../../contexts/AuthContext';
import { Bell, Calendar, X } from 'lucide-react';
import { formatDateTimeDDMMMYYYYhhmmA } from '../../utils/date';
import RescheduleRequestDetailsModal from '../dashboard/RescheduleRequestDetailsModal';

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
  const [uninvoicedLessonsState, setUninvoicedLessonsState] = useState({
    loading: false,
    lessons: [],
    total: 0,
    sinceDays: null,
    error: null
  });

  useEffect(() => {
    if (user) {
      fetchNotifications();
      checkCurrentVacation();
    }
  }, [user]);

  useEffect(() => {
    if (!isOpen || user?.role !== 'admin') return;
    const hasUninvoicedAlert = notifications.some(isUninvoicedLessonsNotification);
    if (hasUninvoicedAlert) fetchUninvoicedLessons();
  }, [isOpen, user?.role, notifications]);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await api.get('/notifications');
      setNotifications(res.data.notifications);
      setUnreadCount(res.data.unreadCount);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  const checkCurrentVacation = async () => {
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
      relatedId === 'uninvoiced-lessons' ||
      title.toLowerCase().includes('uninvoiced lessons')
    );
  };

  const getUninvoicedReasonLabel = (lesson) => {
    const code = lesson?.reasonCode;
    if (code === 'linked_invoice_missing_or_voided') return 'Linked invoice is missing/voided.';
    if (code === 'missing_invoice_link') return 'No invoice item/link found.';
    return lesson?.reason || 'No invoice item/link found.';
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

  const handleOpenActionLink = async (notification) => {
    const link = notification?.actionLink;
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
                          <h4 className="text-sm font-medium text-gray-900 truncate">
                            {notification.title}
                          </h4>
                          {!notification.isRead && (
                            <div className="h-2 w-2 bg-blue-500 rounded-full flex-shrink-0 ml-2 mt-1"></div>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                          {notification.message}
                        </p>

                        {user?.role === 'admin' && isUninvoicedLessonsNotification(notification) && (
                          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                            {uninvoicedLessonsState.loading ? (
                              <p>Loading lesson details...</p>
                            ) : uninvoicedLessonsState.error ? (
                              <p>{uninvoicedLessonsState.error}</p>
                            ) : uninvoicedLessonsState.total === 0 ? (
                              <p>No uninvoiced lessons found.</p>
                            ) : (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between text-amber-900">
                                  <span>
                                    {uninvoicedLessonsState.total} lesson(s)
                                    {uninvoicedLessonsState.sinceDays
                                      ? ` in the last ${uninvoicedLessonsState.sinceDays} days`
                                      : ''}
                                  </span>
                                  {uninvoicedLessonsState.total > 5 && (
                                    <span className="text-amber-800">Showing 5</span>
                                  )}
                                </div>
                                <ul className="space-y-1">
                                  {uninvoicedLessonsState.lessons.slice(0, 5).map((lesson) => {
                                    const teacherName = lesson?.teacher?.name || 'Unknown teacher';
                                    const studentName = lesson?.student?.name || 'Unknown student';
                                    const guardianName = lesson?.guardian?.name || 'Unknown guardian';
                                    return (
                                      <li key={lesson.classId} className="space-y-0.5">
                                        <div className="font-medium text-amber-900">
                                          {formatDateTimeDDMMMYYYYhhmmA(lesson.scheduledDate, { timeZone: userTimezone })}
                                          {' • '}
                                          {teacherName} {' • '} {studentName} {' • '} {guardianName}
                                        </div>
                                        <div className="text-amber-800">
                                          {getUninvoicedReasonLabel(lesson)}
                                        </div>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}

                        {notification?.metadata?.scheduledDate && (
                          <p className="text-xs text-gray-500 mt-2">
                            Lesson time: {formatDateTimeDDMMMYYYYhhmmA(notification.metadata.scheduledDate, { timeZone: userTimezone })}
                          </p>
                        )}

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
                        {!isActionableReschedule(notification) && notification?.actionLink && (
                          <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => handleOpenActionLink(notification)}
                              className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground"
                            >
                              Open class
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