/**
 * Teacher Management Routes
 * 
 * Handles CRUD operations for teachers using the new separate model architecture
 */

const express = require("express");
const { body, validationResult } = require("express-validator");
const User = require("../models/User");
const Teacher = require("../models/Teacher");
const {
  authenticateToken,
  authorizeRoles,
  requireAdmin,
} = require("../middleware/auth");

const router = express.Router();

/**
 * Get all teachers with pagination, search, and filtering
 * GET /api/teachers
 */
router.get("/", authenticateToken, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search = "", 
      sortBy = "createdAt", 
      order = "desc",
      isActive 
    } = req.query;
    
    // Build user query for search and filtering
    const userQuery = { role: "teacher" };
    
    if (search) {
      userQuery.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    
    if (isActive !== undefined) {
      userQuery.isActive = isActive === 'true';
    }
    
    // Sort options
    const sortOptions = {};
    sortOptions[sortBy] = order === "desc" ? -1 : 1;

    // Find users first, then populate with teacher data
    const users = await User.find(userQuery)
      .select("-password")
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort(sortOptions);
    
    // Get teacher data for each user
    const teachersWithData = await Promise.all(
      users.map(async (user) => {
        const teacherData = await Teacher.findOne({ user: user._id });
        return {
          ...user.toObject(),
          teacherData: teacherData || {}
        };
      })
    );
    
    const total = await User.countDocuments(userQuery);
    
    res.json({
      teachers: teachersWithData,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
    
  } catch (error) {
    console.error("Get teachers error:", error);
    res.status(500).json({
      message: "Failed to fetch teachers",
      error: error.message,
    });
  }
});

/**
 * Get teacher by ID
 * GET /api/teachers/:id
 */
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    console.log("Fetching user with id:", req.params.id || req.body.user);

    if (!user || user.role !== "teacher") {
      return res.status(404).json({
        message: "Teacher not found",
      });
    }
    
    const teacherData = await Teacher.findOne({ user: user._id });
    
    res.json({ 
      teacher: {
        ...user.toObject(),
        teacherData: teacherData || {}
      }
    });
    
  } catch (error) {
    console.error("Get teacher error:", error);
    res.status(500).json({
      message: "Failed to fetch teacher",
      error: error.message,
    });
  }
});

/**
 * Update teacher profile
 * PUT /api/teachers/:id
 */
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Check authorization
    if (req.user.role !== "admin" && req.user._id.toString() !== id) {
      return res.status(403).json({ 
        message: "You are not authorized to update this teacher" 
      });
    }

    // Find the user
    const user = await User.findById(id);
    if (!user || user.role !== "teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    // Separate user updates from teacher-specific updates
    const userUpdates = {};
    const teacherUpdates = {};

    // Define which fields belong to User model
    const userFields = [
      'firstName', 'lastName', 'email', 'phone', 'timezone', 
      'gender', 'dateOfBirth', 'isActive'
    ];

    // Define which fields belong to Teacher model
    const teacherFields = [
      'bio', 'specialization', 'profilePhoto'
    ];

    // Admin-only fields
    const adminOnlyFields = ['bonus', 'instapay'];

    // Separate updates
    for (const [key, value] of Object.entries(updates)) {
      if (userFields.includes(key)) {
        // Only admin can update certain user fields
        if (key === 'isActive' && req.user.role !== 'admin') {
          continue;
        }
        userUpdates[key] = value;
      } else if (teacherFields.includes(key)) {
        teacherUpdates[key] = value;
      } else if (adminOnlyFields.includes(key) && req.user.role === 'admin') {
        teacherUpdates[key] = value;
      }
    }

    // Update user data
    if (Object.keys(userUpdates).length > 0) {
      await User.findByIdAndUpdate(id, userUpdates, { 
        new: true, 
        runValidators: true 
      });
    }

    // Update teacher data
    if (Object.keys(teacherUpdates).length > 0) {
      await Teacher.findOneAndUpdate(
        { user: id }, 
        teacherUpdates, 
        { new: true, runValidators: true, upsert: true }
      );
    }

    // Fetch updated data
    const updatedUser = await User.findById(id).select("-password");
    const updatedTeacherData = await Teacher.findOne({ user: id });

    res.json({
      message: "Teacher updated successfully",
      teacher: {
        ...updatedUser.toObject(),
        teacherData: updatedTeacherData || {}
      },
    });
    
  } catch (error) {
    console.error("Update teacher error:", error);
    res.status(500).json({
      message: "Failed to update teacher",
      error: error.message,
    });
  }
});

/**
 * Admin: Update teacher status (active/inactive)
 * PUT /api/teachers/:id/status
 */
router.put("/:id/status", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({ message: "isActive must be a boolean" });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { isActive },
      { new: true, runValidators: true }
    ).select("-password");

    if (!user || user.role !== "teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    const teacherData = await Teacher.findOne({ user: id });

    res.json({
      message: `Teacher status updated to ${isActive ? "active" : "inactive"}`,
      teacher: {
        ...user.toObject(),
        teacherData: teacherData || {}
      },
    });
  } catch (error) {
    console.error("Update teacher status error:", error);
    res.status(500).json({
      message: "Failed to update teacher status",
      error: error.message,
    });
  }
});

/**
 * Admin: Update teacher bonus
 * PUT /api/teachers/:id/bonus
 */
router.put("/:id/bonus", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const { bonus } = req.body;

    if (typeof bonus !== "number" || bonus < 0) {
      return res.status(400).json({ message: "Bonus must be a non-negative number" });
    }

    // Verify user is a teacher
    const user = await User.findById(id);
    if (!user || user.role !== "teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    // Update teacher bonus
    const teacherData = await Teacher.findOneAndUpdate(
      { user: id },
      { bonus },
      { new: true, runValidators: true, upsert: true }
    );

    res.json({
      message: "Teacher bonus updated successfully",
      teacher: {
        ...user.toObject(),
        teacherData
      },
    });
  } catch (error) {
    console.error("Update teacher bonus error:", error);
    res.status(500).json({
      message: "Failed to update teacher bonus",
      error: error.message,
    });
  }
});

/**
 * Admin: Add hours to teacher (for monthly tracking)
 * PUT /api/teachers/:id/hours
 */
router.put("/:id/hours", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const { hours, operation } = req.body; // operation: 'add' or 'subtract' or 'set'

    if (typeof hours !== "number") {
      return res.status(400).json({ message: "Hours must be a number" });
    }

    if (!["add", "subtract", "set"].includes(operation)) {
      return res.status(400).json({ message: "Operation must be 'add', 'subtract', or 'set'" });
    }

    // Verify user is a teacher
    const user = await User.findById(id);
    if (!user || user.role !== "teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    // Get current teacher data
    let teacherData = await Teacher.findOne({ user: id });
    if (!teacherData) {
      teacherData = new Teacher({ user: id, hoursThisMonth: 0 });
    }

    const currentHours = teacherData.hoursThisMonth || 0;
    let newHours;

    switch (operation) {
      case "add":
        newHours = currentHours + hours;
        break;
      case "subtract":
        newHours = Math.max(0, currentHours - hours); // Don't allow negative hours
        break;
      case "set":
        newHours = Math.max(0, hours); // Don't allow negative hours
        break;
    }

    teacherData.hoursThisMonth = newHours;
    await teacherData.save();

    res.json({
      message: `Teacher hours ${operation}ed successfully`,
      teacher: {
        ...user.toObject(),
        teacherData
      },
      previousHours: currentHours,
      newHours: newHours,
    });
  } catch (error) {
    console.error("Update teacher hours error:", error);
    res.status(500).json({
      message: "Failed to update teacher hours",
      error: error.message,
    });
  }
});

/**
 * Get teacher's monthly statistics
 * GET /api/teachers/:id/stats
 */
router.get("/:id/stats", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { year, month } = req.query;

    // Verify user is a teacher
    const user = await User.findById(id);
    if (!user || user.role !== "teacher") {
      return res.status(404).json({ message: "Teacher not found" });
    }

    // Check authorization (teachers can only view their own stats, admins can view any)
    if (req.user.role !== "admin" && req.user._id.toString() !== id) {
      return res.status(403).json({ 
        message: "You are not authorized to view these statistics" 
      });
    }

    const teacherData = await Teacher.findOne({ user: id });

    // TODO: Add logic to calculate monthly statistics from Class model
    // This would include classes taught, total hours, earnings, etc.
    
    const stats = {
      currentMonth: {
        hoursThisMonth: teacherData?.hoursThisMonth || 0,
        bonus: teacherData?.bonus || 0,
        instapay: teacherData?.instapay || 0,
      },
      // Add more statistics as needed
    };

    res.json({
      teacher: {
        ...user.toObject(),
        teacherData: teacherData || {}
      },
      stats
    });
  } catch (error) {
    console.error("Get teacher stats error:", error);
    res.status(500).json({
      message: "Failed to fetch teacher statistics",
      error: error.message,
    });
  }
});

module.exports = router;

