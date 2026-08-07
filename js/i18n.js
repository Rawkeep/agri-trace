/**
 * i18n.js
 *
 * Minimale i18n-Basis fuer agri-trace: Woerterbuch mit Englisch (en) und
 * Franzoesisch (fr) fuer alle UI-Kernbegriffe, plus t(key, lang) und
 * setLanguage/getLanguage mit Persistenz in localStorage. Keine externen
 * Requests, keine externen i18n-Bibliotheken. Standardsprache: Englisch.
 */
(function (global) {
  'use strict';

  var LANGUAGE_STORAGE_KEY = 'agri_trace_lang';
  var SUPPORTED_LANGUAGES = ['en', 'fr'];
  var DEFAULT_LANGUAGE = 'en';

  // Jeder Begriff besitzt sowohl einen en- als auch einen fr-Eintrag.
  var TRANSLATIONS = {
    appTitle: { en: 'agri-trace — Lot Traceability', fr: 'agri-trace — Tracabilite des lots' },

    // Navigation
    navLots: { en: 'Lots', fr: 'Lots' },
    navProcessing: { en: 'Processing', fr: 'Transformation' },
    navPassport: { en: 'Lot Passport', fr: 'Passeport de lot' },
    navRecall: { en: 'Recall', fr: 'Rappel' },
    navExport: { en: 'Export', fr: 'Export' },
    navProducts: { en: 'Products', fr: 'Produits' },

    // Allgemeine Felder
    lot: { en: 'Lot', fr: 'Lot' },
    lotId: { en: 'Lot ID', fr: 'ID du lot' },
    product: { en: 'Product', fr: 'Produit' },
    weight: { en: 'Weight (kg)', fr: 'Poids (kg)' },
    farmer: { en: 'Farmer / Cooperative', fr: 'Agriculteur / Cooperative' },
    village: { en: 'Village', fr: 'Village' },
    h3Cell: { en: 'H3 Cell', fr: 'Cellule H3' },
    harvestDate: { en: 'Harvest Date', fr: 'Date de recolte' },
    status: { en: 'Status', fr: 'Statut' },
    date: { en: 'Date', fr: 'Date' },
    reason: { en: 'Reason', fr: 'Motif' },
    recordedBy: { en: 'Recorded by', fr: 'Saisi par' },
    hsCode: { en: 'HS Code', fr: 'Code SH' },
    grade: { en: 'Grade (A/B/C)', fr: 'Grade (A/B/C)' },
    temperature: { en: 'Temperature (C)', fr: 'Temperature (C)' },
    lotNumber: { en: 'Lot Number', fr: 'Numero de lot' },

    // Ereignisse
    events: { en: 'Events', fr: 'Evenements' },
    eventType: { en: 'Event Type', fr: "Type d'evenement" },
    addEvent: { en: 'Add Event', fr: 'Ajouter un evenement' },
    typ_ankauf: { en: 'Purchase', fr: 'Achat' },
    typ_grading: { en: 'Grading', fr: 'Calibrage' },
    typ_einlagerung: { en: 'Storage', fr: 'Stockage' },
    typ_verarbeitung: { en: 'Processing', fr: 'Transformation' },
    typ_verpackung: { en: 'Packaging', fr: 'Emballage' },
    typ_transport: { en: 'Transport', fr: 'Transport' },
    typ_verkauf: { en: 'Sale / Export', fr: 'Vente / Export' },
    typ_storno: { en: 'Reversal', fr: 'Annulation' },

    // Aktionen
    createLot: { en: 'Create Lot', fr: 'Creer le lot' },
    reverse: { en: 'Reverse (append reversal)', fr: 'Annuler (ajouter annulation)' },
    reversalHint: {
      en: 'Events are immutable — corrections are made by appending a reversal event.',
      fr: 'Les evenements sont immuables — les corrections se font par annulation.'
    },

    // Verarbeitung / Massenbilanz
    processingTitle: { en: 'Processing (Split / Merge)', fr: 'Transformation (Division / Fusion)' },
    parentLots: { en: 'Parent Lots (input kg)', fr: 'Lots parents (kg entree)' },
    childLots: { en: 'Child Lots (output kg)', fr: 'Lots enfants (kg sortie)' },
    inputSum: { en: 'Total input', fr: 'Total entree' },
    outputSum: { en: 'Total output', fr: 'Total sortie' },
    yieldLoss: { en: 'Yield loss', fr: 'Perte de rendement' },
    runProcessing: { en: 'Run Processing', fr: 'Lancer la transformation' },
    addParent: { en: 'Add parent', fr: 'Ajouter un parent' },
    addChild: { en: 'Add child', fr: 'Ajouter un enfant' },
    massBalanceError: {
      en: 'Mass balance violated: output must not exceed input.',
      fr: "Bilan de masse viole : la sortie ne doit pas depasser l'entree."
    },

    // Chargen-Pass
    passportTitle: { en: 'Lot Passport', fr: 'Passeport de lot' },
    origin: { en: 'Origin', fr: 'Origine' },
    eventChain: { en: 'Event Chain (chronological)', fr: 'Chaine d\'evenements (chronologique)' },
    print: { en: 'Print', fr: 'Imprimer' },
    showPassport: { en: 'Show Passport', fr: 'Afficher le passeport' },

    // Rueckruf
    recallTitle: { en: 'Recall Simulation', fr: 'Simulation de rappel' },
    runRecall: { en: 'Run Recall', fr: 'Lancer le rappel' },
    ancestors: { en: 'Ancestors', fr: 'Ascendants' },
    descendants: { en: 'Descendants', fr: 'Descendants' },
    siblings: { en: 'Siblings', fr: 'Freres et soeurs' },
    affectedKg: { en: 'Affected kg', fr: 'kg concernes' },

    // Suche
    search: { en: 'Search', fr: 'Rechercher' },
    dateFrom: { en: 'From', fr: 'Du' },
    dateTo: { en: 'To', fr: 'Au' },

    // Export
    exportTitle: { en: 'Export Event Chain', fr: 'Exporter la chaine d\'evenements' },
    exportJson: { en: 'Export JSON', fr: 'Exporter JSON' },
    exportCsv: { en: 'Export CSV', fr: 'Exporter CSV' },
    hofketteImportTitle: {
      en: 'Import Hofkette (data bridge)',
      fr: 'Importer Hofkette (pont de donnees)'
    },
    hofketteImportHint: {
      en: 'Import hofkette-v1 records from agri-flock, feed-mill etc. Duplicates are skipped (idempotent).',
      fr: 'Importe des justificatifs hofkette-v1 de agri-flock, feed-mill etc. Les doublons sont ignores (idempotent).'
    },
    hofketteImportBtn: { en: 'Import Hofkette', fr: 'Importer Hofkette' },
    hofketteImported: { en: 'imported', fr: 'importes' },
    hofketteSkipped: { en: 'skipped (already known)', fr: 'ignores (deja connus)' },
    hofketteNoFile: { en: 'Please choose a CSV file first.', fr: 'Choisir un fichier CSV.' },
    allLots: { en: 'All lots', fr: 'Tous les lots' },

    // Produkte
    productsTitle: { en: 'Products', fr: 'Produits' },
    nameEn: { en: 'Name (EN)', fr: 'Nom (EN)' },
    nameFr: { en: 'Name (FR)', fr: 'Nom (FR)' },
    save: { en: 'Save', fr: 'Enregistrer' },

    // Meldungen
    saved: { en: 'Saved.', fr: 'Enregistre.' },
    noResults: { en: 'No results.', fr: 'Aucun resultat.' },
    selectLot: { en: 'Select a lot', fr: 'Selectionner un lot' }
  };

  function isSupportedLanguage(lang) {
    return SUPPORTED_LANGUAGES.indexOf(lang) !== -1;
  }

  function hasLocalStorage() {
    return typeof global.localStorage !== 'undefined' && global.localStorage !== null;
  }

  /**
   * Uebersetzt einen Schluessel. Ohne lang wird die aktive Sprache genutzt;
   * fehlt der Schluessel, wird er selbst zurueckgegeben.
   */
  function t(key, lang) {
    var targetLang = isSupportedLanguage(lang) ? lang : getLanguage();
    var entry = TRANSLATIONS[key];
    if (!entry) {
      return key;
    }
    return entry[targetLang] || entry[DEFAULT_LANGUAGE] || key;
  }

  function setLanguage(lang) {
    if (!isSupportedLanguage(lang)) {
      throw new Error('Nicht unterstuetzte Sprache: ' + lang + ' (erlaubt: en, fr).');
    }
    if (hasLocalStorage()) {
      global.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    }
    return lang;
  }

  function getLanguage() {
    if (hasLocalStorage()) {
      var stored = global.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (isSupportedLanguage(stored)) {
        return stored;
      }
    }
    return DEFAULT_LANGUAGE;
  }

  var TraceI18n = {
    SUPPORTED_LANGUAGES: SUPPORTED_LANGUAGES,
    DEFAULT_LANGUAGE: DEFAULT_LANGUAGE,
    TRANSLATIONS: TRANSLATIONS,
    t: t,
    setLanguage: setLanguage,
    getLanguage: getLanguage
  };

  global.TraceI18n = TraceI18n;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TraceI18n;
  }
})(typeof window !== 'undefined' ? window : globalThis);
