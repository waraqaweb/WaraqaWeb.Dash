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
const User = require("../models/User");
const Teacher = require("../models/Teacher");
const Guardian = require("../models/Guardian");
const Student = require("../models/Student");

const router = express.Router();

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
      .isMobilePhone()
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
        return res.status(400).json({
          message: "Validation failed",
          errors: errors.array(),
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
        });
      }

      // Hash password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Create base user
      const user = new User({
        firstName,
        lastName,
        email,
        password: hashedPassword,
        role,
        phone,
        timezone: timezone || "UTC",
        gender: gender || "male",
        dateOfBirth: dateOfBirth || null,
        isActive: true,
      });

      await user.save();

      // Create role-specific record
      let roleSpecificRecord;
      if (role === "teacher") {
        roleSpecificRecord = new Teacher({
          user: user._id,
          bonus: 0,
          instapay: 0,
          hoursThisMonth: 0,
          bio: "",
          specialization: "",
        });
        await roleSpecificRecord.save();
      } else if (role === "guardian") {
        roleSpecificRecord = new Guardian({
          user: user._id,
          students: [],
          remainingMinutes: 0,
        });
        await roleSpecificRecord.save();
      }

      // Generate token
      const token = generateToken(user._id);

      // Remove password from response
      const userResponse = user.toObject();
      delete userResponse.password;

      res.status(201).json({
        message: "User registered successfully",
        user: userResponse,
        roleData: roleSpecificRecord,
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

      // Find user by email
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(401).json({
          message: "Invalid email or password",
        });
      }

      // Check if user is active
      if (!user.isActive) {
        return res.status(403).json({
          message: "Account is deactivated. Please contact administrator.",
        });
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          message: "Invalid email or password",
        });
      }

      // Fetch role-specific data
      let roleData = null;
      if (user.role === "teacher") {
        roleData = await Teacher.findOne({ user: user._id });
      } else if (user.role === "guardian") {
        roleData = await Guardian.findOne({ user: user._id }).populate('students');
      } else if (user.role === "student") {
        roleData = await Student.findOne({ user: user._id }).populate('guardian');
      }

      // Generate token
      const token = generateToken(user._id);

      // Remove password from response
      const userResponse = user.toObject();
      delete userResponse.password;

      res.json({
        message: "Login successful",
        user: userResponse,
        roleData,
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

      // Find admin user by email
      const user = await User.findOne({ email, role: "admin" });
      if (!user) {
        return res.status(401).json({
          message: "Invalid admin credentials",
        });
      }

      // Check if admin is active
      if (!user.isActive) {
        return res.status(403).json({
          message: "Admin account is deactivated",
        });
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          message: "Invalid admin credentials",
        });
      }

      // Generate token
      const token = generateToken(user._id);

      // Remove password from response
      const userResponse = user.toObject();
      delete userResponse.password;

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
    const user = await User.findById(decoded.userId).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Fetch role-specific data
    let roleData = null;
    if (user.role === "teacher") {
      roleData = await Teacher.findOne({ user: user._id });
    } else if (user.role === "guardian") {
      roleData = await Guardian.findOne({ user: user._id }).populate('students');
    } else if (user.role === "student") {
      roleData = await Student.findOne({ user: user._id }).populate('guardian');
    }

    res.json({
      user,
      roleData,
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
 * Change password
 * PUT /api/auth/change-password
 */
router.put(
  "/change-password",
  [
    body("currentPassword")
      .notEmpty()
      .withMessage("Current password is required"),
    body("newPassword")
      .isLength({ min: 6 })
      .withMessage("New password must be at least 6 characters long"),
  ],
  async (req, res) => {
    try {
      const token = req.header("Authorization")?.replace("Bearer ", "");
      
      if (!token) {
        return res.status(401).json({ message: "No token provided" });
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const { currentPassword, newPassword } = req.body;

      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({
          message: "Current password is incorrect",
        });
      }

      // Hash new password
      const saltRounds = 12;
      const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update password
      user.password = hashedNewPassword;
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
  }
);

module.exports = router;

