import React, { useState, useEffect } from 'react';
import moment from 'moment-timezone';
import Select from 'react-select';
import { Clock, RefreshCcw } from 'lucide-react';
import { getTimezoneOptions } from '../../utils/timezoneOptions';

const shortZoneName = (zone) =>
  zone && zone.includes('/') ? zone.split('/').pop().replace('_', ' ') : zone;

const computeConversion = (dateISO, timeHHMM, fromZone, toZone) => {
  if (!timeHHMM) return null;
  try {
    const [hh, mm] = timeHHMM.split(':').map((x) => parseInt(x, 10));
    const sourceMoment = moment.tz(
      `${dateISO} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
      'YYYY-MM-DD HH:mm',
      fromZone
    );
    if (!sourceMoment.isValid()) return null;

    const targetMoment = sourceMoment.clone().tz(toZone);

    const sourceFormatted = sourceMoment.format('hh:mm A ddd, MMM DD, YYYY');
    const targetFormatted = targetMoment.format('hh:mm A ddd, MMM DD, YYYY');

    const dayDiff = targetMoment.startOf('day').diff(sourceMoment.startOf('day'), 'days');
    let dayLabel = '';
    if (dayDiff > 0) dayLabel = '(following day)';
    else if (dayDiff < 0) dayLabel = '(previous day)';

    const sourceOffset = sourceMoment.utcOffset();
    const targetOffset = targetMoment.utcOffset();
    const offsetDiff = targetOffset - sourceOffset;
    const absHours = Math.floor(Math.abs(offsetDiff) / 60);
    const absMins = Math.abs(offsetDiff) % 60;
    const aheadBehind = offsetDiff > 0 ? 'ahead' : offsetDiff < 0 ? 'behind' : 'same time';
    const diffLabel = offsetDiff === 0 ? 'Same time' : `${absHours}h ${absMins}m ${aheadBehind}`;

    return {
      source: `${sourceFormatted} ${shortZoneName(fromZone)} Time`,
      target: `${targetFormatted} ${toZone}`,
      dayLabel,
      diffLabel,
      copyText: `${sourceFormatted} ${shortZoneName(fromZone)} Time\n${targetFormatted} ${toZone}\n${dayLabel ? dayLabel + ' ' : ''}${diffLabel}`,
    };
  } catch (e) {
    return null;
  }
};

const FloatingTimezone = () => {
  const [open, setOpen] = useState(false);
  const [timezoneOptions, setTimezoneOptions] = useState([]);
  const [sourceDate, setSourceDate] = useState(moment().format('YYYY-MM-DD'));
  const [sourceTime, setSourceTime] = useState('12:00');
  const [sourceZone, setSourceZone] = useState('Africa/Cairo');
  const [targetZone, setTargetZone] = useState('Europe/London');
  const [convertedText, setConvertedText] = useState(null);
  const [copied, setCopied] = useState(false);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    setTimezoneOptions(getTimezoneOptions());
  }, []);

  useEffect(() => {
    const res = computeConversion(sourceDate, sourceTime, sourceZone, targetZone);
    setConvertedText(res);
  }, [sourceDate, sourceTime, sourceZone, targetZone]);

  const handleCopy = async () => {
    if (!convertedText) return;
    try {
      await navigator.clipboard.writeText(convertedText.copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // ignore
    }
  };

  const handleSwap = () => {
    setSourceZone((prev) => {
      setTargetZone(prev);
      return targetZone;
    });
  };

  return (
    <>
      {/* Floating toggle button bottom-right */}
      <div className="fixed bottom-6 right-6 z-50">
        <button
          aria-expanded={open}
          aria-label={open ? 'Close time converter' : 'Open time converter'}
          onClick={() => setOpen((s) => !s)}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#2C736C] text-white shadow-lg transition hover:bg-[#245b56] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#2C736C]"
          title={open ? 'Close time converter' : 'Open time converter'}
        >
          <RefreshCcw className="h-5 w-5" />
        </button>
      </div>

      {open && (
        <div className="fixed bottom-20 right-6 z-50 w-80 sm:w-96">
          <div className={`bg-card rounded-lg shadow-sm border border-border overflow-hidden p-3`}> 
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <Clock className="h-4 w-4 text-amber-500" />
                <div className="text-sm font-medium">Time Zone Converter</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSwap}
                  className="inline-flex items-center justify-center rounded-lg bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                >
                  Swap
                </button>
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center justify-center rounded-lg bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={() => setMinimized(m => !m)}
                  className="text-xs font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
                >
                  {minimized ? 'Expand' : 'Min'}
                </button>
              </div>
            </div>

            {!minimized && (
              <div className="grid grid-cols-1 gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={sourceDate} onChange={(e)=>setSourceDate(e.target.value)} className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#2C736C]" />
                  <input type="time" value={sourceTime} onChange={(e)=>setSourceTime(e.target.value)} className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#2C736C]" />
                </div>

                <Select value={timezoneOptions.find((opt)=>opt.value===sourceZone)||null} onChange={(opt)=>setSourceZone(opt?.value||sourceZone)} options={timezoneOptions} classNamePrefix="react-select" styles={{container: (base) => ({...base, width: '100%'}), control: (base) => ({...base, minHeight: '32px'})}} placeholder="From timezone" />
                <Select value={timezoneOptions.find((opt)=>opt.value===targetZone)||null} onChange={(opt)=>setTargetZone(opt?.value||targetZone)} options={timezoneOptions} classNamePrefix="react-select" styles={{container: (base) => ({...base, width: '100%'}), control: (base) => ({...base, minHeight: '32px'})}} placeholder="To timezone" />

                <div className="break-words rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
                  {convertedText ? (
                    <div>
                      <div className="font-medium truncate">{convertedText.source}</div>
                      <div className="font-medium truncate">{convertedText.target}</div>
                      <div className="text-muted text-xs">{convertedText.dayLabel} • {convertedText.diffLabel}</div>
                    </div>
                  ) : (
                    <div className="text-gray-400">--:--</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default FloatingTimezone;
