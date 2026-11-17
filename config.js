/* =====================================================================
   AERDZ — config.js
   Toute la configuration du site au même endroit.
   Pour changer le prix, le numéro Wave ou les contacts : modifiez ici seulement.
   ===================================================================== */
window.AERDZ_CONFIG = Object.freeze({
  siteName: 'AERDZ',
  orgName: "Amicale des Étudiants Ressortissants de Dagana à l'UASZ",
  cardPrefix: 'AERDZ',

  // Paiement (manuel : l'étudiant envoie par Wave puis saisit son numéro de transaction)
  price: 1000,
  currency: 'FCFA',
  wave: Object.freeze({ number: '71 037 21 43' }),

  contact: Object.freeze({
    phone: '77 065 43 94',
    email: 'diallotousmane404@gmail.com'
  }),

  levels: Object.freeze(['Licence 1', 'Licence 2', 'Licence 3', 'Master 1', 'Master 2', 'Doctorat']),
  filieres: Object.freeze([
    'Informatique', 'Mathématiques - Informatique', 'Gestion', 'Comptabilité', 'Droit',
    'Médecine', 'Pharmacie', 'Agronomie', 'Lettres Modernes', 'Sciences Économiques',
    'Physique-Chimie', 'Anglais'
  ]),

  limits: Object.freeze({
    imageMaxMo: 5,      // taille maximale d'une image choisie
    photoPx: 420,       // la photo est réduite à 420 px (économise le stockage)
    receiptPx: 700      // la capture de reçu est réduite à 700 px
  }),

  sessionMinutes: 30,                 // déconnexion admin après 30 min d'inactivité
  storagePrefix: 'aerdz:v2:'          // préfixe des clés du navigateur
});
