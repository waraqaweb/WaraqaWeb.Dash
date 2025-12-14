/**
 * Authentication Middleware
 * 
 * This middleware handles:
 * - JWT token verification
 * - User authentication
 * - Role-based access control
 * - Admin, Teacher, Guardian, and Student access protection
 * - Optional authentication
 */

const jwt = require("jsonwebtoken");
const User = require("../models/User");

/**
 * Verify JWT token and authenticate user
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        message: "Access token required",
        error: "NO_TOKEN"
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("-password");

    if (!user) {
      return res.status(401).json({
        message: "Invalid token - user not found",
        error: "USER_NOT_FOUND"
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        message: "Account is deactivated",
        error: "ACCOUNT_DEACTIVATED"
      });
    }

    if (user.isLocked) {
      return res.status(401).json({
        message: "Account is temporarily locked",
        error: "ACCOUNT_LOCKED"
      });
    }

    req.user = user;
    next();

  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        message: "Invalid token",
        error: "INVALID_TOKEN"
      });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        message: "Token expired",
        error: "TOKEN_EXPIRED"
      });
    }

    console.error("Auth middleware error:", error);
    res.status(500).json({
      message: "Authentication error",
      error: "AUTH_ERROR"
    });
  }
};

/**
 * Optional authentication - doesn't fail if no token
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select("-password");

      if (user && user.isActive && !user.isLocked) {
        req.user = user;
      }
    }

    next();
  } catch (error) {
    // Ignore token errors for optional auth
    next();
  }
};

/**
 * Check if user has required role(s)
 */
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        message: "Authentication required",
        error: "NOT_AUTHENTICATED"
      });
    }

    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Insufficient permissions",
        error: "INSUFFICIENT_PERMISSIONS",
        required: allowedRoles,
        current: req.user.role
      });
    }

    next();
  };
};

// Predefined role middlewares
const requireAdmin = requireRole("admin");
const requireTeacher = requireRole("teacher");
const requireTeacherOrAdmin = requireRole(["teacher", "admin"]);
const requireGuardianOrAdmin = requireRole(["guardian", "admin"]);

/**
 * Role-based route protection
 */
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "You are not authorized to access this route" });
    }
    next();
  };
};

/**
 * Require student access (students or their guardians)
 */
const requireStudentAccess = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      message: "Authentication required",
      error: "NOT_AUTHENTICATED"
    });
  }

  if (req.user.role === "admin" || req.user.role === "student") {
    return next();
  }

  if (req.user.role === "guardian") {
    const studentId = req.params.studentId || req.body.studentId;

    if (studentId) {
      try {
        const student = await User.findById(studentId);

        if (!student || student.role !== "student") {
          return res.status(404).json({
            message: "Student not found",
            error: "STUDENT_NOT_FOUND"
          });
        }

        if (student.studentInfo.guardianId.toString() !== req.user._id.toString()) {
          return res.status(403).json({
            message: "Access denied - not your student",
            error: "NOT_YOUR_STUDENT"
          });
        }
      } catch (error) {
        return res.status(500).json({
          message: "Error verifying student access",
          error: "VERIFICATION_ERROR"
        });
      }
    }

    return next();
  }

  return res.status(403).json({
    message: "Insufficient permissions",
    error: "INSUFFICIENT_PERMISSIONS"
  });
};

/**
 * Resource-specific access control
 */
const requireResourceAccess = (resourceType) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        message: "Authentication required",
        error: "NOT_AUTHENTICATED"
      });
    }

    if (req.user.role === "admin") {
      return next();
    }

    const resourceId = req.params.id;

    try {
      let resource;

      switch (resourceType) {
        case "class":
          const Class = require("../models/Class");
          resource = await Class.findById(resourceId);

          if (!resource) {
            return res.status(404).json({ message: "Class not found", error: "RESOURCE_NOT_FOUND" });
          }

          if (req.user.role === "teacher" && resource.teacher.toString() === req.user._id.toString()) {
            return next();
          }

          if (req.user.role === "student") {
            const isEnrolled = resource.students.some(
              s => s.student.toString() === req.user._id.toString() && s.status === "enrolled"
            );
            if (isEnrolled) return next();
          }

          if (req.user.role === "guardian") {
            const guardianStudents = await User.find({
              role: "student",
              "studentInfo.guardianId": req.user._id
            });

            const studentIds = guardianStudents.map(s => s._id.toString());
            const hasAccess = resource.students.some(
              s => studentIds.includes(s.student.toString()) && s.status === "enrolled"
            );

            if (hasAccess) return next();
          }

          break;

        case "user":
          resource = await User.findById(resourceId);

          if (!resource) {
            return res.status(404).json({ message: "User not found", error: "RESOURCE_NOT_FOUND" });
          }

          if (resource._id.toString() === req.user._id.toString()) {
            return next();
          }

          if (req.user.role === "guardian" &&
            resource.role === "student" &&
            resource.studentInfo.guardianId.toString() === req.user._id.toString()) {
            return next();
          }

          break;

        default:
          return res.status(400).json({ message: "Invalid resource type", error: "INVALID_RESOURCE_TYPE" });
      }

      return res.status(403).json({ message: "Access denied to this resource", error: "RESOURCE_ACCESS_DENIED" });
    } catch (error) {
      console.error("Resource access check error:", error);
      return res.status(500).json({
        message: "Error checking resource access",
        error: "ACCESS_CHECK_ERROR"
      });
    }
  };
};

module.exports = {
  authenticateToken,
  requireAuth: authenticateToken,
  optionalAuth,
  requireRole,
  requireAdmin,
  requireTeacher,
  requireTeacherOrAdmin,
  requireGuardianOrAdmin,
  requireStudentAccess,
  requireResourceAccess,
  authorizeRoles
};
