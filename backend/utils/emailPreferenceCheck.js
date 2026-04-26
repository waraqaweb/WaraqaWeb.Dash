/**
 * Central helper: decide whether to send an email of a given type to a given user.
 * Checks in order:
 *   1. Global role switch (from Setting model) — e.g. email.enableGuardians
 *   2. User's emailPreferences.globalEnabled (master kill-switch per user)
 *   3. User's emailPreferences[eventType] for the specific event
 */
const Setting = require('../models/Setting');
const User = require('../models/User');

// In-memory cache for global switches (refreshed every 60s)
let _globalSwitchCache = null;
let _globalSwitchCachedAt = 0;
const GLOBAL_SWITCH_TTL = 60 * 1000;

async function getGlobalSwitches() {
  const now = Date.now();
  if (_globalSwitchCache && now - _globalSwitchCachedAt < GLOBAL_SWITCH_TTL) {
    return _globalSwitchCache;
  }
  const settings = await Setting.find({
    key: { $in: ['email.enableTeachers', 'email.enableGuardians', 'email.enableAdmins', 'email.masterEnabled'] }
  }).lean();
  const map = {};
  for (const s of settings) map[s.key] = s.value;
  _globalSwitchCache = {
    masterEnabled:   map['email.masterEnabled']   !== false,
    enableTeachers:  map['email.enableTeachers']  !== false,
    enableGuardians: map['email.enableGuardians'] !== false,
    enableAdmins:    map['email.enableAdmins']    !== false,
  };
  _globalSwitchCachedAt = now;
  return _globalSwitchCache;
}

/**
 * Invalidate the global switch cache (call after admin saves settings).
 */
function invalidateGlobalSwitchCache() {
  _globalSwitchCache = null;
  _globalSwitchCachedAt = 0;
}

/**
 * Returns true if an email of eventType should be sent to userId.
 * @param {string|ObjectId} userId
 * @param {string} eventType - key from emailPreferences schema
 * @returns {Promise<boolean>}
 */
async function shouldSendEmail(userId, eventType) {
  try {
    const switches = await getGlobalSwitches();
    if (!switches.masterEnabled) return false;

    const user = await User.findById(userId).select('role emailPreferences').lean();
    if (!user || !user.emailPreferences) return true; // default allow if user not found (shouldn't happen)

    // Role-level switch
    if (user.role === 'teacher'  && !switches.enableTeachers)  return false;
    if (user.role === 'guardian' && !switches.enableGuardians) return false;
    if (user.role === 'admin'    && !switches.enableAdmins)    return false;

    const prefs = user.emailPreferences;

    // Master user kill-switch
    if (prefs.globalEnabled === false) return false;

    // Event-specific toggle (default true if key missing)
    if (eventType && Object.prototype.hasOwnProperty.call(prefs, eventType)) {
      return prefs[eventType] !== false;
    }

    return true;
  } catch (e) {
    console.error('[emailPreferenceCheck] Error checking prefs for', userId, eventType, e.message);
    return false; // fail safe: don't send if prefs can't be checked
  }
}

module.exports = { shouldSendEmail, getGlobalSwitches, invalidateGlobalSwitchCache };
