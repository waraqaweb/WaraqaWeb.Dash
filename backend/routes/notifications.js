const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const notificationService = require('../services/notificationService');


// Get recent notifications for the logged-in user (limit 20)
router.get('/recent', requireAuth, async (req, res) => {
  try {
    const notifications = await notificationService.getRecentNotifications(req.user._id, 20);
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch notifications', error: err.message });
  }
});

// Get unread notification count for the logged-in user
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    const count = await notificationService.getUnreadCount(req.user._id);
    res.json({ count });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch unread count', error: err.message });
  }
});

// Get all notifications and unread count (legacy, for compatibility)
router.get('/', requireAuth, async (req, res) => {
  try {
    const notifications = await notificationService.getRecentNotifications(req.user._id, 50);
    const unreadCount = await notificationService.getUnreadCount(req.user._id);
    res.json({ notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch notifications', error: err.message });
  }
});

// Mark notifications as read
router.post('/mark-read', requireAuth, async (req, res) => {
  try {
    const { notificationIds } = req.body;
    await notificationService.markNotificationsAsRead(req.user._id, notificationIds);
    res.json({ message: 'Notifications marked as read' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to mark notifications as read' });
  }
});

// Delete a notification
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await notificationService.deleteNotification(req.user._id, id);
    if (!result.deletedCount) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    res.json({ message: 'Notification deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete notification', error: err.message });
  }
});

module.exports = router;