/**
 * Authentication Context
 * 
 * Manages user authentication state throughout the application
 * Provides login, logout, and user data to all components
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../../api/axios';
import { io } from 'socket.io-client';

// Create the authentication context
const AuthContext = createContext();

// Custom hook to use the auth context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// api instance already configures baseURL and token handling

// Authentication Provider Component
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(localStorage.getItem('token'));

  // Set token on the api instance
  useEffect(() => {
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete api.defaults.headers.common['Authorization'];
    }
  }, [token]);

  // Check if user is authenticated on app load
  useEffect(() => {
    const checkAuth = async () => {
      const savedToken = localStorage.getItem('token');
      if (savedToken) {
        let attempts = 0;
        while (attempts < 2) {
          try {
            const response = await api.get('/auth/me');
            setUser(response.data.user);
            setToken(savedToken);
            // initialize socket here as well (dashboard context)
            try {
              // derive socket URL similarly to main context
              const derivedApiBase = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_URL)
                ? process.env.REACT_APP_API_URL
                : (typeof window !== 'undefined' && window.__API_BASE__)
                  // Deprecated shim: use src/contexts/AuthContext instead.
                  export { default } from '../../contexts/AuthContext';
                  export * from '../../contexts/AuthContext';

  /**
   * Admin: Login as another user
   */
  const loginAsUser = async (userId) => {
    try {
  const response = await api.post(`/users/${userId}/login-as`);
      const { user: userData, token: userToken, originalAdmin } = response.data;

      // Store original admin info if this is a login-as session
      if (originalAdmin) {
        localStorage.setItem('originalAdminToken', localStorage.getItem('token'));
  localStorage.setItem('originalAdminUser', JSON.stringify(api.defaults.headers.common['Authorization']));
      }

      localStorage.setItem('token', userToken);
      setUser(userData);
      setToken(userToken);

      return { success: true, user: userData, role: userData.role };
    } catch (error) {
      console.error('Login as user error:', error);
      const errorMessage = error.response?.data?.message || 'Failed to login as user';
      return { success: false, error: errorMessage };
    }
  };

  /**
   * Logout function
   */
  const logout = async () => {
    try {
      // Call logout endpoint (optional)
  await api.post('/auth/logout');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Clear local storage and state
      localStorage.removeItem('token');
      localStorage.removeItem('originalAdminToken'); // Clear original admin token
      localStorage.removeItem('originalAdminUser'); // Clear original admin user
      
      // Clear axios default header
  delete api.defaults.headers.common['Authorization'];
      
      // Update state
      setUser(null);
      setToken(null);
      
      // Force page reload to ensure clean state
      window.location.href = '/login';
    }
  };

  /**
   * Update user profile
   */
  const updateProfile = async (updates) => {
    try {
  const response = await api.put(`/users/${user._id}`, updates);
      
      setUser(response.data.user);
      
      return { success: true, user: response.data.user };
      
    } catch (error) {
      console.error('Profile update error:', error);
      
      const errorMessage = error.response?.data?.message || 'Profile update failed';
      return { success: false, error: errorMessage };
    }
  };

  /**
   * Change password
   */
  const changePassword = async (currentPassword, newPassword) => {
    try {
      await api.put('/auth/change-password', {
        currentPassword,
        newPassword
      });
      
      return { success: true };
      
    } catch (error) {
      console.error('Password change error:', error);
      
      const errorMessage = error.response?.data?.message || 'Password change failed';
      return { success: false, error: errorMessage };
    }
  };

  /**
   * Check if user has specific role
   */
  const hasRole = (role) => {
    if (!role) return false;
    const target = typeof role === 'string' ? role.toLowerCase() : '';
    return (user?.role || '').toLowerCase() === target;
  };

  /**
   * Check if user is admin
   */
  const isAdmin = () => {
    return hasRole('admin');
  };

  /**
   * Check if user is teacher
   */
  const isTeacher = () => {
    return hasRole('teacher');
  };

  /**
   * Check if user is guardian
   */
  const isGuardian = () => {
    return hasRole('guardian');
  };

  /**
   * Check if user is student
   */
  const isStudent = () => {
    return hasRole('student');
  };

  // Context value
  const value = {
    user,
    token,
    loading,
    login,
    adminLogin,
    register,
    logout,
    updateProfile,
    changePassword,
    loginAsUser,
    hasRole,
    isAdmin,
    isTeacher,
    isGuardian,
    isStudent,
    isAuthenticated: !!user
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
