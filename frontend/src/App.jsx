/**
 * Main App Component
 * 
 * This is the root component that sets up routing and authentication
 * for the Online Class Management System
 */

import React from 'react';
import api from './api/axios';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import './App.css';

// Import components
import LoginPage from './components/auth/LoginPage';
import AdminLoginPage from './components/auth/AdminLoginPage';
import RegisterPage from './components/auth/RegisterPage';
import ForgotPassword from './components/auth/ForgotPassword';
import ResetPassword from './components/auth/ResetPassword';
import Dashboard from './pages/dashboard/Dashboard';
import LoadingSpinner from './components/ui/LoadingSpinner';
import ClassReportPage from './pages/dashboard/ClassReportPage';
import DashboardLayout from './components/layout/DashboardLayout';
// Import invoice modals/pages
import InvoiceViewModal from './components/invoices/InvoiceViewModal';
import RecordPaymentModal from './components/invoices/RecordPaymentModal';
import InvoicePublicPage from './components/invoices/InvoicePublicPage';
import PublicEvaluationBookingPage from './components/meetings/PublicEvaluationBookingPage';
import SalariesPage from "./pages/dashboard/salaries/SalariesPage";
import FeedbacksAdmin from './pages/dashboard/FeedbacksAdmin';
// Classes modals
import CreateClassModal from './components/dashboard/CreateClassModal';
import EditClassModal from './components/dashboard/EditClassModal';
import RescheduleClassModal from './components/dashboard/RescheduleClassModal';
import DeleteClassModal from './components/dashboard/DeleteClassModal';
// Salary modals
import SalaryViewModal from './pages/dashboard/salaries/SalaryViewModal';
import SalaryEditModal from './pages/dashboard/salaries/SalaryEditModal';
import SalaryCreateModal from './pages/dashboard/salaries/SalaryCreateModal';
// Teacher Salary pages
import TeacherSalaries from './pages/admin/TeacherSalaries';
import TeacherSalaryDashboard from './pages/teacher/SalaryDashboard';
import LibraryDashboard from './pages/library/LibraryDashboard';

/**
 * Protected Route Component
 * Redirects to login if user is not authenticated
 */
const ProtectedRoute = ({ children, requiredRole = null, allowedRoles = null }) => {
  const { user, loading, hasRole } = useAuth();

  

  if (loading) {
    return <LoadingSpinner fullScreen />;
  }

  if (!user) {
    
    return <Navigate to="/dashboard/login" replace />;
  }

  const requiredRoles = Array.isArray(allowedRoles) && allowedRoles.length > 0
    ? allowedRoles
    : (requiredRole ? [requiredRole] : []);

  if (requiredRoles.length > 0) {
    const isAuthorized = requiredRoles.some(role => hasRole(role));
    if (!isAuthorized) {
      return <Navigate to="/unauthorized" replace />;
    }
  }

  
  return children;
};

/**
 * Public Route Component
 * Redirects to dashboard if user is already authenticated, based on their role.
 */
const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();

  

  if (loading) {
    return <LoadingSpinner fullScreen />;
  }

  if (user) {
    
    // Redirect to dashboard based on user's role
    if (user.role === 'admin') {
      return <Navigate to="/admin/dashboard" replace />;
    } else {
      return <Navigate to="/dashboard" replace />;
    }
  }

  
  return children;
};

/**
 * Main App Routes
 */
const AppRoutes = () => {
  const { user, loading } = useAuth();
  const location = useLocation();
  // If we navigated to a modal route we save the previous location in state.background
  const background = location.state && location.state.background;

  // debug info
  React.useEffect(() => {
    
  }, [user, loading, location]);

  React.useEffect(() => {
    const shouldLockHomepageScroll = location.pathname === '/' && !user;
    document.body.classList.toggle('homepage-scroll-lock', shouldLockHomepageScroll);
    return () => {
      document.body.classList.remove('homepage-scroll-lock');
    };
  }, [location.pathname, user]);

  return (
    // Render the main routes using the background location if set so the modal can overlay
    <>
      <Routes location={background || location}>
      {/* Dashboard-scoped auth routes (preferred in production under /dashboard/*) */}
      <Route
        path="/dashboard/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/dashboard/admin/login"
        element={
          <PublicRoute>
            <AdminLoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/dashboard/register"
        element={
          <PublicRoute>
            <RegisterPage />
          </PublicRoute>
        }
      />
      <Route
        path="/dashboard/forgot-password"
        element={
          <PublicRoute>
            <ForgotPassword />
          </PublicRoute>
        }
      />
      <Route
        path="/dashboard/reset-password"
        element={
          <PublicRoute>
            <ResetPassword />
          </PublicRoute>
        }
      />

      {/* Public routes */}
      <Route 
        path="/login" 
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        } 
      />
      <Route 
        path="/admin/login" 
        element={
          <PublicRoute>
            <AdminLoginPage />
          </PublicRoute>
        } 
      />
      <Route 
        path="/register" 
        element={
          <PublicRoute>
            <RegisterPage />
          </PublicRoute>
        } 
      />
      <Route 
        path="/forgot-password"
        element={
          <PublicRoute>
            <ForgotPassword />
          </PublicRoute>
        }
      />
      <Route 
        path="/reset-password"
        element={
          <PublicRoute>
            <ResetPassword />
          </PublicRoute>
        }
      />

      <Route
        path="/public/invoices/:slug"
        element={<InvoicePublicPage />}
      />

      <Route
        path="/public/meetings/evaluation"
        element={<PublicEvaluationBookingPage />}
      />

      {/* Protected routes */}
      <Route 
        path="/dashboard" 
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/dashboard/home" 
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/dashboard/profile" 
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/dashboard/teachers" 
        element={
          <ProtectedRoute requiredRole="admin">
            <Dashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/dashboard/guardians" 
        element={
          <ProtectedRoute requiredRole="admin">
            <Dashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/dashboard/students" 
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/dashboard/my-students" 
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/dashboard/classes" 
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/dashboard/invoices" 
        element={
          <ProtectedRoute allowedRoles={['admin', 'guardian']}>
            <Dashboard />
          </ProtectedRoute>
        } 
      />
      <Route
        path="/dashboard/library"
        element={
          <ProtectedRoute>
            <LibraryDashboard />
          </ProtectedRoute>
        }
      />
      <Route 
        path="/dashboard/availability" 
        element={
          <ProtectedRoute allowedRoles={['teacher', 'admin']}>
            <Dashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/dashboard/feedbacks" 
        element={
          <ProtectedRoute requiredRole="admin">
            <Dashboard />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/dashboard/vacation-management" 
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } 
      />
      {/* Removed /dashboard/reports and /dashboard/users routes to disable those pages */}
      <Route 
        path="/dashboard/settings" 
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } 
      />
      <Route
        path="salaries"
        element={<SalariesPage />
        } /> 

      <Route 
        path="/dashboard/reports/classes" 
        element={
          <ProtectedRoute requiredRole="admin">
            <ClassReportPage />
          </ProtectedRoute>
        } 
      />
      <Route
        path="/dashboard/feedbacks"
        element={
          <ProtectedRoute requiredRole="admin">
            <FeedbacksAdmin />
          </ProtectedRoute>
        }
      />
      <Route 
        path="/invoices/:slug" 
        element={
          <ProtectedRoute>
            <InvoiceModalFromRoute />
          </ProtectedRoute>
        } 
      />

      {/* Admin only routes - now explicitly defined for dashboard */}
      <Route 
        path="/admin/dashboard/*" 
        element={
          <ProtectedRoute requiredRole="admin">
            <Dashboard /> {/* Admin dashboard content */}
          </ProtectedRoute>
        } 
      />

      {/* Teacher Salary System Routes - Wrapped in DashboardLayout for consistent layout */}
      <Route
        path="/admin/teacher-salaries"
        element={
          <ProtectedRoute requiredRole="admin">
            <DashboardLayout activeView="teacher-salaries">
              <TeacherSalaries />
            </DashboardLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/salary"
        element={
          <ProtectedRoute requiredRole="teacher">
            <DashboardLayout activeView="teacher-salary">
              <TeacherSalaryDashboard />
            </DashboardLayout>
          </ProtectedRoute>
        }
      />

      {/* Default redirect - if authenticated, redirect based on role, otherwise to login */}
      <Route 
        path="/" 
        element={loading ? <LoadingSpinner fullScreen /> : (user ? (user.role === 'admin' ? <Navigate to="/admin/dashboard" replace /> : <Navigate to="/dashboard" replace />) : <Navigate to="/dashboard/login" replace />)}
      />
      
      {/* Unauthorized page */}
      <Route 
        path="/unauthorized" 
        element={
          <div className="min-h-screen flex items-center justify-center bg-background">
            <div className="text-center">
              <h1 className="text-4xl font-bold text-destructive mb-4">Access Denied</h1>
              <p className="text-muted-foreground mb-4">
                You don't have permission to access this page.
              </p>
              <button 
                onClick={() => window.location.href = '/dashboard'}
                className="inline-flex items-center justify-center rounded-lg bg-[#2C736C] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#245b56]"
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        } 
      />

      {/* 404 page */}
      <Route 
        path="*" 
        element={
          <div className="min-h-screen flex items-center justify-center bg-background">
            <div className="text-center">
              <h1 className="text-4xl font-bold text-foreground mb-4">404 - Page Not Found</h1>
              <p className="text-muted-foreground mb-4">
                The page you're looking for doesn't exist.
              </p>
              <button 
                onClick={() => window.location.href = '/dashboard'}
                className="inline-flex items-center justify-center rounded-lg bg-[#2C736C] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#245b56]"
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        } 
      />
      </Routes>

      {/* If we're showing a modal route (background exists) render the modal routes on top */}
      {background && (
        <Routes>
          <Route path="/invoices/:slug" element={
            <ProtectedRoute>
              <InvoiceModalFromRoute />
            </ProtectedRoute>
          } />
          <Route path="/invoices/:id/record" element={
            <ProtectedRoute>
              <RecordPaymentModalFromRoute />
            </ProtectedRoute>
          } />
          {/* Classes modal routes */}
          <Route path="/classes/create" element={
            <ProtectedRoute requiredRole="admin">
              <CreateClassModalFromRoute />
            </ProtectedRoute>
          } />
          <Route path="/classes/:id/edit" element={
            <ProtectedRoute requiredRole="admin">
              <EditClassModalFromRoute />
            </ProtectedRoute>
          } />
          <Route path="/classes/:id/report" element={
            <ProtectedRoute>
              <ClassReportFromRoute />
            </ProtectedRoute>
          } />
          <Route path="/classes/:id/reschedule" element={
            <ProtectedRoute requiredRole="admin">
              <RescheduleClassFromRoute />
            </ProtectedRoute>
          } />
          <Route path="/classes/:id/delete" element={
            <ProtectedRoute requiredRole="admin">
              <DeleteClassFromRoute />
            </ProtectedRoute>
          } />

          {/* Salaries modal routes */}
          <Route path="/salaries/create" element={
            <ProtectedRoute requiredRole="admin">
              <SalaryCreateFromRoute />
            </ProtectedRoute>
          } />
          <Route path="/salaries/:id" element={
            <ProtectedRoute>
              <SalaryViewFromRoute />
            </ProtectedRoute>
          } />
          <Route path="/salaries/:id/edit" element={
            <ProtectedRoute requiredRole="admin">
              <SalaryEditFromRoute />
            </ProtectedRoute>
          } />
        </Routes>
      )}
    </>
  );
};

// Small wrappers so route-based modals can read params and navigate back on close
function InvoiceModalFromRoute() {
  const { slug } = useParams();
  const navigate = useNavigate();
  return <InvoiceViewModal invoiceSlug={slug} onClose={() => navigate(-1)} />;
}

function RecordPaymentModalFromRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  return <RecordPaymentModal invoiceId={id} onClose={() => navigate(-1)} onUpdated={() => navigate(-1)} />;
}

function CreateClassModalFromRoute() {
  const navigate = useNavigate();
  return <CreateClassModal isOpen={true} onClose={() => navigate(-1)} />;
}

function EditClassModalFromRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  // Edit modal expects editClass and helpers in the page; many apps fetch inside the modal - pass id as prop
  return <EditClassModal isOpen={true} classId={id} onClose={() => navigate(-1)} />;
}

function ClassReportFromRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const handleClose = () => {
    // If this route was opened as a modal with a background location, navigate explicitly to that background
    const bg = location.state?.background;
    if (bg) {
      try {
        const path = `${bg.pathname || ''}${bg.search || ''}`;
        navigate(path, { replace: true });
        return;
      } catch (e) {
        // If explicit navigate fails, fall back to history back
        console.warn('Failed to navigate to background path, falling back to history back', e);
        navigate(-1);
        return;
      }
    }

    // If the opener provided an explicit `from` path, navigate there
    if (location.state?.from) {
      navigate(location.state.from, { replace: true });
      return;
    }

    // Fallback: go back in history (best-effort to return to previous page)
    navigate(-1);
  };

  const handleSuccess = () => {
    // Notify any open classes page to refresh its data, then close the modal/route
    try { window.dispatchEvent(new Event('classes:refresh')); } catch (e) { /* ignore */ }
    handleClose();
  };

  return <ClassReportPage reportClassId={id} onClose={handleClose} onSuccess={handleSuccess} />;
}

function RescheduleClassFromRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const initialClass = location.state?.modalClass || null;

  const handleClose = () => {
    if (location.state?.background) {
      navigate(-1);
    } else {
      navigate('/admin/dashboard?view=classes', { replace: true });
    }
  };

  const handleSuccess = (response) => {
    alert(response?.message || "Class rescheduled successfully!");
  };

  return (
    <RescheduleClassModal
      isOpen={true}
      classId={id}
      initialClass={initialClass}
      onClose={handleClose}
      onRescheduled={handleSuccess}
    />
  );
}

function DeleteClassFromRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const initialClass = location.state?.modalClass || null;

  const handleClose = () => {
    if (location.state?.background) {
      navigate(-1);
    } else {
      navigate('/admin/dashboard?view=classes', { replace: true });
    }
  };

  const handleDeleted = (_scope, response) => {
    alert(response?.message || "Class deleted successfully!");
  };

  return (
    <DeleteClassModal
      isOpen={true}
      classId={id}
      initialClass={initialClass}
      onClose={handleClose}
      onDeleted={handleDeleted}
    />
  );
}

function SalaryViewFromRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  return <SalaryViewModal salaryData={{ _id: id }} onClose={() => navigate(-1)} />;
}

function SalaryEditFromRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  return <SalaryEditModal salary={{ _id: id }} onClose={() => navigate(-1)} onUpdated={() => navigate(-1)} />;
}

function SalaryCreateFromRoute() {
  const navigate = useNavigate();
  return <SalaryCreateModal onClose={() => navigate(-1)} onCreated={() => navigate(-1)} />;
}

/**
 * Main App Component
 */
function App() {
  React.useEffect(() => {
    let mounted = true;
    const setFavicon = (href) => {
      try {
        let link = document.querySelector("link[rel~='icon']");
        if (!link) {
          link = document.createElement('link');
          link.rel = 'icon';
          document.getElementsByTagName('head')[0].appendChild(link);
        }
        link.type = 'image/png';
        link.href = href;
      } catch (e) {
        // ignore DOM failures
      }
    };

    (async () => {
      try {
        const res = await api.get('/settings/branding');
        if (!mounted) return;
        const branding = res?.data?.branding;
        if (branding && branding.logo) {
          // Prefer hosted URL, fallback to dataUri
          const href = branding.logo.url || branding.logo.dataUri;
          if (href) setFavicon(href);
        }
      } catch (e) {
        // ignore fetch errors - keep default favicon
      }
    })();

    return () => { mounted = false; };
  }, []);

  const resolvedBasename = React.useMemo(() => {
    const publicUrl = process.env.PUBLIC_URL || '/';

    // In local dev we want routes to work from the root (e.g. /public/...).
    if (process.env.NODE_ENV === 'development') return '/';

    // In production we support both:
    // - dashboard hosted under PUBLIC_URL (typically /dashboard)
    // - public pages hosted at the root (/public/...) via nginx rewrite to the same SPA
    if (typeof window !== 'undefined') {
      const path = window.location.pathname || '/';
      if (path.startsWith('/public')) return '/';
      if (publicUrl !== '/' && path.startsWith(publicUrl)) return publicUrl;
    }

    return publicUrl || '/';
  }, []);

  return (
    // Opt-in to React Router v7 behavior to silence deprecation warnings and prepare for upgrade
    <Router
      basename={resolvedBasename}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <div className="min-h-screen bg-background">
        <AppRoutes />
      </div>
    </Router>
  );
}

export default App;


