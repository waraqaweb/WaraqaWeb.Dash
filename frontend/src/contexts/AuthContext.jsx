/**
 * Authentication Context
 * 
 * Manages user authentication state throughout the application
 * Provides login, logout, and user data to all components
 */

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import api from '../api/axios';
import { io } from 'socket.io-client';
import { bumpDomainVersion } from '../utils/sessionCache';

// Create the authentication context
const AuthContext = createContext();

// Global socket instance to prevent multiple connections
let globalSocket = null;
let socketInitTimeout = null;
let isSocketInitializing = false;

// Custom hook to use the auth context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// api instance already configures baseURL and attaches token via interceptor

// Authentication Provider Component
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [socket, setSocket] = useState(globalSocket); // Use global socket
  const hasCheckedAuthRef = useRef(false);

  // Keep list/availability UIs in sync when other users create/update/delete classes.
  // We do this centrally so any screen that listens to these window events stays up-to-date.
  useEffect(() => {
    if (!socket) return;

    const safeDispatch = (name) => {
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event(name));
        }
      } catch (e) {
        // ignore
      }
    };

    const handleClassChange = () => {
      try {
        bumpDomainVersion('classes');
        bumpDomainVersion('availability');
      } catch (e) {
        // ignore
      }
      safeDispatch('classes:refresh');
      safeDispatch('availability:refresh');
    };

    socket.on('class:created', handleClassChange);
    socket.on('class:updated', handleClassChange);
    socket.on('class:deleted', handleClassChange);

    return () => {
      socket.off('class:created', handleClassChange);
      socket.off('class:updated', handleClassChange);
      socket.off('class:deleted', handleClassChange);
    };
  }, [socket]);

  // If the backend tells us the token is invalid/expired during an active session,
  // clear auth state so the UI can redirect back to login.
  useEffect(() => {
    const interceptorId = api.interceptors.response.use(
      (response) => response,
      (error) => {
        const status = error?.response?.status;
        const apiError = error?.response?.data?.error || error?.authErrorCode;
        if (status === 401 && (apiError === 'INVALID_TOKEN' || apiError === 'TOKEN_EXPIRED')) {
          try { localStorage.removeItem('token'); } catch (e) {}
          setToken(null);
          setUser(null);
        }
        return Promise.reject(error);
      }
    );

    return () => {
      api.interceptors.response.eject(interceptorId);
    };
  }, []);

  const initializeSocket = (token, user) => {
    // Prevent multiple initializations with stronger checks
    if (isSocketInitializing) {
      return globalSocket;
    }
    
    if (globalSocket?.connected) {
      return globalSocket;
    }
    
    // Clear any pending initialization
    if (socketInitTimeout) {
      clearTimeout(socketInitTimeout);
    }
    
    // Debounce socket creation with a delay
    socketInitTimeout = setTimeout(() => {
      if (isSocketInitializing || globalSocket?.connected) {
        return;
      }
      
      isSocketInitializing = true;
      
      try {
        // Disconnect any existing socket
        if (globalSocket) {
          globalSocket.disconnect();
          globalSocket = null;
        }

        // Derive socket URL from API base when possible to avoid port mismatches.
        // Vite exposes CRA-prefixed env vars on `import.meta.env.REACT_APP_*`.
        const viteEnv = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};

        const explicitApiBase =
          (viteEnv && viteEnv.REACT_APP_API_URL) ||
          (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_URL) ||
          (typeof window !== 'undefined' && window.__API_BASE__) ||
          null;

        // Use the configured axios baseURL if present (this already falls back to `window.location.origin + /api`).
        const axiosBase = api?.defaults?.baseURL;
        const derivedApiBase = explicitApiBase || axiosBase || null;

        const isLocalHost = (typeof window !== 'undefined'
          && window.location
          && (window.location.hostname === 'localhost'
            || window.location.hostname === '127.0.0.1'
            || window.location.hostname === '::1'));

        const explicitSocketUrl =
          (viteEnv && viteEnv.REACT_APP_SOCKET_URL) ||
          (typeof process !== 'undefined' && process.env && process.env.REACT_APP_SOCKET_URL) ||
          (typeof window !== 'undefined' && window.__SOCKET_URL__) ||
          null;

        let socketUrl =
          explicitSocketUrl ||
          (derivedApiBase ? String(derivedApiBase).replace(/\/api\/?$/, '') : null);

        // If still unknown, prefer same-origin in prod (nginx proxies `/socket.io/*` to backend).
        // In local/dev, default to backend port 5000.
        if (!socketUrl) {
          const origin = (typeof window !== 'undefined' && window.location && window.location.origin)
            ? window.location.origin
            : null;
          if (origin && !isLocalHost) socketUrl = origin;
          else socketUrl = 'http://127.0.0.1:5000';
        }

        if (isLocalHost && typeof socketUrl === 'string' && socketUrl.startsWith('http://localhost:')) {
          socketUrl = socketUrl.replace('http://localhost:', 'http://127.0.0.1:');
        }

        // Production safety:
        // If the app is NOT running on localhost but the socket URL points to localhost/127.0.0.1
        // (commonly baked into a Docker build by mistake), force same-origin instead.
        if (!isLocalHost && typeof window !== 'undefined' && window.location?.origin) {
          const looksLocal = typeof socketUrl === 'string' && /:\/\/(localhost|127\.0\.0\.1|::1)(:|\/|$)/i.test(socketUrl);
          if (looksLocal) {
            socketUrl = window.location.origin;
          }

          // Avoid mixed-content issues on HTTPS sites.
          if (window.location.protocol === 'https:' && typeof socketUrl === 'string' && socketUrl.startsWith('http://')) {
            socketUrl = window.location.origin;
          }
        }

        // Configure reconnection and transport options for robustness
        const socketOpts = {
          auth: { token },
          forceNew: true,
          // Give slow proxies / first-connect DNS a bit more time.
          timeout: 20000,
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000
        };

        globalSocket = io(socketUrl, socketOpts);
        
        globalSocket.on('connect', () => {
          if (user) {
            globalSocket.emit('join-room', user.role);
            globalSocket.emit('join-room', user._id);
          }
          isSocketInitializing = false;
        });
        
        globalSocket.on('disconnect', () => {
          isSocketInitializing = false;
        });
        
        globalSocket.on('connect_error', (error) => {
          // Common errors: ECONNREFUSED (server not running), xhr poll errors, CORS issues
          console.error('🔌 Socket connection error:', error && error.message ? error.message : error, {
            socketUrl
          });
          isSocketInitializing = false;
        });
        
        setSocket(globalSocket);
      } catch (e) {
        console.error('Socket initialization failed:', e);
        isSocketInitializing = false;
      }
    }, 1000); // 1 second delay to let the app settle
    
    return globalSocket;
  };

  // Set up axios interceptor to include token in requests
  useEffect(() => {
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete api.defaults.headers.common['Authorization'];
    }
  }, [token]);

  // Check if user is authenticated on app load
  useEffect(() => {
    let isComponentMounted = true;
    
    const checkAuth = async () => {
      const savedToken = localStorage.getItem('token');
      
      if (savedToken && isComponentMounted) {
        let attempts = 0;
        while (attempts < 2) { // try once, then retry once on transient failures
          try {
            // Verify token with backend
            const response = await api.get('/auth/me');
            
            if (isComponentMounted) {
              setUser(response.data.user);
              setToken(savedToken);

              // Initialize socket ONLY ONCE
              initializeSocket(savedToken, response.data.user);
            }
            break; // success -> exit loop
          } catch (error) {
            attempts += 1;
            // If there's no response it could be a transient network/cache read failure
            if ((error.isNetworkOrCache || !error.response) && attempts < 2) {
              console.warn('Transient network/cache error when verifying token, retrying...', error.message || error);
              // small delay before retry
              await new Promise((r) => setTimeout(r, 500));
              continue;
            }

            // If backend explicitly returned 401 or token errors, clear token.
            const status = error.response?.status || (error.isAuthError ? 401 : null);
            const apiError = error.response?.data?.error || error.authErrorCode;
            if (status === 401 || apiError === 'TOKEN_EXPIRED' || apiError === 'INVALID_TOKEN') {
              console.error('Token verification failed - invalid/expired token:', error);
              if (isComponentMounted) {
                localStorage.removeItem('token');
                setToken(null);
              }
            } else {
              // For other errors (network, cache, server 5xx), keep the token and let user continue;
              console.error('Token verification encountered a non-auth error:', error);
            }
            break;
          }
        }
      }
      
      if (isComponentMounted) {
        setLoading(false);
      }
    };

    // Only run if we don't already have a user (and only once)
    if (!user && !hasCheckedAuthRef.current) {
      hasCheckedAuthRef.current = true;
      checkAuth();
    } else {
      setLoading(false);
    }
    
    return () => {
      isComponentMounted = false;
      // Don't disconnect global socket on cleanup, let logout handle it
    };
  }, [user]);

  /**
   * Login function for regular users (teacher, guardian, student)
   */
  const login = async (email, password) => {
    try {
      const payload = {
        email: (email || '').trim().toLowerCase(),
        password: (password || '').trim(),
      };
      const response = await api.post('/auth/login', payload);

      const { user: userData, token: userToken } = response.data;
      
      // Save token to localStorage
      localStorage.setItem('token', userToken);
      
      // Update state
      setUser(userData);
      setToken(userToken);

      // Initialize socket ONLY ONCE
      initializeSocket(userToken, userData);
      
      return { success: true, user: userData, role: userData.role };
      
    } catch (error) {
      console.error('Login error:', error);
      
      const errorMessage = error.response?.data?.message || 'Login failed';
      return { success: false, error: errorMessage };
    }
  };

  /**
   * Admin login function (separate endpoint)
   */
  const adminLogin = async (email, password) => {
    try {
      const payload = {
        email: (email || '').trim().toLowerCase(),
        password: (password || '').trim(),
      };
      const response = await api.post('/auth/admin/login', payload);

      const { user: userData, token: userToken } = response.data;
      
      // Save token to localStorage
      localStorage.setItem('token', userToken);
      
      // Update state
      setUser(userData);
      setToken(userToken);
      
      return { success: true, user: userData, role: userData.role };
      
    } catch (error) {
      console.error('Admin login error:', error);
      
      const errorMessage = error.response?.data?.message || 'Admin login failed';
      return { success: false, error: errorMessage };
    }
  };

  /**
   * Register function for new users
   */
  const register = async (userData) => {
    try {
      // Sanitize phone on client side as an extra safety net
      const normalizePhone = (raw = '') => {
        if (!raw || typeof raw !== 'string') return '';
        const trimmed = raw.trim();
        const hasPlus = trimmed.startsWith('+');
        const cleaned = trimmed.replace(/[\s().-]/g, '');
        return hasPlus ? `+${cleaned.replace(/^\+/, '')}` : cleaned.replace(/^\+/, '');
      };

      const payload = {
        ...userData,
        email: (userData?.email || '').trim().toLowerCase(),
        password: (userData?.password || '').trim(),
        phone: userData?.phone ? normalizePhone(userData.phone) : userData?.phone,
      };
      const response = await api.post('/auth/register', payload);

      const { user: newUser, token: userToken } = response.data;
      
      // Save token to localStorage
      localStorage.setItem('token', userToken);
      
      // Update state
      setUser(newUser);
      setToken(userToken);
      
      return { success: true, user: newUser, role: newUser.role };
      
    } catch (error) {
      console.error('Registration error:', error);

      const data = error.response?.data;
      const errorMessage = data?.message || 'Registration failed';
      return {
        success: false,
        error: errorMessage,
        fieldErrors: data?.fieldErrors,
        errors: data?.errors,
        status: error.response?.status,
      };
    }
  };

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
      localStorage.removeItem('originalAdminToken');
      localStorage.removeItem('originalAdminUser');
      setUser(null);
      setToken(null);
      
      // Clear any pending socket initialization
      if (socketInitTimeout) {
        clearTimeout(socketInitTimeout);
        socketInitTimeout = null;
      }
      
      // Disconnect global socket
      if (globalSocket) {
        globalSocket.disconnect();
        globalSocket = null;
      }
      isSocketInitializing = false;
      setSocket(null);
      
      // Clear api default header
      delete api.defaults.headers.common['Authorization'];
    }
  };  /**
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
    socket,
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


