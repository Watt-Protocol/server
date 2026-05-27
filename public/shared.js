/* ═══════════════════════════════════════════════════════
   $WATT PROTOCOL — SHARED NAV + FOOTER + CURSOR
   Include this script on every page
   ═══════════════════════════════════════════════════════ */

(function() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  const currentOrigin = window.location.origin;
  const currentUrl = window.location.href.split('#')[0];
  const resolveUrl = (relativePath) => new URL(relativePath, `${currentOrigin}/`).toString();
  const _apiBase = window.WATT_API_BASE || document.documentElement.dataset.apiBase || '';
  const supportsFinePointer = window.matchMedia('(pointer:fine)').matches;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scheduleNonCritical = (fn) => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => fn(), { timeout: 700 });
      return;
    }
    window.setTimeout(fn, 1);
  };

  // Keep canonical/OG URLs in sync with the active browser address.
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute('href', currentUrl);
  const ogUrl = document.querySelector('meta[property="og:url"]');
  if (ogUrl) ogUrl.setAttribute('content', currentUrl);
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage) ogImage.setAttribute('content', resolveUrl('og-image.png'));
  const twitterImage = document.querySelector('meta[name="twitter:image"]');
  if (twitterImage) twitterImage.setAttribute('content', resolveUrl('og-image.png'));

  function renderAnnouncement(message) {
    const announcement = String(message || '').trim();
    const el = document.getElementById('watt-announcement');
    if (!el) return;
    if (!announcement) {
      el.style.display = 'none';
      return;
    }
    el.textContent = announcement;
    el.style.display = 'block';
    const bannerH = el.offsetHeight;
    const nav = document.getElementById('watt-nav');
    const mob = document.getElementById('navMobile');
    if (nav) nav.style.top = bannerH + 'px';
    if (mob) mob.style.top = (bannerH + 72) + 'px';
    document.body.style.paddingTop = bannerH + 'px';

    const strip = document.getElementById('announcement-strip');
    const stripText = strip?.querySelector('.announcement-strip-text');
    if (strip && stripText) {
      stripText.textContent = announcement;
      strip.style.display = 'flex';
    }
  }

  function sendPageView() {
    const payload = JSON.stringify({ page: path || 'index.html' });
    const url = `${_apiBase}/api/pageview`;
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
        return;
      }
    } catch {}
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }

  document.body.insertAdjacentHTML('afterbegin',
    '<div id="watt-announcement" style="display:none;background:#f5e642;color:#080808;font-family:\'Courier New\',monospace;font-size:12px;font-weight:700;letter-spacing:0.08em;text-align:center;padding:10px 48px;position:fixed;top:0;left:0;right:0;z-index:1001;"></div>'
  );

  document.body.insertAdjacentHTML('afterbegin', `
    <nav id="watt-nav">
      <a href="index.html" class="nav-logo">
        <img src="assets/img/logo/watt_logo.svg" alt="$WATT Protocol logo" class="brand-logo-img brand-logo-img--sm">
        <span>$WATT</span>
        <div class="nav-logo-dot"></div>
      </a>
      <ul class="nav-links">
        <li><a href="index.html" ${path==='index.html'?'class="active"':''}>Home</a></li>
        <li><a href="how-it-works.html" ${path==='how-it-works.html'?'class="active"':''}>How It Works</a></li>
        <li><a href="token.html" ${path==='token.html'?'class="active"':''}>Token</a></li>
        <li><a href="community.html" ${path==='community.html'?'class="active"':''}>Community</a></li>
        <li><a href="whitepaper.html" ${path==='whitepaper.html'?'class="active"':''}>Whitepaper</a></li>
        <li><a href="about.html" ${path==='about.html'?'class="active"':''}>About</a></li>
        <li><a href="dashboard.html" ${path==='dashboard.html'?'class="active"':''}>Dashboard</a></li>
        <li><a href="leaderboard.html" ${path==='leaderboard.html'?'class="active"':''}>Leaderboard</a></li>
        <li><a href="index.html#waitlist" class="nav-cta">Join Waitlist</a></li>
      </ul>
      <button class="nav-burger" id="navBurger" aria-label="Menu">
        <span></span><span></span><span></span>
      </button>
    </nav>
    <div class="nav-mobile" id="navMobile">
      <a href="index.html">Home</a>
      <a href="how-it-works.html">How It Works</a>
      <a href="token.html">Token</a>
      <a href="community.html">Community & SDG</a>
      <a href="whitepaper.html">Whitepaper</a>
      <a href="about.html">About</a>
      <a href="dashboard.html">Dashboard</a>
      <a href="leaderboard.html">Leaderboard</a>
      <a href="index.html#waitlist" style="color:var(--yellow)">${window.wattIconMarkup ? window.wattIconMarkup('zap', 'Join waitlist') : ''}<span style="margin-left:8px;">Join Waitlist</span></a>
    </div>
  `);
  if (window.wattHydrateIcons) window.wattHydrateIcons();

  const nav = document.getElementById('watt-nav');
  const mobileNav = document.getElementById('navMobile');
  const navBurger = document.getElementById('navBurger');

  if (navBurger && mobileNav) {
    navBurger.addEventListener('click', () => {
      mobileNav.classList.toggle('open');
    });
  }

  if (nav) {
    let ticking = false;
    const syncNav = () => {
      nav.classList.toggle('scrolled', window.scrollY > 60);
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(syncNav);
      }
    }, { passive: true });
    syncNav();
  }

  try {
    const cached = JSON.parse(localStorage.getItem('watt_announcement_cache') || 'null');
    if (cached && cached.text && Date.now() - cached.time < 60_000) {
      renderAnnouncement(cached.text);
    }
  } catch {}

  scheduleNonCritical(() => {
    fetch(`${_apiBase}/api/announcement`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        const text = data?.announcement?.trim() || '';
        renderAnnouncement(text);
        try {
          localStorage.setItem('watt_announcement_cache', JSON.stringify({ text, time: Date.now() }));
        } catch {}
      })
      .catch(() => {});
  });

  scheduleNonCritical(() => {
    document.body.insertAdjacentHTML('beforeend', `
      <footer id="watt-footer">
        <div class="footer-top">
          <div>
            <div class="footer-brand-logo" style="display:flex;align-items:center;gap:12px;"><img src="assets/img/logo/watt_logo.svg" alt="$WATT Protocol logo" class="brand-logo-img"><span>$WATT</span></div>
            <p class="footer-brand-desc">A decentralized protocol rewarding individuals worldwide for generating renewable energy. Born in Africa. Built for the World.</p>
            <div class="footer-socials">
              <a class="footer-social" href="${window.WATT_SOCIAL_X || 'https://x.com/wattprotocol'}" target="_blank" rel="noopener" title="X / Twitter">${window.wattIconMarkup ? window.wattIconMarkup('twitter', 'X / Twitter') : ''}</a>
              <a class="footer-social" href="${window.WATT_SOCIAL_DISCORD || 'https://discord.gg/wattprotocol'}" target="_blank" rel="noopener" title="Discord">${window.wattIconMarkup ? window.wattIconMarkup('discord', 'Discord') : ''}</a>
              <a class="footer-social" href="${window.WATT_SOCIAL_LINKEDIN || 'https://linkedin.com/company/wattprotocol'}" target="_blank" rel="noopener" title="LinkedIn">${window.wattIconMarkup ? window.wattIconMarkup('linkedin', 'LinkedIn') : ''}</a>
              <a class="footer-social" href="${window.WATT_SOCIAL_INSTAGRAM || 'https://instagram.com/wattprotocol'}" target="_blank" rel="noopener" title="Instagram">${window.wattIconMarkup ? window.wattIconMarkup('instagram', 'Instagram') : ''}</a>
              <a class="footer-social" href="${window.WATT_SOCIAL_YOUTUBE || 'https://youtube.com/@wattprotocol'}" target="_blank" rel="noopener" title="YouTube">${window.wattIconMarkup ? window.wattIconMarkup('youtube', 'YouTube') : ''}</a>
            </div>
          </div>
          <div class="footer-col">
            <div class="footer-col-title">Protocol</div>
            <ul>
              <li><a href="how-it-works.html">How It Works</a></li>
              <li><a href="token.html">Tokenomics</a></li>
              <li><a href="whitepaper.html">Whitepaper</a></li>
              <li><a href="community.html">SDG Impact</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <div class="footer-col-title">Company</div>
            <ul>
              <li><a href="about.html">About</a></li>
              <li><a href="about.html#team">Team</a></li>
              <li><a href="whitepaper.html">Press Kit</a></li>
              <li><a href="about.html#team">Careers</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <div class="footer-col-title">Resources</div>
            <ul>
              <li><a href="${window.WATT_GITHUB_URL || resolveUrl('whitepaper.html')}" target="_blank" rel="noopener">GitHub</a></li>
              <li><a href="how-it-works.html">Documentation</a></li>
              <li><a href="community.html">Grant Applications</a></li>
              <li><a href="mailto:hello@wattprotocol.io">Contact</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <span class="footer-copy">© 2025 $WATT Protocol · Watt Protocol Limited</span>
          <div class="footer-live"><div class="footer-live-dot"></div> Building on Base Network</div>
          <span class="footer-legal"><a href="privacy.html" style="color:inherit;text-decoration:none;">Privacy</a> · <a href="terms.html" style="color:inherit;text-decoration:none;">Terms</a> · Not Financial Advice</span>
        </div>
      </footer>
    `);
    if (window.wattHydrateIcons) window.wattHydrateIcons();
  });

  if (supportsFinePointer && !prefersReducedMotion) {
    scheduleNonCritical(() => {
      document.body.insertAdjacentHTML('afterbegin', `
        <div id="watt-cursor"></div>
        <div id="watt-cursor-ring"></div>
      `);
      const cur = document.getElementById('watt-cursor');
      const ring = document.getElementById('watt-cursor-ring');
      if (!cur || !ring) return;
      let mx = 0;
      let my = 0;
      let rx = 0;
      let ry = 0;
      let active = false;

      document.addEventListener('mousemove', (e) => {
        mx = e.clientX;
        my = e.clientY;
        cur.style.left = mx + 'px';
        cur.style.top = my + 'px';
        active = true;
      }, { passive: true });

      const animRing = () => {
        if (active) {
          rx += (mx - rx) * 0.11;
          ry += (my - ry) * 0.11;
          ring.style.left = rx + 'px';
          ring.style.top = ry + 'px';
        }
        requestAnimationFrame(animRing);
      };
      requestAnimationFrame(animRing);

      document.querySelectorAll('a,button,.card,.hover-target').forEach((el) => {
        el.addEventListener('mouseenter', () => { cur.classList.add('hover'); ring.classList.add('hover'); }, { passive: true });
        el.addEventListener('mouseleave', () => { cur.classList.remove('hover'); ring.classList.remove('hover'); }, { passive: true });
      });
    });
  }

  if (!prefersReducedMotion) {
    scheduleNonCritical(() => {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, i) => {
          if (entry.isIntersecting) {
            setTimeout(() => entry.target.classList.add('visible'), i * 60);
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08 });
      document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
    });
  } else {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible'));
  }

  scheduleNonCritical(sendPageView);

})();

/* ═══════════════════════════════════════════════════════
   GLOBAL TOAST SYSTEM
   Usage: window.wattToast('Message', 'success'|'error'|'info')
   ═══════════════════════════════════════════════════════ */
(function() {
  // Inject toast container + styles
  const style = document.createElement('style');
  style.textContent = `
    #watt-toast-container {
      position: fixed; bottom: 28px; right: 28px; z-index: 99999;
      display: flex; flex-direction: column; gap: 10px; pointer-events: none;
    }
    .watt-toast {
      display: flex; align-items: center; gap: 12px;
      background: #1a1a1a; border: 1px solid #333;
      color: #fff; font-family: 'Courier New', monospace;
      font-size: 12px; font-weight: 700; letter-spacing: 0.06em;
      padding: 14px 20px; min-width: 260px; max-width: 400px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      transform: translateX(120%); opacity: 0;
      transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease;
      pointer-events: auto;
    }
    .watt-toast.show { transform: translateX(0); opacity: 1; }
    .watt-toast.hide { transform: translateX(120%); opacity: 0; }
    .watt-toast-bar { width: 3px; height: 36px; flex-shrink: 0; }
    .watt-toast.success .watt-toast-bar { background: #22c55e; }
    .watt-toast.error   .watt-toast-bar { background: #ef4444; }
    .watt-toast.info    .watt-toast-bar { background: #f5e642; }
    .watt-toast-icon { font-size: 15px; flex-shrink: 0; }
    .watt-toast-msg { flex: 1; line-height: 1.5; }
    .watt-toast-close { background: none; border: none; color: #555; font-size: 16px; cursor: pointer; padding: 0 0 0 8px; flex-shrink: 0; line-height: 1; transition: color 0.15s; }
    .watt-toast-close:hover { color: #fff; }
    @media (max-width: 500px) {
      #watt-toast-container { left: 16px; right: 16px; bottom: 16px; }
      .watt-toast { min-width: 0; }
    }
  `;
  document.head.appendChild(style);

  const container = document.createElement('div');
  container.id = 'watt-toast-container';
  document.body.appendChild(container);

  const icons = { success: 'check', error: 'x', info: 'zap' };

  window.wattToast = function(message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');
    const bar = document.createElement('div');
    const icon = document.createElement('span');
    const msg = document.createElement('span');
    const close = document.createElement('button');

    toast.className = `watt-toast ${type}`;
    bar.className = 'watt-toast-bar';
    icon.className = 'watt-toast-icon';
    icon.innerHTML = window.wattIconMarkup ? window.wattIconMarkup(icons[type] || 'zap', type) : '';
    msg.className = 'watt-toast-msg';
    msg.textContent = String(message || '');
    close.className = 'watt-toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = window.wattIconMarkup ? window.wattIconMarkup('x', 'Dismiss') : '';

    toast.append(bar, icon, msg, close);
    container.appendChild(toast);

    // Trigger entrance animation
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));

    const dismiss = () => {
      toast.classList.remove('show');
      toast.classList.add('hide');
      setTimeout(() => toast.remove(), 350);
    };

    close.addEventListener('click', dismiss);
    if (duration > 0) setTimeout(dismiss, duration);
    return dismiss;
  };
})();

/* ═══════════════════════════════════════════════════════
   GDPR COOKIE CONSENT BANNER
   Shows once, stores choice in localStorage.
   Sets watt_ref cookie only after consent.
   ═══════════════════════════════════════════════════════ */
(function() {
  const CONSENT_KEY = 'watt_cookie_consent';
  if (localStorage.getItem(CONSENT_KEY)) return; // already decided

  const style = document.createElement('style');
  style.textContent = `
    #watt-consent {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 99990;
      background: #111; border-top: 1px solid #2a2a2a;
      padding: 18px 32px; display: flex; align-items: center;
      gap: 20px; flex-wrap: wrap; justify-content: space-between;
      transform: translateY(100%);
      transition: transform 0.4s cubic-bezier(0.34,1.2,0.64,1);
      box-shadow: 0 -8px 32px rgba(0,0,0,0.5);
    }
    #watt-consent.show { transform: translateY(0); }
    #watt-consent p {
      font-family: 'Inter', sans-serif; font-size: 13px; color: #888;
      line-height: 1.6; margin: 0; flex: 1; min-width: 240px;
    }
    #watt-consent a { color: #f5e642; text-decoration: none; }
    #watt-consent a:hover { text-decoration: underline; }
    #watt-consent-btns { display: flex; gap: 10px; flex-shrink: 0; }
    #watt-consent-accept {
      background: #f5e642; color: #080808; border: none;
      font-family: 'Courier New', monospace; font-size: 10px; font-weight: 700;
      letter-spacing: 0.15em; text-transform: uppercase; padding: 10px 20px; cursor: pointer;
      transition: background 0.2s;
    }
    #watt-consent-accept:hover { background: #ffe100; }
    #watt-consent-decline {
      background: none; border: 1px solid #333; color: #555;
      font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.1em;
      text-transform: uppercase; padding: 10px 16px; cursor: pointer; transition: all 0.15s;
    }
    #watt-consent-decline:hover { border-color: #555; color: #888; }
    @media (max-width: 600px) {
      #watt-consent { padding: 16px 20px; gap: 14px; }
      #watt-consent-btns { width: 100%; }
      #watt-consent-accept, #watt-consent-decline { flex: 1; text-align: center; }
    }
  `;
  document.head.appendChild(style);

  const banner = document.createElement('div');
  const text = document.createElement('p');
  const code = document.createElement('code');
  const link = document.createElement('a');
  const buttons = document.createElement('div');
  const decline = document.createElement('button');
  const accept = document.createElement('button');

  banner.id = 'watt-consent';
  code.style.color = '#fff';
  code.style.fontSize = '11px';
  code.textContent = 'watt_ref';
  link.href = 'privacy.html';
  link.textContent = ' Learn more →';
  text.append(
    'We use a single cookie (',
    code,
    ') to track referral codes for 7 days so that referral credit is correctly attributed. No advertising or third-party tracking.',
    link
  );
  buttons.id = 'watt-consent-btns';
  decline.id = 'watt-consent-decline';
  decline.textContent = 'Decline';
  accept.id = 'watt-consent-accept';
  accept.textContent = 'Accept Cookies';
  buttons.append(decline, accept);
  banner.append(text, buttons);
  document.body.appendChild(banner);
  requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('show')));

  const dismiss = (accepted) => {
    localStorage.setItem(CONSENT_KEY, accepted ? 'accepted' : 'declined');
    banner.style.transform = 'translateY(100%)';
    setTimeout(() => banner.remove(), 400);
  };

  accept.addEventListener('click', () => dismiss(true));
  decline.addEventListener('click', () => dismiss(false));
})();

/* ═══════════════════════════════════════════════════════
   SERVICE WORKER REGISTRATION
   ═══════════════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    const activateUpdate = (registration) => {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    };

    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        // Check for updates every time the page loads
        reg.update();
        // If a worker is already waiting, activate it immediately.
        activateUpdate(reg);
        // Listen for new SW waiting — prompt user to refresh
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available — auto activate so users don't need hard refresh.
              activateUpdate(reg);
            }
          });
        });
      })
      .catch(() => {/* SW not supported or blocked — silently ignore */});
  });
}
