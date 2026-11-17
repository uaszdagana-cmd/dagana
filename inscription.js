/* =====================================================================
   AERDZ — inscription.js
   Formulaire d'inscription : validation en direct, photo, enregistrement.
   (Aucun paiement ici : il s'ouvre après la validation par l'administration.)
   ===================================================================== */
(function (A) {
  'use strict';
  const { $, esc, clean, CFG, V, Store, Workflow, UI } = A;

  UI.ready(() => {
    const form = $('#form-inscription');
    const btn = $('#btn-submit');

    // Listes issues de config.js
    $('#filieres').innerHTML = CFG.filieres.map((f) => `<option value="${esc(f)}"></option>`).join('');
    $('#niveau').insertAdjacentHTML('beforeend', CFG.levels.map((n) => `<option>${esc(n)}</option>`).join(''));

    /* ---------- Champs et règles ---------- */
    const FIELDS = {
      nom: V.name('nom'),
      prenom: V.name('prénom'),
      filiere: V.filiere,
      niveau: V.level,
      telephone: V.phone,
      email: V.email
    };

    function setError(name, message) {
      const input = $('#' + name);
      const out = $('#err-' + name);
      out.textContent = message || '';
      input.classList.toggle('is-invalid', !!message);
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
    }
    const check = (name) => { const msg = FIELDS[name]($('#' + name).value); setError(name, msg); return !msg; };

    Object.keys(FIELDS).forEach((name) => {
      const input = $('#' + name);
      input.addEventListener('blur', () => { if (clean(input.value) || input.classList.contains('is-invalid')) check(name); });
      input.addEventListener('input', () => { if (input.classList.contains('is-invalid')) check(name); });
      input.addEventListener('change', () => { if (name === 'niveau') check(name); });
    });

    /* ---------- Photo ---------- */
    const picker = UI.imagePicker({ root: $('#dz-photo'), maxPx: CFG.limits.photoPx, quality: 0.82 });

    /* ---------- Envoi ---------- */
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const results = Object.keys(FIELDS).map((n) => [n, check(n)]);
      const firstBad = results.find(([, ok]) => !ok);
      if (firstBad) {
        const el = $('#' + firstBad[0]);
        el.focus();
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        UI.toast('Certains champs sont incorrects. Vérifiez votre saisie.', 'error');
        return;
      }

      const data = {
        nom: clean($('#nom').value).toUpperCase(),
        prenom: A.titleCase(clean($('#prenom').value)),
        filiere: clean($('#filiere').value),
        niveau: $('#niveau').value,
        telephone: V.phoneNormalize($('#telephone').value),
        email: clean($('#email').value).toLowerCase(),
        photo: picker.value
      };

      UI.setBusy(btn, true, 'Envoi en cours…');
      const result = Workflow.create(data);
      UI.setBusy(btn, false);

      if (!result.ok) {
        if (result.error === 'EMAIL_EXISTS') {
          setError('email', 'Une demande existe déjà avec cet email.');
          $('#email').focus();
          UI.toast('Cet email a déjà une demande. Utilisez « Suivre ma demande ».', 'warning');
        } else {
          UI.toast(result.error, 'error', 8000);
        }
        return;
      }

      const item = result.item;
      Store.rememberRef(item.reference);
      $('#succes-nom').textContent = `${item.prenom} ${item.nom}`;
      $('#succes-ref').textContent = item.reference;
      $('#lien-suivi').href = `suivi.html?ref=${encodeURIComponent(item.reference)}`;
      $('#vue-formulaire').hidden = true;
      $('#vue-succes').hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      $('#vue-succes h1').setAttribute('tabindex', '-1');
      $('#vue-succes h1').focus({ preventScroll: true });
    });

    $('#btn-copy-ref').addEventListener('click', async () => {
      const ok = await UI.copy($('#succes-ref').textContent);
      UI.toast(ok ? 'Référence copiée.' : 'Copie impossible : notez-la manuellement.', ok ? 'success' : 'warning');
    });
  });
})(window.AERDZ);
