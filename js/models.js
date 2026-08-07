/**
 * models.js
 *
 * Datenmodell fuer agri-trace: reine JS-Objekte/Factory-Funktionen mit
 * Validierung. Entitaeten der Chargen-Rueckverfolgbarkeit:
 *   Product (Produkt/HS-Code), Lot (Charge mit Herkunft),
 *   Event (Ereignis an einer Charge -- APPEND-ONLY),
 *   LotLink (Eltern->Kind Verknuepfung mit kg-Anteil bei Split/Merge).
 *
 * Wichtige Regel: Ereignisse sind unveraenderlich. Es gibt bewusst KEINE
 * Update-/Delete-Semantik im Datenmodell; eine Korrektur wird ueber ein
 * separates Storno-Ereignis abgebildet (siehe js/trace.js).
 *
 * Gewichte (menge_kg / anteil_kg) werden als positive Zahlen gefuehrt.
 */
(function (global) {
  'use strict';

  // Erlaubte Ereignistypen entlang der Lieferkette (Brief 04, Tabelle events).
  var EVENT_TYPES = [
    'ankauf', // Ankauf beim Farmer/Kooperative
    'grading', // Sortierung/Grading A/B/C
    'einlagerung', // Einlagerung inkl. Temperatur
    'verarbeitung', // Verarbeitung mit Input/Output-Verknuepfung (Split/Merge)
    'verpackung', // Verpackung mit Losnummer
    'transport', // Transport
    'verkauf', // Verkauf/Export
    'storno', // Storno-Ereignis (Korrektur, hebt fachlich ein Vorereignis auf)
    // Zusatztypen der Datenbruecke (Hofkette v1, siehe js/bridge.js):
    'ernte', // Ernte-Charge vom Feld
    'produktion', // Erzeugung im Stall (z.B. Eier-Tagescharge aus agri-flock)
    'verbrauch', // Verbrauch einer Charge (z.B. Futter an eine Herde)
    'auslagerung' // Auslagerung aus Lager/Kuehlraum
  ];

  // Qualitaetsstufen fuer Grading.
  var QUALITY_GRADES = ['A', 'B', 'C'];

  // Lebenszyklus-Status einer Charge.
  var LOT_STATUSES = ['aktiv', 'verarbeitet', 'verkauft', 'gesperrt'];

  var idCounter = 0;

  /**
   * Erzeugt eine eindeutige ID pro Prozess (Praefix + Zeitstempel + Zaehler).
   */
  function generateId(prefix) {
    idCounter += 1;
    var ts = Date.now().toString(36);
    return (prefix || 'id') + '_' + ts + '_' + idCounter.toString(36);
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function requireString(value, fieldName) {
    if (!isNonEmptyString(value)) {
      throw new Error('Pflichtfeld fehlt oder ungueltig: ' + fieldName);
    }
    return value;
  }

  function isPositiveNumber(value) {
    return typeof value === 'number' && isFinite(value) && value > 0;
  }

  function requireWeightKg(value, fieldName) {
    if (!isPositiveNumber(value)) {
      throw new Error('Ungueltiges Gewicht (kg) fuer ' + (fieldName || 'menge_kg') + ': muss eine positive Zahl sein.');
    }
    return value;
  }

  function isValidEventType(value) {
    return EVENT_TYPES.indexOf(value) !== -1;
  }

  function isValidQualityGrade(value) {
    return QUALITY_GRADES.indexOf(value) !== -1;
  }

  // ---------------------------------------------------------------------
  // Product: Produkt/Erntegut mit zweisprachigem Namen + HS-Code (fuer den
  // spaeteren Export-Anschluss RAQ/sap-agent).
  // ---------------------------------------------------------------------
  function createProduct(data) {
    data = data || {};
    var product = {
      id: isNonEmptyString(data.id) ? data.id : generateId('prod'),
      nameEn: requireString(data.nameEn, 'nameEn'),
      nameFr: requireString(data.nameFr, 'nameFr'),
      hsCode: typeof data.hsCode === 'string' ? data.hsCode : ''
    };
    return product;
  }

  // ---------------------------------------------------------------------
  // Lot: Charge mit Herkunft. Kind-Chargen aus Verarbeitung haben
  // originType 'verarbeitung'; primaer angekaufte Chargen 'ankauf'.
  // ---------------------------------------------------------------------
  function createLot(data) {
    data = data || {};
    var lot = {
      id: isNonEmptyString(data.id) ? data.id : generateId('lot'),
      productId: requireString(data.productId, 'productId'),
      weightKg: requireWeightKg(data.weightKg, 'menge_kg'),
      farmerId: typeof data.farmerId === 'string' ? data.farmerId : '',
      village: typeof data.village === 'string' ? data.village : '',
      h3Cell: typeof data.h3Cell === 'string' ? data.h3Cell : '',
      harvestDate: typeof data.harvestDate === 'string' ? data.harvestDate : '',
      status: LOT_STATUSES.indexOf(data.status) !== -1 ? data.status : 'aktiv',
      // 'ankauf' = Primaer-Charge, 'verarbeitung' = Kind-Charge aus Split/Merge.
      originType: data.originType === 'verarbeitung' ? 'verarbeitung' : 'ankauf',
      createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString()
    };
    return lot;
  }

  // ---------------------------------------------------------------------
  // Event: Ereignis an einer Charge. APPEND-ONLY. seq gibt die stabile
  // Erfassungsreihenfolge bei identischem Zeitstempel vor.
  // Bei typ 'storno' referenziert payload.stornoOf das aufgehobene Ereignis.
  // ---------------------------------------------------------------------
  function createEvent(data) {
    data = data || {};
    if (!isValidEventType(data.type)) {
      throw new Error('Ungueltiger Ereignistyp: ' + data.type + ' (erlaubt: ' + EVENT_TYPES.join(', ') + ').');
    }
    var event = {
      id: isNonEmptyString(data.id) ? data.id : generateId('evt'),
      lotId: requireString(data.lotId, 'lotId'),
      ts: typeof data.ts === 'string' ? data.ts : new Date().toISOString(),
      seq: typeof data.seq === 'number' && isFinite(data.seq) ? data.seq : 0,
      type: data.type,
      payload: data.payload && typeof data.payload === 'object' ? data.payload : {},
      recordedBy: typeof data.recordedBy === 'string' ? data.recordedBy : ''
    };
    if (data.type === 'grading' && event.payload.grade && !isValidQualityGrade(event.payload.grade)) {
      throw new Error('Ungueltige Qualitaetsstufe im Grading-Ereignis: erlaubt sind A, B, C.');
    }
    return event;
  }

  // ---------------------------------------------------------------------
  // LotLink: gerichtete Kante Eltern-Charge -> Kind-Charge mit kg-Anteil.
  // Mehrere Eltern pro Kind (Merge) und mehrere Kinder pro Eltern (Split)
  // sind erlaubt.
  // ---------------------------------------------------------------------
  function createLotLink(data) {
    data = data || {};
    var link = {
      id: isNonEmptyString(data.id) ? data.id : generateId('link'),
      parentLotId: requireString(data.parentLotId, 'parentLotId'),
      childLotId: requireString(data.childLotId, 'childLotId'),
      shareKg: requireWeightKg(data.shareKg, 'anteil_kg')
    };
    if (link.parentLotId === link.childLotId) {
      throw new Error('Eltern- und Kind-Charge duerfen nicht identisch sein.');
    }
    return link;
  }

  var TraceModels = {
    EVENT_TYPES: EVENT_TYPES,
    QUALITY_GRADES: QUALITY_GRADES,
    LOT_STATUSES: LOT_STATUSES,
    generateId: generateId,
    isValidEventType: isValidEventType,
    isValidQualityGrade: isValidQualityGrade,
    createProduct: createProduct,
    createLot: createLot,
    createEvent: createEvent,
    createLotLink: createLotLink
  };

  // Im Browser als window.TraceModels, in Node/Tests ueber globalThis.
  global.TraceModels = TraceModels;

  // Zusaetzlicher CommonJS-Export fuer Node-basierte Tests.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TraceModels;
  }
})(typeof window !== 'undefined' ? window : globalThis);
