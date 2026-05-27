// ═══════════════════════════════════════════════════════════════
//  $WATT PROTOCOL — Waitlist Server
//  Stack: Node.js · Express · Nodemailer (SMTP) · Supabase (Postgres)
// ═══════════════════════════════════════════════════════════════

import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import nodemailer from 'nodemailer';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

let geoip = null;
try {
  const geoipModule = await import('geoip-lite');
  geoip = geoipModule?.default || geoipModule;
} catch (err) {
  console.warn(`[WATT] geoip-lite unavailable, continuing without IP geolocation: ${err.message}`);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const TEMPLATE_DIR = path.join(__dirname, 'templates');
const app = express();
const testHooks = globalThis.__WATT_TEST_HOOKS__ || {};
const isDev = process.env.NODE_ENV !== 'production';

if (!isDev) {
  // Honor x-forwarded-* headers in production behind reverse proxies.
  app.set('trust proxy', 1);
}

const SESSION_COOKIE_NAME = 'watt_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const RESET_TTL_MS = 1000 * 60 * 30;
const VERIFY_TTL_MS = 1000 * 60 * 60 * 24;
const DEFAULT_DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com',
  'dispostable.com',
  'getnada.com',
  'guerrillamail.com',
  'maildrop.cc',
  'mailinator.com',
  'sharklasers.com',
  'temp-mail.org',
  'tempmail.com',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
]);

// ── Supabase (service role key — server-side only, never sent to browser) ──
function createSupabaseClientOrNull() {
  if (testHooks.supabase) return testHooks.supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('[WATT] Supabase not configured: SUPABASE_URL and SUPABASE_SERVICE_KEY are required.');
    return null;
  }
  try {
    return createClient(url, key);
  } catch (err) {
    console.error(`[WATT] Supabase client init failed: ${err.message}`);
    return null;
  }
}

const supabase = createSupabaseClientOrNull();

// ── Dynamic config cache (60s TTL) ────────────────────────────────────────
let _configCache = null;
let _configTime  = 0;
let _configPromise = null;

async function getConfig() {
  if (_configCache && Date.now() - _configTime < 60_000) return _configCache;
  if (_configPromise) return _configPromise;
  _configPromise = (async () => {
    const { data } = await supabase.from('watt_config').select('key, value');
    if (data?.length) {
      _configCache = Object.fromEntries(data.map(r => [r.key, r.value]));
      _configTime  = Date.now();
    }
    return _configCache || {};
  })();
  try {
    return await _configPromise;
  } finally {
    _configPromise = null;
  }
}

function invalidateConfig() { _configCache = null; }

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(
    raw.split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf('=');
        if (idx === -1) return [part, ''];
        return [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))];
      })
  );
}

function toBool(value) {
  return value === true || value === 'true';
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getReplyToAddress() {
  return normalizeEmail(process.env.CONTACT_EMAIL || process.env.FROM_EMAIL || process.env.SMTP_USER) || '';
}

function getSenderAddress() {
  const smtpUser = normalizeEmail(process.env.SMTP_USER);
  const fromEmail = normalizeEmail(process.env.FROM_EMAIL);
  const allowCustomFrom = toBool(process.env.SMTP_ALLOW_CUSTOM_FROM);

  if (allowCustomFrom && fromEmail) return fromEmail;
  if (fromEmail && smtpUser && fromEmail === smtpUser) return fromEmail;
  return smtpUser || fromEmail || '';
}

function getSenderHeader() {
  const senderAddress = getSenderAddress();
  const senderName = process.env.FROM_NAME || '$WATT Protocol';
  return senderAddress ? `"${senderName}" <${senderAddress}>` : senderName;
}

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  if (email.length > 254) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(email)) return false;
  const [local = '', domain = ''] = email.split('@');
  if (!local || !domain || local.length > 64) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (domain.includes('..')) return false;
  return domain.split('.').every((label) => label.length > 0 && !label.startsWith('-') && !label.endsWith('-'));
}

function getDisposableDomains() {
  const extra = String(process.env.DISPOSABLE_EMAIL_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_DISPOSABLE_DOMAINS, ...extra]);
}

function isDisposableEmail(email) {
  const domain = normalizeEmail(email).split('@')[1] || '';
  if (!domain) return false;
  for (const blocked of getDisposableDomains()) {
    if (domain === blocked || domain.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

function hasHoneypot(req) {
  return Boolean(String(req.body?.website || '').trim());
}

function hashSecret(value) {
  return crypto.scryptSync(String(value), process.env.AUTH_SALT || 'watt-protocol-auth', 64).toString('hex');
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifySecret(plain, expectedHash) {
  if (!plain || !expectedHash) return false;
  return constantTimeEqual(hashSecret(plain), expectedHash);
}

function createSignedToken(size = 32) {
  return crypto.randomBytes(size).toString('hex');
}

function signValue(value) {
  const secret = process.env.SESSION_SECRET || process.env.ADMIN_KEY || 'watt-dev-secret';
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
}

function buildSignedUnsubscribeUrl(email, siteUrl) {
  const normalizedEmail = normalizeEmail(email);
  const sig = signValue(`unsubscribe:${normalizedEmail}`);
  return `${siteUrl}/unsubscribe?email=${encodeURIComponent(normalizedEmail)}&sig=${sig}`;
}

function renderSimplePage({ title, heading, body, siteUrl, tone = 'yellow' }) {
  const accent = tone === 'red' ? '#ef4444' : '#f5e642';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#080808;color:#fff;font-family:'Inter',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.box{max-width:420px;text-align:center}.icon{display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:50%;border:1px solid ${accent};margin-bottom:16px}h2{color:${accent};font-family:'Courier New',monospace;letter-spacing:.05em;margin-bottom:12px}p{color:#888;font-size:14px;line-height:1.7}a{color:#f5e642;text-decoration:none}a:hover{text-decoration:underline}</style></head><body><div class="box"><div class="icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${accent}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"></path></svg></div><h2>${heading}</h2><p>${body}</p><p style="margin-top:24px"><a href="${siteUrl}">Back to $WATT Protocol</a></p></div></body></html>`;
}

function getSessionCookieOptions() {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    'HttpOnly',
    'SameSite=Lax',
    process.env.NODE_ENV === 'production' ? 'Secure' : '',
  ].filter(Boolean);
}

function setSessionCookie(res, token) {
  const parts = getSessionCookieOptions();
  parts[0] = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = getSessionCookieOptions();
  parts[0] = `${SESSION_COOKIE_NAME}=`;
  parts[2] = 'Max-Age=0';
  res.setHeader('Set-Cookie', parts.join('; '));
}

function setShortCache(res, seconds = 60) {
  res.setHeader('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=${seconds}`);
}

async function waitToMinimum(startTime, minimumMs = 400) {
  const elapsed = Date.now() - startTime;
  if (elapsed < minimumMs) {
    await new Promise((resolve) => setTimeout(resolve, minimumMs - elapsed));
  }
}

async function invalidateUserSessions(userId) {
  if (!userId) return;
  await supabase
    .from('auth_sessions')
    .delete()
    .eq('user_id', userId)
    .eq('role', 'user');
}

async function createSession({ role, userId = null, adminEmail = null }) {
  const token = createSignedToken(32);
  const tokenHash = hashSecret(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const payload = {
    role,
    user_id: userId,
    admin_email: adminEmail,
    token_hash: tokenHash,
    expires_at: expiresAt,
  };
  const { error } = await supabase.from('auth_sessions').insert([payload]);
  if (error) throw error;
  return token;
}

async function deleteSessionByToken(token) {
  if (!token) return;
  const tokenHash = hashSecret(token);
  await supabase.from('auth_sessions').delete().eq('token_hash', tokenHash);
}

async function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  const tokenHash = hashSecret(token);
  const { data: session } = await supabase
    .from('auth_sessions')
    .select('id, role, user_id, admin_email, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (!session) return null;
  if (session.expires_at && new Date(session.expires_at).getTime() <= Date.now()) {
    await supabase.from('auth_sessions').delete().eq('id', session.id);
    return null;
  }
  return session;
}

async function attachSession(req, _res, next) {
  if (!String(req.headers.cookie || '').includes(`${SESSION_COOKIE_NAME}=`)) {
    req.session = null;
    return next();
  }
  try {
    req.session = await getSessionFromRequest(req);
  } catch (error) {
    console.error('[WATT] Session attach error:', error.message);
    req.session = null;
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || req.session.role !== 'admin') {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  next();
}

function isValidEthAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(addr || '').trim());
}

async function callMinter(path, method = 'GET', body = null) {
  const base = (process.env.WATT_MINTER_URL || '').replace(/\/$/, '');
  const secret = process.env.WATT_MINTER_SECRET;
  if (!base || !secret) {
    throw new Error('WATT_MINTER_URL and WATT_MINTER_SECRET must be configured.');
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': secret,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Minter error ${res.status}`);
  return data;
}

function requireUser(req, res, next) {
  if (!req.session || req.session.role !== 'user' || !req.session.user_id) {
    return res.status(401).json({ error: 'Please sign in first.' });
  }
  next();
}

async function logAdminAction(req, action, targetType, targetId = null, details = {}) {
  if (!req.session?.admin_email) return;
  try {
    await supabase.from('admin_audit_logs').insert([{
      admin_email: req.session.admin_email,
      action,
      target_type: targetType,
      target_id: targetId,
      details,
      ip_address: getClientIp(req),
      user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
    }]);
  } catch (error) {
    console.warn('[WATT] Admin audit log failed:', error.message);
  }
}

async function isUnsubscribed(email) {
  const { data } = await supabase
    .from('waitlist_users')
    .select('unsubscribed')
    .eq('email', normalizeEmail(email))
    .maybeSingle();
  return Boolean(data?.unsubscribed);
}

async function sendManagedMail({ to, subject, html, text, transactional = false, siteUrl, ...rest }) {
  const normalizedEmail = normalizeEmail(to);
  if (!normalizedEmail) throw new Error('Recipient email required.');
  if (!transactional && await isUnsubscribed(normalizedEmail)) {
    console.log(`[WATT] Skipping non-transactional email to unsubscribed recipient: ${normalizedEmail}`);
    return { skipped: true };
  }
  const finalHtml = !transactional && siteUrl && html
    ? html.replaceAll('{{UNSUBSCRIBE_URL}}', buildSignedUnsubscribeUrl(normalizedEmail, siteUrl))
    : html;
  const finalText = !transactional && siteUrl && text
    ? `${text}\n\nUnsubscribe: ${buildSignedUnsubscribeUrl(normalizedEmail, siteUrl)}`
    : text;
  const replyTo = getReplyToAddress();
  await transporter.sendMail({
    from: getSenderHeader(),
    replyTo: replyTo || undefined,
    to: normalizedEmail,
    subject,
    html: finalHtml,
    text: finalText,
    ...rest,
  });
  return { skipped: false };
}

// ── Security headers ────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: https:",
    "font-src 'self' https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "script-src 'self' 'unsafe-inline'",
    "connect-src 'self' https:",
    "frame-src 'none'",
    "upgrade-insecure-requests",
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), interest-cohort=()');
  if (!isDev) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
});

// ── CORS: same-origin by default, optional env overrides ───────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowedOrigins = String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

// ── Rate limiting ──────────────────────────────────────────────────────────

// Waitlist signup: 5/15min in prod, relaxed in dev
const waitlistLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 100 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts. Please try again in 15 minutes.' },
});

// Lookup / dashboard: 20/10min in prod, relaxed in dev
const lookupLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: isDev ? 500 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Admin login: 10/hour in prod, relaxed in dev
const adminLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 200 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin attempts. Try again in an hour.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 100 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please try again shortly.' },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 100 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset attempts. Please try again later.' },
});

const emailActionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isDev ? 100 : 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many email requests. Please wait a bit and try again.' },
});

// Service worker must never be cached by the browser (so updates are detected immediately)
app.get('/sw.js', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'sw.js'), {
    headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Content-Type': 'application/javascript' },
  });
});

app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: '10m',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    if (/\.(css|js|svg|png|jpg|jpeg|webp|ico|pdf)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=86400');
    }
  },
}));

app.use(attachSession);

// ── SMTP transporter ───────────────────────────────────────────────────────
const transporter = testHooks.transporter || nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ── Dynamic site URL — reads from env or detects from incoming request ─────
// Optional: set SITE_URL in .env to force one canonical domain.
// Default behavior (recommended): leave SITE_URL unset to auto-detect host.
function getSiteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host  = (req.headers['x-forwarded-host']  || req.get('host') || 'localhost:3000');
  return `${proto}://${host}`;
}

// ── IP → Geo helper ────────────────────────────────────────────────────────
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'] || '';
  const raw = forwarded.split(',')[0].trim()
    || req.headers['x-real-ip']
    || req.socket.remoteAddress
    || '';
  return raw.replace(/^::ffff:/, ''); // strip IPv4-mapped IPv6 prefix
}

function geoFromIp(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168') || ip.startsWith('10.')) {
    return null; // localhost / private IP — no geo data
  }
  if (!geoip?.lookup) return null;
  try { return geoip.lookup(ip); } catch { return null; }
}

// ISO 3166-1 alpha-2 → country name (common subset)
const COUNTRY_NAMES = {
  AF:'Afghanistan',AL:'Albania',DZ:'Algeria',AO:'Angola',AR:'Argentina',AU:'Australia',
  AT:'Austria',AZ:'Azerbaijan',BD:'Bangladesh',BE:'Belgium',BJ:'Benin',BO:'Bolivia',
  BR:'Brazil',BF:'Burkina Faso',BI:'Burundi',CM:'Cameroon',CA:'Canada',CF:'Central African Republic',
  TD:'Chad',CL:'Chile',CN:'China',CO:'Colombia',CG:'Congo',CD:'DR Congo',
  CI:"Côte d'Ivoire",HR:'Croatia',CU:'Cuba',CZ:'Czech Republic',DK:'Denmark',
  EG:'Egypt',ET:'Ethiopia',FR:'France',GA:'Gabon',GM:'Gambia',DE:'Germany',
  GH:'Ghana',GR:'Greece',GT:'Guatemala',GN:'Guinea',HN:'Honduras',HK:'Hong Kong',
  HU:'Hungary',IN:'India',ID:'Indonesia',IR:'Iran',IQ:'Iraq',IE:'Ireland',
  IL:'Israel',IT:'Italy',JP:'Japan',JO:'Jordan',KZ:'Kazakhstan',KE:'Kenya',
  KW:'Kuwait',LB:'Lebanon',LY:'Libya',MY:'Malaysia',ML:'Mali',MX:'Mexico',
  MA:'Morocco',MZ:'Mozambique',MM:'Myanmar',NP:'Nepal',NL:'Netherlands',
  NZ:'New Zealand',NE:'Niger',NG:'Nigeria',NO:'Norway',OM:'Oman',PK:'Pakistan',
  PE:'Peru',PH:'Philippines',PL:'Poland',PT:'Portugal',QA:'Qatar',RO:'Romania',
  RU:'Russia',RW:'Rwanda',SA:'Saudi Arabia',SN:'Senegal',ZA:'South Africa',
  SS:'South Sudan',ES:'Spain',LK:'Sri Lanka',SD:'Sudan',SE:'Sweden',CH:'Switzerland',
  SY:'Syria',TW:'Taiwan',TZ:'Tanzania',TH:'Thailand',TN:'Tunisia',TR:'Turkey',
  UG:'Uganda',UA:'Ukraine',AE:'United Arab Emirates',GB:'United Kingdom',
  US:'United States',UZ:'Uzbekistan',VE:'Venezuela',VN:'Vietnam',YE:'Yemen',
  ZM:'Zambia',ZW:'Zimbabwe',
};

// ── Email builders ─────────────────────────────────────────────────────────
function buildRoadmapHtml(stages) {
  if (!stages || stages.length === 0) return '';
  return stages.map((stage, i) => {
    const num     = String(i + 1).padStart(2, '0');
    const isFirst = i === 0;
    const isLast  = i === stages.length - 1;
    const numStyle = isFirst
      ? 'background:#F5C518;color:#080808;'
      : 'background:#1a1a00;border:1px solid #F5C518;color:#F5C518;';
    const titleColor = '#fff';
    const mb = isLast ? '' : 'margin-bottom:18px;';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${mb}">
            <tr>
              <td width="44" valign="top" style="padding-right:14px;padding-top:1px;">
                <div style="${numStyle}font-family:'Courier New',Courier,monospace;font-size:10px;font-weight:700;padding:6px 8px;text-align:center;">${num}</div>
              </td>
              <td>
                <p style="font-weight:700;font-size:13px;color:${titleColor};margin:0 0 4px 0;">${stage.title || ''}${stage.timeline ? ` &nbsp;<span style="font-family:'Courier New',Courier,monospace;font-size:9px;color:#555;font-weight:400;">${stage.timeline}</span>` : ''}</p>
                <p style="font-size:12px;color:#666;line-height:1.65;margin:0;">${stage.description || ''}</p>
              </td>
            </tr>
          </table>`;
  }).join('\n          ');
}

function buildHtmlEmail(referralCode, referralLink, dashboardUrl, siteUrl, roadmapStages) {
  const tplPath = path.join(TEMPLATE_DIR, 'watt-waitlist-email.html');
  const siteDisplay = siteUrl.replace(/^https?:\/\//, '');
  return fs.readFileSync(tplPath, 'utf8')
    .replaceAll('{{REFERRAL_CODE}}',        referralCode)
    .replaceAll('{{REFERRAL_LINK}}',        referralLink)
    .replaceAll('{{REFERRAL_LINK_ENCODED}}', encodeURIComponent(referralLink))
    .replaceAll('{{DASHBOARD_URL}}',        dashboardUrl)
    .replaceAll('{{SITE_URL}}',             siteUrl)
    .replaceAll('{{SITE_URL_DISPLAY}}',     siteDisplay)
    .replaceAll('{{UNSUBSCRIBE_URL}}',      '{{UNSUBSCRIBE_URL}}')
    .replaceAll('{{ROADMAP_ITEMS}}',        buildRoadmapHtml(roadmapStages));
}

function buildPlainText(referralLink, dashboardUrl, siteUrl) {
  return `
YOU'RE IN — $WATT PROTOCOL
${siteUrl}

Welcome to the global clean energy revolution.

YOUR DASHBOARD
${dashboardUrl}
Bookmark this link — it's your personal dashboard.

THE CORE IDEA
Generate clean energy → WATT Meter logs it on-chain → Earn $WATT tokens
1 KWh = 1 $WATT. Automatically. No middleman. Every country on Earth.

YOUR FOUNDING MEMBER PERKS
• Priority hardware allocation — first to receive the WATT Smart Meter
• 1.5× earning multiplier for your first 90 days after launch
• 500 $WATT for every friend you refer who installs a meter
• Founding Member NFT badge — permanently on-chain

YOUR REFERRAL LINK
${referralLink}
Share it. Every friend who joins earns you 500 $WATT at launch.

WHAT'S COMING
Month 3–4:   Prototype ships — first energy data on-chain
Month 5–6:   Africa Pilot — Nigeria & Ghana go live
Month 12–18: Global mainnet launch, Uniswap listing
Year 2–3:    1M+ active meters worldwide

FOLLOW THE BUILD
Twitter:  https://twitter.com/WATTProtocol
Website:  ${siteUrl}

Born in Africa. Powered by the Sun. Built for Everyone.

────────────────────────────────
$WATT is a utility token. This is not financial advice.
`.trim();
}

function buildMagicLinkHtml(dashboardUrl, siteUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Your $WATT Dashboard — $WATT Protocol</title></head>
<body style="margin:0;padding:0;background:#080808;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#fff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width:4px;background:#f5e642;">&nbsp;</td>
        <td style="background:#0f0f0f;padding:14px 24px;">
          <span style="font-family:'Courier New',monospace;font-size:11px;font-weight:700;color:#f5e642;letter-spacing:0.18em;">$WATT PROTOCOL</span>
        </td>
      </tr>
    </table>
  </td></tr>
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width:4px;background:#f5e642;">&nbsp;</td>
        <td style="background:#0e0e00;padding:48px 40px 40px;">
          <p style="font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.35em;color:#f5e642;text-transform:uppercase;margin:0 0 14px;">DASHBOARD ACCESS</p>
          <h1 style="font-size:34px;font-weight:700;line-height:1.1;margin:0 0 16px;color:#fff;">Your $WATT<br><span style="color:#f5e642;">Dashboard Link</span></h1>
          <p style="font-size:14px;color:#999;line-height:1.75;margin:0 0 32px;">Click the button below to access your personal waitlist dashboard — your position, referrals, and earned $WATT.</p>
          <a href="${dashboardUrl}" style="display:inline-block;background:#f5e642;color:#080808;font-family:'Courier New',monospace;font-size:12px;font-weight:700;letter-spacing:0.12em;padding:16px 32px;text-decoration:none;text-transform:uppercase;">ACCESS MY DASHBOARD →</a>
          <p style="font-size:11px;color:#333;margin-top:24px;word-break:break-all;">Or copy: <span style="color:#555;">${dashboardUrl}</span></p>
        </td>
      </tr>
    </table>
  </td></tr>
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width:4px;background:#f5e642;">&nbsp;</td>
        <td style="background:#080808;padding:20px 40px;">
          <p style="font-size:10px;color:#2a2a2a;line-height:1.75;margin:0;">
            $WATT is a utility token. This is not financial advice.<br>
            <a href="${siteUrl}" style="color:#3a3a3a;">${siteUrl.replace(/^https?:\/\//, '')}</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function buildVerificationEmail(verifyUrl, siteUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Confirm your $WATT spot</title></head>
<body style="margin:0;padding:0;background:#080808;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#fff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width:4px;background:#f5e642;">&nbsp;</td>
        <td style="background:#0f0f0f;padding:14px 24px;">
          <span style="font-family:'Courier New',monospace;font-size:11px;font-weight:700;color:#f5e642;letter-spacing:0.18em;">$WATT PROTOCOL</span>
        </td>
      </tr>
    </table>
  </td></tr>
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width:4px;background:#f5e642;">&nbsp;</td>
        <td style="background:#0e0e00;padding:48px 40px 40px;">
          <p style="font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.35em;color:#f5e642;text-transform:uppercase;margin:0 0 14px;">ONE STEP TO GO</p>
          <h1 style="font-size:28px;font-weight:700;line-height:1.2;margin:0 0 20px;">Confirm your<br><span style="color:#f5e642;">$WATT spot.</span></h1>
          <p style="font-size:15px;color:#888;line-height:1.8;margin:0 0 32px;">Click the button below to confirm your email and secure your place on the $WATT Protocol waitlist. This link expires in 24 hours.</p>
          <a href="${verifyUrl}" style="display:inline-block;background:#f5e642;color:#080808;font-family:'Courier New',monospace;font-size:12px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;padding:16px 36px;text-decoration:none;">CONFIRM MY SPOT →</a>
          <p style="font-size:12px;color:#444;line-height:1.7;margin:32px 0 0;">Or copy this URL into your browser:<br><span style="color:#f5e642;word-break:break-all;">${verifyUrl}</span></p>
        </td>
      </tr>
    </table>
  </td></tr>
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width:4px;background:#f5e642;">&nbsp;</td>
        <td style="background:#080808;padding:20px 40px;">
          <p style="font-size:10px;color:#2a2a2a;line-height:1.75;margin:0;">
            If you didn't sign up for $WATT Protocol, ignore this email.<br>
            <a href="${siteUrl}" style="color:#3a3a3a;">${siteUrl.replace(/^https?:\/\//, '')}</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function buildResetPasswordEmail(resetUrl, siteUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Reset your $WATT password</title></head>
<body style="margin:0;padding:0;background:#080808;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#fff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
  <tr><td style="background:#0f0f0f;padding:18px 24px;border-left:4px solid #f5e642;">
    <span style="font-family:'Courier New',monospace;font-size:11px;font-weight:700;color:#f5e642;letter-spacing:0.18em;">$WATT PROTOCOL</span>
  </td></tr>
  <tr><td style="background:#0e0e00;padding:48px 40px 40px;border-left:4px solid #f5e642;">
    <p style="font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.35em;color:#f5e642;text-transform:uppercase;margin:0 0 14px;">PASSWORD RESET</p>
    <h1 style="font-size:30px;font-weight:700;line-height:1.15;margin:0 0 20px;color:#fff;">Reset your<br><span style="color:#f5e642;">$WATT password.</span></h1>
    <p style="font-size:15px;color:#888;line-height:1.8;margin:0 0 32px;">Use the secure link below to choose a new password. This link expires in 30 minutes.</p>
    <a href="${resetUrl}" style="display:inline-block;background:#f5e642;color:#080808;font-family:'Courier New',monospace;font-size:12px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;padding:16px 36px;text-decoration:none;">RESET PASSWORD →</a>
    <p style="font-size:12px;color:#444;line-height:1.7;margin:32px 0 0;">Or copy this URL into your browser:<br><span style="color:#f5e642;word-break:break-all;">${resetUrl}</span></p>
  </td></tr>
  <tr><td style="background:#080808;padding:20px 40px;border-left:4px solid #f5e642;">
    <p style="font-size:10px;color:#2a2a2a;line-height:1.75;margin:0;">
      If you didn't request this, you can ignore this email.<br>
      <a href="${siteUrl}" style="color:#3a3a3a;">${siteUrl.replace(/^https?:\/\//, '')}</a>
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function buildPasswordResetConfirmationEmail(siteUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Your $WATT password was changed</title></head>
<body style="margin:0;padding:0;background:#080808;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#fff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
  <tr><td style="background:#0f0f0f;padding:18px 24px;border-left:4px solid #f5e642;">
    <span style="font-family:'Courier New',monospace;font-size:11px;font-weight:700;color:#f5e642;letter-spacing:0.18em;">$WATT PROTOCOL</span>
  </td></tr>
  <tr><td style="background:#111;padding:40px;border-left:4px solid #f5e642;">
    <p style="font-family:'Courier New',monospace;font-size:10px;letter-spacing:0.35em;color:#f5e642;text-transform:uppercase;margin:0 0 14px;">SECURITY NOTICE</p>
    <h1 style="font-size:28px;font-weight:700;line-height:1.2;margin:0 0 20px;color:#fff;">Your password<br><span style="color:#f5e642;">was updated.</span></h1>
    <p style="font-size:15px;color:#888;line-height:1.8;margin:0 0 18px;">This email confirms that your $WATT password was changed successfully.</p>
    <p style="font-size:14px;color:#888;line-height:1.8;margin:0;">If you did not make this change, reset your password again immediately and contact support.</p>
    <p style="margin:28px 0 0;"><a href="${siteUrl}/dashboard.html" style="display:inline-block;background:#f5e642;color:#080808;font-family:'Courier New',monospace;font-size:12px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;padding:14px 28px;text-decoration:none;">SIGN IN →</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// ── GET /ref/:code — referral link redirect ────────────────────────────────
app.get('/ref/:code', (req, res) => {
  const code = (req.params.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) return res.redirect('/');
  res.setHeader('Set-Cookie', `watt_ref=${code}; Path=/; Max-Age=604800; SameSite=Lax`);
  console.log(`[WATT] Referral visit: code=${code}`);
  res.redirect(`/?ref=${code}`);
});

if (!supabase) {
  app.use('/api', (_req, res) => {
    return res.status(500).json({
      error: 'Server misconfigured: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in environment variables.',
    });
  });
}

// ── POST /api/waitlist ─────────────────────────────────────────────────────
app.post('/api/waitlist', waitlistLimiter, async (req, res) => {
  const { email, password, referredBy } = req.body || {};

  if (hasHoneypot(req)) {
    return res.status(200).json({ success: true, requiresVerification: true });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  if (isDisposableEmail(email)) {
    return res.status(400).json({ error: 'Temporary email addresses are not allowed.' });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'Please choose a password with at least 8 characters.' });
  }

  const normalizedEmail = normalizeEmail(email);

  const { data: existing, error: lookupError } = await supabase
    .from('waitlist_users')
    .select('referral_code')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (lookupError) {
    console.error('[WATT] Duplicate check failed:', lookupError.message);
    return res.status(500).json({ error: 'Could not verify your email. Please try again.' });
  }
  if (existing) {
    return res.json({ success: false, alreadyExists: true, referralCode: existing.referral_code });
  }

  const cfg = await getConfig();
  const foundingThreshold = parseInt(cfg.founding_member_threshold) || 1000;
  const { count } = await supabase.from('waitlist_users').select('*', { count: 'exact', head: true });

  const siteUrl = getSiteUrl(req);
  const referralCode = nanoid(8).toUpperCase();
  const referralLink = `${siteUrl}/ref/${referralCode}`;
  const foundingMember = (count || 0) < foundingThreshold;
  const cleanRef = (referredBy || '').toUpperCase().trim().replace(/[^A-Z0-9]/g, '');

  const verificationToken = createSignedToken(32);
  const verificationTokenHash = hashSecret(verificationToken);
  const verificationExpiresAt = new Date(Date.now() + VERIFY_TTL_MS).toISOString();
  const verifyUrl = `${siteUrl}/verify-email?token=${verificationToken}`;

  const clientIp = getClientIp(req);
  const geoData = geoFromIp(clientIp);
  const countryCode = geoData?.country || null;
  const countryName = countryCode ? (COUNTRY_NAMES[countryCode] || countryCode) : null;
  const signupLat = geoData?.ll?.[0] ?? null;
  const signupLng = geoData?.ll?.[1] ?? null;

  let { error: insertError } = await supabase
    .from('waitlist_users')
    .insert([{
      email: normalizedEmail,
      password_hash: hashSecret(password),
      referral_code: referralCode,
      referral_link: referralLink,
      referred_by: cleanRef || null,
      founding_member: foundingMember,
      email_verified: false,
      verification_token: verificationTokenHash,
      verification_expires_at: verificationExpiresAt,
      country_code: countryCode,
      country_name: countryName,
      signup_lat: signupLat,
      signup_lng: signupLng,
      unsubscribed: false,
    }]);

  if (insertError) {
    const isColumnError = insertError.message?.toLowerCase().includes('column') || insertError.code === '42703';
    if (isColumnError) {
      console.warn('[WATT] Missing new auth columns. Run migrations.sql before using password auth.');
      return res.status(500).json({ error: 'Server migrations are incomplete. Please contact support.' });
    }
  }

  if (insertError) {
    const isDuplicate = insertError.code === '23505'
      || insertError.message?.toLowerCase().includes('duplicate')
      || insertError.message?.toLowerCase().includes('unique');
    if (isDuplicate) {
      const { data: existingUser } = await supabase
        .from('waitlist_users')
        .select('referral_code')
        .eq('email', normalizedEmail)
        .maybeSingle();
      return res.json({ success: false, alreadyExists: true, referralCode: existingUser?.referral_code });
    }
    console.error('[WATT] Supabase insert error:', insertError.message);
    return res.status(500).json({ error: 'Could not save your signup. Please try again.' });
  }

  try {
    await sendManagedMail({
      to: normalizedEmail,
      subject: 'Confirm your $WATT spot — one click to go',
      html: buildVerificationEmail(verifyUrl, siteUrl),
      text: `Confirm your $WATT Protocol waitlist spot:\n\n${verifyUrl}\n\nThis link expires in 24 hours.`,
      transactional: true,
      siteUrl,
    });
    console.log(`[WATT] Verification email sent: ${normalizedEmail}`);
  } catch (err) {
    console.error('[WATT] Verification email send error:', err.message);
  }

  return res.status(200).json({ success: true, requiresVerification: true });
});

// ── GET /verify-email?token=xxx ────────────────────────────────────────────
app.get('/verify-email', async (req, res) => {
  const token   = String(req.query.token || '').trim();
  const siteUrl = getSiteUrl(req);

  if (!token) return res.redirect('/?error=invalid-token');
  const tokenHash = hashSecret(token);

  const { data: user, error } = await supabase
    .from('waitlist_users')
    .select('id, email, referral_code, referral_link, founding_member, email_verified, verification_expires_at, referred_by')
    .eq('verification_token', tokenHash)
    .maybeSingle();

  if (error || !user) {
    return res.send(renderSimplePage({
      title: 'Invalid Link — $WATT',
      heading: 'Invalid or Expired Link',
      body: `This verification link has already been used or has expired.`,
      siteUrl,
      tone: 'red',
    }));
  }

  if (user.verification_expires_at && new Date(user.verification_expires_at).getTime() <= Date.now()) {
    return res.send(renderSimplePage({
      title: 'Expired Link — $WATT',
      heading: 'Verification Link Expired',
      body: 'Your verification link expired. Please request a new one from the sign-in screen.',
      siteUrl,
      tone: 'red',
    }));
  }

  if (user.email_verified) {
    const sessionToken = await createSession({ role: 'user', userId: user.id });
    setSessionCookie(res, sessionToken);
    return res.redirect(`${siteUrl}/dashboard.html`);
  }

  await supabase
    .from('waitlist_users')
    .update({
      email_verified: true,
      verification_token: null,
      verification_expires_at: null,
    })
    .eq('id', user.id);

  if (user.referred_by) {
    const { data: referrer, error: refErr } = await supabase
      .from('waitlist_users')
      .select('id, email, referrals_count')
      .eq('referral_code', user.referred_by)
      .maybeSingle();
    if (refErr) {
      console.error('[WATT] Referrer lookup error after verify:', refErr.message);
    } else if (referrer) {
      const { error: updateErr } = await supabase
        .from('waitlist_users')
        .update({ referrals_count: (referrer.referrals_count || 0) + 1 })
        .eq('id', referrer.id);
      if (updateErr) {
        console.error('[WATT] Referral count update error after verify:', updateErr.message);
      }
    }
  }

  const dashboardUrl = `${siteUrl}/dashboard.html`;
  const referralLink = user.referral_link;
  const cfg = await getConfig();
  let roadmapStages = [];
  try { roadmapStages = JSON.parse(cfg.roadmap || '[]'); } catch {}

  const pdfPath = path.join(PUBLIC_DIR, 'watt-protocol-whitepaper.pdf');
  let pdfContent;
  try { pdfContent = fs.readFileSync(pdfPath).toString('base64'); }
  catch { /* PDF not found — send without attachment */ }

  const mailOptions = {
    to:      user.email,
    subject: "You're in — $WATT Protocol. Energy to Earn.",
    html:    buildHtmlEmail(user.referral_code, referralLink, dashboardUrl, siteUrl, roadmapStages),
    text:    buildPlainText(referralLink, dashboardUrl, siteUrl),
  };
  if (pdfContent) {
    mailOptions.attachments = [{
      filename:    'WATT-Protocol-Whitepaper-2025.pdf',
      content:     pdfContent,
      encoding:    'base64',
      contentType: 'application/pdf',
    }];
  }

  try {
    await sendManagedMail({
      ...mailOptions,
      subject: mailOptions.subject,
      html: mailOptions.html,
      text: mailOptions.text,
      attachments: mailOptions.attachments,
      transactional: false,
      siteUrl,
      to: user.email,
    });
    console.log(`[WATT] Verified and welcome email sent: ${user.email} | ref:${user.referral_code}`);
  } catch (err) {
    console.error('[WATT] Welcome email error after verify:', err.message);
  }

  const sessionToken = await createSession({ role: 'user', userId: user.id });
  setSessionCookie(res, sessionToken);
  return res.redirect(dashboardUrl);
});

// ── POST /api/auth/login ───────────────────────────────────────────────────
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (!password) {
    return res.status(400).json({ error: 'Password is required.' });
  }

  const { data: user, error } = await supabase
    .from('waitlist_users')
    .select('id, password_hash, email_verified')
    .eq('email', email)
    .maybeSingle();

  if (error || !user || !user.password_hash || !verifySecret(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (!toBool(user.email_verified)) {
    return res.status(403).json({ error: 'Please verify your email before signing in.' });
  }

  const sessionToken = await createSession({ role: 'user', userId: user.id });
  setSessionCookie(res, sessionToken);
  return res.json({ success: true });
});

// ── POST /api/auth/forgot-password ────────────────────────────────────────
app.post('/api/auth/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const startedAt = Date.now();
  const email = normalizeEmail(req.body?.email);
  const siteUrl = getSiteUrl(req);

  if (hasHoneypot(req)) {
    await waitToMinimum(startedAt);
    return res.json({ success: true });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const { data: user } = await supabase
    .from('waitlist_users')
    .select('id, email')
    .eq('email', email)
    .maybeSingle();

  if (user) {
    const resetToken = createSignedToken(32);
    const resetTokenHash = hashSecret(resetToken);
    const resetExpiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();
    await supabase
      .from('waitlist_users')
      .update({
        reset_token: resetTokenHash,
        reset_token_expires_at: resetExpiresAt,
      })
      .eq('id', user.id);

    const resetUrl = `${siteUrl}/dashboard.html?reset=${encodeURIComponent(resetToken)}`;
    try {
      await sendManagedMail({
        to: user.email,
        subject: 'Reset your $WATT password',
        html: buildResetPasswordEmail(resetUrl, siteUrl),
        text: `Reset your $WATT password:\n\n${resetUrl}\n\nThis link expires in 30 minutes.`,
        transactional: true,
        siteUrl,
      });
    } catch (err) {
      console.error('[WATT] Password reset email error:', err.message);
    }
  }

  await waitToMinimum(startedAt);
  return res.json({ success: true });
});

// ── GET /api/auth/reset-password-status?token=... ─────────────────────────
app.get('/api/auth/reset-password-status', forgotPasswordLimiter, async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).json({ valid: false, error: 'Reset token required.' });

  const tokenHash = hashSecret(token);
  const { data: user } = await supabase
    .from('waitlist_users')
    .select('id, reset_token_expires_at')
    .eq('reset_token', tokenHash)
    .maybeSingle();

  const valid = Boolean(
    user
    && user.reset_token_expires_at
    && new Date(user.reset_token_expires_at).getTime() > Date.now()
  );

  return res.json({
    valid,
    error: valid ? null : 'This reset link is invalid or expired.',
  });
});

// ── POST /api/auth/reset-password ─────────────────────────────────────────
app.post('/api/auth/reset-password', forgotPasswordLimiter, async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');
  const confirmPassword = String(req.body?.confirmPassword || '');

  if (!token) return res.status(400).json({ error: 'Reset token required.' });
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Please choose a password with at least 8 characters.' });
  }
  if (!confirmPassword || password !== confirmPassword) {
    return res.status(400).json({ error: 'Your password confirmation does not match.' });
  }

  const tokenHash = hashSecret(token);
  const { data: user } = await supabase
    .from('waitlist_users')
    .select('id, email, password_hash, reset_token_expires_at')
    .eq('reset_token', tokenHash)
    .maybeSingle();

  if (!user || !user.reset_token_expires_at || new Date(user.reset_token_expires_at).getTime() <= Date.now()) {
    return res.status(400).json({ error: 'This reset link is invalid or expired.' });
  }
  if (user.password_hash && verifySecret(password, user.password_hash)) {
    return res.status(400).json({ error: 'Choose a password you have not used for this account.' });
  }

  await supabase
    .from('waitlist_users')
    .update({
      password_hash: hashSecret(password),
      reset_token: null,
      reset_token_expires_at: null,
    })
    .eq('id', user.id);

  await invalidateUserSessions(user.id);
  clearSessionCookie(res);

  try {
    await sendManagedMail({
      to: user.email,
      subject: 'Your $WATT password was changed',
      html: buildPasswordResetConfirmationEmail(getSiteUrl(req)),
      text: 'Your $WATT password was changed successfully. If this was not you, reset it again immediately and contact support.',
      transactional: true,
      siteUrl: getSiteUrl(req),
    });
  } catch (err) {
    console.error('[WATT] Password reset confirmation email error:', err.message);
  }

  return res.json({
    success: true,
    message: 'Your password has been reset. Please sign in with your new password.',
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────
app.post('/api/auth/logout', async (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  await deleteSessionByToken(token);
  clearSessionCookie(res);
  return res.json({ success: true });
});

// ── GET /api/auth/session ─────────────────────────────────────────────────
app.get('/api/auth/session', async (req, res) => {
  if (!req.session) return res.status(401).json({ authenticated: false });
  return res.json({
    authenticated: true,
    role: req.session.role,
    adminEmail: req.session.admin_email || null,
  });
});

// ── POST /api/admin/login ─────────────────────────────────────────────────
app.post('/api/admin/login', adminLimiter, authLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH || (process.env.ADMIN_PASSWORD ? hashSecret(process.env.ADMIN_PASSWORD) : '');

  if (!adminEmail || !adminPasswordHash) {
    return res.status(500).json({ error: 'Admin credentials are not configured.' });
  }
  if (email !== adminEmail || !verifySecret(password, adminPasswordHash)) {
    return res.status(401).json({ error: 'Invalid admin credentials.' });
  }

  const sessionToken = await createSession({ role: 'admin', adminEmail });
  setSessionCookie(res, sessionToken);
  req.session = { role: 'admin', admin_email: adminEmail };
  await logAdminAction(req, 'login', 'admin', adminEmail);
  return res.json({ success: true, adminEmail });
});

// ── GET /api/me?ref=CODE — dashboard data ─────────────────────────────────
app.get('/api/me', lookupLimiter, async (req, res) => {
  const ref = String(req.query.ref || '').toUpperCase().trim();
  let user = null;
  let error = null;

  if (req.session?.role === 'user' && req.session.user_id) {
    ({ data: user, error } = await supabase
      .from('waitlist_users')
      .select('email, referral_code, referral_link, referrals_count, founding_member, signed_up_at')
      .eq('id', req.session.user_id)
      .maybeSingle());
  } else {
    if (!ref) return res.status(401).json({ error: 'Please sign in first.' });
    ({ data: user, error } = await supabase
      .from('waitlist_users')
      .select('email, referral_code, referral_link, referrals_count, founding_member, signed_up_at')
      .eq('referral_code', ref)
      .maybeSingle());
  }

  if (error || !user) return res.status(404).json({ error: 'No account found for this code.' });

  const [
    { count: position },
    { count: total },
    { count: referralsCount, error: countErr },
    cfg,
  ] = await Promise.all([
    supabase.from('waitlist_users').select('*', { count: 'exact', head: true }).lte('signed_up_at', user.signed_up_at),
    supabase.from('waitlist_users').select('*', { count: 'exact', head: true }),
    supabase.from('waitlist_users').select('*', { count: 'exact', head: true }).eq('referred_by', user.referral_code).eq('email_verified', true),
    getConfig(),
  ]);

  if (countErr) console.error('[WATT] /api/me referral count error:', countErr.message);

  const referralReward    = parseInt(cfg.referral_reward_watt) || 500;
  const foundingMultiplier = parseFloat(cfg.founding_member_multiplier) || 1.5;
  const [local, domain]   = user.email.split('@');
  const maskedEmail        = local.slice(0, 2) + '***@' + domain;

  return res.json({
    email:            maskedEmail,
    referralCode:     user.referral_code,
    referralLink:     user.referral_link,
    referralsCount:   referralsCount || 0,
    foundingMember:   user.founding_member,
    signedUpAt:       user.signed_up_at,
    position:         position || 1,
    total:            total    || 1,
    referralReward,
    multiplier:       user.founding_member ? foundingMultiplier : 1,
    wattEarned:       (referralsCount || 0) * referralReward,
  });
});

// ── Producer / energy MVP (session user) ───────────────────────────────────
app.put('/api/producer/wallet', requireUser, async (req, res) => {
  const wallet = String(req.body?.wallet_address || req.body?.wallet || '').trim();
  if (wallet && !isValidEthAddress(wallet)) {
    return res.status(400).json({ error: 'Invalid Ethereum address.' });
  }
  const { error } = await supabase
    .from('waitlist_users')
    .update({ wallet_address: wallet ? wallet.toLowerCase() : null })
    .eq('id', req.session.user_id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, wallet_address: wallet ? wallet.toLowerCase() : null });
});

app.get('/api/producer/energy-summary', requireUser, async (req, res) => {
  const { data: user, error } = await supabase
    .from('waitlist_users')
    .select('wallet_address, pending_watt, credited_watt, last_energy_kwh')
    .eq('id', req.session.user_id)
    .maybeSingle();
  if (error || !user) return res.status(404).json({ error: 'User not found.' });

  const { data: lastMint } = await supabase
    .from('mining_events')
    .select('kwh, watt_earned, tx_hash, created_at, status')
    .eq('user_id', req.session.user_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let onChainBalance = null;
  if (user.wallet_address && process.env.WATT_MINTER_URL) {
    try {
      const bal = await callMinter(`/balance/${user.wallet_address}`);
      onChainBalance = bal.balance;
    } catch (e) {
      console.warn('[WATT] /api/producer/energy-summary balance:', e.message);
    }
  }

  return res.json({
    wallet_address: user.wallet_address,
    pending_kwh:    Number(user.pending_watt) || 0,
    credited_watt:  Number(user.credited_watt) || 0,
    last_energy_kwh: user.last_energy_kwh,
    last_mint:      lastMint || null,
    on_chain_balance: onChainBalance,
    chain_id:         84532,
    contract_address: process.env.WATT_CONTRACT_ADDRESS || '0xf07ce10cE718fEe22dFEe06B4048B734bC95b954',
  });
});

// ── POST /api/lookup — lightweight account lookup for existing email ──────
app.post('/api/lookup', adminLimiter, lookupLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  const { data: user } = await supabase
    .from('waitlist_users')
    .select('email_verified, password_hash')
    .eq('email', email)
    .maybeSingle();

  if (!user) {
    return res.status(404).json({ error: 'No account found for this email. Are you on the waitlist?' });
  }
  return res.json({
    exists: true,
    emailVerified: toBool(user.email_verified),
    hasPassword: Boolean(user.password_hash),
  });
});

// ── GET /api/leaderboard — top 10 referrers (emails masked) ───────────────
app.get('/api/leaderboard', async (req, res) => {
  // Count live referrals per referral_code by querying referred_by column
  const { data, error } = await supabase
    .from('waitlist_users')
    .select('referral_code, referred_by, founding_member, email_verified')
    .not('referred_by', 'is', null);
  const verifiedRows = (data || []).filter((row) => row.referred_by && toBool(row.email_verified));

  if (error) return res.status(500).json({ error: error.message });

  // Build counts map
  const counts = {};
  verifiedRows.forEach(row => {
    const code = (row.referred_by || '').toUpperCase();
    if (code) counts[code] = (counts[code] || 0) + 1;
  });

  // Get top 10 codes
  const topCodes = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([code, count]) => ({ code, count }));

  if (!topCodes.length) return res.json({ leaders: [] });

  // Look up emails for these codes (masked for privacy)
  const { data: users } = await supabase
    .from('waitlist_users')
    .select('referral_code, email, founding_member')
    .in('referral_code', topCodes.map(t => t.code));

  const userMap = {};
  (users || []).forEach(u => { userMap[u.referral_code] = u; });

  const cfg = await getConfig();
  const referralReward = parseInt(cfg.referral_reward_watt) || 500;

  const leaders = topCodes.map((t, i) => {
    const u = userMap[t.code] || {};
    const [local = '', domain = ''] = (u.email || '').split('@');
    const masked = local.length > 2
      ? local.slice(0, 2) + '***@' + domain
      : '***@' + domain;
    return {
      rank:          i + 1,
      maskedEmail:   masked,
      referralCode:  t.code,
      referrals:     t.count,
      wattEarned:    t.count * referralReward,
      foundingMember: u.founding_member || false,
    };
  });

  return res.json({ leaders });
});

// ── GET /api/stats — public, no auth required ─────────────────────────────
app.get('/api/stats', async (req, res) => {
  setShortCache(res, 60);
  const [{ count: total }, cfg] = await Promise.all([
    supabase.from('waitlist_users').select('*', { count: 'exact', head: true }),
    getConfig(),
  ]);
  return res.json({
    total:     total || 0,
    threshold: parseInt(cfg.founding_member_threshold) || 1000,
  });
});

// ── GET /unsubscribe?email=... — one-click unsubscribe from emails ─────────
app.get('/unsubscribe', async (req, res) => {
  const email = normalizeEmail(req.query.email);
  const sig = String(req.query.sig || '').trim();
  const siteUrl = getSiteUrl(req);

  if (!isValidEmail(email) || !sig || !constantTimeEqual(sig, signValue(`unsubscribe:${email}`))) {
    return res.send(renderSimplePage({
      title: 'Unsubscribe — $WATT Protocol',
      heading: 'Invalid Link',
      body: `This unsubscribe link is invalid or expired. Email us at <a href="mailto:${process.env.CONTACT_EMAIL || process.env.FROM_EMAIL || process.env.SMTP_USER}">${process.env.CONTACT_EMAIL || process.env.FROM_EMAIL || process.env.SMTP_USER}</a> to opt out.`,
      siteUrl,
      tone: 'red',
    }));
  }

  try {
    await supabase
      .from('waitlist_users')
      .update({ unsubscribed: true })
      .eq('email', email);
  } catch {}

  console.log(`[WATT] Unsubscribe: ${email}`);

  return res.send(renderSimplePage({
    title: 'Unsubscribed — $WATT Protocol',
    heading: `You've been unsubscribed.`,
    body: `We've removed <strong style="color:#fff">${email}</strong> from our mailing list. Your waitlist spot is preserved and you can still access your dashboard anytime.`,
    siteUrl,
  }));
});

// ── GET /api/announcement — public, no auth required ──────────────────────
app.get('/api/announcement', async (req, res) => {
  setShortCache(res, 60);
  const cfg = await getConfig();
  return res.json({ announcement: cfg.announcement || '' });
});

// ── GET /api/roadmap — public, no auth required ────────────────────────────
app.get('/api/roadmap', async (req, res) => {
  setShortCache(res, 60);
  const cfg = await getConfig();
  let stages = [];
  try { stages = JSON.parse(cfg.roadmap || '[]'); } catch {}
  return res.json({ stages });
});

// ── POST /api/send-dashboard-link ─────────────────────────────────────────
app.post('/api/send-dashboard-link', emailActionLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Valid email required.' });
  }

  const { data: user } = await supabase
    .from('waitlist_users')
    .select('referral_code')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (user) {
    const siteUrl      = getSiteUrl(req);
    const dashboardUrl = `${siteUrl}/dashboard.html`;
    try {
      await sendManagedMail({
        to:      email,
        subject: 'Your $WATT Dashboard Link',
        html:    buildMagicLinkHtml(dashboardUrl, siteUrl),
        text:    `Your $WATT dashboard: ${dashboardUrl}`,
        transactional: true,
        siteUrl,
      });
    } catch (err) {
      console.error('[WATT] Magic link email error:', err.message);
    }
  }

  return res.json({ success: true });
});

// ── POST /api/pageview — lightweight privacy-first page analytics ──────────
app.post('/api/pageview', async (req, res) => {
  const page = (req.body?.page || '').slice(0, 120).replace(/[^a-zA-Z0-9/_.-]/g, '');
  if (!page) return res.sendStatus(204);
  res.setHeader('Cache-Control', 'no-store');
  res.sendStatus(204);

  // Upsert asynchronously so analytics never slow the response path.
  Promise.resolve()
    .then(async () => {
      try {
        const { error } = await supabase.rpc('increment_page_view', { p_page: page });
        if (error) {
          await supabase.from('page_views')
            .upsert({ page, views: 1, updated_at: new Date().toISOString() }, { onConflict: 'page' });
        }
      } catch {
        // ignore analytics errors — never crash the server
      }
    });
});

// ── GET /api/admin/pageviews — top pages by views ─────────────────────────
app.get('/api/admin/pageviews', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('page_views')
    .select('page, views, updated_at')
    .order('views', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ pages: data || [] });
});

// ── GET /api/admin/geo — user distribution by country ─────────────────────
app.get('/api/admin/geo', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('waitlist_users')
    .select('country_code, country_name, signup_lat, signup_lng')
    .not('country_code', 'is', null);

  if (error) {
    // Columns likely don't exist yet — return empty result so the dashboard doesn't crash
    console.warn('[WATT] /api/admin/geo error (run migrations?):', error.message);
    return res.json({ countries: [], total: 0, migrationNeeded: true });
  }

  // Aggregate by country
  const map = {};
  for (const u of data || []) {
    const code = u.country_code;
    if (!map[code]) {
      map[code] = { code, name: u.country_name || COUNTRY_NAMES[code] || code, count: 0, lats: [], lngs: [] };
    }
    map[code].count++;
    if (u.signup_lat != null) map[code].lats.push(u.signup_lat);
    if (u.signup_lng != null) map[code].lngs.push(u.signup_lng);
  }

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const countries = Object.values(map)
    .map(c => ({ code: c.code, name: c.name, count: c.count, lat: avg(c.lats), lng: avg(c.lngs) }))
    .sort((a, b) => b.count - a.count);

  return res.json({ countries, total: (data || []).length });
});

// ═══════════════════════════════════════════════════════════════
//  ADMIN ROUTES — all protected by requireAdmin middleware
// ═══════════════════════════════════════════════════════════════

// GET /api/admin/chart — daily signups for the last N days
app.get('/api/admin/chart', requireAdmin, async (req, res) => {
  const days = Math.min(90, parseInt(req.query.days) || 30);
  const from = new Date();
  from.setDate(from.getDate() - days + 1);
  from.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('waitlist_users')
    .select('signed_up_at')
    .gte('signed_up_at', from.toISOString())
    .order('signed_up_at');

  if (error) return res.status(500).json({ error: error.message });

  // Build date → count map
  const counts = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    counts[d.toISOString().slice(0, 10)] = 0;
  }
  (data || []).forEach(r => {
    const day = r.signed_up_at.slice(0, 10);
    if (counts[day] !== undefined) counts[day]++;
  });

  return res.json({ labels: Object.keys(counts), values: Object.values(counts) });
});

// GET /api/admin/stats — overview dashboard
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const [
    { count: total },
    { count: founding },
    { count: todayCount },
    { data: topReferrers },
    { data: recent },
    { data: refRows },
    cfg,
  ] = await Promise.all([
    supabase.from('waitlist_users').select('*', { count: 'exact', head: true }),
    supabase.from('waitlist_users').select('*', { count: 'exact', head: true }).eq('founding_member', true),
    supabase.from('waitlist_users').select('*', { count: 'exact', head: true }).gte('signed_up_at', today.toISOString()),
    supabase.from('waitlist_users').select('email, referral_code, referrals_count').order('referrals_count', { ascending: false }).limit(5),
    supabase.from('waitlist_users').select('email, referral_code, founding_member, signed_up_at, referred_by').order('signed_up_at', { ascending: false }).limit(10),
    supabase.from('waitlist_users').select('referrals_count').eq('email_verified', true),
    getConfig(),
  ]);

  const totalReferrals = (refRows || []).reduce((s, r) => s + (r.referrals_count || 0), 0);

  return res.json({ total, founding, todayCount, totalReferrals, topReferrers, recent, config: cfg });
});

// GET /api/admin/users?page=1&search=&limit=20
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 25);
  const search = (req.query.search || '').trim();
  const from   = (page - 1) * limit;

  let q = supabase
    .from('waitlist_users')
    .select('id, email, referral_code, referrals_count, founding_member, signed_up_at, referred_by', { count: 'exact' })
    .order('signed_up_at', { ascending: false })
    .range(from, from + limit - 1);

  if (search) q = q.ilike('email', `%${search}%`);

  const { data, count, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ users: data || [], total: count || 0, page, pages: Math.ceil((count || 0) / limit) });
});

// PATCH /api/admin/users/:id — update founding_member status
app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const allowed = ['founding_member', 'status'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  const { error } = await supabase.from('waitlist_users').update(updates).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await logAdminAction(req, 'update_user', 'waitlist_user', req.params.id, updates);
  return res.json({ success: true });
});

// DELETE /api/admin/users/:id
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('waitlist_users').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await logAdminAction(req, 'delete_user', 'waitlist_user', req.params.id);
  return res.json({ success: true });
});

// GET /api/admin/config
app.get('/api/admin/config', requireAdmin, async (req, res) => {
  const { data, error } = await supabase.from('watt_config').select('key, value').order('key');
  if (error) return res.status(500).json({ error: error.message });
  return res.json(Object.fromEntries((data || []).map(r => [r.key, r.value])));
});

// PUT /api/admin/config — upsert one or many config values
app.put('/api/admin/config', requireAdmin, async (req, res) => {
  const rows = Object.entries(req.body).map(([key, value]) => ({
    key,
    value:      String(value),
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from('watt_config').upsert(rows, { onConflict: 'key' });
  if (error) return res.status(500).json({ error: error.message });
  invalidateConfig();
  await logAdminAction(req, 'update_config', 'config', null, req.body);
  return res.json({ success: true });
});

// POST /api/admin/resend-email/:id — resend welcome email to a user
app.post('/api/admin/resend-email/:id', requireAdmin, emailActionLimiter, async (req, res) => {
  const { data: user } = await supabase
    .from('waitlist_users')
    .select('email, referral_code, referral_link')
    .eq('id', req.params.id)
    .maybeSingle();

  if (!user) return res.status(404).json({ error: 'User not found.' });

  const siteUrl      = getSiteUrl(req);
  const dashboardUrl = `${siteUrl}/dashboard.html?ref=${user.referral_code}`;

  try {
    await sendManagedMail({
      to:      user.email,
      subject: 'Your $WATT Dashboard Link',
      html:    buildMagicLinkHtml(dashboardUrl, siteUrl),
      text:    `Your $WATT dashboard: ${dashboardUrl}`,
      transactional: true,
      siteUrl,
    });
    console.log(`[WATT] Admin resent dashboard email to ${user.email}`);
    await logAdminAction(req, 'resend_email', 'waitlist_user', req.params.id, { email: user.email });
    return res.json({ success: true });
  } catch (err) {
    console.error('[WATT] Admin resend email error:', err.message);
    return res.status(500).json({ error: 'Email send failed: ' + err.message });
  }
});

// GET /api/admin/export — download all users as CSV
app.get('/api/admin/export', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('waitlist_users')
    .select('email, referral_code, referrals_count, founding_member, signed_up_at, referred_by')
    .order('signed_up_at');
  if (error) return res.status(500).json({ error: error.message });

  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [
    'Email,Referral Code,Referrals,Founding Member,Signed Up,Referred By',
    ...(data || []).map(u =>
      [q(u.email), q(u.referral_code), u.referrals_count || 0, u.founding_member, q(u.signed_up_at), q(u.referred_by || '')].join(',')
    ),
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="watt-waitlist-${new Date().toISOString().slice(0,10)}.csv"`);
  return res.send(csv);
});

// ── /og-image.png — serve SVG OG image (Discord/Slack/Twitter parse SVG fine) ──
app.get('/og-image.png', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'og-image.svg'), {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
  });
});

// ── /favicon.ico — serve the SVG favicon (stops browser 404 noise) ────────
app.get('/favicon.ico', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'assets/img/logo/watt_logo.svg'), {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
  });
});

// ── 404 fallback — serve custom 404 page for unmatched routes ─────────────
app.use((_req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  app.listen(PORT, () => {
    const senderAddress = getSenderAddress();
    const configuredFrom = normalizeEmail(process.env.FROM_EMAIL);
    const smtpUser = normalizeEmail(process.env.SMTP_USER);
    console.log(`[WATT] Server  → http://localhost:${PORT}`);
    console.log(`[WATT] SMTP    → ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}`);
    console.log(`[WATT] Sender  → ${senderAddress || '[warn] sender not set'}`);
    console.log(`[WATT] DB      → ${process.env.SUPABASE_URL || '[warn] SUPABASE_URL not set'}`);
    console.log(`[WATT] Admin   → ${process.env.ADMIN_EMAIL  || '[warn] ADMIN_EMAIL not set'}`);
    if (configuredFrom && smtpUser && configuredFrom !== smtpUser && !toBool(process.env.SMTP_ALLOW_CUSTOM_FROM)) {
      console.warn(`[WATT] Mail warning → FROM_EMAIL (${configuredFrom}) does not match SMTP_USER (${smtpUser}). Using SMTP_USER as the actual sender for better delivery.`);
    }
  });
}

export default app;
export { app, hashSecret, signValue, isValidEmail };
