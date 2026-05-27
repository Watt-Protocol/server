import test from 'node:test';
import assert from 'node:assert/strict';

function createFakeSupabase() {
  const tables = {
    waitlist_users: [],
    auth_sessions: [],
    admin_audit_logs: [],
    watt_config: [],
    page_views: [],
  };
  const ids = { waitlist_users: 1, auth_sessions: 1, admin_audit_logs: 1, page_views: 1 };

  const parseColumns = (value) => {
    if (!value || value === '*') return null;
    return value.split(',').map((part) => part.trim()).filter(Boolean);
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));

  class Query {
    constructor(table) {
      this.table = table;
      this.action = 'select';
      this.columns = null;
      this.filters = [];
      this.options = {};
      this.single = false;
      this.updateValues = null;
      this.insertRows = null;
      this.limitValue = null;
      this.rangeValue = null;
      this.orderBy = null;
    }

    select(columns, options = {}) { this.action = 'select'; this.columns = parseColumns(columns); this.options = options; return this; }
    insert(rows) { this.action = 'insert'; this.insertRows = rows; return this; }
    update(values) { this.action = 'update'; this.updateValues = values; return this; }
    delete() { this.action = 'delete'; return this; }
    upsert(rows) { this.action = 'upsert'; this.insertRows = rows; return this; }
    eq(field, value) { this.filters.push((row) => row[field] === value); return this; }
    not(field, op, value) { this.filters.push((row) => op === 'is' ? row[field] !== value : true); return this; }
    ilike(field, value) {
      const needle = String(value).replaceAll('%', '').toLowerCase();
      this.filters.push((row) => String(row[field] || '').toLowerCase().includes(needle));
      return this;
    }
    in(field, values) { this.filters.push((row) => values.includes(row[field])); return this; }
    lte(field, value) { this.filters.push((row) => row[field] <= value); return this; }
    gte(field, value) { this.filters.push((row) => row[field] >= value); return this; }
    maybeSingle() { this.single = true; return this; }
    order(field, options = {}) { this.orderBy = { field, ascending: options.ascending !== false }; return this; }
    limit(value) { this.limitValue = value; return this; }
    range(from, to) { this.rangeValue = { from, to }; return this; }

    then(resolve, reject) {
      return this.execute().then(resolve, reject);
    }

    async execute() {
      const rows = tables[this.table];
      if (!rows) return { data: null, error: new Error(`Unknown table ${this.table}`) };

      if (this.action === 'insert') {
        const inserted = this.insertRows.map((row) => {
          const copy = clone(row);
          if (this.table === 'waitlist_users' || this.table === 'auth_sessions' || this.table === 'admin_audit_logs' || this.table === 'page_views') {
            copy.id = copy.id ?? ids[this.table]++;
          }
          copy.signed_up_at = copy.signed_up_at || new Date().toISOString();
          tables[this.table].push(copy);
          return clone(copy);
        });
        return { data: inserted, error: null };
      }

      if (this.action === 'upsert') {
        for (const row of this.insertRows) {
          const idx = rows.findIndex((existing) => existing.key === row.key);
          if (idx === -1) rows.push(clone(row));
          else rows[idx] = { ...rows[idx], ...clone(row) };
        }
        return { data: clone(this.insertRows), error: null };
      }

      let filtered = rows.filter((row) => this.filters.every((fn) => fn(row)));

      if (this.action === 'update') {
        filtered.forEach((row) => Object.assign(row, clone(this.updateValues)));
        return { data: clone(filtered), error: null };
      }

      if (this.action === 'delete') {
        tables[this.table] = rows.filter((row) => !filtered.includes(row));
        return { data: null, error: null };
      }

      if (this.orderBy) {
        filtered = [...filtered].sort((a, b) => {
          if (a[this.orderBy.field] === b[this.orderBy.field]) return 0;
          return this.orderBy.ascending
            ? (a[this.orderBy.field] > b[this.orderBy.field] ? 1 : -1)
            : (a[this.orderBy.field] < b[this.orderBy.field] ? 1 : -1);
        });
      }
      if (this.rangeValue) filtered = filtered.slice(this.rangeValue.from, this.rangeValue.to + 1);
      if (this.limitValue != null) filtered = filtered.slice(0, this.limitValue);

      if (this.options.head && this.options.count === 'exact') {
        return { data: null, count: filtered.length, error: null };
      }

      const mapped = this.columns
        ? filtered.map((row) => Object.fromEntries(this.columns.map((column) => [column, row[column]])))
        : filtered.map((row) => clone(row));

      if (this.single) return { data: mapped[0] || null, error: null };
      return { data: mapped, count: mapped.length, error: null };
    }
  }

  return {
    tables,
    from(table) { return new Query(table); },
    rpc() { return Promise.resolve({ data: null, error: null }); },
  };
}

function createTransportStub() {
  const sent = [];
  return {
    sent,
    async sendMail(mail) {
      sent.push(mail);
      return { messageId: String(sent.length) };
    },
  };
}

function getCookieValue(setCookie, name) {
  const entry = Array.isArray(setCookie) ? setCookie.find((value) => value.startsWith(`${name}=`)) : setCookie;
  return entry?.split(';')[0]?.split('=')[1] || '';
}

const fakeSupabase = createFakeSupabase();
const transporter = createTransportStub();
globalThis.__WATT_TEST_HOOKS__ = { supabase: fakeSupabase, transporter };

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret';
process.env.AUTH_SALT = 'test-salt';
process.env.ADMIN_EMAIL = 'admin@watt.test';
process.env.ADMIN_PASSWORD = 'AdminPass123!';
process.env.SITE_URL = 'http://127.0.0.1';

const { app, signValue } = await import('../server.js');
const server = app.listen(0);
const baseUrl = `http://127.0.0.1:${server.address().port}`;

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('signup requires verification before referral credit is counted', async () => {
  fakeSupabase.tables.waitlist_users.push({
    id: 99,
    email: 'referrer@watt.test',
    password_hash: 'x',
    referral_code: 'REF12345',
    referral_link: `${baseUrl}/ref/REF12345`,
    referrals_count: 0,
    email_verified: true,
    signed_up_at: new Date('2026-01-01').toISOString(),
  });

  const signupRes = await fetch(`${baseUrl}/api/waitlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'newuser@watt.test',
      password: 'Password123!',
      referredBy: 'REF12345',
      website: '',
    }),
  });
  const signupJson = await signupRes.json();
  assert.equal(signupRes.status, 200);
  assert.equal(signupJson.requiresVerification, true);
  assert.equal(fakeSupabase.tables.waitlist_users.find((u) => u.email === 'referrer@watt.test').referrals_count, 0);

  const verifyMail = transporter.sent.at(-1);
  assert.match(verifyMail.text, /verify-email\?token=/);
  const token = verifyMail.text.match(/token=([a-f0-9]+)/i)[1];
  const verifyRes = await fetch(`${baseUrl}/verify-email?token=${token}`, { redirect: 'manual' });
  assert.equal(verifyRes.status, 302);
  assert.equal(fakeSupabase.tables.waitlist_users.find((u) => u.email === 'referrer@watt.test').referrals_count, 1);
  assert.equal(fakeSupabase.tables.waitlist_users.find((u) => u.email === 'newuser@watt.test').email_verified, true);
});

test('lookup returns account availability metadata', async () => {
  const res = await fetch(`${baseUrl}/api/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'newuser@watt.test' }),
  });
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.exists, true);
  assert.equal(json.emailVerified, true);
  assert.equal(json.hasPassword, true);
});

test('user can sign in, request reset, and reset password', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'newuser@watt.test', password: 'Password123!' }),
  });
  assert.equal(loginRes.status, 200);
  const loginCookie = getCookieValue(loginRes.headers.getSetCookie?.() || loginRes.headers.get('set-cookie'), 'watt_session');
  assert.ok(loginCookie);

  const forgotRes = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'newuser@watt.test', website: '' }),
  });
  assert.equal(forgotRes.status, 200);
  const resetMail = transporter.sent.at(-1);
  const resetToken = resetMail.text.match(/reset=([a-f0-9]+)/i)[1];

  const statusRes = await fetch(`${baseUrl}/api/auth/reset-password-status?token=${resetToken}`);
  const statusJson = await statusRes.json();
  assert.equal(statusRes.status, 200);
  assert.equal(statusJson.valid, true);

  const resetRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: resetToken, password: 'NewPass123!', confirmPassword: 'NewPass123!' }),
  });
  const resetJson = await resetRes.json();
  assert.equal(resetRes.status, 200);
  assert.match(resetJson.message, /sign in/i);
  const resetCookie = getCookieValue(resetRes.headers.getSetCookie?.() || resetRes.headers.get('set-cookie'), 'watt_session');
  assert.equal(resetCookie, '');
  assert.equal(fakeSupabase.tables.auth_sessions.filter((s) => s.user_id === 1 && s.role === 'user').length, 0);

  const confirmationMail = transporter.sent.at(-1);
  assert.match(confirmationMail.subject, /password was changed/i);

  const reloginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'newuser@watt.test', password: 'NewPass123!' }),
  });
  assert.equal(reloginRes.status, 200);
});

test('admin auth creates a session and audit log entry', async () => {
  const res = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@watt.test', password: 'AdminPass123!' }),
  });
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.success, true);
  assert.equal(fakeSupabase.tables.admin_audit_logs.at(-1).action, 'login');
});

test('signed unsubscribe marks the recipient unsubscribed', async () => {
  const email = 'newuser@watt.test';
  const sig = signValue(`unsubscribe:${email}`);
  const res = await fetch(`${baseUrl}/unsubscribe?email=${encodeURIComponent(email)}&sig=${sig}`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /unsubscribed/i);
  assert.equal(fakeSupabase.tables.waitlist_users.find((u) => u.email === email).unsubscribed, true);
});
