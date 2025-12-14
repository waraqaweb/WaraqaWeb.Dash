import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { checkDSTWarning, getDSTTransitions } from '../../utils/timezoneUtils';
import { Clock, AlertTriangle, Calendar, X, Info } from 'lucide-react';

const DSTWarningBanner = () => {
  const { user } = useAuth();
  const [dstWarning, setDstWarning] = useState(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (user?.timezone) {
      checkForDSTWarning();
      // Check every hour for DST changes
      const interval = setInterval(checkForDSTWarning, 60 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [user?.timezone]);

  const checkForDSTWarning = () => {
    if (!user?.timezone) return;
    
    const warning = checkDSTWarning(user.timezone, 7); // 7 days warning
    
    if (warning.hasWarning) {
      setDstWarning(warning);
      
      // Check if user has dismissed this specific transition
      const dismissKey = `dst_dismissed_${user.timezone}_${warning.transition.date.getTime()}`;
      const dismissed = localStorage.getItem(dismissKey);
      setIsDismissed(!!dismissed);
    } else {
      setDstWarning(null);
      setIsDismissed(false);
    }
  };

  const handleDismiss = () => {
    if (dstWarning?.transition) {
      const dismissKey = `dst_dismissed_${user.timezone}_${dstWarning.transition.date.getTime()}`;
      localStorage.setItem(dismissKey, 'true');
      setIsDismissed(true);
    }
  };

  const formatDate = (date) => {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: user?.timezone
    }).format(new Date(date));
  };

  const getWarningColor = (daysUntil) => {
    if (daysUntil <= 1) return 'bg-red-50 border-red-200 text-red-800';
    if (daysUntil <= 3) return 'bg-orange-50 border-orange-200 text-orange-800';
    return 'bg-yellow-50 border-yellow-200 text-yellow-800';
  };

  const getIcon = (daysUntil) => {
    if (daysUntil <= 1) return <AlertTriangle className="h-5 w-5 text-red-600" />;
    return <Clock className="h-5 w-5 text-yellow-600" />;
  };

  if (!dstWarning || isDismissed) return null;

  return (
    <div className={`border-l-4 p-4 ${getWarningColor(dstWarning.daysUntil)}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3">
          <div className="flex-shrink-0 mt-0.5">
            {getIcon(dstWarning.daysUntil)}
          </div>
          <div className="flex-1">
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-medium">
                🕰️ Daylight Saving Time Change Alert
              </h3>
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-xs font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
              >
                {showDetails ? 'Hide details' : 'Show details'}
              </button>
            </div>
            <p className="text-sm mt-1">
              {dstWarning.message}
            </p>
            
            {showDetails && (
              <div className="mt-3 p-3 bg-white bg-opacity-50 rounded-lg">
                <div className="text-sm space-y-2">
                  <div className="flex items-center space-x-2">
                    <Calendar className="h-4 w-4" />
                    <span><strong>When:</strong> {formatDate(dstWarning.transition.date)}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Clock className="h-4 w-4" />
                    <span><strong>Change:</strong> Clocks {dstWarning.transition.type === 'spring_forward' ? 'spring forward' : 'fall back'} by {dstWarning.transition.timeDifference / 60} hour(s)</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Info className="h-4 w-4" />
                    <span><strong>Impact:</strong> Your class times will remain the same in your local time, but may appear different to others in different timezones.</span>
                  </div>
                </div>
              </div>
            )}
            
            <div className="mt-2 text-xs opacity-75">
              Your classes are anchored to your timezone and will automatically adjust to maintain consistency in your local time.
            </div>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="ml-4 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-300"
          title="Dismiss this warning"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default DSTWarningBanner;