// ═══════════════════════════════════════════════════════════════════════
//  $WATT PROTOCOL — Waitlist Email Integration
//  wattprotocol.io  ·  hello@wattprotocol.io
//  Stack: Node.js / Next.js  ·  Resend  ·  Airtable
//  ─────────────────────────────────────────────────────────────────────
//  Why Resend?
//  • Generous free tier: 3,000 emails/month, no credit card needed
//  • First-class attachment support (perfect for the whitepaper PDF)
//  • Dead-simple API — 5-minute setup from zero
//  • Domain verification via DNS (takes ~10 min, deliverability is great)
// ═══════════════════════════════════════════════════════════════════════


// ──────────────────────────────────────────────────────────────────────
//  STEP 1 — INSTALL
//  npm install resend airtable nanoid
// ──────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────
//  STEP 2 — .env.local (never commit this file)
// ──────────────────────────────────────────────────────────────────────
//
//  RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
//  AIRTABLE_API_KEY=patxxxxxxxxxxxxxxxxxx
//  AIRTABLE_BASE_ID=appxxxxxxxxxxxxxxxxx
//  WATT_FROM_EMAIL=hello@wattprotocol.io
//  WATT_BASE_URL=https://wattprotocol.io
//


// ──────────────────────────────────────────────────────────────────────
//  FILE: /pages/api/waitlist.js
//  (Next.js API route — works identically as an Express route)
// ──────────────────────────────────────────────────────────────────────

import { Resend } from 'resend';
import Airtable from 'airtable';
import { nanoid } from 'nanoid';
import fs from 'fs';
import path from 'path';

const resend = new Resend(process.env.RESEND_API_KEY);
const base   = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
                 .base(process.env.AIRTABLE_BASE_ID);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email } = req.body;

  // Validate
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email address required.' });
  }

  try {
    // ── Generate referral code ───────────────────────────────────────
    const referralCode = nanoid(8).toUpperCase(); // e.g. "X7K2PQ4M"
    const referralLink = `${process.env.WATT_BASE_URL}/ref/${referralCode}`;

    // ── Save to Airtable ─────────────────────────────────────────────
    await base('Waitlist').create([{
      fields: {
        'Email':           email,
        'Referral Code':   referralCode,
        'Referral Link':   referralLink,
        'Signed Up At':    new Date().toISOString(),
        'Status':          'Active',
        'Referrals Count': 0,
      }
    }]);

    // ── Load whitepaper PDF ──────────────────────────────────────────
    //   Place the PDF at: /public/watt-protocol-whitepaper.pdf
    const pdfPath   = path.join(process.cwd(), 'public', 'watt-protocol-whitepaper.pdf');
    const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');

    // ── Build personalised HTML email ────────────────────────────────
    const emailHtml = buildEmail(referralCode, referralLink);

    // ── Send via Resend ──────────────────────────────────────────────
    const { error } = await resend.emails.send({
      from:    `$WATT Protocol <${process.env.WATT_FROM_EMAIL}>`,
      to:      email,
      subject: "You're in — $WATT Protocol. Energy to Earn.",
      html:    emailHtml,
      text:    buildPlainText(referralCode, referralLink),
      attachments: [{
        filename:    'WATT-Protocol-Whitepaper-2025.pdf',
        content:     pdfBase64,
        type:        'application/pdf',
        disposition: 'attachment',
      }],
    });

    if (error) {
      console.error('[WATT] Resend error:', error);
      return res.status(500).json({ error: 'Email failed. Please try again.' });
    }

    console.log(`[WATT] Waitlist signup recorded → ${email} | ref:${referralCode}`);
    return res.status(200).json({ success: true, referralCode });

  } catch (err) {
    console.error('[WATT] Handler error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}


// ──────────────────────────────────────────────────────────────────────
//  EMAIL BUILDER
//  Loads watt-waitlist-email.html and injects the referral code.
//  Place the template at: /emails/watt-waitlist-email.html
// ──────────────────────────────────────────────────────────────────────

function buildEmail(referralCode, referralLink) {
  const tplPath = path.join(process.cwd(), 'emails', 'watt-waitlist-email.html');
  return fs.readFileSync(tplPath, 'utf8')
    .replaceAll('{{REFERRAL_CODE}}',   referralCode)
    .replaceAll('{{REFERRAL_LINK}}',   referralLink)
    .replaceAll('{{UNSUBSCRIBE_URL}}', `${process.env.WATT_BASE_URL}/unsubscribe`);
}

function buildPlainText(referralCode, referralLink) {
  return `
YOU'RE IN — $WATT PROTOCOL
wattprotocol.io

Welcome to the global clean energy revolution.

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
Website:  ${process.env.WATT_BASE_URL}

Born in Africa. Powered by the Sun. Built for Everyone.

────────────────────────────────
$WATT is a utility token. This is not financial advice.
Unsubscribe: ${process.env.WATT_BASE_URL}/unsubscribe
`.trim();
}


// ──────────────────────────────────────────────────────────────────────
//  FRONTEND SCRIPT
//  Paste this into the <script> block of your landing page.
//  Targets the existing .wl-btn / .wl-input / .wl-note elements.
// ──────────────────────────────────────────────────────────────────────

/*

(function () {
  const btn   = document.querySelector('.wl-btn');
  const input = document.querySelector('.wl-input');
  const note  = document.querySelector('.wl-note');
  if (!btn || !input) return;

  btn.addEventListener('click', async () => {
    const email = input.value.trim();

    // Validate
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      input.style.borderColor = '#ff4444';
      return;
    }

    // Loading state
    btn.textContent = 'Joining...';
    btn.disabled    = true;
    input.disabled  = true;
    input.style.borderColor = '';

    try {
      const res  = await fetch('/api/waitlist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        // Success
        btn.textContent          = 'You\'re In!';
        btn.style.background     = '#22c55e';
        btn.style.borderColor    = '#22c55e';
        input.value              = '';
        note.textContent         = 'Check your inbox — whitepaper and referral link are on the way.';
        note.style.color         = '#F5C518';
      } else {
        // Error
        btn.textContent  = 'Try Again';
        btn.disabled     = false;
        input.disabled   = false;
        note.textContent = data.error || 'Something went wrong.';
        note.style.color = '#ff4444';
      }
    } catch {
      btn.textContent  = 'Try Again';
      btn.disabled     = false;
      input.disabled   = false;
      note.textContent = 'Network error. Please try again.';
      note.style.color = '#ff4444';
    }
  });

  // Clear error on focus
  input.addEventListener('focus', () => { input.style.borderColor = ''; });

  // Enter key submits
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
})();

*/


// ──────────────────────────────────────────────────────────────────────
//  REFERRAL TRACKING
//  FILE: /pages/api/ref/[code].js
//  When someone visits wattprotocol.io/ref/X7K2PQ4M this fires.
// ──────────────────────────────────────────────────────────────────────

/*

export default async function refHandler(req, res) {
  const { code } = req.query;

  // Find referrer in Airtable and increment their count
  try {
    const records = await base('Waitlist').select({
      filterByFormula: `{Referral Code} = '${code}'`,
      maxRecords: 1,
    }).firstPage();

    if (records.length > 0) {
      const rec   = records[0];
      const count = rec.fields['Referrals Count'] || 0;
      await base('Waitlist').update(rec.id, { 'Referrals Count': count + 1 });
    }
  } catch (err) {
    console.error('[WATT] Ref tracking error:', err);
  }

  // Drop cookie so the signup form knows who referred this visitor
  res.setHeader('Set-Cookie', `watt_ref=${code}; Path=/; Max-Age=604800; SameSite=Lax`);
  res.redirect(302, '/');
}

*/


// ══════════════════════════════════════════════════════════════════════
//  SETUP CHECKLIST — do this once, in order
// ══════════════════════════════════════════════════════════════════════
//
//  1. RESEND  →  resend.com (free, no credit card)
//     ├─ Create account
//     ├─ Add domain: wattprotocol.io  (or the domain you have)
//     ├─ Add the 3 DNS records Resend shows you (takes ~10 min to verify)
//     └─ Copy API key → RESEND_API_KEY in .env.local
//
//  2. AIRTABLE  →  airtable.com (free)
//     ├─ Create base: "$WATT Protocol"
//     ├─ Create table: "Waitlist" with these fields:
//     │     Email           (Email field type)
//     │     Referral Code   (Single line text)
//     │     Referral Link   (URL)
//     │     Signed Up At    (Date, include time)
//     │     Status          (Single select: Active / Unsubscribed)
//     │     Referrals Count (Number)
//     ├─ Get API token: airtable.com/create/tokens  → AIRTABLE_API_KEY
//     └─ Get Base ID from your base URL: airtable.com/appXXXXXX/...
//
//  3. FILES IN YOUR PROJECT
//     ├─ /public/watt-protocol-whitepaper.pdf   ← the PDF from this build
//     ├─ /emails/watt-waitlist-email.html       ← the email template
//     └─ /pages/api/waitlist.js                ← this file
//
//  4. ADD FRONTEND SCRIPT to your landing page <script> block
//
//  5. TEST IT LOCALLY
//     curl -X POST http://localhost:3000/api/waitlist \
//       -H "Content-Type: application/json" \
//       -d '{"email":"your@email.com"}'
//     → Check inbox for email + PDF attachment
//     → Check Airtable for the new row
//
//  6. DEPLOY  →  vercel.com (free)
//     npm i -g vercel && vercel --prod
//     Add all env vars in:
//     Vercel Dashboard → Project → Settings → Environment Variables
//
// ══════════════════════════════════════════════════════════════════════
