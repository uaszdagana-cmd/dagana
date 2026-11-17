/* =====================================================================
   AERDZ — admin.js
   Tableau de bord : validation des demandes, confirmation des paiements,
   recherche, filtres, détails, export CSV, sauvegarde.
   Toutes les modifications passent par Workflow (règles métier centralisées).
   ===================================================================== */
(function (A) {
  'use strict';
  const { $, $$, esc, clean, normalize, fmtDate, debounce, csvSafe, CFG, Store, Workflow, Auth, UI } = A;

  UI.ready(() => {
    const el = {
      setup: $('#vue-setup'), login: $('#vue-login'), dash: $('#vue-dashboard'),
      stats: $('#stats'), chips: $('#chips'), tbody: $('#tbody'), vide: $('#vide'),
      info: $('#results-info'), pagination: $('#pagination'), search: $('#recherche'),
      level: $('#filtre-niveau'), sort: $('#tri')
    };

    const PAGE_SIZE = 10;
    const state = { q: '', chip: 'tous', level: '', sort: 'recent', page: 1 };

    /* ===================================================================
       Filtres (étapes du workflow)
       =================================================================== */
    const CHIPS = [
      { id: 'tous', label: 'Tous', test: () => true },
      { id: 'attente', label: 'À valider', test: (i) => i.statut === 'en_attente' },
      { id: 'apayer', label: 'À payer', test: (i) => i.statut === 'valide' && i.paiement.statut === 'non_paye' },
      { id: 'averifier', label: 'Paiements à vérifier', test: (i) => i.statut === 'valide' && i.paiement.statut === 'en_verification' },
      { id: 'pretes', label: 'Cartes prêtes', test: (i) => i.paiement.statut === 'paye' },
      { id: 'rejetes', label: 'Rejetées', test: (i) => i.statut === 'rejete' }
    ];

    const SORTERS = {
      recent: (a, b) => new Date(b.dateInscription) - new Date(a.dateInscription),
      ancien: (a, b) => new Date(a.dateInscription) - new Date(b.dateInscription),
      nom: (a, b) => `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, 'fr')
    };

    const haystack = (i) => normalize([
      i.nom, i.prenom, `${i.prenom} ${i.nom}`, `${i.nom} ${i.prenom}`, i.filiere, i.niveau,
      i.email, i.telephone, i.reference, i.numeroCarte, i.paiement.transaction
    ].join(' '));

    function filtered() {
      const q = normalize(state.q);
      const chip = CHIPS.find((c) => c.id === state.chip) || CHIPS[0];
      return Store.all()
        .filter((i) => chip.test(i) && (!state.level || i.niveau === state.level) && (!q || haystack(i).includes(q)))
        .sort(SORTERS[state.sort]);
    }

    /* ===================================================================
       Rendu
       =================================================================== */
    function renderStats() {
      const all = Store.all();
      const paid = all.filter((i) => i.paiement.statut === 'paye').length;
      const cards = [
        ['Demandes', all.length, ''],
        ['À valider', all.filter(CHIPS[1].test).length, 'warn'],
        ['Paiements à vérifier', all.filter(CHIPS[3].test).length, 'info'],
        ['Cartes délivrées', paid, 'ok'],
        ['Recettes confirmées', A.formatMoney(paid * CFG.price), 'money']
      ];
      el.stats.innerHTML = cards.map(([label, value, tone]) =>
        `<div class="stat ${tone ? 'stat-' + tone : ''}"><span class="stat-num">${esc(value)}</span><span class="stat-label">${esc(label)}</span></div>`).join('');
    }

    function renderChips() {
      const all = Store.all();
      el.chips.innerHTML = CHIPS.map((c) => {
        const n = all.filter(c.test).length;
        return `<button type="button" class="chip${state.chip === c.id ? ' is-active' : ''}" data-chip="${c.id}" aria-pressed="${state.chip === c.id}">${esc(c.label)} <span class="chip-count">${n}</span></button>`;
      }).join('');
    }

    const demandeBadge = (i) => ({
      en_attente: '<span class="badge badge-attente">En attente</span>',
      valide: '<span class="badge badge-valide">Validée</span>',
      rejete: '<span class="badge badge-rejete">Rejetée</span>'
    }[i.statut]);

    function paiementCell(i) {
      if (i.statut !== 'valide') return '<span class="muted">—</span>';
      const p = i.paiement;
      if (p.statut === 'non_paye') {
        return `<span class="badge badge-apayer">À payer</span>${p.motifRefus ? `<div class="cell-sub warn-text">Refusé : ${esc(p.motifRefus)}</div>` : ''}`;
      }
      if (p.statut === 'en_verification') {
        return `<span class="badge badge-verif">À vérifier</span>
          <div class="cell-sub">Tx : <code>${esc(p.transaction)}</code></div>
          ${p.recu ? `<img class="receipt-thumb" src="${esc(p.recu)}" alt="Reçu Wave de ${esc(i.prenom)} ${esc(i.nom)}" data-img="${esc(p.recu)}" data-caption="Reçu — ${esc(i.prenom)} ${esc(i.nom)}" tabindex="0" role="button">` : '<div class="cell-sub muted">Sans reçu</div>'}`;
      }
      return `<span class="badge badge-valide">Payé</span><div class="cell-sub">${esc(fmtDate(p.datePaiement))}</div>`;
    }

    function actions(i) {
      const b = (action, label, cls) => `<button type="button" class="btn btn-sm ${cls}" data-action="${action}" data-id="${esc(i.id)}">${label}</button>`;
      const out = [];
      if (i.statut === 'en_attente') {
        out.push(b('validate', 'Valider', 'btn-primary'), b('reject', 'Rejeter', 'btn-danger-soft'));
      } else if (i.statut === 'rejete') {
        out.push(b('reopen', 'Réexaminer', 'btn-ghost'));
      } else if (i.paiement.statut === 'non_paye') {
        out.push(b('reopen', 'Annuler la validation', 'btn-ghost'));
      } else if (i.paiement.statut === 'en_verification') {
        out.push(b('confirm-pay', 'Confirmer le paiement', 'btn-primary'), b('refuse-pay', 'Refuser', 'btn-danger-soft'));
      } else {
        out.push(`<a class="btn btn-sm btn-primary" href="carte.html?num=${encodeURIComponent(i.numeroCarte)}" target="_blank" rel="noopener">Voir la carte</a>`);
      }
      out.push(b('details', 'Détails', 'btn-ghost'));
      return out.join('');
    }

    function avatar(i) {
      return i.photo
        ? `<img class="avatar" src="${esc(i.photo)}" alt="Photo de ${esc(i.prenom)} ${esc(i.nom)}" data-img="${esc(i.photo)}" data-caption="${esc(i.prenom)} ${esc(i.nom)}" tabindex="0" role="button">`
        : `<span class="avatar avatar-text" aria-hidden="true">${esc(A.initials(i.prenom, i.nom))}</span>`;
    }

    function renderTable() {
      const list = filtered();
      const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      state.page = Math.min(Math.max(1, state.page), pages);
      const slice = list.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

      el.info.textContent = `${list.length} dossier${list.length > 1 ? 's' : ''}${list.length !== Store.all().length ? ' (filtré)' : ''}`;
      $('#btn-export').textContent = list.length !== Store.all().length ? `Exporter la sélection (${list.length})` : 'Exporter en CSV';

      el.vide.hidden = list.length > 0;
      $('.table', el.dash).hidden = list.length === 0;

      el.tbody.innerHTML = slice.map((i) => `
        <tr>
          <td data-label="Étudiant">
            <div class="cell-student">${avatar(i)}
              <div><strong>${esc(i.nom)}</strong> ${esc(i.prenom)}<div class="cell-sub">Réf. <code>${esc(i.reference)}</code></div></div>
            </div>
          </td>
          <td data-label="Filière / Niveau">${esc(i.filiere)}<div class="cell-sub">${esc(i.niveau)}</div></td>
          <td data-label="Contact"><a href="tel:${esc(i.telephone)}">${esc(A.fmtPhone(i.telephone))}</a><div class="cell-sub"><a href="mailto:${esc(i.email)}">${esc(i.email)}</a></div></td>
          <td data-label="Demande">${demandeBadge(i)}<div class="cell-sub">${esc(fmtDate(i.dateInscription))}</div></td>
          <td data-label="Paiement">${paiementCell(i)}</td>
          <td data-label="N° carte">${i.numeroCarte ? `<code>${esc(i.numeroCarte)}</code>` : '<span class="muted">—</span>'}</td>
          <td data-label="Actions"><div class="row-actions">${actions(i)}</div></td>
        </tr>`).join('');

      if (pages > 1) {
        el.pagination.hidden = false;
        el.pagination.innerHTML = `
          <button type="button" class="btn btn-ghost btn-sm" data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>← Précédent</button>
          <span>Page ${state.page} sur ${pages}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-page="${state.page + 1}" ${state.page === pages ? 'disabled' : ''}>Suivant →</button>`;
      } else {
        el.pagination.hidden = true;
      }
    }

    function renderStorage() {
      const u = Store.usage();
      $('#meter-fill').style.width = `${Math.max(2, u.percent)}%`;
      $('#meter-fill').parentElement.classList.toggle('is-high', u.percent >= 80);
      $('#meter-text').textContent = `Stockage du navigateur utilisé : ${u.percent} %` + (u.percent >= 80 ? ' — pensez à sauvegarder puis à libérer de la place.' : '');
    }

    function refresh() {
      renderStats();
      renderChips();
      renderTable();
      renderStorage();
    }

    /* ===================================================================
       Actions sur les dossiers
       =================================================================== */
    function done(result, successMessage, type = 'success') {
      if (!result.ok) UI.toast(result.error, 'error', 7000);
      else UI.toast(successMessage, type);
      refresh();
    }

    async function handleAction(action, id) {
      const it = Store.get(id);
      if (!it) { UI.toast('Dossier introuvable.', 'error'); refresh(); return; }
      const name = `${it.prenom} ${it.nom}`;
      const price = A.formatMoney(CFG.price);

      switch (action) {
        case 'details':
          openDetails(it);
          break;

        case 'validate':
          if (await UI.confirm({
            title: 'Valider cette demande ?',
            message: `${name} pourra ensuite payer sa carte (${price} par Wave). Un numéro de carte lui sera attribué.`,
            confirmText: 'Valider la demande'
          })) done(Workflow.validate(id), `Demande de ${name} validée : le paiement est ouvert.`);
          break;

        case 'reject':
          if (await UI.confirm({
            title: 'Rejeter cette demande ?',
            message: `La demande de ${name} sera rejetée. Vous pourrez la réexaminer plus tard.`,
            confirmText: 'Rejeter', tone: 'danger'
          })) done(Workflow.reject(id), `Demande de ${name} rejetée.`, 'info');
          break;

        case 'reopen':
          if (await UI.confirm({
            title: 'Remettre en attente ?',
            message: it.statut === 'rejete'
              ? `Le dossier de ${name} sera de nouveau à valider.`
              : `La validation de ${name} sera annulée et son paiement refermé.`,
            confirmText: 'Remettre en attente'
          })) done(Workflow.reopen(id), `Dossier de ${name} remis en attente.`, 'info');
          break;

        case 'confirm-pay':
          if (await UI.confirm({
            title: 'Confirmer le paiement ?',
            message: `Vérifiez dans Wave que ${price} sont bien arrivés (transaction ${it.paiement.transaction}). La carte de ${name} sera délivrée immédiatement.`,
            confirmText: 'Paiement reçu — délivrer la carte'
          })) done(Workflow.confirmPayment(id), `Paiement confirmé : la carte de ${name} est prête.`);
          break;

        case 'refuse-pay': {
          const reason = await UI.prompt({
            title: 'Refuser ce paiement ?',
            message: `L'étudiant (${name}) verra ce motif et pourra soumettre un nouveau paiement.`,
            label: 'Motif du refus', placeholder: 'Ex : montant reçu inférieur, transaction introuvable…',
            confirmText: 'Refuser le paiement', tone: 'danger'
          });
          if (reason) done(Workflow.refusePayment(id, reason), `Paiement de ${name} refusé.`, 'info');
          break;
        }
        default:
      }
    }

    function openDetails(it) {
      const p = it.paiement;
      const dl = (label, value) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
      const photo = it.photo
        ? `<img class="detail-photo" src="${esc(it.photo)}" alt="Photo de ${esc(it.prenom)} ${esc(it.nom)}" data-img="${esc(it.photo)}" data-caption="${esc(it.prenom)} ${esc(it.nom)}" tabindex="0" role="button">`
        : `<div class="detail-photo detail-photo-empty">${esc(A.initials(it.prenom, it.nom))}</div>`;
      const dlg = UI.modal(`
        <div class="dialog-body dialog-wide">
          <div class="detail-head">
            ${photo}
            <div><h2 id="dlg-title">${esc(it.prenom)} ${esc(it.nom)}</h2>
              <p class="muted">${esc(it.filiere)} · ${esc(it.niveau)}</p>
              <p>${demandeBadge(it)} ${it.statut === 'valide' ? paiementBadgeOnly(p) : ''}</p></div>
          </div>
          <dl class="detail-grid">
            ${dl('Référence de suivi', `<code>${esc(it.reference)}</code>`)}
            ${dl('N° de carte', it.numeroCarte ? `<code>${esc(it.numeroCarte)}</code>` : '—')}
            ${dl('Téléphone', `<a href="tel:${esc(it.telephone)}">${esc(A.fmtPhone(it.telephone))}</a>`)}
            ${dl('Email', `<a href="mailto:${esc(it.email)}">${esc(it.email)}</a>`)}
            ${dl('Inscrit le', esc(fmtDate(it.dateInscription, true)))}
            ${dl('Validée le', esc(fmtDate(it.dateValidation, true)))}
            ${dl('Transaction Wave', p.transaction ? `<code>${esc(p.transaction)}</code>` : '—')}
            ${dl('Paiement confirmé le', esc(fmtDate(p.datePaiement, true)))}
          </dl>
          ${p.recu ? `<p><button type="button" class="link-btn" data-img="${esc(p.recu)}" data-caption="Reçu Wave">Voir le reçu Wave joint</button></p>` : ''}
          <h3 class="detail-sub">Historique</h3>
          <ol class="history">${[...it.historique].reverse().map((h) => `<li><time>${esc(fmtDate(h.date, true))}</time> ${esc(h.texte)}</li>`).join('') || '<li class="muted">Aucun événement.</li>'}</ol>
          <form method="dialog" class="dialog-actions"><button class="btn btn-primary" autofocus>Fermer</button></form>
        </div>`);
      dlg.addEventListener('click', (e) => {
        const target = e.target.closest('[data-img]');
        if (target) UI.lightbox(target.dataset.img, target.dataset.caption || '');
      });
    }

    const paiementBadgeOnly = (p) => ({
      non_paye: '<span class="badge badge-apayer">À payer</span>',
      en_verification: '<span class="badge badge-verif">Paiement à vérifier</span>',
      paye: '<span class="badge badge-valide">Payé</span>'
    }[p.statut]);

    /* ===================================================================
       Export / sauvegarde
       =================================================================== */
    function download(content, type, filename) {
      const url = URL.createObjectURL(new Blob([content], { type }));
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
    const today = () => new Date().toISOString().slice(0, 10);

    function exportCsv() {
      const rows = filtered();
      if (!rows.length) { UI.toast('Aucun dossier à exporter.', 'warning'); return; }
      const label = { en_attente: 'En attente', valide: 'Validée', rejete: 'Rejetée' };
      const payLabel = { non_paye: 'À payer', en_verification: 'À vérifier', paye: 'Payé' };
      const head = ['Référence', 'N° Carte', 'Nom', 'Prénom', 'Filière', 'Niveau', 'Téléphone', 'Email', 'Statut demande',
        'Statut paiement', 'Transaction Wave', `Montant (${CFG.currency})`, 'Date inscription', 'Date validation', 'Date paiement', 'Date délivrance'];
      const body = rows.map((i) => [
        i.reference, i.numeroCarte || '', i.nom, i.prenom, i.filiere, i.niveau, i.telephone, i.email,
        label[i.statut], i.statut === 'valide' ? payLabel[i.paiement.statut] : '—', i.paiement.transaction || '',
        i.paiement.statut === 'paye' ? CFG.price : '',
        fmtDate(i.dateInscription), i.dateValidation ? fmtDate(i.dateValidation) : '',
        i.paiement.datePaiement ? fmtDate(i.paiement.datePaiement) : '', i.dateDelivrance ? fmtDate(i.dateDelivrance) : ''
      ]);
      const csv = '﻿' + [head, ...body].map((r) => r.map((c) => `"${csvSafe(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
      download(csv, 'text/csv;charset=utf-8', `inscriptions_aerdz_${today()}.csv`);
      UI.toast(`${rows.length} dossier(s) exporté(s).`, 'success');
    }

    /* ===================================================================
       Authentification (vues)
       =================================================================== */
    function showView() {
      const logged = Auth.isLoggedIn();
      const configured = Auth.isSetup();
      el.setup.hidden = logged || configured;
      el.login.hidden = logged || !configured;
      el.dash.hidden = !logged;
      if (logged) refresh();
    }

    const fieldError = (input, errEl, msg) => {
      errEl.textContent = msg || '';
      input.classList.toggle('is-invalid', !!msg);
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    };

    $('#form-setup').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pwd = $('#setup-pwd'), pwd2 = $('#setup-pwd2');
      const problem = A.V.password(pwd.value);
      fieldError(pwd, $('#err-setup-pwd'), problem);
      fieldError(pwd2, $('#err-setup-pwd2'), !problem && pwd.value !== pwd2.value ? 'Les deux mots de passe ne correspondent pas.' : '');
      if (problem || pwd.value !== pwd2.value) return;
      const res = await Auth.setup(pwd.value);
      if (!res.ok) { fieldError(pwd, $('#err-setup-pwd'), res.error); return; }
      pwd.value = pwd2.value = '';
      UI.toast('Mot de passe créé. Vous êtes connecté.', 'success');
      showView();
    });

    $('#form-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pwd = $('#login-pwd'), btn = $('#btn-login');
      UI.setBusy(btn, true, 'Vérification…');
      const res = await Auth.login(pwd.value);
      UI.setBusy(btn, false);
      if (!res.ok) { fieldError(pwd, $('#err-login'), res.error); pwd.select(); return; }
      fieldError(pwd, $('#err-login'), '');
      pwd.value = '';
      showView();
    });

    $('#btn-eye').addEventListener('click', (e) => {
      const pwd = $('#login-pwd');
      const show = pwd.type === 'password';
      pwd.type = show ? 'text' : 'password';
      e.currentTarget.textContent = show ? 'Masquer' : 'Afficher';
      e.currentTarget.setAttribute('aria-pressed', String(show));
      e.currentTarget.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
    });

    $('#btn-logout').addEventListener('click', () => { Auth.logout(); showView(); UI.toast('Vous êtes déconnecté.', 'info'); });

    $('#form-pwd').addEventListener('submit', async (e) => {
      e.preventDefault();
      const oldP = $('#old-pwd'), newP = $('#new-pwd'), err = $('#err-pwd');
      const res = await Auth.change(oldP.value, newP.value);
      err.textContent = res.ok ? '' : res.error;
      if (res.ok) { oldP.value = newP.value = ''; UI.toast('Mot de passe mis à jour.', 'success'); }
    });

    // Expiration de session par inactivité
    ['click', 'keydown', 'pointerdown'].forEach((ev) => document.addEventListener(ev, () => Auth.touch(), { passive: true }));
    setInterval(() => {
      if (!el.dash.hidden && !Auth.isLoggedIn()) { showView(); UI.toast('Session expirée par inactivité. Reconnectez-vous.', 'warning', 8000); }
    }, 15000);

    /* ===================================================================
       Événements du tableau de bord
       =================================================================== */
    el.level.insertAdjacentHTML('beforeend', CFG.levels.map((n) => `<option>${esc(n)}</option>`).join(''));

    el.search.addEventListener('input', debounce(() => { state.q = el.search.value; state.page = 1; renderTable(); }, 160));
    el.level.addEventListener('change', () => { state.level = el.level.value; state.page = 1; renderTable(); });
    el.sort.addEventListener('change', () => { state.sort = el.sort.value; state.page = 1; renderTable(); });
    el.chips.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-chip]');
      if (!chip) return;
      state.chip = chip.dataset.chip; state.page = 1;
      renderChips(); renderTable();
    });
    el.pagination.addEventListener('click', (e) => {
      const b = e.target.closest('[data-page]');
      if (!b || b.disabled) return;
      state.page = Number(b.dataset.page);
      renderTable();
      $('#table-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    el.tbody.addEventListener('click', (e) => {
      const img = e.target.closest('img[data-img]');
      if (img) { UI.lightbox(img.dataset.img, img.dataset.caption || ''); return; }
      const btn = e.target.closest('button[data-action]');
      if (btn) handleAction(btn.dataset.action, btn.dataset.id);
    });
    el.tbody.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('img[data-img]')) { e.preventDefault(); UI.lightbox(e.target.dataset.img, e.target.dataset.caption || ''); }
    });

    $('#btn-export').addEventListener('click', exportCsv);

    $('#btn-backup').addEventListener('click', () => {
      download(Store.exportJSON(), 'application/json', `sauvegarde_aerdz_${today()}.json`);
      UI.toast('Sauvegarde téléchargée. Gardez-la en lieu sûr (elle contient des données personnelles).', 'success', 6500);
    });

    $('#restore-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const ok = await UI.confirm({
        title: 'Restaurer cette sauvegarde ?',
        message: 'Tous les dossiers actuellement présents dans ce navigateur seront REMPLACÉS par ceux de la sauvegarde.',
        confirmText: 'Remplacer les données', tone: 'danger'
      });
      if (!ok) return;
      const res = Store.importJSON(await file.text());
      if (res.ok) { UI.toast(`${res.count} dossier(s) restauré(s).`, 'success'); refresh(); }
      else UI.toast(res.error, 'error', 7000);
    });

    // Un autre onglet a modifié les données (ex. un étudiant vient de s'inscrire ou de payer)
    Store.subscribe(() => { if (!el.dash.hidden) { refresh(); UI.toast('Les données ont été mises à jour.', 'info', 2500); } });

    showView();
  });
})(window.AERDZ);
