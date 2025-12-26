/**
 * Authentication Routes
 * 
 * Handles user registration and login for the new separate model architecture
 * Creates corresponding Teacher/Guardian/Student records when users register
 */

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const rateLimit = require('express-rate-limit');
const User = require("../models/User");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Create a more specific rate limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 50 : 500, // 500 attempts in dev, 50 in production
  message: {
    error: 'Too many authentication attempts, please try again later.',
    retryAfter: 15 * 60 // 15 minutes in seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to login endpoints only
// Allow aggressive testing locally while keeping production protection reasonable
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 20 : 1000, // 1000 login attempts in dev, 20 in production
  // Only rate-limit failed attempts; successful logins should not consume the budget.
  skipSuccessfulRequests: true,
  message: {
    error: 'Too many login attempts, please try again later.',
    retryAfter: 15 * 60 // 15 minutes in seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const crypto = require('crypto');
const { sendMail } = require('../services/emailService');

/**
 * Generate JWT token
 */
const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || "7d" }
  );
};

/**
 * Register new user (Teacher or Guardian)
 * POST /api/auth/register
 */
router.post(
  "/register",
  authLimiter, // Apply auth rate limiter
  [
    body("firstName")
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage("First name must be between 2 and 50 characters"),
    body("lastName")
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage("Last name must be between 2 and 50 characters"),
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please provide a valid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters long"),
    body("role")
      .isIn(["teacher", "guardian"])
      .withMessage("Role must be either teacher or guardian"),
    body("phone")
      .optional()
      .trim()
      // Remove common formatting characters but preserve leading + for international numbers
      .customSanitizer((v) => (typeof v === 'string' ? v.replace(/[\s().-]/g, '') : v))
      .isMobilePhone('any')
      .withMessage("Please provide a valid phone number"),
    body("timezone")
      .optional()
      .isString()
      .withMessage("Timezone must be a valid string"),
    body("gender")
      .optional()
      .isIn(["male", "female"])
      .withMessage("Gender must be one of: male, female"),
  ],
  async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const errorArray = errors.array();
        const fieldErrors = {};
        for (const err of errorArray) {
          const field = err?.path || err?.param;
          if (!field) continue;
          if (!fieldErrors[field]) fieldErrors[field] = err.msg;
        }
        return res.status(400).json({
          message: "Validation failed",
          errors: errorArray,
          fieldErrors,
        });
      }

      const {
        firstName,
        lastName,
        email,
        password,
        role,
        phone,
        timezone,
        gender,
        dateOfBirth,
      } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(409).json({
          message: "User with this email already exists",
          errors: [{ path: 'email', msg: 'User with this email already exists' }],
          fieldErrors: { email: 'User with this email already exists' },
        });
      }

      // Create base user
      // IMPORTANT: Do NOT hash password here. It's handled by the pre-save hook in User model.
      const user = new User({
        firstName,
        lastName,
        email,
        password, // Pass plain text password
        role,
        phone,
        timezone: timezone || "UTC",
        gender: gender || "male",
        dateOfBirth: dateOfBirth || null,
        isActive: true,
      });

      await user.save(); // Password will be hashed by the pre('save') hook here

      // --- Notification triggers ---
      const notificationService = require('../services/notificationService');
      // Notify admin(s) and user
      notificationService.notifyNewUser(user).catch(console.error);
      // Optionally, check for incomplete profile and send reminder
      if (!user.phone || !user.timezone || !user.gender || !user.dateOfBirth) {
        notificationService.notifyProfileIncomplete(user).catch(console.error);
      }
      // Update lastLogin timestamp
      try {
        user.lastLogin = new Date();
        await user.save();
        console.log('Updated lastLogin for user', user.email);
      } catch (e) {
        console.warn('Failed to update lastLogin for user', user.email, e && e.message);
      }

      // Generate token
      const token = generateToken(user._id);

      // Remove password from response
      const userResponse = user.toObject();
      delete userResponse.password;

      res.status(201).json({
        message: "User registered successfully",
        user: userResponse,
        token,
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({
        message: "Registration failed",
        error: error.message,
      });
    }
  }
);

/**
 * Login user (Teacher, Guardian, or Student)
 * POST /api/auth/login
 */
router.post(
  "/login",
  loginLimiter, // Apply login rate limiter
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please provide a valid email"),
    body("password")
      .notEmpty()
      .withMessage("Password is required"),
  ],
  async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { email, password } = req.body;

      // Find user by email and EXPLICITLY SELECT PASSWORD
      const user = await User.findOne({ email }).select("+password");
      console.log("Login attempt for email:", email);
      console.log("User found:", user ? user.email : "No user found");
      console.log("User password hash from DB:", user ? user.password : "N/A");

      if (!user) {
        console.log("Login failed: User not found");
        return res.status(401).json({
          message: "Invalid email or password",
        });
      }

      // Check if user is active
      if (!user.isActive) {
        console.log("Login failed: Account deactivated for user", user.email);
        return res.status(403).json({
          message: "Account is deactivated. Please contact administrator.",
        });
      }

      // Verify password using the method on the user schema
      const isPasswordValid = await user.comparePassword(password);
      console.log("Password comparison result:", isPasswordValid);

      if (!isPasswordValid) {
        // Increment login attempts if password is invalid
        await user.incLoginAttempts();
        console.log("Login failed: Invalid password for user", user.email);
        return res.status(401).json({
          message: "Invalid email or password",
        });
      }

      // Reset login attempts on successful login
      if (user.loginAttempts > 0) {
        await user.resetLoginAttempts();
        console.log("Login successful: Login attempts reset for user", user.email);
      }

      // Check if account is locked
      if (user.isLocked) {
        console.log("Login failed: Account locked for user", user.email);
        return res.status(403).json({
          message: `Account locked until ${new Date(user.lockUntil).toLocaleString()}. Please try again later.`, 
        });
      }

      // Update lastLogin timestamp for admin
      try {
        user.lastLogin = new Date();
        await user.save();
        console.log('Updated lastLogin for admin', user.email);
      } catch (e) {
        console.warn('Failed to update lastLogin for admin', user.email, e && e.message);
      }

      // Generate token
      const token = generateToken(user._id);

      // Remove password from response
      const userResponse = user.toObject();
      delete userResponse.password;

      console.log("Login successful for user:", user.email);
      res.json({
        message: "Login successful",
        user: userResponse,
        token,
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({
        message: "Login failed",
        error: error.message,
      });
    }
  }
);

/**
 * Admin login (separate endpoint for security)
 * POST /api/auth/admin/login
 */
router.post(
  "/admin/login",
  loginLimiter, // Apply login rate limiter
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please provide a valid email"),
    body("password")
      .notEmpty()
      .withMessage("Password is required"),
  ],
  async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { email, password } = req.body;

      // Find admin user by email and EXPLICITLY SELECT PASSWORD
      const user = await User.findOne({ email, role: "admin" }).select("+password");
      console.log("Admin Login attempt for email:", email);
      console.log("Admin User found:", user ? user.email : "No admin user found");
      console.log("Admin User password hash from DB:", user ? user.password : "N/A");

      if (!user) {
        console.log("Admin Login failed: Admin user not found");
        return res.status(401).json({
          message: "Invalid admin credentials",
        });
      }

      // Check if admin is active
      if (!user.isActive) {
        console.log("Admin Login failed: Admin account deactivated for user", user.email);
        return res.status(403).json({
          message: "Admin account is deactivated",
        });
      }

      // Verify password
      const isPasswordValid = await user.comparePassword(password);
      console.log("Admin Password comparison result:", isPasswordValid);

      if (!isPasswordValid) {
        // Increment login attempts if password is invalid
        await user.incLoginAttempts();
        console.log("Admin Login failed: Invalid password for admin user", user.email);
        return res.status(401).json({
          message: "Invalid admin credentials",
        });
      }

      // Reset login attempts on successful login
      if (user.loginAttempts > 0) {
        await user.resetLoginAttempts();
        console.log("Admin Login successful: Login attempts reset for admin user", user.email);
      }

      // Check if account is locked
      if (user.isLocked) {
        console.log("Admin Login failed: Account locked for user", user.email);
        return res.status(403).json({
          message: `Admin account locked until ${new Date(user.lockUntil).toLocaleString()}. Please try again later.`, 
        });
      }

      // Generate token
      const token = generateToken(user._id);

      // Remove password from response
      const userResponse = user.toObject();
      delete userResponse.password;

      console.log("Admin Login successful for user:", user.email);
      res.json({
        message: "Admin login successful",
        user: userResponse,
        token,
      });
    } catch (error) {
      console.error("Admin login error:", error);
      res.status(500).json({
        message: "Admin login failed",
        error: error.message,
      });
    }
  }
);

/**
 * Get current user profile
 * GET /api/auth/me
 */
router.get("/me", async (req, res) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");
    
    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("-password"); // Do NOT select password here

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      user,
    });
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(401).json({
      message: "Invalid token",
      error: error.message,
    });
  }
});

/**
 * Logout current user (JWT-based)
 * POST /api/auth/logout
 * Simply acknowledges logout so client can clear local session/token.
 */
router.post("/logout", authenticateToken, async (req, res) => {
  try {
    // Stateless JWT logout: client discards token; optionally track audit info here.
    res.json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ message: "Logout failed", error: error.message });
  }
});

const changePasswordValidators = [
  body("currentPassword")
    .notEmpty()
    .withMessage("Current password is required"),
  body("newPassword")
    .isLength({ min: 6 })
    .withMessage("New password must be at least 6 characters long"),
];

const changePasswordHandler = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const token = req.header("Authorization")?.replace("Bearer ", "");
    
    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("+password"); // Select password to compare

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { currentPassword, newPassword } = req.body;

    // Verify current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        message: "Current password is incorrect",
      });
    }

    // Hash new password (pre-save hook will handle this)
    user.password = newPassword; // Assign plain text, pre-save hook hashes
    await user.save();

    res.json({
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({
      message: "Failed to change password",
      error: error.message,
    });
  }
};

/**
 * Change password
 * PUT/POST /api/auth/change-password
 */
router.put("/change-password", changePasswordValidators, changePasswordHandler);
router.post("/change-password", changePasswordValidators, changePasswordHandler);


/**
 * Forgot password
 * POST /api/auth/forgot-password
 * Body: { email }
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const user = await User.findOne({ email });
    if (!user) return res.status(200).json({ message: 'If an account exists for this email, a reset link has been sent.' });

    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = token;
    user.passwordResetExpires = Date.now() + 1000 * 60 * 60; // 1 hour
    await user.save();

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}&id=${user._id}`;
    const html = `<p>Hello ${user.firstName || ''},</p>
      <p>You requested to reset your password. Click the link below to set a new password. This link will expire in one hour.</p>
      <p><a href="${resetUrl}">Reset Password</a></p>
      <p>If you did not request this, please ignore this email.</p>`;

    try {
      await sendMail({ to: user.email, subject: 'Reset your password', html, text: `Reset your password: ${resetUrl}` });
    } catch (mailErr) {
      console.error('Failed to send reset email', mailErr);
    }

    res.json({ message: 'If an account exists for this email, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error', err);
    res.status(500).json({ message: 'Failed to process request' });
  }
});

/**
 * Reset password
 * POST /api/auth/reset-password
 * Body: { id, token, newPassword }
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { id, token, newPassword } = req.body;
    if (!id || !token || !newPassword) return res.status(400).json({ message: 'Missing required fields' });

    const user = await User.findById(id).select('+passwordResetToken +passwordResetExpires');
    if (!user) return res.status(400).json({ message: 'Invalid token or user' });

    if (!user.passwordResetToken || user.passwordResetToken !== token || !user.passwordResetExpires || user.passwordResetExpires < Date.now()) {
      return res.status(400).json({ message: 'Reset token is invalid or has expired' });
    }

    // Set new password (pre-save hook will hash)
    user.password = newPassword;
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();

    res.json({ message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Reset password error', err);
    res.status(500).json({ message: 'Failed to reset password' });
  }
});

// Export router
module.exports = router;
