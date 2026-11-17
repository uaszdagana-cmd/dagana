/* =====================================================================
   AERDZ — carte.js
   Consultation de la carte étudiant.
   La carte n'est affichée que si le paiement a été CONFIRMÉ par l'administration.
   ===================================================================== */
(function (A) {
  'use strict';
  const { $, esc, clean, CFG, Store, UI } = A;

  UI.ready(() => {
    const vueRecherche = $('#vue-recherche');
    const vueCarte = $('#vue-carte');
    const form = $('#form-recherche');
    const input = $('#recherche-val');
    const msg = $('#msg-recherche');

    const showMessage = (html, type) => { msg.innerHTML = `<div class="notice notice-${type}" role="${type === 'error' ? 'alert' : 'status'}">${html}</div>`; };

    function showCard(it) {
      $('#carte-zone').innerHTML = UI.cardHTML(it);
      msg.innerHTML = '';
      vueRecherche.hidden = true;
      vueCarte.hidden = false;
      document.title = `Carte ${it.numeroCarte} — AERDZ`;
    }

    /** Affiche la carte si elle est payée, sinon explique l'étape en cours. */
    function open(raw, { silent = false } = {}) {
      const q = clean(raw);
      if (!q) { if (!silent) showMessage('Saisissez votre référence, votre numéro de carte ou votre email.', 'error'); return; }
      const it = Store.lookup(q);
      if (!it) { if (!silent) showMessage("Aucune demande trouvée. Vérifiez votre saisie.", 'error'); return; }

      const link = `<a href="suivi.html?ref=${encodeURIComponent(it.reference)}">Ouvrir ma page de suivi</a>`;
      if (it.statut === 'rejete') {
        showMessage(`<strong>Votre demande a été rejetée.</strong><br>Contactez l'administration : ${esc(CFG.contact.phone)}.`, 'error');
      } else if (it.statut === 'en_attente') {
        showMessage(`<strong>Votre demande est en attente de validation.</strong><br>Revenez plus tard : le paiement s'ouvrira dès sa validation. ${link}`, 'info');
      } else if (it.paiement.statut === 'non_paye') {
        showMessage(`<strong>Votre demande est validée : il reste à payer ${esc(A.formatMoney(CFG.price))} par Wave.</strong><br>Votre carte sera disponible après confirmation du paiement. ${link}`, 'warning');
      } else if (it.paiement.statut === 'en_verification') {
        showMessage(`<strong>Votre paiement est en cours de vérification.</strong><br>Votre carte s'affichera dès sa confirmation par l'administration. ${link}`, 'warning');
      } else {
        Store.rememberRef(it.reference);
        showCard(it);
      }
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); open(input.value); });
    $('#btn-print').addEventListener('click', () => window.print());
    $('#btn-retour').addEventListener('click', () => {
      vueCarte.hidden = true;
      vueRecherche.hidden = false;
      input.value = '';
      msg.innerHTML = '';
      document.title = 'Ma carte — AERDZ';
      try { history.replaceState(null, '', 'carte.html'); } catch (e) { /* ignoré */ }
      input.focus();
    });

    // Lien direct : carte.html?ref=… ou ?num=… (ex. depuis la page de suivi ou l'administration)
    const params = new URLSearchParams(location.search);
    const direct = params.get('ref') || params.get('num');
    if (direct) { input.value = direct; open(direct); }
    else if (Store.lastRef()) { input.value = Store.lastRef(); }
  });
})(window.AERDZ);
