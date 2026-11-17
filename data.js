/* =====================================================================
   AERDZ — data.js
   Noyau de l'application (sans aucun accès au DOM, sauf $ / $$) :
     - utilitaires et validateurs
     - Store      : persistance (localStorage) + migration depuis l'ancienne version
     - Workflow   : machine à états de la demande et du paiement
     - Auth       : authentification administrateur (mot de passe salé + PBKDF2)

   Cycle de vie d'un dossier :
     demande  : en_attente ──valider──▶ valide      (ou ──rejeter──▶ rejete)
     paiement : (fermé) ───────────────▶ non_paye ──soumettre──▶ en_verification
                                                    ◀──refuser───┘   │ confirmer
                                                                      ▼
                                                                    paye  → carte délivrée
   Le paiement n'est possible QUE lorsque la demande est « valide » :
   cette règle est appliquée ici (Workflow), pas seulement dans l'interface.
   ===================================================================== */
(function (global) {
  'use strict';

  const CFG = global.AERDZ_CONFIG;
  if (!CFG) throw new Error('config.js doit être chargé avant data.js');

  /* ===================================================================
     1. Utilitaires
     =================================================================== */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => HTML_ESC[c]);

  const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const normalize = (v) => clean(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function fmtDate(iso, withTime = false) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const opts = { day: '2-digit', month: '2-digit', year: 'numeric' };
    if (withTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
    return d.toLocaleString('fr-FR', opts);
  }

  function debounce(fn, ms = 180) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function academicYear(d = new Date()) {
    const y = d.getFullYear();
    return d.getMonth() >= 8 ? `${y} - ${y + 1}` : `${y - 1} - ${y}`;
  }

  /** Affichage lisible d'un numéro enregistré sans espaces : 77 123 45 67 / +221 77 123 45 67 */
  const fmtPhone = (raw) => {
    const t = String(raw ?? '');
    let m = /^\+221(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(t);
    if (m) return `+221 ${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
    m = /^(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(t);
    return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : t;
  };

  const initials = (prenom, nom) => ((prenom || '')[0] || '').toUpperCase() + ((nom || '')[0] || '').toUpperCase();
  const titleCase = (s) => String(s).toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  const formatMoney = (n) => `${Number(n).toLocaleString('fr-FR').replace(/ /g, ' ')} ${CFG.currency}`;

  /** Neutralise l'injection de formules dans Excel / LibreOffice */
  const csvSafe = (v) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };

  function randomString(length, alphabet) {
    const out = [];
    const bytes = new Uint8Array(length);
    (global.crypto || global.msCrypto).getRandomValues(bytes);
    for (let i = 0; i < length; i++) out.push(alphabet[bytes[i] % alphabet.length]);
    return out.join('');
  }
  const uid = () => (global.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id_' + Date.now() + '_' + randomString(8, 'abcdefghijklmnopqrstuvwxyz0123456789'));
  const nowIso = () => new Date().toISOString();
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ===================================================================
     2. Validateurs (renvoient '' si valide, sinon un message en français)
     =================================================================== */
  const NAME_RE = /^[\p{L}][\p{L}\p{M}\s'’.-]{1,59}$/u;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const TX_RE = /^[\w.-]{6,30}$/;

  const V = {
    name: (label) => (value) => {
      const v = clean(value);
      if (!v) return `Le ${label} est obligatoire.`;
      if (!NAME_RE.test(v)) return `Le ${label} doit contenir de 2 à 60 caractères (lettres, espaces, tirets, apostrophes).`;
      return '';
    },
    filiere(value) {
      const v = clean(value);
      if (!v) return 'La filière est obligatoire.';
      if (v.length < 2 || v.length > 100) return 'La filière doit contenir entre 2 et 100 caractères.';
      return '';
    },
    level(value) {
      if (!clean(value)) return "Choisissez votre niveau d'études.";
      return CFG.levels.includes(value) ? '' : "Ce niveau d'études n'est pas valide.";
    },
    phoneNormalize(value) {
      let t = clean(value).replace(/[\s.\-()]/g, '');
      if (t.startsWith('00')) t = '+' + t.slice(2);
      return t;
    },
    phone(value) {
      if (!clean(value)) return 'Le numéro de téléphone est obligatoire.';
      return /^\+?\d{9,15}$/.test(V.phoneNormalize(value)) ? '' : 'Numéro invalide (ex. : 77 123 45 67 ou +221 77 123 45 67).';
    },
    email(value) {
      const v = clean(value);
      if (!v) return "L'adresse email est obligatoire.";
      return v.length <= 150 && EMAIL_RE.test(v) ? '' : "L'adresse email n'est pas valide.";
    },
    transaction(value) {
      const v = clean(value);
      if (!v) return 'Le numéro de transaction est obligatoire.';
      return TX_RE.test(v) ? '' : 'Numéro invalide : 6 à 30 caractères (lettres, chiffres, tirets, underscore).';
    },
    password(value) {
      const v = String(value ?? '');
      if (v.length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.';
      if (!/\p{L}/u.test(v) || !/\d/.test(v)) return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
      return '';
    }
  };

  /* ===================================================================
     3. SHA-256 en JavaScript pur (secours si WebCrypto est indisponible,
        par exemple sur une page servie en http:// hors localhost)
     =================================================================== */
  function sha256(str) {
    const ascii = unescape(encodeURIComponent(str));
    const rr = (v, a) => (v >>> a) | (v << (32 - a));
    const mp = Math.pow, mw = mp(2, 32);
    let i, j, result = '';
    const words = [];
    const bitLength = ascii.length * 8;
    let hash = (sha256.h = sha256.h || []);
    const k = (sha256.k = sha256.k || []);
    let primeCounter = k.length;
    const composite = {};
    for (let c = 2; primeCounter < 64; c++) {
      if (!composite[c]) {
        for (i = 0; i < 313; i += c) composite[i] = c;
        hash[primeCounter] = (mp(c, 0.5) * mw) | 0;
        k[primeCounter++] = (mp(c, 1 / 3) * mw) | 0;
      }
    }
    let p = ascii + '\x80';
    while (p.length % 64 - 56) p += '\x00';
    for (i = 0; i < p.length; i++) {
      j = p.charCodeAt(i);
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (bitLength / mw) | 0;
    words[words.length] = bitLength;
    for (j = 0; j < words.length;) {
      const w = words.slice(j, (j += 16));
      const oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        const t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ (~e & hash[6])) + k[i] +
          (w[i] = i < 16 ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        const t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(t1 + t2) | 0].concat(hash);
        hash[4] = (hash[4] + t1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        const b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? '0' : '') + b.toString(16);
      }
    }
    return result;
  }

  /* ===================================================================
     4. Store : persistance
     =================================================================== */
  const KEY = {
    data: CFG.storagePrefix + 'inscriptions',
    auth: CFG.storagePrefix + 'admin',
    lock: CFG.storagePrefix + 'lock',
    lastRef: CFG.storagePrefix + 'lastRef',
    session: CFG.storagePrefix + 'session'
  };
  const OLD_KEY = 'aerdz_inscriptions_v1';
  const STORAGE_ERROR = "Impossible d'enregistrer : l'espace de stockage du navigateur est plein. Exportez une sauvegarde puis libérez de la place.";
  const STORAGE_LIMIT_CHARS = 5000000; // ~5 Mo : limite habituelle du localStorage

  const storage = {
    read(key, fallback = null) {
      try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
      catch (e) { return fallback; }
    },
    write(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignoré */ } }
  };

  const emptyPayment = () => ({
    statut: 'non_paye', transaction: null, recu: null,
    dateSoumission: null, datePaiement: null, motifRefus: null
  });

  /** Garantit qu'un dossier possède tous les champs attendus (anciennes données comprises) */
  function ensureShape(it) {
    const out = { ...it };
    out.paiement = { ...emptyPayment(), ...(it.paiement || {}) };
    out.historique = Array.isArray(it.historique) ? it.historique : [];
    out.reference = out.reference || makeReference();
    out.numeroCarte = out.numeroCarte || null;
    out.dateValidation = out.dateValidation || null;
    out.dateDelivrance = out.dateDelivrance || null;
    return out;
  }

  const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I
  const makeReference = () => 'DGN-' + randomString(6, REF_ALPHABET);

  /** Migre les données de l'ancienne version (clé aerdz_inscriptions_v1) */
  function migrateV1() {
    if (localStorage.getItem(KEY.data) !== null) return;
    const old = storage.read(OLD_KEY, null);
    if (!Array.isArray(old) || !old.length) return;
    const migrated = old.map((o) => ensureShape({
      id: o.id || uid(), nom: o.nom, prenom: o.prenom, filiere: o.filiere, niveau: o.niveau,
      telephone: o.telephone, email: String(o.email || '').toLowerCase(), photo: o.photo || null,
      statut: o.statut || 'en_attente', numeroCarte: o.numeroCarte || null,
      dateInscription: o.dateInscription || nowIso(),
      dateValidation: o.statut === 'valide' ? (o.dateDelivrance || null) : null,
      dateDelivrance: o.statut === 'valide' ? (o.dateDelivrance || null) : null,
      paiement: {
        ...emptyPayment(),
        statut: o.statut === 'valide' ? 'paye' : 'non_paye',
        transaction: o.transaction || null, recu: o.recu || null,
        datePaiement: o.statut === 'valide' ? (o.dateDelivrance || null) : null
      },
      historique: [{ date: nowIso(), texte: 'Dossier importé depuis l’ancienne version du site.' }]
    }));
    storage.write(KEY.data, migrated);
  }

  let cache = null;
  const listeners = new Set();

  const Store = {
    /** Liste complète (lecture seule : ne la modifiez pas directement) */
    all() {
      if (cache) return cache;
      try { migrateV1(); } catch (e) { /* migration facultative */ }
      const raw = storage.read(KEY.data, []);
      cache = Array.isArray(raw) ? raw.map(ensureShape) : [];
      return cache;
    },
    save(list) {
      if (!storage.write(KEY.data, list)) return false;
      cache = list;
      return true;
    },
    get(id) { return Store.all().find((i) => i.id === id) || null; },

    /** Recherche par référence de suivi, numéro de carte ou email */
    lookup(raw) {
      const q = clean(raw);
      if (!q) return null;
      const code = q.toUpperCase().replace(/[\s-]/g, '');
      const mail = q.toLowerCase();
      return Store.all().find((i) =>
        i.reference.replace('-', '') === code ||
        (i.numeroCarte || '').toUpperCase().replace(/-/g, '') === code ||
        i.email === mail) || null;
    },

    persist(item) {
      const list = Store.all().slice();
      const idx = list.findIndex((i) => i.id === item.id);
      if (idx === -1) list.push(item); else list[idx] = item;
      return Store.save(list);
    },

    nextCardNumber() {
      const year = new Date().getFullYear();
      const re = new RegExp('^' + CFG.cardPrefix + '-' + year + '-(\\d+)$');
      const max = Store.all().reduce((m, i) => {
        const hit = re.exec(i.numeroCarte || '');
        return hit ? Math.max(m, parseInt(hit[1], 10)) : m;
      }, 0);
      return `${CFG.cardPrefix}-${year}-${String(max + 1).padStart(3, '0')}`;
    },

    uniqueReference() {
      let ref;
      do { ref = makeReference(); } while (Store.all().some((i) => i.reference === ref));
      return ref;
    },

    transactionUsed(tx, exceptId) {
      const t = clean(tx).toLowerCase();
      return Store.all().some((i) => i.id !== exceptId && i.paiement.transaction &&
        i.paiement.transaction.toLowerCase() === t && ['en_verification', 'paye'].includes(i.paiement.statut));
    },

    /* --- Sauvegarde / restauration --- */
    exportJSON() {
      return JSON.stringify({ app: 'aerdz', version: 2, exportedAt: nowIso(), inscriptions: Store.all() }, null, 2);
    },
    importJSON(text) {
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { return { ok: false, error: "Ce fichier n'est pas une sauvegarde valide." }; }
      const list = Array.isArray(parsed) ? parsed : parsed && parsed.inscriptions;
      if (!Array.isArray(list)) return { ok: false, error: "Ce fichier n'est pas une sauvegarde AERDZ." };
      const required = ['id', 'nom', 'prenom', 'filiere', 'niveau', 'email'];
      if (!list.every((i) => i && typeof i === 'object' && required.every((f) => typeof i[f] === 'string'))) {
        return { ok: false, error: 'La sauvegarde est incomplète ou corrompue.' };
      }
      const shaped = list.map(ensureShape);
      return Store.save(shaped) ? { ok: true, count: shaped.length } : { ok: false, error: STORAGE_ERROR };
    },
    usage() {
      let chars = 0;
      try { chars = (localStorage.getItem(KEY.data) || '').length; } catch (e) { /* ignoré */ }
      return { chars, percent: Math.min(100, Math.round((chars / STORAGE_LIMIT_CHARS) * 100)) };
    },

    /** Dernière référence de suivi utilisée sur cet appareil (pratique pour l'étudiant) */
    rememberRef(ref) { storage.write(KEY.lastRef, ref); },
    lastRef() { return storage.read(KEY.lastRef, ''); },

    /** Notifie les changements faits depuis un autre onglet */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };

  global.addEventListener('storage', (e) => {
    if (e.key === KEY.data || e.key === null) {
      cache = null;
      listeners.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } });
    }
  });

  /* ===================================================================
     5. Workflow : toutes les règles métier passent par ici
        Chaque action renvoie { ok: true, item } ou { ok: false, error }
     =================================================================== */
  const fail = (error) => ({ ok: false, error });
  const logEntry = (item, texte) => item.historique.push({ date: nowIso(), texte });

  function apply(id, fn) {
    const found = Store.get(id);
    if (!found) return fail('Dossier introuvable.');
    const item = clone(found);
    const error = fn(item);
    if (typeof error === 'string') return fail(error);
    return Store.persist(item) ? { ok: true, item } : fail(STORAGE_ERROR);
  }

  const Workflow = {
    create(data) {
      if (Store.all().some((i) => i.email === data.email)) return fail('EMAIL_EXISTS');
      const item = ensureShape({
        id: uid(), reference: Store.uniqueReference(), ...data,
        statut: 'en_attente', dateInscription: nowIso()
      });
      logEntry(item, 'Demande envoyée.');
      return Store.persist(item) ? { ok: true, item } : fail(STORAGE_ERROR);
    },

    validate(id) {
      return apply(id, (it) => {
        if (it.statut === 'valide') return 'Cette demande est déjà validée.';
        it.statut = 'valide';
        it.numeroCarte = it.numeroCarte || Store.nextCardNumber();
        it.dateValidation = nowIso();
        it.paiement = { ...emptyPayment() };
        logEntry(it, `Demande validée — numéro de carte ${it.numeroCarte}. Paiement ouvert.`);
      });
    },

    reject(id) {
      return apply(id, (it) => {
        if (it.statut === 'rejete') return 'Cette demande est déjà rejetée.';
        if (it.paiement.statut === 'paye') return 'Une carte déjà payée ne peut pas être rejetée.';
        if (it.paiement.statut === 'en_verification') return "Traitez d'abord le paiement soumis (confirmer ou refuser).";
        it.statut = 'rejete';
        it.paiement = { ...emptyPayment() };
        logEntry(it, 'Demande rejetée.');
      });
    },

    /** Remet le dossier « en attente » (réexamen d'un rejet, ou annulation d'une validation non payée) */
    reopen(id) {
      return apply(id, (it) => {
        if (it.statut === 'en_attente') return 'Cette demande est déjà en attente.';
        if (it.paiement.statut === 'paye') return 'Une carte déjà payée ne peut pas être remise en attente.';
        if (it.paiement.statut === 'en_verification') return "Traitez d'abord le paiement soumis (confirmer ou refuser).";
        it.statut = 'en_attente';
        it.dateValidation = null;
        it.paiement = { ...emptyPayment() };
        logEntry(it, 'Dossier remis en attente.');
      });
    },

    /** L'étudiant déclare son paiement Wave. Possible UNIQUEMENT après validation. */
    submitPayment(id, { transaction, recu }) {
      const error = V.transaction(transaction);
      if (error) return fail(error);
      return apply(id, (it) => {
        if (it.statut !== 'valide') return "Le paiement n'est possible qu'après la validation de votre demande par l'administration.";
        if (it.paiement.statut === 'en_verification') return 'Un paiement est déjà en cours de vérification.';
        if (it.paiement.statut === 'paye') return 'Votre carte est déjà payée.';
        if (Store.transactionUsed(transaction, it.id)) return 'Ce numéro de transaction est déjà utilisé pour un autre dossier.';
        it.paiement = {
          ...emptyPayment(), statut: 'en_verification',
          transaction: clean(transaction), recu: recu || null, dateSoumission: nowIso()
        };
        logEntry(it, `Paiement déclaré (transaction ${it.paiement.transaction}).`);
      });
    },

    confirmPayment(id) {
      return apply(id, (it) => {
        if (it.statut !== 'valide' || it.paiement.statut !== 'en_verification') return "Aucun paiement à confirmer pour ce dossier.";
        it.paiement.statut = 'paye';
        it.paiement.datePaiement = nowIso();
        it.paiement.motifRefus = null;
        it.dateDelivrance = nowIso();
        logEntry(it, 'Paiement confirmé — carte délivrée.');
      });
    },

    refusePayment(id, motif) {
      const reason = clean(motif);
      if (!reason) return fail('Indiquez le motif du refus.');
      return apply(id, (it) => {
        if (it.statut !== 'valide' || it.paiement.statut !== 'en_verification') return "Aucun paiement à refuser pour ce dossier.";
        const tx = it.paiement.transaction;
        it.paiement = { ...emptyPayment(), motifRefus: reason };
        logEntry(it, `Paiement refusé (transaction ${tx}) : ${reason}`);
      });
    }
  };

  /* ===================================================================
     6. Auth : authentification administrateur
        ⚠ Elle protège l'interface, pas les données : tout ce qui est dans
        le navigateur reste lisible par quelqu'un qui ouvre les outils de
        développement. Pour une vraie sécurité, il faut un serveur.
     =================================================================== */
  const PBKDF2_ITER = 150000;
  const enc = new TextEncoder();
  const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  const fromHex = (hex) => Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));
  const hasSubtle = () => !!(global.crypto && crypto.subtle && typeof crypto.subtle.importKey === 'function');

  async function derive(password, saltHex, algo) {
    if (algo === 'pbkdf2') {
      const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: fromHex(saltHex), iterations: PBKDF2_ITER, hash: 'SHA-256' }, key, 256);
      return toHex(bits);
    }
    let h = sha256(saltHex + ':' + password);
    for (let i = 0; i < 1500; i++) h = sha256(h + saltHex + password);
    return h;
  }

  function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  async function makeCredential(password) {
    const algo = hasSubtle() ? 'pbkdf2' : 'sha256';
    const salt = randomString(32, '0123456789abcdef');
    return { algo, salt, hash: await derive(password, salt, algo) };
  }

  const LOCK_STEPS = 5; // échecs avant blocage temporaire

  const Auth = {
    isSetup() { return !!storage.read(KEY.auth, null); },

    async setup(password) {
      const error = V.password(password);
      if (error) return fail(error);
      if (Auth.isSetup()) return fail('Un mot de passe existe déjà.');
      if (!storage.write(KEY.auth, await makeCredential(password))) return fail(STORAGE_ERROR);
      Auth._open();
      return { ok: true };
    },

    lockRemaining() {
      const lock = storage.read(KEY.lock, null);
      return lock && lock.until > Date.now() ? Math.ceil((lock.until - Date.now()) / 1000) : 0;
    },

    async login(password) {
      const wait = Auth.lockRemaining();
      if (wait) return fail(`Trop de tentatives. Réessayez dans ${wait} s.`);
      const cred = storage.read(KEY.auth, null);
      if (!cred) return fail("Aucun mot de passe n'est défini.");
      const hash = await derive(String(password ?? ''), cred.salt, cred.algo);
      if (safeEqual(hash, cred.hash)) {
        storage.remove(KEY.lock);
        Auth._open();
        return { ok: true };
      }
      const lock = storage.read(KEY.lock, { count: 0, level: 0, until: 0 });
      lock.count += 1;
      if (lock.count >= LOCK_STEPS) {
        lock.level += 1;
        lock.until = Date.now() + 60000 * lock.level;
        lock.count = 0;
        storage.write(KEY.lock, lock);
        return fail(`Trop de tentatives. Accès bloqué ${lock.level} minute(s).`);
      }
      storage.write(KEY.lock, lock);
      return fail('Mot de passe incorrect.');
    },

    async change(oldPassword, newPassword) {
      const cred = storage.read(KEY.auth, null);
      if (!cred || !safeEqual(await derive(String(oldPassword ?? ''), cred.salt, cred.algo), cred.hash)) return fail('Ancien mot de passe incorrect.');
      const error = V.password(newPassword);
      if (error) return fail(error);
      return storage.write(KEY.auth, await makeCredential(newPassword)) ? { ok: true } : fail(STORAGE_ERROR);
    },

    _open() { try { sessionStorage.setItem(KEY.session, String(Date.now() + CFG.sessionMinutes * 60000)); } catch (e) { /* ignoré */ } },
    isLoggedIn() {
      try { return Number(sessionStorage.getItem(KEY.session) || 0) > Date.now(); } catch (e) { return false; }
    },
    touch() { if (Auth.isLoggedIn()) Auth._open(); },
    logout() { try { sessionStorage.removeItem(KEY.session); } catch (e) { /* ignoré */ } }
  };

  /* ===================================================================
     7. Export
     =================================================================== */
  global.AERDZ = Object.assign(global.AERDZ || {}, {
    CFG, $, $$, esc, clean, normalize, fmtDate, debounce, academicYear, initials, titleCase,
    formatMoney, fmtPhone, csvSafe, uid, V, sha256, Store, Workflow, Auth
  });
})(window);
