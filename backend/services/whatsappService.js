const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');

// Two admin numbers always added to every group
const ADMIN_NUMBERS = ['201203211908', '201222501445'];
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // auto-destroy after 5 min idle

let client = null;
let qrDataUrl = null;
let isReady = false;
let isInitializing = false;
let idleTimer = null;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log('[WhatsApp] Idle timeout — destroying client');
    destroy();
  }, IDLE_TIMEOUT_MS);
}

/**
 * Strip non-digits, convert leading-zero Egyptian numbers to +20 prefix.
 */
function formatPhone(phone) {
  let num = String(phone || '').replace(/\D/g, '');
  if (num.startsWith('0')) num = '20' + num.slice(1);
  return num;
}

/**
 * Start the WhatsApp Web client (if not already running).
 * Resolves with { ready: true } if session exists, or { qr } on first auth.
 */
function initialize() {
  if (client && isReady) return Promise.resolve({ ready: true });
  if (isInitializing) return Promise.resolve({ initializing: true, qr: qrDataUrl });

  isInitializing = true;
  qrDataUrl = null;

  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: path.join(__dirname, '..', 'tmp', 'wwebjs-auth')
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote'
      ],
      executablePath: process.env.CHROMIUM_PATH || undefined
    }
  });

  return new Promise((resolve) => {
    let resolved = false;
    const done = (v) => { if (!resolved) { resolved = true; resolve(v); } };

    client.on('qr', async (qr) => {
      qrDataUrl = await qrcode.toDataURL(qr);
      done({ qr: qrDataUrl });
    });

    client.on('ready', () => {
      isReady = true;
      isInitializing = false;
      qrDataUrl = null;
      resetIdleTimer();
      console.log('[WhatsApp] Client ready');
      done({ ready: true });
    });

    client.on('authenticated', () => {
      console.log('[WhatsApp] Authenticated (session restored or QR scanned)');
    });

    client.on('auth_failure', (msg) => {
      console.error('[WhatsApp] Auth failure:', msg);
      isReady = false;
      isInitializing = false;
      client = null;
      done({ error: 'Auth failed: ' + msg });
    });

    client.on('disconnected', (reason) => {
      console.log('[WhatsApp] Disconnected:', reason);
      isReady = false;
      isInitializing = false;
      client = null;
    });

    client.initialize().catch((err) => {
      console.error('[WhatsApp] Init error:', err.message);
      isInitializing = false;
      client = null;
      done({ error: err.message });
    });
  });
}

function getStatus() {
  return { ready: isReady, initializing: isInitializing, hasQr: !!qrDataUrl };
}

/**
 * Return the current QR data URL (starts client if needed).
 */
async function getQr() {
  if (isReady) return { ready: true };
  if (qrDataUrl) return { qr: qrDataUrl };
  return initialize();
}

/**
 * Create a WhatsApp group named "Waraqa: <studentName>"
 * with teacher, guardian, and the two fixed admin numbers.
 */
async function createGroup({ teacherPhone, guardianPhone, studentName }) {
  if (!isReady || !client) throw new Error('WhatsApp not connected. Scan QR first.');

  resetIdleTimer();

  const groupName = `Waraqa: ${studentName}`;

  const participants = new Set();
  if (teacherPhone) participants.add(formatPhone(teacherPhone) + '@c.us');
  if (guardianPhone) participants.add(formatPhone(guardianPhone) + '@c.us');
  ADMIN_NUMBERS.forEach((n) => participants.add(n + '@c.us'));

  const arr = [...participants];
  console.log(`[WhatsApp] Creating group "${groupName}" with ${arr.length} participants`);

  const result = await client.createGroup(groupName, arr);
  return {
    groupName,
    groupId: result.gid?._serialized || result.gid || null,
    participantsInvited: arr.length
  };
}

async function destroy() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (client) {
    try { await client.destroy(); } catch (_) { /* ignore */ }
    client = null;
  }
  isReady = false;
  isInitializing = false;
  qrDataUrl = null;
}

module.exports = { initialize, getStatus, getQr, createGroup, destroy, formatPhone };
