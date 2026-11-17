/* =====================================================================
   AERDZ — ui.js
   Composants d'interface partagés par toutes les pages :
     - en-tête / pied de page (une seule source pour tout le site)
     - notifications (toasts) et boîtes de dialogue accessibles (<dialog>)
     - compression d'images, copie dans le presse-papiers
     - rendu de la carte étudiante
   ===================================================================== */
(function (A) {
  'use strict';

  const { $, $$, esc, CFG } = A;
  const UI = {};

  /* ===================================================================
     1. Notifications (toasts)
     =================================================================== */
  let toastHost = null;
  const TOAST_ICONS = { success: '✓', error: '!', info: 'i', warning: '!' };

  UI.toast = function toast(message, type = 'info', timeout = 4800) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.className = 'toast-host';
      toastHost.setAttribute('aria-live', 'polite');
      toastHost.setAttribute('aria-atomic', 'false');
      document.body.append(toastHost);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span class="toast-icon" aria-hidden="true">${TOAST_ICONS[type] || 'i'}</span>
      <p class="toast-text">${esc(message)}</p>
      <button type="button" class="toast-close" aria-label="Fermer la notification">×</button>`;
    toastHost.append(el);
    requestAnimationFrame(() => el.classList.add('is-in'));

    const close = () => {
      if (!el.isConnected) return;
      el.classList.remove('is-in');
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 260);
    };
    el.querySelector('.toast-close').addEventListener('click', close);
    if (timeout > 0) setTimeout(close, timeout);
    return close;
  };

  /* ===================================================================
     2. Boîtes de dialogue (élément <dialog> natif : focus et Échap gérés)
     =================================================================== */
  const dialogSupported = () => typeof HTMLDialogElement === 'function' && typeof HTMLDialogElement.prototype.showModal === 'function';

  /** Ouvre une boîte avec un contenu HTML ; renvoie l'élément <dialog> */
  UI.modal = function modal(html, { className = '', labelledBy = 'dlg-title' } = {}) {
    const dlg = document.createElement('dialog');
    dlg.className = `dialog ${className}`.trim();
    dlg.setAttribute('aria-labelledby', labelledBy);
    dlg.innerHTML = html;
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel'); }); // clic sur le fond
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
    document.body.append(dlg);
    dlg.showModal();
    return dlg;
  };

  UI.confirm = function confirm({ title, message, confirmText = 'Confirmer', cancelText = 'Annuler', tone = 'primary' }) {
    if (!dialogSupported()) return Promise.resolve(window.confirm(`${title}\n\n${message}`));
    return new Promise((resolve) => {
      const dlg = UI.modal(`
        <form method="dialog" class="dialog-body">
          <h2 id="dlg-title">${esc(title)}</h2>
          <p>${esc(message)}</p>
          <div class="dialog-actions">
            <button value="cancel" class="btn btn-ghost">${esc(cancelText)}</button>
            <button value="ok" class="btn btn-${esc(tone)}" autofocus>${esc(confirmText)}</button>
          </div>
        </form>`);
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'));
    });
  };

  /** Demande un texte (ex. motif de refus). Renvoie la chaîne saisie, ou null si annulé */
  UI.prompt = function prompt({ title, message, label, placeholder = '', confirmText = 'Valider', tone = 'primary' }) {
    if (!dialogSupported()) {
      const v = window.prompt(`${title}\n\n${message}`);
      return Promise.resolve(v && v.trim() ? v.trim() : null);
    }
    return new Promise((resolve) => {
      let answer = null;
      const dlg = UI.modal(`
        <form method="dialog" class="dialog-body" novalidate>
          <h2 id="dlg-title">${esc(title)}</h2>
          <p>${esc(message)}</p>
          <label class="field-label" for="dlg-input">${esc(label)}</label>
          <textarea id="dlg-input" class="input" rows="3" maxlength="240" placeholder="${esc(placeholder)}" required></textarea>
          <p class="field-error" id="dlg-error" role="alert"></p>
          <div class="dialog-actions">
            <button value="cancel" class="btn btn-ghost" formnovalidate>Annuler</button>
            <button value="ok" class="btn btn-${esc(tone)}">${esc(confirmText)}</button>
          </div>
        </form>`);
      const form = dlg.querySelector('form');
      const input = dlg.querySelector('#dlg-input');
      form.addEventListener('submit', (e) => {
        if (e.submitter && e.submitter.value === 'ok') {
          const value = input.value.replace(/\s+/g, ' ').trim();
          if (!value) {
            e.preventDefault();
            dlg.querySelector('#dlg-error').textContent = 'Ce champ est obligatoire.';
            input.classList.add('is-invalid');
            input.focus();
            return;
          }
          answer = value;
        }
      });
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? answer : null));
      input.focus();
    });
  };

  UI.lightbox = function lightbox(src, caption = '') {
    if (!dialogSupported()) { window.open(src, '_blank', 'noopener'); return; }
    UI.modal(`
      <form method="dialog" class="lightbox">
        <button class="lightbox-close" aria-label="Fermer" value="cancel">×</button>
        <img src="${esc(src)}" alt="${esc(caption || 'Image agrandie')}">
        <p id="dlg-title" class="lightbox-caption">${esc(caption)}</p>
      </form>`, { className: 'dialog-image' });
  };

  /* ===================================================================
     3. Aides diverses
     =================================================================== */
  UI.copy = async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  };

  UI.setBusy = function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.disabled = true;
      button.classList.add('is-busy');
      if (label) button.textContent = label;
    } else {
      button.disabled = false;
      button.classList.remove('is-busy');
      if (button.dataset.label) button.textContent = button.dataset.label;
    }
  };

  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  /** Contrôle d'un fichier image avant traitement. Renvoie '' si correct. */
  UI.checkImage = function checkImage(file) {
    if (!file) return '';
    if (!IMAGE_TYPES.includes(file.type)) return 'Format non accepté. Utilisez une image JPG, PNG ou WebP.';
    if (file.size > CFG.limits.imageMaxMo * 1024 * 1024) return `L'image est trop lourde (${CFG.limits.imageMaxMo} Mo maximum).`;
    return '';
  };

  /** Réduit l'image et la convertit en JPEG (data URL) pour économiser le stockage */
  UI.compressImage = function compressImage(file, maxPx = 500, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const ratio = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * ratio));
        const h = Math.max(1, Math.round(img.naturalHeight * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // fond blanc pour les PNG transparents
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
      img.src = url;
    });
  };

  /** Branche une zone de dépôt d'image (glisser-déposer + sélection) */
  UI.imagePicker = function imagePicker({ root, maxPx, quality, onChange }) {
    const input = $('input[type=file]', root);
    const preview = $('.dz-preview', root);
    const previewImg = $('img', preview);
    const errorEl = $('.field-error', root);
    let value = null;

    const setError = (msg) => { errorEl.textContent = msg || ''; root.classList.toggle('has-error', !!msg); };
    const clear = () => { value = null; input.value = ''; preview.hidden = true; previewImg.removeAttribute('src'); root.classList.remove('has-file'); setError(''); if (onChange) onChange(null); };

    async function handle(file) {
      if (!file) { clear(); return; }
      const problem = UI.checkImage(file);
      if (problem) { clear(); setError(problem); return; }
      try {
        value = await UI.compressImage(file, maxPx, quality);
        previewImg.src = value;
        preview.hidden = false;
        root.classList.add('has-file');
        setError('');
        if (onChange) onChange(value);
      } catch (e) {
        clear();
        setError('Impossible de lire cette image. Essayez-en une autre.');
      }
    }

    input.addEventListener('change', () => handle(input.files[0]));
    $('.dz-remove', root).addEventListener('click', clear);
    ['dragenter', 'dragover'].forEach((ev) => root.addEventListener(ev, (e) => { e.preventDefault(); root.classList.add('is-drag'); }));
    ['dragleave', 'drop'].forEach((ev) => root.addEventListener(ev, (e) => { e.preventDefault(); root.classList.remove('is-drag'); }));
    root.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files[0];
      if (file) {
        try { const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; } catch (err) { /* non supporté */ }
        handle(file);
      }
    });
    return { get value() { return value; }, clear, setError };
  };

  /* ===================================================================
     4. Carte étudiante
     =================================================================== */
  const ICON = {
    user: '<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>',
    cap: '<path d="M12 3 1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z"/>',
    level: '<path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"/>',
    phone: '<path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>',
    calendar: '<path d="M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V8h14v11z"/>'
  };
  const row = (icon, label, value) => `
    <li class="carte-row">
      <span class="carte-icon"><svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true">${ICON[icon]}</svg></span>
      <span class="carte-data"><span class="cd-label">${esc(label)}</span><span class="cd-val">${esc(value)}</span></span>
    </li>`;

  UI.cardHTML = function cardHTML(s) {
    const photo = s.photo
      ? `<img src="${esc(s.photo)}" alt="Photo de ${esc(s.prenom)} ${esc(s.nom)}">`
      : `<span class="carte-initiales">${esc(A.initials(s.prenom, s.nom))}</span>`;
    return `
    <article class="carte" aria-label="Carte étudiant de ${esc(s.prenom)} ${esc(s.nom)}">
      <div class="carte-watermark" aria-hidden="true"></div>
      <div class="carte-head">
        <img class="carte-logo" src="img/logo.jpg" alt="">
        <div class="carte-titre">
          <p class="ct-top">AMICALE DES ÉTUDIANTS RESSORTISSANTS<br>DE DAGANA À L'UASZ</p>
          <p class="ct-main">(AERDZ)</p>
        </div>
      </div>
      <div class="carte-badge">CARTE ÉTUDIANT</div>
      <div class="carte-body">
        <ul class="carte-infos">
          ${row('user', 'Nom & Prénom :', `${String(s.nom).toUpperCase()} ${s.prenom}`)}
          ${row('cap', 'Filière :', s.filiere)}
          ${row('level', 'Niveau :', s.niveau)}
          ${row('phone', 'Téléphone :', s.telephone ? A.fmtPhone(s.telephone) : '—')}
          ${row('calendar', 'Année universitaire :', A.academicYear(s.dateDelivrance ? new Date(s.dateDelivrance) : new Date()))}
        </ul>
        <div class="carte-photo-wrap"><div class="carte-photo">${photo}</div></div>
      </div>
      <div class="carte-foot">
        <div class="cf-numero"><span class="cf-label">N° Carte :</span><span class="cf-val">${esc(s.numeroCarte || '—')}</span>
          ${s.dateDelivrance ? `<span class="cf-date">Délivrée le ${esc(A.fmtDate(s.dateDelivrance))}</span>` : ''}</div>
        <div class="cf-barcode" aria-hidden="true"></div>
        <div class="cf-slogan">Ensemble pour la réussite<br>des étudiants de Dagana</div>
      </div>
    </article>`;
  };

  /* ===================================================================
     5. En-tête, pied de page, animations d'apparition
     =================================================================== */
  const NAV = [
    ['index', 'index.html', 'Accueil'],
    ['inscription', 'inscription.html', "S'inscrire"],
    ['suivi', 'suivi.html', 'Suivi & paiement'],
    ['carte', 'carte.html', 'Ma carte'],
    ['admin', 'admin.html', 'Admin']
  ];

  UI.chrome = function chrome() {
    const page = document.body.dataset.page || '';
    const header = $('#site-header');
    if (header) {
      header.className = 'site-header no-print';
      header.innerHTML = `
        <div class="container nav">
          <a href="index.html" class="brand" aria-label="${esc(CFG.siteName)} — Accueil">
            <img src="img/logo.jpg" width="44" height="44" alt="">
            <span>${esc(CFG.siteName)} <strong>Dagana</strong></span>
          </a>
          <button class="burger" type="button" aria-expanded="false" aria-controls="menu" aria-label="Ouvrir le menu">
            <span></span><span></span><span></span>
          </button>
          <nav id="menu" class="nav-links" aria-label="Navigation principale">
            ${NAV.map(([id, href, label]) => `<a href="${href}"${id === page ? ' class="active" aria-current="page"' : ''}>${esc(label)}</a>`).join('')}
          </nav>
        </div>`;
      const burger = $('.burger', header);
      const menu = $('#menu', header);
      const setOpen = (open) => {
        menu.classList.toggle('open', open);
        burger.classList.toggle('is-open', open);
        burger.setAttribute('aria-expanded', String(open));
        burger.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
      };
      burger.addEventListener('click', () => setOpen(!menu.classList.contains('open')));
      menu.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
      window.addEventListener('resize', () => { if (window.innerWidth > 760) setOpen(false); });

      const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    const footer = $('#site-footer');
    if (footer) {
      footer.className = 'site-footer no-print';
      footer.innerHTML = `
        <div class="container footer-grid">
          <div>
            <div class="brand brand-footer"><img src="img/logo.jpg" width="48" height="48" alt=""><span>${esc(CFG.siteName)} <strong>Dagana</strong></span></div>
            <p>${esc(CFG.orgName)}.</p>
          </div>
          <div>
            <h4>Liens rapides</h4>
            <a href="inscription.html">S'inscrire</a>
            <a href="suivi.html">Suivre ma demande / payer</a>
            <a href="carte.html">Consulter ma carte</a>
            <a href="admin.html">Administration</a>
          </div>
          <div>
            <h4>Contact</h4>
            <p><a href="tel:${esc(CFG.contact.phone.replace(/\s/g, ''))}">${esc(CFG.contact.phone)}</a></p>
            <p><a href="mailto:${esc(CFG.contact.email)}">${esc(CFG.contact.email)}</a></p>
          </div>
        </div>
        <div class="footer-bottom">© ${new Date().getFullYear()} ${esc(CFG.siteName)} — Tous droits réservés.</div>`;
    }
  };

  UI.reveal = function reveal() {
    const items = $$('.reveal');
    if (!items.length) return;
    if (!('IntersectionObserver' in window)) { items.forEach((el) => el.classList.add('is-visible')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); io.unobserve(entry.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    items.forEach((el, i) => { el.style.setProperty('--d', `${(i % 4) * 70}ms`); io.observe(el); });
  };

  UI.ready = function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  };

  UI.ready(() => {
    UI.chrome();
    // Carte d'exemple (page d'accueil) : données fictives, purement décorative
    const sample = $('#sample-card');
    if (sample) {
      sample.innerHTML = UI.cardHTML({
        prenom: 'Aminata', nom: 'Diop', filiere: 'Mathématiques - Informatique', niveau: 'Licence 2',
        telephone: '770000000', numeroCarte: `${CFG.cardPrefix}-${new Date().getFullYear()}-001`, photo: null,
        dateDelivrance: new Date().toISOString()
      });
    }
    // Valeurs de config.js injectées dans les pages : <span data-cfg="price">…</span>
    const bound = {
      price: A.formatMoney(CFG.price), wave: CFG.wave.number,
      phone: CFG.contact.phone, email: CFG.contact.email
    };
    $$('[data-cfg]').forEach((el) => { if (bound[el.dataset.cfg]) el.textContent = bound[el.dataset.cfg]; });
    UI.reveal();
  });

  A.UI = UI;
})(window.AERDZ);
