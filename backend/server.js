/**
 * Online Class Management System - Backend Server
 * 
 * This is the main server file that starts the Express.js application
 * and sets up all the necessary middleware and routes.
 */

// Import required packages
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config(); // Load environment variables from .env file

// Import route handlers
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const studentRoutes = require('./routes/students'); // New students routes
const classRoutes = require('./routes/classes');
const dashboardRoutes = require('./routes/dashboard');
const invoiceRoutes = require('./routes/invoices');
const feedbackRoutes = require('./routes/feedbacks');
const availabilityRoutes = require('./routes/availability');
const teacherSalaryRoutes = require('./routes/teacherSalary');
const analyticsRoutes = require('./routes/analytics');
const settingsManagementRoutes = require('./routes/settingsManagement');
const currencyRoutes = require('./routes/currency');
const templateRoutes = require('./routes/templates');
const libraryRoutes = require('./routes/library');
const libraryShareRoutes = require('./routes/libraryShares');
const onboardingRoutes = require('./routes/onboarding');
const meetingRoutes = require('./routes/meetings');

// Create Express application
const app = express();
const server = http.createServer(app);

// When running behind a reverse proxy (nginx), trust X-Forwarded-* so req.ip is the real client.
// This prevents rate-limit from treating all users as a single IP (the proxy).
const isProduction = process.env.NODE_ENV === 'production';

// Ensure we have a stable JWT secret in development.
// Without this, logins can succeed/fail inconsistently and existing tokens may become invalid.
if (!process.env.JWT_SECRET) {
  if (isProduction) {
    console.error('❌ JWT_SECRET is required in production');
    process.exit(1);
  }
  process.env.JWT_SECRET = 'dev-jwt-secret';
  console.warn('⚠️ JWT_SECRET not set; using insecure development default');
}
if (isProduction) {
  // Trust the first proxy hop (nginx -> app). Override via TRUST_PROXY if needed.
  const trustProxy = process.env.TRUST_PROXY ?? '1';
  app.set('trust proxy', trustProxy);
}

// Allowed frontend origins (dashboard)
// In production, keep this strict (use FRONTEND_URL env var).
// In local/dev, allow common localhost/127.0.0.1 ports used for running the dashboard.
const envFrontendOrigins = (process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',')
  : []
)
  .map((origin) => origin.trim())
  .filter(Boolean);

const devFrontendOrigins = isProduction
  ? []
  : [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001'
  ];

const frontendOrigins = Array.from(new Set([...envFrontendOrigins, ...devFrontendOrigins]));

// Set up Socket.io for real-time communication
const io = socketIo(server, {
  cors: {
    origin: frontendOrigins,
    methods: ["GET", "POST"]
  }
});

// Middleware setup
const frameAncestors = ["'self'", ...frontendOrigins];
const cspDirectives = {
  ...helmet.contentSecurityPolicy.getDefaultDirectives(),
  'frame-ancestors': frameAncestors
};

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: cspDirectives
    }
  })
); // Security headers with relaxed frame policy for the frontend
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (frontendOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true
})); // Enable CORS for frontend communication

// Rate limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 200 : 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests, please slow down.',
    retryAfter: 15 * 60
  }
});
app.use(limiter);

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅ Connected to MongoDB successfully');
})
.catch((error) => {
  console.error('❌ MongoDB connection error:', error);
  process.exit(1);
});

// Socket.io connection handling for real-time features
io.on('connection', (socket) => {
  console.log('👤 User connected:', socket.id);
  // Map of userId -> Set of socketIds is stored on io for global access
  if (!io.connectedUsers) io.connectedUsers = new Map();
  
  // Join user to their role-based room for targeted notifications
  socket.on('join-room', (userRoleOrId) => {
    try {
      socket.join(userRoleOrId);
      console.log(`User ${socket.id} joined ${userRoleOrId} room`);

      // If this looks like a Mongo ObjectId, treat it as the user id and track active sockets
      try {
        const mongoose = require('mongoose');
        if (typeof userRoleOrId === 'string' && mongoose.Types.ObjectId.isValid(userRoleOrId)) {
          const userId = String(userRoleOrId);
          socket.data = socket.data || {};
          socket.data.userId = userId;
          const map = io.connectedUsers = io.connectedUsers || new Map();
          const set = map.get(userId) || new Set();
          set.add(socket.id);
          map.set(userId, set);
          console.log(`Active users now: ${map.size}`);
        }
      } catch (e) {
        // ignore
      }
    } catch (e) {
      console.warn('join-room handler failed', e && e.message);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('👤 User disconnected:', socket.id);
    try {
      const map = io.connectedUsers;
      if (map && socket.data && socket.data.userId) {
        const userId = socket.data.userId;
        const set = map.get(userId);
        if (set) {
          set.delete(socket.id);
          if (set.size === 0) map.delete(userId);
        }
      }
      console.log('Active users now:', map ? map.size : 0);
    } catch (e) {
      // ignore
    }
  });
});

// Make io accessible to routes
app.set('io', io);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/students', studentRoutes); // New students routes
app.use('/api/classes', classRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/invoices", invoiceRoutes);
const classReportsRouter = require('./routes/classReports');
app.use('/api/class-reports', classReportsRouter);
const settingsRouter = require('./routes/settings');
app.use('/api/settings', settingsRouter);
app.use('/api/feedbacks', feedbackRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/teacher-salary', teacherSalaryRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/settings-management', settingsManagementRoutes);
app.use('/api/currency', currencyRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/library/shares', libraryShareRoutes);
app.use('/api/meetings', meetingRoutes);

const vacationManagementRoutes = require('./routes/vacationManagement');
app.use('/api/vacation-management', vacationManagementRoutes);

// Legacy routes for backward compatibility
const vacationRoutes = require('./routes/vacations');
app.use('/api/vacations', vacationRoutes);

// System vacation routes
const systemVacationRoutes = require('./routes/systemVacations');
app.use('/api/system-vacations', systemVacationRoutes);

// Notifications routes
const notificationRoutes = require('./routes/notifications');
app.use('/api/notifications', notificationRoutes);

// Vacation status management - check every hour
const vacationService = require('./services/vacationService');
const systemVacationService = require('./services/systemVacationService');

setInterval(async () => {
  try {
    await vacationService.updateTeacherVacationStatuses();
    await systemVacationService.checkAndRestoreExpiredSystemVacations();
  } catch (error) {
    console.error('Error in vacation status update:', error);
  }
}, 60 * 60 * 1000); // Run every hour

// Run vacation status check on startup
vacationService.updateTeacherVacationStatuses().catch(console.error);
systemVacationService.checkAndRestoreExpiredSystemVacations().catch(console.error);

// Start DST monitoring jobs
const { startScheduledJobs } = require('./jobs/timezoneJobs');
startScheduledJobs();

// Schedule dashboard precomputation job (hourly) and run once on startup
try {
  const cron = require('node-cron');
  const { recomputeDashboardStats } = require('./jobs/recomputeDashboardStats');
  // Run on the top of every hour
  cron.schedule('0 * * * *', async () => {
    try {
      await recomputeDashboardStats();
    } catch (e) { console.error('Scheduled recompute failed:', e && e.message); }
  });
  // Run once at startup (non-blocking)
  recomputeDashboardStats().catch((e) => console.warn('Initial dashboard recompute failed:', e && e.message));
} catch (e) {
  console.warn('Failed to start dashboard scheduled job:', e && e.message);
}

// Schedule recurring-classes generation job (daily at 00:05)
try {
  const cron = require('node-cron');
  const { runGenerateRecurringClasses } = require('./jobs/generateRecurringClassesJob');
  cron.schedule('5 0 * * *', async () => {
    try {
      await runGenerateRecurringClasses();
    } catch (e) { console.error('Scheduled generateRecurringClasses failed:', e && e.message); }
  });
  // Run once on startup (non-blocking) to ensure initial generation happens
  runGenerateRecurringClasses().catch((e) => console.warn('Initial generateRecurringClasses failed:', e && e.message));
} catch (e) {
  console.warn('Failed to start recurring-classes scheduled job:', e && e.message);
}

// Schedule uninvoiced lessons audit (daily at 02:15) and run once on startup
try {
  const cron = require('node-cron');
  const { runUninvoicedLessonsAudit } = require('./jobs/uninvoicedLessonsAudit');
  cron.schedule('15 2 * * *', async () => {
    try {
      await runUninvoicedLessonsAudit();
    } catch (e) { console.error('Scheduled uninvoiced-lessons audit failed:', e && e.message); }
  });
  // Run once at startup (non-blocking)
  runUninvoicedLessonsAudit().catch((e) => console.warn('Initial uninvoiced-lessons audit failed:', e && e.message));
} catch (e) {
  console.warn('Failed to schedule uninvoiced-lessons audit job:', e && e.message);
}

// Schedule mark unreported classes job (hourly)
try {
  const cron = require('node-cron');
  const { runJob: runMarkUnreportedJob } = require('./jobs/markUnreportedClassesJob');
  // Run every hour at minute 15
  cron.schedule('15 * * * *', async () => {
    try {
      await runMarkUnreportedJob();
    } catch (e) { console.error('Scheduled mark-unreported-classes job failed:', e && e.message); }
  });
  // Run once at startup (non-blocking)
  runMarkUnreportedJob().catch((e) => console.warn('Initial mark-unreported-classes job failed:', e && e.message));
} catch (e) {
  console.warn('Failed to schedule mark-unreported-classes job:', e && e.message);
}

// Schedule teacher invoice generation job (monthly on 1st at 00:05)
try {
  const cron = require('node-cron');
  const { startInvoiceGenerationJob } = require('./jobs/generateTeacherInvoicesJob');
  startInvoiceGenerationJob();
} catch (e) {
  console.warn('Failed to start teacher invoice generation job:', e && e.message);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Waraqa API is running',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  const isMulterLimit = err && (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_UNEXPECTED_FILE');
  const status = err.status || (isMulterLimit ? 413 : 500);

  // Keep logging server-side details for debugging.
  console.error('❌ Error:', err && (err.stack || err));

  if (isMulterLimit) {
    return res.status(status).json({
      message: 'File too large for upload. Please use a smaller file or increase the server upload limit.',
      error: err.code
    });
  }

  res.status(status).json({
    message: status >= 500 ? 'Something went wrong!' : err.message,
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📱 Frontend should connect to: http://localhost:${PORT}`);
});

module.exports = { app, io };