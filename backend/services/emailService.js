/**
 * emailService.js — central email sending & queue service.
 * SMTP config loaded from MongoDB Setting (admin-configurable) with env-var fallback.
 * MongoDB-backed queue (EmailQueue) with priority tiers.
 * All templates use baseEmailTemplate() for consistent branding.
 * Every template returns { subject, html, text } — text is WhatsApp-ready plain text.
 */
const nodemailer = require('nodemailer');
const Setting    = require('../models/Setting');
const EmailQueue = require('../models/EmailQueue');
const EmailLog   = require('../models/EmailLog');
const { decryptSMTPPass } = require('../utils/emailCrypto');
require('dotenv').config();

// ─── Branding cache ─────────────────────────────────────────────────────────
let _brandingCache    = null;
let _brandingCachedAt = 0;
const BRANDING_TTL    = 5 * 60 * 1000;

async function loadBrandingAndLogo() {
  const now = Date.now();
  if (_brandingCache && now - _brandingCachedAt < BRANDING_TTL) return _brandingCache;
  try {
    const s = await Setting.findOne({ key: 'branding' }).lean();
    const b = s?.value || {};
    _brandingCache = {
      title:   b.title   || 'Waraqa',
      slogan:  b.slogan  || '',
      logoUrl: b.logo?.url || b.logo?.dataUri || null,
    };
    _brandingCachedAt = now;
  } catch {
    _brandingCache = { title: 'Waraqa', slogan: '', logoUrl: null };
  }
  return _brandingCache;
}

function invalidateBrandingCache() {
  _brandingCache    = null;
  _brandingCachedAt = 0;
}

// ─── SMTP config (DB-first, env fallback) ────────────────────────────────────
async function loadSMTPConfig() {
  try {
    const keys = [
      'email.smtpHost', 'email.smtpPort', 'email.smtpUser',
      'email.smtpPass', 'email.smtpFrom', 'email.smtpFromName', 'email.smtpSecure',
    ];
    const docs = await Setting.find({ key: { $in: keys } }).lean();
    const m = {};
    for (const d of docs) m[d.key] = d.value;
    return {
      host:     m['email.smtpHost']     || process.env.SMTP_HOST     || '',
      port:     parseInt(m['email.smtpPort'] || process.env.SMTP_PORT || '587', 10),
      user:     m['email.smtpUser']     || process.env.SMTP_USER     || '',
      pass:     m['email.smtpPass']     ? decryptSMTPPass(m['email.smtpPass'])     : (process.env.SMTP_PASS || ''),
      from:     m['email.smtpFrom']     || process.env.EMAIL_FROM     || 'no-reply@waraqa.local',
      fromName: m['email.smtpFromName'] || process.env.EMAIL_FROM_NAME || 'Waraqa',
      secure:   m['email.smtpSecure']   === true,
    };
  } catch (e) {
    console.warn('[EmailService] Failed to load SMTP config from DB:', e.message);
    return {
      host: process.env.SMTP_HOST || '', port: parseInt(process.env.SMTP_PORT || '587', 10),
      user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '',
      from: process.env.EMAIL_FROM || 'no-reply@waraqa.local',
      fromName: process.env.EMAIL_FROM_NAME || 'Waraqa', secure: false,
    };
  }
}

// ─── Core sendMail ───────────────────────────────────────────────────────────
async function sendMail({ to, subject, html, text, attachments }) {
  const cfg = await loadSMTPConfig();
  if (!cfg.host) throw new Error('SMTP host not configured. Go to Settings → Email to configure it.');
  const transporter = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: (cfg.user && cfg.pass) ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.from}>` : cfg.from;
  return transporter.sendMail({ from, to, subject, html, text, attachments });
}

// ─── Queue helpers ────────────────────────────────────────────────────────────
async function enqueueEmail({ to, subject, html, text, type = 'other', userId, relatedId, priority = 2, attachments }) {
  try {
    await EmailQueue.create({
      to, subject, html, text, type, userId, relatedId, priority,
      attachments: attachments ? JSON.stringify(attachments) : undefined,
      status: 'pending', scheduledAt: new Date(),
    });
  } catch (e) {
    console.error('[EmailService] Failed to enqueue email:', e.message);
  }
}

const PRIORITY_GAP = { 1: 0, 2: 2000, 3: 5000 };
let _lastSentAt  = 0;
let _processing  = false;

async function processEmailQueue() {
  if (_processing) return;
  _processing = true;
  try {
    const item = await EmailQueue.findOneAndUpdate(
      { status: 'pending', scheduledAt: { $lte: new Date() } },
      { status: 'processing' },
      { sort: { priority: 1, scheduledAt: 1 }, new: true }
    );
    if (!item) return;

    const gap     = PRIORITY_GAP[item.priority] ?? 2000;
    const elapsed = Date.now() - _lastSentAt;
    if (gap > 0 && elapsed < gap) {
      await EmailQueue.updateOne({ _id: item._id }, { status: 'pending' });
      return;
    }

    const attachments = item.attachments ? (() => { try { return JSON.parse(item.attachments); } catch { return undefined; } })() : undefined;
    try {
      await sendMail({ to: item.to, subject: item.subject, html: item.html, text: item.text, attachments });
      _lastSentAt     = Date.now();
      item.status     = 'sent';
      item.processedAt = new Date();
      await item.save();
      await EmailLog.create({ to: item.to, subject: item.subject, type: item.type, status: 'sent', userId: item.userId, relatedId: item.relatedId, sentAt: new Date() });
    } catch (sendErr) {
      item.attempts = (item.attempts || 0) + 1;
      if (item.attempts >= (item.maxAttempts || 3)) {
        item.status = 'failed';
        item.error  = sendErr.message;
        await item.save();
        await EmailLog.create({ to: item.to, subject: item.subject, type: item.type, status: 'failed', userId: item.userId, relatedId: item.relatedId, error: sendErr.message });
      } else {
        item.status = 'pending';
        item.error  = sendErr.message;
        await item.save();
      }
      console.error(`[EmailService] Send failed (attempt ${item.attempts}):`, sendErr.message);
    }
  } catch (e) {
    console.error('[EmailService] Queue processor error:', e.message);
  } finally {
    _processing = false;
  }
}

let _queueInterval = null;
function initEmailQueueProcessor() {
  if (_queueInterval) return;
  _queueInterval = setInterval(processEmailQueue, 5000);
  console.log('[EmailService] Email queue processor started');
}

// ─── BASE HTML TEMPLATE ───────────────────────────────────────────────────────
/**
 * Islamic geometric decoration SVG — subtle repeating diamond/lattice pattern strip.
 * Pure inline SVG, renders in all major email clients that support HTML.
 */
function _islamicBorder() {
  // A row of 8-pointed star / diamond motifs as a thin decoration strip
  return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="18" viewBox="0 0 560 18" style="display:block;margin:0 auto;" aria-hidden="true">
  <defs>
    <pattern id="ip" x="0" y="0" width="28" height="18" patternUnits="userSpaceOnUse">
      <!-- diamond -->
      <polygon points="14,1 25,9 14,17 3,9" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>
      <!-- inner diamond -->
      <polygon points="14,5 19,9 14,13 9,9" fill="rgba(255,255,255,0.18)"/>
      <!-- corner dots -->
      <circle cx="0" cy="9" r="1.2" fill="rgba(255,255,255,0.3)"/>
      <circle cx="28" cy="9" r="1.2" fill="rgba(255,255,255,0.3)"/>
    </pattern>
  </defs>
  <rect width="560" height="18" fill="url(#ip)"/>
</svg>`;
}

function baseEmailTemplate({ preheader = '', body, icon = '', footerNote = '', branding = {} }) {
  const title   = branding.title   || 'Waraqa';
  const logoUrl = branding.logoUrl || null;
  const year    = new Date().getFullYear();
  const BRAND   = '#2C736C';
  const BRAND2  = '#235c56';
  const dashUrl = `${(process.env.FRONTEND_URL || 'https://dashboard.waraqaweb.com').replace(/\/$/, '')}/dashboard`;

  // Icon shown inside the header — white stroke so it reads on dark teal background
  const headerIcon = icon
    ? `<div style="margin:0 auto 8px;line-height:0;">${icon}</div>`
    : '';

  const headerLogoSection = logoUrl
    ? `<img src="${logoUrl}" alt="${title}" style="height:48px;max-width:160px;display:inline-block;margin-bottom:4px;filter:brightness(0) invert(1) opacity(0.93);">`
    : `<div style="width:44px;height:44px;background:rgba(255,255,255,0.16);border:2px solid rgba(255,255,255,0.35);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:4px;font-size:20px;color:white;font-weight:800;">${title.charAt(0).toUpperCase()}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#eef4f3;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#1a2e2c;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#eef4f3;">${preheader}</div>` : ''}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef4f3;padding:28px 12px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

      <!-- ══ HEADER ══ -->
      <tr><td style="background:linear-gradient(135deg,${BRAND} 0%,${BRAND2} 100%);border-radius:14px 14px 0 0;padding:22px 36px 10px;text-align:center;">
        ${headerLogoSection}
        <div style="color:rgba(255,255,255,0.9);font-size:20px;font-weight:700;letter-spacing:0.3px;margin-bottom:8px;">${title}</div>
        ${headerIcon}
        ${_islamicBorder()}
      </td></tr>

      <!-- ══ BODY ══ -->
      <tr><td style="background:#ffffff;padding:28px 36px 22px;border-left:1px solid #d4e8e5;border-right:1px solid #d4e8e5;">
        ${body}
      </td></tr>

      <!-- ══ FOOTER ══ -->
      <tr><td style="background:#f3f9f8;border:1px solid #d4e8e5;border-top:none;border-radius:0 0 14px 14px;padding:16px 36px;text-align:center;">
        ${footerNote ? `<p style="margin:0 0 8px;font-size:13px;color:#4b7571;">${footerNote}</p>` : ''}
        <p style="margin:0 0 4px;font-size:12px;color:#6b9e9a;">
          <a href="${dashUrl}" style="color:${BRAND};text-decoration:none;font-weight:600;">Open Dashboard</a>
          &nbsp;&middot;&nbsp; &copy; ${year} ${title}. All rights reserved.
        </p>
        <p style="margin:0;font-size:11px;color:#9bbfbc;">Automated notification &mdash; do not reply.</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ─── Shared HTML snippets ─────────────────────────────────────────────────────
const _B = '#2C736C';

function _infoRow(label, value) {
  return `<tr><td style="padding:7px 0;color:#6b7280;font-size:13px;width:38%;vertical-align:top;">${label}</td><td style="padding:7px 0;font-size:14px;font-weight:600;color:#111827;">${value || '—'}</td></tr>`;
}
function _infoTable(rows) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0;">${rows}</table>`;
}
function _card(content) {
  return `<div style="background:#f8fafa;border:1px solid #d1e0de;border-radius:8px;padding:18px 20px;margin:14px 0;">${content}</div>`;
}
function _btn(label, url) {
  return `<div style="text-align:center;margin:22px 0;"><a href="${url}" style="display:inline-block;background:${_B};color:white;text-decoration:none;padding:11px 30px;border-radius:6px;font-size:14px;font-weight:600;">${label}</a></div>`;
}
function _alert(msg, bg = '#fffbeb', border = '#f59e0b', txt = '#92400e') {
  return `<div style="background:${bg};border-left:4px solid ${border};border-radius:4px;padding:12px 14px;margin:14px 0;font-size:13px;color:${txt};">${msg}</div>`;
}
function _hi(firstName) {
  return `<p style="margin:0 0 14px;font-size:15px;">Hi <strong>${firstName || 'there'}</strong>,</p>`;
}

// ─── Timezone helpers ─────────────────────────────────────────────────────────
function formatInTimezone(date, tz) {
  try {
    const d = new Date(date);
    // Date part: "12 Apr 2025"
    const datePart = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || 'UTC', day: '2-digit', month: 'short', year: 'numeric',
    }).format(d);
    // Time part: "3:45 PM"
    const timePart = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'UTC', hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(d);
    return `${datePart} · ${timePart}`;
  } catch { return new Date(date).toLocaleString(); }
}
function _tzLabel(tz) { return tz ? tz.replace(/_/g, ' ') : 'UTC'; }
function _dateOnly(date, tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
  } catch { return new Date(date).toDateString(); }
}
function _dashUrl(path = '') {
  return `${(process.env.FRONTEND_URL || 'https://dashboard.waraqaweb.com').replace(/\/$/, '')}/dashboard${path}`;
}

// ─── SVG Icons — hand-drawn sketch style, white stroke for header use ────────
// All icons use white stroke so they render cleanly on the teal header background.
// stroke-width 2.2 + round caps/joins gives the soft hand-drawn outline feel.
const W = 'rgba(255,255,255,0.88)';  // icon stroke color (header)
const SZ = 'width="34" height="34" viewBox="0 0 24 24"';
const STYLE = `fill="none" stroke="${W}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;

const _ICONS = {
  // Calendar with checkmark — class confirmed
  classCreated:    `<svg xmlns="http://www.w3.org/2000/svg" ${SZ} ${STYLE}><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M9 16l2 2 4-4"/></svg>`,
  // Calendar with X — cancelled
  classCancelled:  `<svg xmlns="http://www.w3.org/2000/svg" ${SZ} ${STYLE}><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M10 14l4 4M14 14l-4 4"/></svg>`,
  // Calendar with arrow — rescheduled
  classRescheduled:`<svg xmlns="http://www.w3.org/2000/svg" ${SZ} ${STYLE}><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 16c1-2 5-2 6 0s5 2 6 0"/><polyline points="18 13 20 16 17 16"/></svg>`,
  // Open book — welcome/registration
  registration:    `<svg xmlns="http://www.w3.org/2000/svg" ${SZ} ${STYLE}><path d="M2 4c3-1 6 0 8 2 2-2 5-3 8-2v14c-3-1-6 0-8 2-2-2-5-3-8-2V4z"/><line x1="12" y1="6" x2="12" y2="20"/></svg>`,
  // Document with lines — invoice
  invoice:         `<svg xmlns="http://www.w3.org/2000/svg" ${SZ} ${STYLE}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/></svg>`,
  // Card / payment
  payment:         `<svg xmlns="http://www.w3.org/2000/svg" ${SZ} ${STYLE}><rect x="2" y="5" width="20" height="14" rx="3"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="9" y2="15"/></svg>`,
  // Bell / alert
  alert:           `<svg xmlns="http://www.w3.org/2000/svg" ${SZ} ${STYLE}><path d="M10 5a2 2 0 0 1 4 0 7 7 0 0 1 1 3.5V13l2 2H7l2-2V8.5A7 7 0 0 1 10 5z"/><path d="M9 17a3 3 0 0 0 6 0"/></svg>`,
  // Chat bubble — meeting
  meeting:         `<svg xmlns="http://www.w3.org/2000/svg" ${SZ} ${STYLE}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="13" x2="12" y2="13"/></svg>`,
  // Airplane / travel — vacation
  vacation:        `<svg xmlns="http://www.w3.org/2000/svg" ${SZ} ${STYLE}><path d="M21 16l-9-9-8 4 2 2-2 4 4-2 2 2 4-8z"/><line x1="3" y1="21" x2="8" y2="16"/></svg>`,
  // Pulse / waveform — performance
  performance:     `<svg xmlns="http://www.w3.org/2000/svg" ${SZ} ${STYLE}><polyline points="2 12 6 12 9 4 13 20 16 12 18 12 22 12"/></svg>`,
  // Bar chart — report
  report:          `<svg xmlns="http://www.w3.org/2000/svg" ${SZ} ${STYLE}><rect x="3" y="12" width="4" height="8" rx="1"/><rect x="10" y="7" width="4" height="13" rx="1"/><rect x="17" y="3" width="4" height="17" rx="1"/></svg>`,
  // Swap arrows — reassigned
  reassigned:      `<svg xmlns="http://www.w3.org/2000/svg" ${SZ} ${STYLE}><path d="M4 7h14M4 7l3-3M4 7l3 3"/><path d="M20 17H6M20 17l-3-3M20 17l-3 3"/></svg>`,
  // Person with X — absent
  absent:          `<svg xmlns="http://www.w3.org/2000/svg" ${SZ} ${STYLE}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="20" y1="8" x2="23" y2="11"/><line x1="23" y1="8" x2="20" y2="11"/></svg>`,
  // Slash circle — series cancelled
  seriesCancelled: `<svg xmlns="http://www.w3.org/2000/svg" ${SZ} ${STYLE}><circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/></svg>`,
  // Clock — availability
  availability:    `<svg xmlns="http://www.w3.org/2000/svg" ${SZ} ${STYLE}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>`,
  // Star — bonus
  bonus:           `<svg xmlns="http://www.w3.org/2000/svg" ${SZ} ${STYLE}><polygon points="12 2 15 8.5 22 9.5 17 14 18.5 21 12 18 5.5 21 7 14 2 9.5 9 8.5 12 2"/></svg>`,
  // Checklist — admin monthly report
  adminReport:     `<svg xmlns="http://www.w3.org/2000/svg" ${SZ} ${STYLE}><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 9h8M8 13h5"/><path d="M8 17l1.5 1.5L13 15"/></svg>`,
};

// ─── TEMPLATE BUILDERS ────────────────────────────────────────────────────────

function buildClassCreatedEmail({ recipient, classObj, student, role, lastTopic, branding }) {
  const tz      = recipient.timezone || 'Africa/Cairo';
  const dateStr = classObj.scheduledDate ? formatInTimezone(classObj.scheduledDate, tz) : 'TBD';
  const subj    = classObj.courseName || classObj.subject || 'New Class';
  const dur     = classObj.durationMinutes ? `${classObj.durationMinutes} min` : '';
  const recur   = classObj.recurrence?.type && classObj.recurrence.type !== 'none' ? `Every ${classObj.recurrence.type}` : 'Single session';
  const link    = classObj.meetingLink || classObj.link || '';

  let rows  = _infoRow('Student', student?.firstName ? `${student.firstName} ${student.lastName || ''}`.trim() : 'N/A');
  rows     += _infoRow('Subject', subj);
  rows     += _infoRow('Date & Time', `${dateStr} (${_tzLabel(tz)})`);
  if (dur)  rows += _infoRow('Duration', dur);
  rows           += _infoRow('Recurrence', recur);
  if (link) rows += _infoRow('Meeting Link', `<a href="${link}" style="color:${_B};">${link}</a>`);
  if (role === 'teacher' && lastTopic) rows += _infoRow('Student\'s Last Topic', lastTopic);

  const body = `${_hi(recipient.firstName)}
    <p style="margin:0 0 14px;color:#374151;">A new class has been scheduled${role === 'teacher' ? ' and assigned to you' : ''}.</p>
    ${_card(`<h3 style="margin:0 0 10px;font-size:15px;color:#111827;">Class Details</h3>${_infoTable(rows)}`)}
    ${role === 'teacher' && lastTopic ? _alert(`<strong>Context:</strong> Student's last covered topic: <em>${lastTopic}</em>`) : ''}
    ${link ? _btn('Join Class', link) : _btn('View Dashboard', _dashUrl())}`;

  const text = `Hi ${recipient.firstName || 'there'},\n\nNew class scheduled.\nStudent: ${student?.firstName || 'N/A'}\nSubject: ${subj}\nDate: ${dateStr} (${_tzLabel(tz)})\n${dur ? `Duration: ${dur}\n` : ''}${link ? `Meeting: ${link}\n` : ''}${role === 'teacher' && lastTopic ? `Last topic: ${lastTopic}\n` : ''}`;

  return { subject: `New class — ${subj}`, html: baseEmailTemplate({ preheader: `New class: ${subj} on ${dateStr}`, body, icon: _ICONS.classCreated, branding }), text };
}

function buildClassCancelledEmail({ recipient, classObj, reason, branding }) {
  const tz    = recipient.timezone || 'Africa/Cairo';
  const date  = classObj.scheduledDate ? formatInTimezone(classObj.scheduledDate, tz) : 'N/A';
  const subj  = classObj.courseName || classObj.subject || 'Class';
  let rows = _infoRow('Subject', subj) + _infoRow('Scheduled Time', `${date} (${_tzLabel(tz)})`);
  if (reason) rows += _infoRow('Reason', reason);
  const body = `${_hi(recipient.firstName)}
    <p style="margin:0 0 14px;color:#374151;">The following class has been <strong>cancelled</strong>.</p>
    ${_card(_infoTable(rows))}
    ${_alert('If you have questions, contact us via the dashboard.', '#fef2f2', '#ef4444', '#991b1b')}`;
  const text = `Hi ${recipient.firstName || 'there'},\n\nClass cancelled.\nSubject: ${subj}\nScheduled: ${date} (${_tzLabel(tz)})\n${reason ? `Reason: ${reason}\n` : ''}`;
  return { subject: `Class cancelled — ${subj}`, html: baseEmailTemplate({ preheader: `Cancelled: ${subj}`, body, icon: _ICONS.classCancelled, branding }), text };
}

function buildClassRescheduledEmail({ recipient, classObj, oldDate, branding }) {
  const tz     = recipient.timezone || 'Africa/Cairo';
  const oldStr = oldDate ? formatInTimezone(oldDate, tz) : 'N/A';
  const newStr = classObj.scheduledDate ? formatInTimezone(classObj.scheduledDate, tz) : 'TBD';
  const subj   = classObj.courseName || classObj.subject || 'Class';
  const rows   = _infoRow('Subject', subj) +
    _infoRow('Previous Time', `<s style="color:#9ca3af;">${oldStr}</s>`) +
    _infoRow('New Time', `<strong style="color:${_B};">${newStr}</strong> (${_tzLabel(tz)})`);
  const body = `${_hi(recipient.firstName)}
    <p style="margin:0 0 14px;color:#374151;">Your class has been <strong>rescheduled</strong>.</p>
    ${_card(_infoTable(rows))}`;
  const text = `Hi ${recipient.firstName || 'there'},\n\nClass rescheduled.\nSubject: ${subj}\nPrevious: ${oldStr}\nNew time: ${newStr} (${_tzLabel(tz)})`;
  return { subject: `Class rescheduled — ${subj}`, html: baseEmailTemplate({ preheader: `Rescheduled to ${newStr}`, body, icon: _ICONS.classRescheduled, branding }), text };
}

function buildRegistrationWelcomeEmail({ user, branding }) {
  const role = user.role === 'teacher' ? 'teacher' : user.role === 'guardian' ? 'guardian' : 'user';
  const hint = user.role === 'teacher'
    ? 'Complete your profile and add your available hours so students can be scheduled with you.'
    : 'Log in to view your students\' classes, reports, and invoices.';
  const body = `${_hi(user.firstName)}
    <p style="margin:0 0 14px;color:#374151;">Welcome to <strong>${branding.title || 'Waraqa'}</strong>! Your account is ready as a <strong>${role}</strong>.</p>
    <p style="margin:0 0 14px;color:#374151;">${hint}</p>
    ${_btn('Go to Dashboard', _dashUrl())}`;
  const text = `Welcome to ${branding.title || 'Waraqa'}, ${user.firstName || 'there'}! Your account is ready.\n\nDashboard: ${_dashUrl()}`;
  return { subject: `Welcome to ${branding.title || 'Waraqa'}`, html: baseEmailTemplate({ preheader: 'Your account is ready', body, icon: _ICONS.registration, branding }), text };
}

function buildNewStudentEmail({ guardian, student, branding }) {
  let rows = _infoRow('Name', `${student.firstName} ${student.lastName || ''}`.trim());
  if (student.grade) rows += _infoRow('Grade', student.grade);
  const body = `${_hi(guardian.firstName)}
    <p style="margin:0 0 14px;color:#374151;">A new student has been added to your account.</p>
    ${_card(_infoTable(rows))}
    ${_btn('View Dashboard', _dashUrl())}`;
  const text = `Hi ${guardian.firstName || 'there'},\n\nStudent ${student.firstName} ${student.lastName || ''} has been added to your account.`;
  return { subject: `New student added — ${student.firstName}`, html: baseEmailTemplate({ preheader: `Student ${student.firstName} added`, body, icon: _ICONS.registration, branding }), text };
}

function buildStudentDeletedEmail({ guardian, student, branding }) {
  const body = `${_hi(guardian.firstName)}
    <p style="margin:0 0 14px;color:#374151;">Student <strong>${student.firstName} ${student.lastName || ''}</strong> has been removed from your account.</p>
    ${_alert('If this was not expected, please contact an administrator immediately.', '#fef2f2', '#ef4444', '#991b1b')}`;
  const text = `Hi ${guardian.firstName || 'there'},\n\nStudent ${student.firstName} has been removed from your account.`;
  return { subject: `Student removed — ${student.firstName}`, html: baseEmailTemplate({ preheader: `Student removed: ${student.firstName}`, body, icon: _ICONS.alert, branding }), text };
}

function buildAdminNewUserEmail({ admin, newUser, branding }) {
  const role = newUser.role || 'user';
  let rows = _infoRow('Name', `${newUser.firstName} ${newUser.lastName || ''}`.trim()) +
    _infoRow('Email', newUser.email) +
    _infoRow('Role', role.charAt(0).toUpperCase() + role.slice(1)) +
    _infoRow('Joined', _dateOnly(newUser.createdAt || new Date()));
  const body = `${_hi(admin.firstName)}
    <p style="margin:0 0 14px;color:#374151;">A new <strong>${role}</strong> has registered.</p>
    ${_card(_infoTable(rows))}
    ${_btn('View Users', _dashUrl('/users'))}`;
  const text = `New ${role} registered: ${newUser.firstName} ${newUser.lastName || ''} (${newUser.email})`;
  return { subject: `New ${role} registered`, html: baseEmailTemplate({ preheader: `New ${role}: ${newUser.firstName}`, body, icon: _ICONS.registration, branding }), text };
}

function buildPoorPerformanceEmail({ guardian, student, classObj, teacherNote, performanceRating, branding }) {
  const tz   = guardian.timezone || 'Africa/Cairo';
  const date = classObj.scheduledDate ? _dateOnly(classObj.scheduledDate, tz) : 'Recent class';
  const subj = classObj.courseName || classObj.subject || 'Class';
  const stars = '★'.repeat(performanceRating || 1) + '☆'.repeat(Math.max(0, 5 - (performanceRating || 1)));
  let rows = _infoRow('Subject', subj) + _infoRow('Date', date) + _infoRow('Rating', `<span style="color:#f59e0b;">${stars}</span>`);
  const noteHtml = teacherNote ? `<div style="margin-top:10px;padding:10px 12px;background:white;border-radius:6px;border:1px solid #e5e7eb;font-size:13px;color:#374151;font-style:italic;">"${teacherNote}"<br><span style="font-size:11px;color:#9ca3af;">— Teacher</span></div>` : '';
  const body = `${_hi(guardian.firstName)}
    <p style="margin:0 0 14px;color:#374151;">A recent class for <strong>${student?.firstName || 'your student'}</strong> had a lower performance rating.</p>
    ${_card(_infoTable(rows) + noteHtml)}
    ${_alert('Please consider reaching out to the teacher via the dashboard if you have concerns.', '#fffbeb', '#f59e0b', '#92400e')}`;
  const text = `Hi ${guardian.firstName || 'there'},\n\nPerformance update for ${student?.firstName || 'your student'}.\nSubject: ${subj}\nDate: ${date}\n${teacherNote ? `Teacher note: "${teacherNote}"\n` : ''}`;
  return { subject: `Performance update — ${student?.firstName || 'Student'}`, html: baseEmailTemplate({ preheader: `Performance update for ${student?.firstName}`, body, icon: _ICONS.performance, branding }), text };
}

function buildConsecutiveAbsentEmail({ guardian, student, teacher, branding }) {
  const body = `${_hi(guardian.firstName)}
    <p style="margin:0 0 14px;color:#374151;"><strong>${student?.firstName || 'Your student'}</strong> has missed <strong>two consecutive classes</strong> with teacher <strong>${teacher?.firstName || 'their teacher'}</strong>.</p>
    ${_alert('<strong>Action needed?</strong> If the absence is planned (illness, travel), no action is required. Otherwise, contact the teacher via the dashboard.', '#eff6ff', '#3b82f6', '#1e40af')}
    <p style="font-size:12px;color:#9ca3af;margin:10px 0 0;">Based on submitted attendance reports. May take up to 24h to reflect actual sessions.</p>`;
  const text = `Hi ${guardian.firstName || 'there'},\n\n${student?.firstName || 'Your student'} has missed 2 consecutive classes with ${teacher?.firstName || 'their teacher'}. Please log in if unexpected.`;
  return { subject: `Consecutive absences — ${student?.firstName || 'Student'}`, html: baseEmailTemplate({ preheader: `${student?.firstName} missed 2 classes in a row`, body, icon: _ICONS.absent, branding }), text };
}

function buildMonthlyStudentReportEmail({ guardian, reportData, branding }) {
  const { month, year, students = [] } = reportData;
  const MN     = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const label  = `${MN[(month||1)-1]} ${year}`;
  const rows   = students.map(s => `<tr style="border-bottom:1px solid #e5e7eb;">
    <td style="padding:8px;font-size:13px;font-weight:600;">${s.studentName}</td>
    <td style="padding:8px;font-size:13px;text-align:center;">${s.attendedCount ?? 0}</td>
    <td style="padding:8px;font-size:13px;text-align:center;">${s.absentCount ?? 0}</td>
    <td style="padding:8px;font-size:13px;text-align:center;">${(s.totalHours || 0).toFixed(1)}h</td>
    <td style="padding:8px;font-size:13px;text-align:center;">${s.avgPerformance != null ? `${s.avgPerformance.toFixed(1)}/5` : '—'}</td>
  </tr>`).join('');
  const body = `${_hi(guardian.firstName)}
    <p style="margin:0 0 14px;color:#374151;">Monthly learning summary for <strong>${label}</strong>.</p>
    <div style="overflow-x:auto;">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:#f0f7f6;">
          <th style="padding:9px 8px;text-align:left;color:#6b7280;">Student</th>
          <th style="padding:9px 8px;text-align:center;color:#6b7280;">Attended</th>
          <th style="padding:9px 8px;text-align:center;color:#6b7280;">Absent</th>
          <th style="padding:9px 8px;text-align:center;color:#6b7280;">Hours</th>
          <th style="padding:9px 8px;text-align:center;color:#6b7280;">Performance</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${_btn('View Full Reports', _dashUrl())}`;
  const text = `Hi ${guardian.firstName || 'there'},\n\nMonthly report ${label}:\n${students.map(s=>`- ${s.studentName}: ${s.attendedCount ?? 0} attended, ${s.absentCount ?? 0} absent`).join('\n')}`;
  return { subject: `Monthly report — ${label}`, html: baseEmailTemplate({ preheader: `Learning summary: ${label}`, body, icon: _ICONS.report, branding }), text };
}

function buildGuardianInvoiceCreatedEmail({ guardian, invoice, branding }) {
  const period = invoice.billingPeriodLabel || (invoice.month && invoice.year ? `${invoice.month}/${invoice.year}` : '');
  const amount = invoice.totalAmountDue != null ? `${Number(invoice.totalAmountDue).toFixed(2)} ${invoice.currency || 'USD'}`
    : invoice.totalEGP != null ? `${Number(invoice.totalEGP).toFixed(2)} EGP` : 'See invoice';
  let rows = _infoRow('Invoice #', invoice.invoiceNumber || invoice._id);
  if (period) rows += _infoRow('Period', period);
  rows += _infoRow('Amount Due', amount);
  const body = `${_hi(guardian.firstName)}
    <p style="margin:0 0 14px;color:#374151;">A new invoice has been created for your account.</p>
    ${_card(_infoTable(rows))}
    ${_alert('Payment instructions (PayPal link) will be sent soon by your administrator.', '#eff6ff', '#3b82f6', '#1e40af')}
    ${_btn('View Invoice', _dashUrl('/invoices'))}`;
  const text = `Hi ${guardian.firstName || 'there'},\n\nNew invoice created.\nInvoice: ${invoice.invoiceNumber || ''}\n${period ? `Period: ${period}\n` : ''}Amount: ${amount}\n\nPayment instructions will follow.`;
  return { subject: `New invoice — ${period || invoice.invoiceNumber || 'details inside'}`, html: baseEmailTemplate({ preheader: `Invoice: ${amount}`, body, icon: _ICONS.invoice, branding }), text };
}

function buildAdminNewInvoiceEmail({ admin, invoice, guardian, branding }) {
  const period = invoice.billingPeriodLabel || (invoice.month && invoice.year ? `${invoice.month}/${invoice.year}` : '');
  let rows = _infoRow('Guardian', `${guardian?.firstName || ''} ${guardian?.lastName || ''}`.trim()) +
    _infoRow('Invoice #', invoice.invoiceNumber || invoice._id);
  if (period) rows += _infoRow('Period', period);
  const body = `${_hi(admin.firstName)}
    <p style="margin:0 0 14px;color:#374151;">A new invoice was created for guardian <strong>${guardian?.firstName || ''}</strong>.</p>
    ${_card(_infoTable(rows))}
    ${_btn('View Invoices', _dashUrl('/invoices'))}`;
  const text = `New invoice created for ${guardian?.firstName || 'guardian'}: ${invoice.invoiceNumber || ''} ${period}`;
  return { subject: 'New guardian invoice created', html: baseEmailTemplate({ preheader: `Invoice for ${guardian?.firstName}`, body, icon: _ICONS.invoice, branding }), text };
}

function buildMeetingScheduledEmail({ recipient, meeting, calendarLink, icsContent, branding }) {
  const tz    = recipient.timezone || 'Africa/Cairo';
  const date  = meeting.startTime ? formatInTimezone(meeting.startTime, tz) : 'TBD';
  const dur   = meeting.durationMinutes ? `${meeting.durationMinutes} min` : '';
  const link  = meeting.meetingLink || meeting.link || '';
  let rows = _infoRow('Date & Time', `${date} (${_tzLabel(tz)})`) +
    (dur ? _infoRow('Duration', dur) : '') +
    _infoRow('Type', meeting.type || meeting.meetingType || 'Meeting') +
    (link ? _infoRow('Meeting Link', `<a href="${link}" style="color:${_B};">${link}</a>`) : '');
  const calBtn = calendarLink ? `<p style="text-align:center;margin:12px 0;"><a href="${calendarLink}" style="color:${_B};font-size:13px;">+ Add to Google Calendar</a></p>` : '';
  const body = `${_hi(recipient.firstName)}
    <p style="margin:0 0 14px;color:#374151;">A meeting has been scheduled for you.</p>
    ${_card(_infoTable(rows))}
    ${calBtn}
    ${link ? _btn('Join Meeting', link) : ''}
    ${icsContent ? `<p style="font-size:12px;color:#9ca3af;text-align:center;">An .ics calendar file is attached.</p>` : ''}`;
  const attachments = icsContent ? [{ filename: 'meeting.ics', content: icsContent, contentType: 'text/calendar' }] : undefined;
  const text = `Hi ${recipient.firstName || 'there'},\n\nMeeting scheduled.\nDate: ${date} (${_tzLabel(tz)})\n${dur ? `Duration: ${dur}\n` : ''}${link ? `Link: ${link}\n` : ''}${calendarLink ? `Add to calendar: ${calendarLink}\n` : ''}`;
  return { subject: `Meeting scheduled — ${date}`, html: baseEmailTemplate({ preheader: `Meeting on ${date}`, body, icon: _ICONS.meeting, branding }), text, attachments };
}

function buildVacationApprovedEmail({ teacher, vacation, branding }) {
  const tz   = teacher.timezone || 'Africa/Cairo';
  const from = vacation.startDate ? _dateOnly(vacation.startDate, tz) : 'N/A';
  const to   = vacation.endDate   ? _dateOnly(vacation.endDate, tz)   : 'N/A';
  const rows = _infoRow('Start', from) + _infoRow('End', to) + _infoRow('Status', '<span style="color:#16a34a;">✓ Approved</span>');
  const body = `${_hi(teacher.firstName)}
    <p style="margin:0 0 14px;color:#374151;">Your vacation request has been <strong style="color:#16a34a;">approved</strong>.</p>
    ${_card(_infoTable(rows))}
    ${_alert('Classes during this period will be managed by your administrator.', '#f0fdf4', '#22c55e', '#14532d')}`;
  const text = `Hi ${teacher.firstName || 'there'},\n\nVacation approved: ${from} to ${to}.`;
  return { subject: 'Vacation approved', html: baseEmailTemplate({ preheader: `Vacation approved: ${from}–${to}`, body, icon: _ICONS.vacation, branding }), text };
}

function buildVacationGuardianNoticeEmail({ guardian, teacher, vacation, branding }) {
  const tz   = guardian.timezone || 'Africa/Cairo';
  const from = vacation.startDate ? _dateOnly(vacation.startDate, tz) : 'N/A';
  const to   = vacation.endDate   ? _dateOnly(vacation.endDate, tz)   : 'N/A';
  const tName = `${teacher?.firstName || ''} ${teacher?.lastName || ''}`.trim();
  const rows  = _infoRow('Teacher', tName) + _infoRow('Absence Start', from) + _infoRow('Absence End', to);
  const body = `${_hi(guardian.firstName)}
    <p style="margin:0 0 14px;color:#374151;">Teacher <strong>${tName}</strong> will be on leave. Classes may be affected during this period.</p>
    ${_card(_infoTable(rows))}
    ${_alert('Your administrator will notify you about any rescheduling.', '#fffbeb', '#f59e0b', '#92400e')}`;
  const text = `Hi ${guardian.firstName || 'there'},\n\nTeacher ${tName} will be on leave from ${from} to ${to}. Classes may be affected.`;
  return { subject: `Teacher absence — ${tName}`, html: baseEmailTemplate({ preheader: `Teacher absent: ${from}–${to}`, body, icon: _ICONS.vacation, branding }), text };
}

function buildTeacherReassignedEmail({ teacher, classObj, student, lastTopic, branding }) {
  const subj = classObj.courseName || classObj.subject || 'Subject';
  const sName = student ? `${student.firstName} ${student.lastName || ''}`.trim() : 'N/A';
  let rows = _infoRow('Student', sName) + _infoRow('Subject', subj);
  if (lastTopic) rows += _infoRow('Last Topic Covered', lastTopic);
  const body = `${_hi(teacher.firstName)}
    <p style="margin:0 0 14px;color:#374151;">You have been assigned to teach <strong>${sName}</strong> in <strong>${subj}</strong>.</p>
    ${_card(_infoTable(rows))}
    ${lastTopic ? _alert(`<strong>Previous progress:</strong> Student's last covered topic: <em>${lastTopic}</em>`, '#eff6ff', '#3b82f6', '#1e40af') : ''}
    ${_btn('View Dashboard', _dashUrl())}`;
  const text = `Hi ${teacher.firstName || 'there'},\n\nAssigned to ${sName} for ${subj}.\n${lastTopic ? `Last topic: ${lastTopic}\n` : ''}`;
  return { subject: `New assignment — ${sName}`, html: baseEmailTemplate({ preheader: `Assigned: ${sName} – ${subj}`, body, icon: _ICONS.reassigned, branding }), text };
}

function buildSeriesCancelledEmail({ recipient, teacher, student, subject, branding }) {
  const body = `${_hi(recipient.firstName)}
    <p style="margin:0 0 14px;color:#374151;">All upcoming classes for <strong>${student?.firstName || 'a student'}</strong> with teacher <strong>${teacher?.firstName || 'their teacher'}</strong> (${subject || 'the subject'}) have been cancelled.</p>
    ${_alert('Contact your administrator if you believe this is an error.', '#fef2f2', '#ef4444', '#991b1b')}`;
  const text = `Hi ${recipient.firstName || 'there'},\n\nAll classes for ${student?.firstName || 'student'} with ${teacher?.firstName || 'their teacher'} (${subject || ''}) have been cancelled.`;
  return { subject: `Classes cancelled — ${student?.firstName || 'Student'}`, html: baseEmailTemplate({ preheader: `All classes cancelled for ${student?.firstName}`, body, icon: _ICONS.seriesCancelled, branding }), text };
}

function buildAvailabilityChangedEmail({ admin, teacher, branding }) {
  const tName = `${teacher?.firstName || ''} ${teacher?.lastName || ''}`.trim();
  const body  = `${_hi(admin.firstName)}
    <p style="margin:0 0 14px;color:#374151;">Teacher <strong>${tName}</strong> has updated their available hours.</p>
    ${_btn('Review Availability', _dashUrl('/teachers'))}`;
  const text = `Teacher ${tName} updated their availability.`;
  return { subject: `Availability updated — ${tName}`, html: baseEmailTemplate({ preheader: `${tName} updated availability`, body, icon: _ICONS.availability, branding }), text };
}

function buildTeacherInvoiceEmail({ teacher, invoice, isMonthly, branding }) {
  const pd    = invoice.year && invoice.month ? new Date(invoice.year, invoice.month - 1) : null;
  const pStr  = pd ? pd.toLocaleString('en-US', { month: 'long', year: 'numeric' }) : '';
  const total = invoice.netAmountEGP != null ? `${Number(invoice.netAmountEGP).toFixed(2)} EGP` : 'See invoice';
  let rows = '';
  if (invoice.invoiceNumber) rows += _infoRow('Invoice #', invoice.invoiceNumber);
  if (pStr)                  rows += _infoRow('Period', pStr);
  if (invoice.totalHours)    rows += _infoRow('Hours', `${Number(invoice.totalHours).toFixed(2)} h`);
  rows += _infoRow('Total', `<strong style="font-size:15px;">${total}</strong>`);
  const body = `${_hi(teacher.firstName)}
    <p style="margin:0 0 14px;color:#374151;">Your salary invoice${pStr ? ` for <strong>${pStr}</strong>` : ''} is ready.</p>
    ${_card(_infoTable(rows))}
    ${isMonthly ? _alert('Payment will be sent before the <strong>6th of this month</strong>.', '#f0fdf4', '#22c55e', '#14532d') : ''}
    ${_btn('View Invoice', _dashUrl('/salary'))}`;
  const text = `Hi ${teacher.firstName || 'there'},\n\nInvoice ready${pStr ? ` for ${pStr}` : ''}.\nTotal: ${total}\n${isMonthly ? 'Payment before the 6th.\n' : ''}`;
  return { subject: `Invoice ready${pStr ? ` — ${pStr}` : ''}`, html: baseEmailTemplate({ preheader: `Invoice: ${total}`, body, icon: _ICONS.invoice, branding }), text };
}

function buildAdminMonthlyReportEmail({ admin, reportData, branding }) {
  const { month, year, stats = {}, prevStats = {}, topTeachers = [], topStudents = [] } = reportData;
  const MN    = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const label = `${MN[(month||1)-1]} ${year}`;
  const d     = (curr, prev, sfx = '') => {
    if (prev == null || prev === 0) return `${curr}${sfx}`;
    const p = ((curr - prev) / prev * 100).toFixed(1);
    const c = p > 0 ? '#16a34a' : p < 0 ? '#dc2626' : '#9ca3af';
    return `${curr}${sfx} <small style="color:${c};">${p > 0 ? '↑' : '↓'}${Math.abs(p)}%</small>`;
  };
  const kpi = (lbl, val) =>
    `<td style="width:33%;padding:10px;text-align:center;background:#f8fafa;border-radius:6px;">
      <div style="font-size:20px;font-weight:700;color:#111827;">${val}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:3px;">${lbl}</div>
    </td>`;
  const tRows = topTeachers.slice(0,5).map((t,i)=>
    `<tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:7px 8px;font-size:13px;">${i+1}. ${t.name}</td>
      <td style="padding:7px 8px;font-size:13px;text-align:center;">${t.classesReported ?? 0}</td>
      <td style="padding:7px 8px;font-size:13px;text-align:center;">${t.hoursReported != null ? `${t.hoursReported.toFixed(1)}h` : '—'}</td>
    </tr>`).join('');
  const sRows = topStudents.slice(0,5).map((s,i)=>
    `<tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:7px 8px;font-size:13px;">${i+1}. ${s.name}</td>
      <td style="padding:7px 8px;font-size:13px;text-align:center;">${s.attendedCount ?? 0}</td>
      <td style="padding:7px 8px;font-size:13px;text-align:center;">${s.avgPerformance != null ? `${s.avgPerformance.toFixed(1)}/5` : '—'}</td>
    </tr>`).join('');
  const body = `${_hi(admin.firstName)}
    <p style="margin:0 0 14px;color:#374151;">Monthly dashboard report for <strong>${label}</strong>.</p>
    <table width="100%" cellpadding="6" cellspacing="6" style="border-collapse:separate;margin:12px 0;">
      <tr>${kpi('Classes Held',        d(stats.classesHeld ?? 0,        prevStats.classesHeld))}
          ${kpi('Attendance Rate',     d(stats.attendanceRate ?? 0,     prevStats.attendanceRate, '%'))}
          ${kpi('New Registrations',   d(stats.newRegistrations ?? 0,   prevStats.newRegistrations))}</tr>
      <tr>${kpi('Active Students',     d(stats.activeStudents ?? 0,     prevStats.activeStudents))}
          ${kpi('Active Teachers',     d(stats.activeTeachers ?? 0,     prevStats.activeTeachers))}
          ${kpi('Report Submission %', d(stats.reportRate ?? 0,         prevStats.reportRate, '%'))}</tr>
    </table>
    ${tRows ? `<h3 style="font-size:14px;color:#374151;margin:18px 0 8px;">Top Teachers by Reports</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;">
      <thead><tr style="background:#f0f7f6;"><th style="padding:8px;text-align:left;color:#6b7280;">Teacher</th><th style="padding:8px;text-align:center;color:#6b7280;">Reports</th><th style="padding:8px;text-align:center;color:#6b7280;">Hours</th></tr></thead>
      <tbody>${tRows}</tbody></table>` : ''}
    ${sRows ? `<h3 style="font-size:14px;color:#374151;margin:18px 0 8px;">Top Attending Students</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;">
      <thead><tr style="background:#f0f7f6;"><th style="padding:8px;text-align:left;color:#6b7280;">Student</th><th style="padding:8px;text-align:center;color:#6b7280;">Classes</th><th style="padding:8px;text-align:center;color:#6b7280;">Avg Perf</th></tr></thead>
      <tbody>${sRows}</tbody></table>` : ''}
    ${_btn('Open Dashboard', _dashUrl())}`;
  const text = `Monthly Report — ${label}\n\nClasses: ${stats.classesHeld ?? 0}\nAttendance: ${stats.attendanceRate ?? 0}%\nNew registrations: ${stats.newRegistrations ?? 0}\n\nTop teachers: ${topTeachers.slice(0,3).map(t=>t.name).join(', ')}`;
  return { subject: `Monthly report — ${label}`, html: baseEmailTemplate({ preheader: `Dashboard summary: ${label}`, body, icon: _ICONS.adminReport, branding }), text };
}

function buildSystemAlertEmail({ admin, message, error, branding }) {
  const body = `${_hi(admin.firstName)}
    ${_alert(`<strong>System Alert:</strong> ${message}`, '#fef2f2', '#ef4444', '#991b1b')}
    ${error ? `<pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px;font-size:11px;overflow:auto;max-height:240px;color:#374151;">${String(error).slice(0,1500)}</pre>` : ''}
    <p style="font-size:12px;color:#6b7280;">Timestamp: ${new Date().toISOString()}</p>`;
  const text = `SYSTEM ALERT: ${message}\nTime: ${new Date().toISOString()}`;
  return { subject: '[ALERT] System notification', html: baseEmailTemplate({ preheader: `Alert: ${message}`, body, icon: _ICONS.alert, branding }), text };
}


// ─── Backward-compatible send wrappers ───────────────────────────────────────
async function sendInvoicePublished(teacher, invoice) {
  try {
    const branding = await loadBrandingAndLogo();
    const tpl = buildTeacherInvoiceEmail({ teacher, invoice, isMonthly: true, branding });
    await sendMail({ to: teacher.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    await EmailLog.create({ to: teacher.email, subject: tpl.subject, type: 'invoicePublished', status: 'sent', userId: teacher._id, sentAt: new Date() });
    console.log(`[EmailService] Invoice published email sent to ${teacher.email}`);
    return { sent: true };
  } catch (error) {
    console.error('[EmailService] Failed to send invoice published email:', error.message);
    return { sent: false, error: error.message };
  }
}

async function sendPaymentReceived(teacher, invoice) {
  try {
    const branding = await loadBrandingAndLogo();
    const pd    = invoice.year && invoice.month ? new Date(invoice.year, invoice.month - 1) : null;
    const pStr  = pd ? pd.toLocaleString('en-US', { month: 'long', year: 'numeric' }) : '';
    const total = invoice.netAmountEGP != null ? `${Number(invoice.netAmountEGP).toFixed(2)} EGP` : '';
    const rows  = _infoRow('Invoice #', invoice.invoiceNumber || '—') + (pStr ? _infoRow('Period', pStr) : '') + _infoRow('Amount Paid', total);
    const body  = `${_hi(teacher.firstName)}<p style="margin:0 0 14px;">Payment for invoice <strong>#${invoice.invoiceNumber || ''}</strong> has been processed.</p>${_card(_infoTable(rows))}`;
    const html  = baseEmailTemplate({ preheader: `Payment received: ${total}`, body, branding });
    const subj  = `Payment received${pStr ? ` — ${pStr}` : ''}`;
    await sendMail({ to: teacher.email, subject: subj, html });
    await EmailLog.create({ to: teacher.email, subject: subj, type: 'paymentReceived', status: 'sent', userId: teacher._id, sentAt: new Date() });
    console.log(`[EmailService] Payment received email sent to ${teacher.email}`);
    return { sent: true };
  } catch (error) {
    console.error('[EmailService] Failed to send payment received email:', error.message);
    return { sent: false, error: error.message };
  }
}

async function sendBonusAdded(teacher, invoice, bonus) {
  try {
    const branding = await loadBrandingAndLogo();
    const rows = _infoRow('Type', bonus.source) + _infoRow('Amount', `$${bonus.amountUSD?.toFixed(2)} USD`) + _infoRow('Reason', bonus.reason || '—');
    const body = `${_hi(teacher.firstName)}<p style="margin:0 0 14px;">A <strong>${bonus.source}</strong> bonus of <strong>$${bonus.amountUSD?.toFixed(2)}</strong> was added to invoice #${invoice.invoiceNumber}.</p>${_card(_infoTable(rows))}`;
    const html = baseEmailTemplate({ preheader: `Bonus: $${bonus.amountUSD?.toFixed(2)}`, body, branding });
    const subj = `Bonus added — invoice #${invoice.invoiceNumber}`;
    await sendMail({ to: teacher.email, subject: subj, html });
    await EmailLog.create({ to: teacher.email, subject: subj, type: 'bonusAdded', status: 'sent', userId: teacher._id, sentAt: new Date() });
    console.log(`[EmailService] Bonus added email sent to ${teacher.email}`);
    return { sent: true };
  } catch (error) {
    console.error('[EmailService] Failed to send bonus added email:', error.message);
    return { sent: false, error: error.message };
  }
}

async function sendAdminInvoiceGenerationSummary(admin, summary) {
  try {
    const branding    = await loadBrandingAndLogo();
    const hasPeriod   = summary?.month && summary?.year;
    const subj        = hasPeriod ? `Monthly invoices generated — ${summary.month}/${summary.year}` : 'Monthly invoices generated';
    const rows        = _infoRow('Processed', summary.totalProcessed || 0) + _infoRow('Created', summary.created || 0) + _infoRow('Skipped', summary.skipped?.length || 0) + _infoRow('Failed', summary.failed?.length || 0);
    const skip        = summary.skipped?.length ? _alert(`Skipped: ${summary.skipped.slice(0,5).map(t=>t.name||'?').join(', ')}${summary.skipped.length>5?` +${summary.skipped.length-5} more`:''}`, '#fffbeb', '#f59e0b', '#92400e') : '';
    const body        = `${_hi(admin.firstName)}<p style="margin:0 0 14px;">Invoice generation completed${hasPeriod ? ` for <strong>${summary.month}/${summary.year}</strong>` : ''}.</p>${_card(_infoTable(rows))}${skip}`;
    const html        = baseEmailTemplate({ preheader: `${summary.created || 0} invoices generated`, body, branding });
    await sendMail({ to: admin.email, subject: subj, html });
    await EmailLog.create({ to: admin.email, subject: subj, type: 'invoiceGenerationSummary', status: 'sent', userId: admin._id, sentAt: new Date() });
    console.log(`[EmailService] Admin summary email sent to ${admin.email}`);
    return { sent: true };
  } catch (error) {
    console.error('[EmailService] Failed to send admin summary email:', error.message);
    return { sent: false, error: error.message };
  }
}

module.exports = {
  sendMail,
  enqueueEmail,
  initEmailQueueProcessor,
  loadBrandingAndLogo,
  invalidateBrandingCache,
  baseEmailTemplate,
  formatInTimezone,
  // Backward-compatible direct-send
  sendInvoicePublished,
  sendPaymentReceived,
  sendBonusAdded,
  sendAdminInvoiceGenerationSummary,
  // Template builders
  buildClassCreatedEmail,
  buildClassCancelledEmail,
  buildClassRescheduledEmail,
  buildRegistrationWelcomeEmail,
  buildNewStudentEmail,
  buildStudentDeletedEmail,
  buildAdminNewUserEmail,
  buildPoorPerformanceEmail,
  buildConsecutiveAbsentEmail,
  buildMonthlyStudentReportEmail,
  buildGuardianInvoiceCreatedEmail,
  buildAdminNewInvoiceEmail,
  buildMeetingScheduledEmail,
  buildVacationApprovedEmail,
  buildVacationGuardianNoticeEmail,
  buildTeacherReassignedEmail,
  buildSeriesCancelledEmail,
  buildAvailabilityChangedEmail,
  buildTeacherInvoiceEmail,
  buildAdminMonthlyReportEmail,
  buildSystemAlertEmail,
};
