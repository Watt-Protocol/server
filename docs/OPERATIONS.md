# Operations Runbook

This runbook documents how to run and operate the `server` website/API stack safely.

## 1) Prerequisites

- Node.js 20+ (required by transitive dependencies in lockfile)
- npm 10+
- Supabase project with required tables/functions
- SMTP provider credentials for transactional mail

## 2) Local setup

1. Install dependencies:
   - `npm install`
2. Configure env:
   - `cp .env.example .env`
   - fill required values
3. Start dev server:
   - `npm run dev`
4. Run tests:
   - `npm test`

## 3) Required environment variables

Core runtime:
- `NODE_ENV`
- `PORT`
- `SITE_URL` (optional, but recommended in production)
- `CORS_ALLOWED_ORIGINS` (optional unless cross-origin frontend is used)

Supabase:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

SMTP:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_ALLOW_CUSTOM_FROM` (optional)
- `FROM_EMAIL`
- `FROM_NAME`
- `CONTACT_EMAIL`

Auth/admin:
- `SESSION_SECRET`
- `AUTH_SALT`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD_HASH` (preferred) or `ADMIN_PASSWORD`
- `ADMIN_KEY` (legacy fallback used in signature secret chain)

Optional anti-abuse:
- `DISPOSABLE_EMAIL_DOMAINS`

## 4) Supabase schema expectations

The server references the following tables:
- `waitlist_users`
- `auth_sessions`
- `admin_audit_logs`
- `watt_config`
- `page_views`

The server also attempts RPC:
- `increment_page_view(p_page text)`

At minimum, these logical fields are used:
- `waitlist_users`: email, password_hash, referral_code, referral_link, referred_by, referrals_count, founding_member, signed_up_at, email_verified, verification_token, verification_expires_at, reset_token, reset_token_expires_at, unsubscribed, country_code, country_name, signup_lat, signup_lng
- `auth_sessions`: role, user_id, admin_email, token_hash, expires_at
- `admin_audit_logs`: admin_email, action, target_type, target_id, details, ip_address, user_agent
- `watt_config`: key, value, updated_at
- `page_views`: page, views, updated_at

If schema columns are missing, some routes return migration/setup errors by design.

## 5) SMTP guidance

Recommended:
- use dedicated mailbox/API user for operational mail
- set `FROM_EMAIL` equal to `SMTP_USER` unless provider explicitly permits custom sender domains
- test verification and reset flows before production rollout

## 6) API operational checks

After deployment, validate:
- `GET /api/stats`
- `GET /api/leaderboard`
- `POST /api/waitlist` (test mailbox)
- `GET /verify-email?token=...` flow
- `POST /api/auth/login` and `POST /api/auth/forgot-password`
- admin login and `GET /api/admin/stats`

## 7) Vercel deployment notes

- Vercel routes all traffic to `api/index.js`, which exports the Express app.
- `vercel.json` includes `public/**` and `templates/**`.
- Set all required env vars in Vercel Project Settings for each environment.

## 8) Troubleshooting

Supabase misconfigured:
- Symptom: `/api/*` returns server misconfigured error
- Fix: set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`

Email delivery failing:
- Symptom: signup succeeds but no verification/reset email
- Fix: check SMTP credentials, provider sender policy, and `FROM_EMAIL` alignment

Admin endpoints unauthorized:
- Symptom: 401/500 around admin auth
- Fix: verify `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH`/`ADMIN_PASSWORD`

CORS issues:
- Symptom: browser CORS errors for API requests
- Fix: populate `CORS_ALLOWED_ORIGINS` with exact origin(s), comma-separated

Session instability:
- Symptom: frequent re-authentication
- Fix: set stable `SESSION_SECRET` and ensure HTTPS + secure cookies in production
