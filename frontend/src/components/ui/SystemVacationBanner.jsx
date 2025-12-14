import React, { useState, useEffect } from 'react';
import api from '../../api/axios';

const SystemVacationBanner = () => {
  const [currentVacation, setCurrentVacation] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkCurrentVacation();
    // Check every 5 minutes for updates
    const interval = setInterval(checkCurrentVacation, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const checkCurrentVacation = async () => {
    try {
  const res = await api.get('/system-vacations/current');
      if (res.data.isActive) {
        setCurrentVacation(res.data.vacation);
      } else {
        setCurrentVacation(null);
      }
    } catch (err) {
      console.error('Check current vacation error:', err);
      setCurrentVacation(null);
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const getTimeRemaining = () => {
    if (!currentVacation) return null;
    
    const now = new Date();
    const end = new Date(currentVacation.endDate);
    const diff = end - now;
    
    if (diff <= 0) return "Ending soon...";
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) {
      return `${days} day${days > 1 ? 's' : ''} ${hours} hour${hours !== 1 ? 's' : ''} remaining`;
    } else {
      return `${hours} hour${hours !== 1 ? 's' : ''} remaining`;
    }
  };

  if (loading) return null;
  if (!currentVacation) return null;

  return (
    <div className="bg-gradient-to-r from-green-500 to-blue-600 text-white p-4 shadow-lg">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center space-x-3">
            <div className="text-2xl">🎉</div>
            <div>
              <h3 className="font-bold text-lg">{currentVacation.name}</h3>
              <p className="text-green-100 text-sm">{currentVacation.message}</p>
            </div>
          </div>
          
          <div className="text-right">
            <div className="text-sm text-green-100">
              {formatDateTime(currentVacation.startDate)} - {formatDateTime(currentVacation.endDate)}
            </div>
            <div className="font-semibold">
              {getTimeRemaining()}
            </div>
          </div>
        </div>
        
        <div className="mt-3 text-center bg-white bg-opacity-20 rounded-lg py-2">
          <p className="text-sm font-medium">
            📚 All classes are on hold during this vacation period
          </p>
        </div>
      </div>
    </div>
  );
};

export default SystemVacationBanner;