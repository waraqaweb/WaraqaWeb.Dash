// middleware/impersonate.js

const jwt = require('jsonwebtoken');
const User = require('../models/User');

const impersonate = async (req, res) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only admins can impersonate users' });
  }

  try {
    const targetUser = await User.findById(req.params.id).select('-password');
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!targetUser.isActive || targetUser.isLocked) {
      return res.status(403).json({ message: 'Cannot impersonate inactive or locked user' });
    }

    const token = jwt.sign({ userId: targetUser._id }, process.env.JWT_SECRET, {
      expiresIn: '7d'
    });

    res.json({
      message: `Logged in as ${targetUser.firstName || targetUser.name}`,
      user: targetUser,
      token
    });
  } catch (error) {
    console.error('Impersonation error:', error);
    res.status(500).json({ message: 'Failed to impersonate user', error: error.message });
  }
};

module.exports = impersonate;
