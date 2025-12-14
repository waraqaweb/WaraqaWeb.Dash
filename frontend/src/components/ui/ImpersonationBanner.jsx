/**
 * Impersonation Banner Component
 * 
 * Shows when an admin is impersonating another user
 * Provides option to stop impersonation and return to admin account
 */

import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { AlertTriangle, User, X } from 'lucide-react';

const ImpersonationBanner = () => {
  const { isImpersonating, impersonatedBy, user, stopImpersonation } = useAuth();

  // Don't show banner if not impersonating
  if (!isImpersonating || !impersonatedBy) {
    return null;
  }

  const handleStopImpersonation = async () => {
    try {
      const result = await stopImpersonation();
        if (result.success) {
        // The context will automatically update and redirect
      } else {
        console.error('Failed to stop impersonation:', result.error);
        alert('Failed to stop impersonation. Please try again.');
      }
    } catch (error) {
      console.error('Error stopping impersonation:', error);
      alert('An error occurred while stopping impersonation.');
    }
  };

  return (
    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <AlertTriangle className="h-5 w-5 text-yellow-400" />
          </div>
          <div className="ml-3">
            <div className="flex items-center space-x-2">
              <p className="text-sm text-yellow-800 font-medium">
                You are impersonating
              </p>
              <div className="flex items-center space-x-1 bg-yellow-100 px-2 py-1 rounded-md">
                <User className="h-4 w-4 text-yellow-700" />
                <span className="text-sm font-semibold text-yellow-800">
                  {user?.firstName} {user?.lastName}
                </span>
                <span className="text-xs text-yellow-600">
                  ({user?.role})
                </span>
              </div>
            </div>
            <p className="text-xs text-yellow-700 mt-1">
              Logged in as admin: {impersonatedBy?.email}
            </p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={handleStopImpersonation}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2C736C] px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-[#245b56] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#2C736C]"
          >
            <X className="h-3 w-3" />
            Stop Impersonation
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImpersonationBanner;

