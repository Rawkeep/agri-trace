/**
 * hofkette.js — Datenbruecke "Hofkette v1" (kanonisches Modul).
 *
 * QUELLE: agri-aggregator/docs/daten-strategie/kits/hofkette/hofkette.js
 * Kopien in den Apps (agri-flock, feed-mill, agri-trace, ...) werden von hier
 * aus aktualisiert — nicht per Hand divergieren lassen (Kit-Prinzip).
 *
 * Zweck: Ein gemeinsames, versioniertes Beleg-/Ereignisformat (CSV), mit dem
 * die Stationen der Hofplattform (Stall, Muehle, Lager, Laden, Logistik)
 * ihre Warenbewegungen austauschen. Jede App EXPORTIERT ihre Bewegungen als
 * Hofkette-Belege; agri-trace IMPORTIERT sie in die append-only-Kette.
 * Spezifikation: agri-aggregator/docs/DATENBRUECKE.md.
 *
 * Hausstil: IIFE mit Dual-Export, nur Integer-Mengen (qty_x10) und
 * Integer-Betraege (amount_minor), deterministisch, 0 externe Requests.
 */
(function (global) {
  'use strict';

  var SCHEMA = 'hofkette-v1';

  // Ereignistypen entlang der Hofkette (Superset der agri-trace-Typen).
  var EVENT_TYPES = [
    'ERNTE', // Feld -> Ernte-Charge
    'ANKAUF', // Zukauf (Partner-Farm, Kooperative)
    'GRADING', // Sortierung A/B/C
    'EINLAGERUNG', // Lager/Kuehlraum hinein
    'AUSLAGERUNG', // Lager/Kuehlraum heraus
    'VERARBEITUNG_IN', // Verarbeitungs-Input (je Eltern-Charge eine Zeile)
    'VERARBEITUNG_OUT', // Verarbeitungs-Output (Kind-Charge, parent_lot_ids gesetzt)
    'PRODUKTION', // Erzeugung im Stall (Eier-Tagescharge, Schlachtcharge)
    'VERBRAUCH', // Verbrauch einer Charge (Futter an Herde)
    'VERPACKUNG',
    'TRANSPORT',
    'VERKAUF',
    'STORNO' // Korrektur; ref_event_id nennt das aufgehobene Ereignis
  ];

  // Einheiten. Mengen sind IMMER Integer x10 in dieser Einheit.
  var UNITS = ['kg', 'stk', 'tray', 'sack', 'l'];

  var QUALITY_GRADES = ['A', 'B', 'C'];

  // CSV-Spaltenreihenfolge (fix, Teil des Vertrags).
  var COLUMNS = [
    'schema', 'event_id', 'ts', 'station', 'event_type',
    'lot_id', 'parent_lot_ids', 'ref_event_id',
    'product', 'qty_x10', 'unit', 'quality', 'origin',
    'amount_minor', 'currency', 'actor', 'note'
  ];

  function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim().length > 0;
  }

  function requireString(v, name) {
    if (!isNonEmptyString(v)) {
      throw new Error('Pflichtfeld fehlt oder ungueltig: ' + name);
    }
    return v;
  }

  function requireNonNegativeInteger(v, name) {
    if (!Number.isInteger(v) || v < 0) {
      throw new Error('Ungueltiger Wert fuer ' + name + ': muss ein nicht-negativer Integer sein.');
    }
    return v;
  }

  function requireOneOf(v, allowed, name) {
    if (allowed.indexOf(v) === -1) {
      throw new Error('Ungueltiger Wert fuer ' + name + ': ' + String(v) +
        ' (erlaubt: ' + allowed.join(', ') + ')');
    }
    return v;
  }

  /**
   * Erzeugt und validiert einen Hofkette-Beleg. Pflicht: event_id, ts,
   * station, event_type, lot_id, product, qty_x10 (Integer >= 0), unit.
   * VERARBEITUNG_OUT verlangt parent_lot_ids, STORNO ref_event_id.
   */
  function createChainEvent(data) {
    var d = data || {};
    var ev = {
      schema: SCHEMA,
      event_id: requireString(d.event_id, 'event_id'),
      ts: requireString(d.ts, 'ts'),
      station: requireString(d.station, 'station'),
      event_type: requireOneOf(d.event_type, EVENT_TYPES, 'event_type'),
      lot_id: requireString(d.lot_id, 'lot_id'),
      parent_lot_ids: Array.isArray(d.parent_lot_ids)
        ? d.parent_lot_ids.join('|')
        : (isNonEmptyString(d.parent_lot_ids) ? d.parent_lot_ids : ''),
      ref_event_id: isNonEmptyString(d.ref_event_id) ? d.ref_event_id : '',
      product: requireString(d.product, 'product'),
      qty_x10: requireNonNegativeInteger(d.qty_x10, 'qty_x10'),
      unit: requireOneOf(d.unit, UNITS, 'unit'),
      quality: isNonEmptyString(d.quality)
        ? requireOneOf(d.quality, QUALITY_GRADES, 'quality') : '',
      origin: isNonEmptyString(d.origin) ? d.origin : '',
      amount_minor: d.amount_minor === undefined || d.amount_minor === null || d.amount_minor === ''
        ? '' : requireNonNegativeInteger(d.amount_minor, 'amount_minor'),
      currency: isNonEmptyString(d.currency) ? d.currency : '',
      actor: isNonEmptyString(d.actor) ? d.actor : '',
      note: typeof d.note === 'string' ? d.note : ''
    };
    if (!isFinite(Date.parse(ev.ts))) {
      throw new Error('Ungueltiger Zeitstempel (ts): ' + ev.ts);
    }
    if (ev.event_type === 'VERARBEITUNG_OUT' && ev.parent_lot_ids === '') {
      throw new Error('VERARBEITUNG_OUT verlangt parent_lot_ids.');
    }
    if (ev.event_type === 'STORNO' && ev.ref_event_id === '') {
      throw new Error('STORNO verlangt ref_event_id.');
    }
    return ev;
  }

  function parentIds(ev) {
    return ev.parent_lot_ids === '' ? [] : ev.parent_lot_ids.split('|');
  }

  /**
   * Massenbilanz einer Verarbeitung: Σ VERARBEITUNG_IN (via ref_event_id auf
   * das OUT-Ereignis) >= OUT-Menge, gleiche Einheit vorausgesetzt.
   * Liefert { ok, inputX10, outputX10, lossX10 } oder wirft bei
   * Einheiten-Mix / negativer Bilanz.
   */
  function checkMassBalance(events, outEventId) {
    var list = Array.isArray(events) ? events : [];
    var out = list.filter(function (e) {
      return e.event_id === outEventId && e.event_type === 'VERARBEITUNG_OUT';
    })[0];
    if (!out) {
      throw new Error('VERARBEITUNG_OUT nicht gefunden: ' + outEventId);
    }
    var inputs = list.filter(function (e) {
      return e.event_type === 'VERARBEITUNG_IN' && e.ref_event_id === outEventId;
    });
    var inputX10 = 0;
    inputs.forEach(function (e) {
      if (e.unit !== out.unit) {
        throw new Error('Einheiten-Mix in der Massenbilanz: ' + e.unit + ' vs ' + out.unit);
      }
      inputX10 += e.qty_x10;
    });
    var lossX10 = inputX10 - out.qty_x10;
    if (lossX10 < 0) {
      throw new Error('Massenbilanz verletzt: Output (' + out.qty_x10 +
        ') > Input (' + inputX10 + ').');
    }
    return { ok: true, inputX10: inputX10, outputX10: out.qty_x10, lossX10: lossX10 };
  }

  // ---- CSV (kompakter eigener Parser/Writer, Anfuehrungszeichen-faehig) ----

  function escapeField(value) {
    var s = value === undefined || value === null ? '' : String(value);
    if (/[",\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function toCsv(events) {
    var lines = [COLUMNS.join(',')];
    (Array.isArray(events) ? events : []).forEach(function (ev) {
      lines.push(COLUMNS.map(function (c) { return escapeField(ev[c]); }).join(','));
    });
    return lines.join('\n') + '\n';
  }

  function parseCsvRaw(text) {
    var rows = [];
    var field = '';
    var record = [];
    var inQuotes = false;
    var s = String(text || '');

    function endField() { record.push(field); field = ''; }
    function endRecord() {
      endField();
      if (!(record.length === 1 && record[0].trim() === '')) { rows.push(record); }
      record = [];
    }

    for (var i = 0; i < s.length; i += 1) {
      var ch = s[i];
      if (inQuotes) {
        if (ch === '"') {
          if (s[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
        } else { field += ch; }
      } else if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { endField(); }
      else if (ch === '\n') { endRecord(); }
      else if (ch === '\r') { if (s[i + 1] !== '\n') { endRecord(); } }
      else { field += ch; }
    }
    if (field !== '' || record.length > 0) { endRecord(); }
    return rows;
  }

  /**
   * Parst eine Hofkette-CSV zu validierten Belegen. Prueft die schema-Spalte
   * jeder Zeile; Fehler nennen die CSV-Zeile.
   */
  function parseCsv(text) {
    var rows = parseCsvRaw(text);
    if (rows.length === 0) { return []; }
    var header = rows[0].map(function (h) { return h.trim(); });
    return rows.slice(1).map(function (rec, idx) {
      var raw = {};
      header.forEach(function (key, i) {
        raw[key] = rec[i] !== undefined ? rec[i] : '';
      });
      if (raw.schema !== SCHEMA) {
        throw new Error('CSV-Zeile ' + (idx + 2) + ': unbekanntes Schema "' +
          raw.schema + '" (erwartet ' + SCHEMA + ').');
      }
      var data = {
        event_id: raw.event_id,
        ts: raw.ts,
        station: raw.station,
        event_type: raw.event_type,
        lot_id: raw.lot_id,
        parent_lot_ids: raw.parent_lot_ids,
        ref_event_id: raw.ref_event_id,
        product: raw.product,
        qty_x10: raw.qty_x10 === '' ? 0 : parseInt(raw.qty_x10, 10),
        unit: raw.unit,
        quality: raw.quality,
        origin: raw.origin,
        amount_minor: raw.amount_minor === '' ? '' : parseInt(raw.amount_minor, 10),
        currency: raw.currency,
        actor: raw.actor,
        note: raw.note
      };
      if (!Number.isInteger(data.qty_x10)) {
        throw new Error('CSV-Zeile ' + (idx + 2) + ': qty_x10 ist kein Integer.');
      }
      if (data.amount_minor !== '' && !Number.isInteger(data.amount_minor)) {
        throw new Error('CSV-Zeile ' + (idx + 2) + ': amount_minor ist kein Integer.');
      }
      try {
        return createChainEvent(data);
      } catch (err) {
        throw new Error('CSV-Zeile ' + (idx + 2) + ': ' + err.message);
      }
    });
  }

  var Hofkette = {
    SCHEMA: SCHEMA,
    EVENT_TYPES: EVENT_TYPES,
    UNITS: UNITS,
    QUALITY_GRADES: QUALITY_GRADES,
    COLUMNS: COLUMNS,
    createChainEvent: createChainEvent,
    parentIds: parentIds,
    checkMassBalance: checkMassBalance,
    toCsv: toCsv,
    parseCsv: parseCsv
  };

  global.Hofkette = Hofkette;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Hofkette;
  }
})(typeof window !== 'undefined' ? window : globalThis);
