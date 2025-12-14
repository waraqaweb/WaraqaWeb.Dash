const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');
const Analytics = require('../models/Analytics');

// Dismiss onboarding (marks both local dismissal and server-side flag)
router.post('/dismiss', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    await User.findByIdAndUpdate(userId, { 'onboarding.dismissedAt': new Date() });
    res.json({ message: 'Onboarding dismissed' });
  } catch (err) {
    console.error('Onboarding dismiss error', err);
    res.status(500).json({ message: 'Failed to dismiss onboarding' });
  }
});

// Track onboarding analytics events
router.post('/event', authenticateToken, async (req, res) => {
  try {
    const { eventType, payload } = req.body;
    await Analytics.create({ user: req.user.id, eventType, payload });
    res.json({ message: 'Event recorded' });
  } catch (err) {
    console.error('Onboarding event error', err);
    res.status(500).json({ message: 'Failed to record event' });
  }
});

module.exports = router;
