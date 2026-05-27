(function() {
  const LUCIDE_LOCAL = '/vendor/lucide.min.js';
  let lucidePromise = null;

  const fallbackPaths = {
    'arrow-right': '<path d="M5 12h14"/><path d="m13 5 7 7-7 7"/>',
    'arrow-left': '<path d="M19 12H5"/><path d="m11 19-7-7 7-7"/>',
    'download': '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    'check': '<path d="m5 13 4 4L19 7"/>',
    'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'zap': '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    'plug': '<path d="M12 22v-5"/><path d="M8 7V3"/><path d="M16 7V3"/><path d="M7 7h10v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5Z"/>',
    'radio': '<path d="M4 12a8 8 0 0 1 16 0"/><path d="M7 12a5 5 0 0 1 10 0"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
    'blocks': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    'wallet': '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5z"/><path d="M16 12h4"/><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none"/>',
    'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5"/><path d="M12 19.5V22"/><path d="m4.93 4.93 1.77 1.77"/><path d="m17.3 17.3 1.77 1.77"/><path d="M2 12h2.5"/><path d="M19.5 12H22"/><path d="m4.93 19.07 1.77-1.77"/><path d="m17.3 6.7 1.77-1.77"/>',
    'shield-check': '<path d="M12 3 5 6v5c0 5 3.4 8.6 7 10 3.6-1.4 7-5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
    'globe': '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18"/><path d="M12 3a15 15 0 0 0 0 18"/>',
    'leaf': '<path d="M6 20c8 0 12-5 12-14-9 0-14 4-14 12 0 1 .1 1.4 2 2Z"/><path d="M8 16c1.5-2 4-4 8-6"/>',
    'file-text': '<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M9 12h6"/><path d="M9 16h6"/>',
    'coins': '<ellipse cx="12" cy="6" rx="6.5" ry="2.5"/><path d="M5.5 6v4c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V6"/><path d="M5.5 10v4c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-4"/>',
    'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="3.5"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16.5 3.2a3.5 3.5 0 0 1 0 6.6"/>',
    'package': '<path d="m12 3 8 4.5-8 4.5L4 7.5 12 3Z"/><path d="M4 7.5V16l8 5 8-5V7.5"/><path d="M12 12v9"/>',
    'link': '<path d="M10 14a5 5 0 0 1 0-7l1.5-1.5a5 5 0 0 1 7 7L17 14"/><path d="M14 10a5 5 0 0 1 0 7L12.5 18.5a5 5 0 0 1-7-7L7 10"/>',
    'award': '<circle cx="12" cy="8" r="5"/><path d="m8.5 13.5-1.5 7L12 18l5 2.5-1.5-7"/>',
    'lock': '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    'send': '<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7Z"/>',
    'message-circle': '<path d="M7 18-3 3 3 1a9 9 0 1 1 3 17Z" transform="translate(3 2)"/>',
    'share-2': '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>',
    'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="3.5"/><path d="M19 8v6"/><path d="M16 11h6"/>',
    'refresh-cw': '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
    'alert-triangle': '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    'crown': '<path d="m3 8 4 4 5-7 5 7 4-4-2 11H5L3 8Z"/>',
    'sparkles': '<path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Z"/><path d="m19 15 .8 2 .2.2 2 .8-2 .8-.2.2-.8 2-.8-2-.2-.2-2-.8 2-.8.2-.2.8-2Z"/><path d="m5 14 .8 2 .2.2 2 .8-2 .8-.2.2-.8 2-.8-2-.2-.2-2-.8 2-.8.2-.2.8-2Z"/>',
    'badge-check': '<path d="m12 3 2.2 1.4 2.6-.2 1.4 2.2 2.2 1.4-.2 2.6 1.4 2.2-1.4 2.2.2 2.6-2.2 1.4-1.4 2.2-2.6-.2L12 21l-2.2-1.4-2.6.2-1.4-2.2-2.2-1.4.2-2.6L2.4 12l1.4-2.2-.2-2.6 2.2-1.4 1.4-2.2 2.6.2Z"/><path d="m9 12 2 2 4-4"/>',
    'twitter': '<path d="M4 4 20 20"/><path d="M20 4 8 17"/><path d="M14 4h6"/><path d="M4 20h6"/>',
    'discord': '<path d="M8 7.5c2-1 6-1 8 0l1 9c-2 1.5-8 1.5-10 0l1-9Z"/><path d="M9.5 10.5h.01"/><path d="M14.5 10.5h.01"/><path d="M9 14c1.2 1 4.8 1 6 0"/>',
    'linkedin': '<path d="M7 9v9"/><path d="M7 6h.01"/><path d="M12 18v-5a2 2 0 0 1 4 0v5"/><path d="M12 13v-4"/><path d="M16 9h.01"/>',
    'instagram': '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3.5"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>',
    'youtube': '<path d="M21 12c0 2.5-.2 4.2-.7 5-.5.8-1.4 1-3 1.2C15.7 18.5 13.9 18.5 12 18.5s-3.7 0-5.3-.3c-1.6-.2-2.5-.4-3-1.2-.5-.8-.7-2.5-.7-5s.2-4.2.7-5c.5-.8 1.4-1 3-1.2C8.3 5.5 10.1 5.5 12 5.5s3.7 0 5.3.3c1.6.2 2.5.4 3 1.2.5.8.7 2.5.7 5Z"/><path d="m10 9 5 3-5 3Z" fill="currentColor" stroke="none"/>',
    'whatsapp': '<path d="M20 11.5a8.5 8.5 0 1 1-15.5 5L3 21l4.7-1.4A8.5 8.5 0 0 1 20 11.5Z"/><path d="M9.7 8.9c-.3-.7-.7-.7-.9-.7h-.8c-.2 0-.6.1-.8.4s-1 1-.9 2.4 1 2.8 1.1 3 .3.5 2.2 2.3c1.8 1.6 3.2 2.1 3.7 2.3s.9.2 1.3 0c.4-.2 1.2-1 1.3-1.3.1-.3.1-.6 0-.7-.1-.1-.4-.2-.8-.4s-.9-.4-1-.5c-.2-.1-.3-.1-.5.1-.2.2-.6.7-.7.8-.1.2-.3.2-.5.1-.2-.1-1-.4-1.8-1.1-.7-.6-1.1-1.4-1.3-1.6-.1-.2 0-.4.1-.5l.4-.5c.1-.2.1-.3.2-.5 0-.2 0-.4 0-.5-.1-.1-.6-1.4-.8-1.9Z"/>',
    'book-open': '<path d="M2 7.5C2 6 3.2 5 4.7 5H11v14H4.7A2.7 2.7 0 0 1 2 16.3z"/><path d="M22 7.5C22 6 20.8 5 19.3 5H13v14h6.3a2.7 2.7 0 0 0 2.7-2.7z"/>',
    'graduation-cap': '<path d="m2 10 10-5 10 5-10 5z"/><path d="M6 12v4c0 1.5 3 3 6 3s6-1.5 6-3v-4"/><path d="M22 10v6"/>',
    'mail': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    'mountain': '<path d="m3 20 7-10 4 6 3-4 4 8Z"/><path d="m10 10 2-3 2 3"/>',
    'flame': '<path d="M12 2c2 3 4 5 4 8a4 4 0 1 1-8 0c0-2 1-4 4-8Z"/><path d="M12 12c1 1.3 2 2.3 2 3.8a2 2 0 1 1-4 0c0-1 .5-2 2-3.8Z"/>',
    'waves': '<path d="M2 12c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1"/><path d="M2 16c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1"/>',
    'landmark': '<path d="M3 22h18"/><path d="M6 18h12"/><path d="M8 18V9"/><path d="M12 18V9"/><path d="M16 18V9"/><path d="M4 9h16"/><path d="m12 2 8 5H4z"/>',
    'compass': '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 6.5L7 17l2.5-6.5z"/>'
  };

  const nameAliases = {
    blocks: 'layout-grid',
    twitter: 'at-sign',
    discord: 'messages-square',
    linkedin: 'briefcase-business',
    instagram: 'camera',
    youtube: 'play-circle',
    whatsapp: 'message-circle',
  };

  function toPascalCase(name) {
    return String(name || '')
      .split('-')
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join('');
  }

  function safeAttr(value) {
    return String(value || '').replace(/"/g, '&quot;');
  }

  function ensureLucideLoaded() {
    if (window.lucide) return Promise.resolve(window.lucide);
    if (lucidePromise) return lucidePromise;

    lucidePromise = new Promise((resolve) => {
      const existing = document.querySelector('script[data-watt-lucide="1"]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.lucide || null), { once: true });
        existing.addEventListener('error', () => resolve(null), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = LUCIDE_LOCAL;
      script.async = true;
      script.defer = true;
      script.setAttribute('data-watt-lucide', '1');
      script.addEventListener('load', () => resolve(window.lucide || null), { once: true });
      script.addEventListener('error', () => resolve(null), { once: true });
      document.head.appendChild(script);
    });

    return lucidePromise;
  }

  function getLucideIcon(name) {
    const resolved = nameAliases[name] || name || 'zap';
    const iconName = toPascalCase(resolved);
    return window.lucide?.icons?.[iconName] || window.lucide?.[iconName] || window.lucide?.icons?.Zap || window.lucide?.Zap || null;
  }

  function fallbackSvg(name, label, className = '') {
    const path = fallbackPaths[name] || fallbackPaths.zap;
    const aria = label ? `role="img" aria-label="${safeAttr(label)}"` : 'aria-hidden="true"';
    return `<span class="watt-icon${className ? ` ${className}` : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${aria}>${path}</svg></span>`;
  }

  function renderIcon(name, label, className = '') {
    const icon = getLucideIcon(name);
    if (!icon || typeof icon.toSvg !== 'function') return fallbackSvg(name, label, className);
    const svg = icon.toSvg({
      width: 24,
      height: 24,
      stroke: 'currentColor',
      'stroke-width': 1.9,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      ...(label ? { 'aria-label': label, role: 'img' } : { 'aria-hidden': 'true' }),
    });
    return `<span class="watt-icon${className ? ` ${className}` : ''}">${svg}</span>`;
  }

  function svg(name, label, className = '') {
    return renderIcon(name, label, className);
  }

  function hydrate(root = document) {
    root.querySelectorAll('[data-icon]').forEach((node) => {
      const name = node.getAttribute('data-icon');
      const label = node.getAttribute('data-icon-label') || '';
      const extra = node.getAttribute('data-icon-class') || '';
      node.innerHTML = renderIcon(name, label, `watt-icon-inline${extra ? ` ${extra}` : ''}`);
    });
  }

  window.wattIconMarkup = svg;
  window.wattHydrateIcons = hydrate;

  function bootstrap() {
    ensureLucideLoaded().then(() => hydrate());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
