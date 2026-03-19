import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';
import { makeCacheKey, readCache, writeCache } from '../../utils/sessionCache';

const ISLAMIC_DECORATIVE_LINE = '۞ ┈┈┈ ✦ ┈┈┈ ۞';
const BANNER_TITLE_FONT = '"Aref Ruqaa", "Amiri", Georgia, serif';
const BANNER_BODY_FONT = '"Noto Naskh Arabic", "Inter", "Segoe UI", sans-serif';
const BANNER_LABEL_FONT = '"Noto Kufi Arabic", "Open Sans", "Segoe UI", sans-serif';

const SystemVacationBanner = () => {
  const { user } = useAuth();
  const [currentVacation, setCurrentVacation] = useState(null);
  const [bannerState, setBannerState] = useState(null);
  const [loading, setLoading] = useState(true);

  const userTimezone = user?.timezone || user?.guardianInfo?.timezone || user?.teacherInfo?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  useEffect(() => {
    checkCurrentVacation();
    // Check every 5 minutes for updates
    const interval = setInterval(checkCurrentVacation, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const checkCurrentVacation = async () => {
    try {
      const cacheKey = makeCacheKey('system-vacations:banner');
      const cached = readCache(cacheKey, { deps: ['system-vacations'] });
      if (cached.hit && cached.value) {
        if (cached.value.vacation) {
          setCurrentVacation(cached.value.vacation);
          setBannerState(cached.value.isActive ? 'active' : (cached.value.isUpcoming ? 'upcoming' : null));
        } else {
          setCurrentVacation(null);
          setBannerState(null);
        }
        if (cached.ageMs < 60_000) return;
      }

      const res = await api.get('/system-vacations/current', { params: { includeUpcoming: true } });
      if (res.data.vacation) {
        setCurrentVacation(res.data.vacation);
        setBannerState(res.data.isActive ? 'active' : (res.data.isUpcoming ? 'upcoming' : null));
      } else {
        setCurrentVacation(null);
        setBannerState(null);
      }
      writeCache(cacheKey, res.data, { ttlMs: 60_000, deps: ['system-vacations'] });
    } catch (err) {
      console.error('Check current vacation error:', err);
      setCurrentVacation(null);
      setBannerState(null);
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (dateString) => {
    const value = new Date(dateString);
    if (Number.isNaN(value.getTime())) return '';

    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: userTimezone,
        weekday: 'short',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(value);
    } catch (e) {
      return value.toLocaleString();
    }
  };

  const getTimeSummary = () => {
    if (!currentVacation) return null;
    
    const now = new Date();
    const targetDate = bannerState === 'upcoming'
      ? new Date(currentVacation.startDate)
      : new Date(currentVacation.endDate);
    const diff = targetDate - now;
    
    if (diff <= 0) {
      return bannerState === 'upcoming' ? 'Starting soon...' : 'Ending soon...';
    }
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const suffix = bannerState === 'upcoming' ? 'until start' : 'remaining';
    
    if (days > 0) {
      return `${days} day${days > 1 ? 's' : ''} ${hours} hour${hours !== 1 ? 's' : ''} ${suffix}`;
    } else {
      return `${hours} hour${hours !== 1 ? 's' : ''} ${suffix}`;
    }
  };

  const statusHeading = bannerState === 'upcoming' ? 'Upcoming Vacation Notice' : 'Vacation Notice';
  const statusLine = bannerState === 'upcoming'
    ? 'A scheduled system vacation has been announced for your account.'
    : 'A system vacation is currently in effect for your account.';
  const statusFooter = bannerState === 'upcoming'
    ? 'This period is shown in your own timezone so the schedule is easy to follow.'
    : 'All classes are on hold during this window, shown below in your own timezone.';

  if (loading) return null;
  if (!currentVacation) return null;

  return (
    <div className="border-y border-amber-200 bg-gradient-to-r from-amber-50 via-stone-50 to-emerald-50 px-4 py-3 text-slate-800 shadow-sm">
      <div className="mx-auto max-w-7xl rounded-2xl border border-amber-200/80 bg-white/90 p-4 shadow-[0_18px_50px_-30px_rgba(20,83,45,0.45)] backdrop-blur">
        <div className="text-center text-amber-700" style={{ fontFamily: BANNER_TITLE_FONT }}>
          <div className="text-xs tracking-[0.28em] sm:text-sm">{ISLAMIC_DECORATIVE_LINE}</div>
          <h3 className="mt-1 text-xl text-emerald-900 sm:text-2xl">{statusHeading}</h3>
          <p className="mt-1 text-sm text-stone-600" style={{ fontFamily: BANNER_BODY_FONT }}>
            {statusLine}
          </p>
        </div>

        <div className="mt-4 grid items-stretch gap-3 lg:grid-cols-[0.9fr_1.4fr_0.9fr]">
          <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-white to-emerald-50/70 p-4 text-center lg:text-left">
            <div className="text-[11px] uppercase tracking-[0.25em] text-emerald-700" style={{ fontFamily: BANNER_LABEL_FONT }}>
              Vacation Title
            </div>
            <p className="mt-2 text-xl text-slate-900 sm:text-2xl" style={{ fontFamily: BANNER_TITLE_FONT }}>
              {currentVacation.name}
            </p>
            <div className="mt-3 text-sm text-stone-600" style={{ fontFamily: BANNER_BODY_FONT }}>
              {bannerState === 'upcoming' ? 'Scheduled announcement' : 'Currently active'}
            </div>
          </div>

          <div className="flex min-h-[160px] max-h-[25vh] flex-col justify-center overflow-hidden rounded-2xl border border-amber-100 bg-amber-50/70 px-5 py-4 text-slate-700">
            <div className="text-center text-[11px] tracking-[0.25em] text-amber-700" style={{ fontFamily: BANNER_LABEL_FONT }}>
              {ISLAMIC_DECORATIVE_LINE}
            </div>
            <p className="mt-3 text-center whitespace-pre-line text-base leading-7 sm:text-lg" style={{ fontFamily: BANNER_BODY_FONT }}>
              {currentVacation.message}
            </p>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-stone-50/85 p-4 text-center lg:text-left">
            <div className="grid gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.25em] text-stone-500" style={{ fontFamily: BANNER_LABEL_FONT }}>
                  Begins
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900 sm:text-base" style={{ fontFamily: BANNER_BODY_FONT }}>
                  {formatDateTime(currentVacation.startDate)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.25em] text-stone-500" style={{ fontFamily: BANNER_LABEL_FONT }}>
                  Ends
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900 sm:text-base" style={{ fontFamily: BANNER_BODY_FONT }}>
                  {formatDateTime(currentVacation.endDate)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.25em] text-stone-500" style={{ fontFamily: BANNER_LABEL_FONT }}>
                  Time Remaining
                </div>
                <div className="mt-1 text-sm font-semibold text-emerald-800 sm:text-base" style={{ fontFamily: BANNER_BODY_FONT }}>
                  {getTimeSummary()}
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-stone-200 bg-white px-3 py-2 text-center text-sm text-stone-600 lg:text-left" style={{ fontFamily: BANNER_BODY_FONT }}>
              <div className="font-semibold text-slate-800">Timezone</div>
              <div className="mt-1 truncate">{userTimezone}</div>
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-950 px-4 py-2 text-center text-emerald-50">
          <p className="text-sm leading-6" style={{ fontFamily: BANNER_BODY_FONT }}>
            {statusFooter}
          </p>
        </div>
      </div>
    </div>
  );
};

export default SystemVacationBanner;