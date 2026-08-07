/**
 * bridge.js — agri-trace als Hofkette-EMPFAENGER (Datenbruecke, hofkette-v1).
 *
 * Importiert Belege anderer Stationen (agri-flock, feed-mill, ...) in die
 * append-only-Kette: legt fehlende Produkte/Chargen/Links an und haengt
 * Ereignisse an. Rein funktional und Node-getestet (planImport); die
 * Persistenz (applyPlan) ist ein duenner Wrapper um TraceStorage.
 *
 * Regeln:
 *   - IDEMPOTENT: die event_id des Belegs wird zur Ereignis-id; bereits
 *     bekannte ids werden uebersprungen (append-only bleibt unverletzt).
 *   - Verarbeitung: VERARBEITUNG_OUT erzeugt die Kind-Charge + LotLinks;
 *     die Anteile (shareKg) kommen aus den VERARBEITUNG_IN-Zeilen
 *     (ref_event_id -> OUT). Massenbilanz wird geprueft (Σ In >= Out).
 *   - KEINE Einheiten-Umrechnung: die Chargenmenge wird in der Einheit des
 *     Belegs gefuehrt (weightKg traegt den Zahlenwert, payload.unit die
 *     Einheit) — dokumentierte Konvention der Datenbruecke.
 */
(function (global) {
  'use strict';

  function models() {
    return global.TraceModels || require('./models.js');
  }

  function hofkette() {
    return global.Hofkette || require('./hofkette.js');
  }

  // Hofkette-Typ -> agri-trace-Ereignistyp.
  var TYPE_MAP = {
    ERNTE: 'ernte',
    ANKAUF: 'ankauf',
    GRADING: 'grading',
    EINLAGERUNG: 'einlagerung',
    AUSLAGERUNG: 'auslagerung',
    VERARBEITUNG_IN: 'verarbeitung',
    VERARBEITUNG_OUT: 'verarbeitung',
    PRODUKTION: 'produktion',
    VERBRAUCH: 'verbrauch',
    VERPACKUNG: 'verpackung',
    TRANSPORT: 'transport',
    VERKAUF: 'verkauf',
    STORNO: 'storno'
  };

  function productIdFor(productKey) {
    return 'prod-hk-' + productKey;
  }

  function originToFarmerId(origin) {
    if (typeof origin === 'string' && origin.indexOf('partner:') === 0) {
      return origin.slice('partner:'.length);
    }
    return '';
  }

  function maxSeq(events) {
    var max = 0;
    (events || []).forEach(function (e) {
      if (typeof e.seq === 'number' && e.seq > max) { max = e.seq; }
    });
    return max;
  }

  /**
   * Plant den Import (rein, ohne Persistenz).
   *
   * chainEvents: validierte Hofkette-Belege (Hofkette.parseCsv).
   * existing: { products, lots, links, events } — aktueller App-Zustand.
   *
   * Liefert { products, lots, links, events, skippedEventIds } mit NUR den
   * NEU anzulegenden Datensaetzen. Wirft bei struktureller Verletzung
   * (Massenbilanz, unbekannte Eltern, Menge 0 fuer neue Charge).
   */
  function planImport(chainEvents, existing) {
    var M = models();
    var H = hofkette();
    var ex = existing || {};
    var list = (Array.isArray(chainEvents) ? chainEvents : []).slice();

    // Stabile, deterministische Reihenfolge: ts, dann event_id.
    list.sort(function (a, b) {
      if (a.ts !== b.ts) { return a.ts < b.ts ? -1 : 1; }
      return a.event_id < b.event_id ? -1 : (a.event_id > b.event_id ? 1 : 0);
    });

    var knownEventIds = {};
    (ex.events || []).forEach(function (e) { knownEventIds[e.id] = true; });
    var knownProducts = {};
    (ex.products || []).forEach(function (p) { knownProducts[p.id] = true; });
    var knownLots = {};
    (ex.lots || []).forEach(function (l) { knownLots[l.id] = true; });

    var plan = { products: [], lots: [], links: [], events: [], skippedEventIds: [] };
    var seq = maxSeq(ex.events);

    function ensureProduct(ev) {
      var pid = productIdFor(ev.product);
      if (!knownProducts[pid]) {
        plan.products.push(M.createProduct({
          id: pid, nameEn: ev.product, nameFr: ev.product
        }));
        knownProducts[pid] = true;
      }
      return pid;
    }

    function ensureLot(ev, originType) {
      if (knownLots[ev.lot_id]) { return; }
      if (ev.qty_x10 <= 0) {
        throw new Error('Beleg ' + ev.event_id + ': neue Charge ' + ev.lot_id +
          ' braucht eine Menge > 0.');
      }
      plan.lots.push(M.createLot({
        id: ev.lot_id,
        productId: ensureProduct(ev),
        weightKg: ev.qty_x10 / 10,
        farmerId: originToFarmerId(ev.origin),
        harvestDate: ev.ts.slice(0, 10),
        originType: originType || 'ankauf',
        createdAt: ev.ts
      }));
      knownLots[ev.lot_id] = true;
    }

    list.forEach(function (ev) {
      if (knownEventIds[ev.event_id]) {
        plan.skippedEventIds.push(ev.event_id);
        return;
      }
      knownEventIds[ev.event_id] = true;

      if (ev.event_type === 'VERARBEITUNG_OUT') {
        // Massenbilanz gegen die zugehoerigen IN-Zeilen der Datei.
        var balance = H.checkMassBalance(list, ev.event_id);
        var inputs = list.filter(function (e) {
          return e.event_type === 'VERARBEITUNG_IN' && e.ref_event_id === ev.event_id;
        });
        var parents = H.parentIds(ev);
        parents.forEach(function (parentLotId) {
          var inRow = inputs.filter(function (e) { return e.lot_id === parentLotId; })[0];
          if (!inRow) {
            throw new Error('Beleg ' + ev.event_id + ': keine VERARBEITUNG_IN-Zeile fuer Eltern-Charge ' +
              parentLotId + '.');
          }
          if (!knownLots[parentLotId]) {
            // Eltern-Charge aus der IN-Zeile anlegen (z.B. Rohstoff-Lot der Muehle).
            ensureLot(inRow, 'ankauf');
          }
          plan.links.push(M.createLotLink({
            id: 'link-' + ev.event_id + '-' + parentLotId,
            parentLotId: parentLotId,
            childLotId: ev.lot_id,
            shareKg: inRow.qty_x10 / 10
          }));
        });
        ensureLot(ev, 'verarbeitung');
        void balance; // Bilanz gilt als geprueft (checkMassBalance wirft sonst).
      } else {
        ensureLot(ev, 'ankauf');
      }

      seq += 1;
      var payload = {
        schema: ev.schema,
        station: ev.station,
        hofketteType: ev.event_type,
        qtyX10: ev.qty_x10,
        unit: ev.unit,
        note: ev.note
      };
      if (ev.quality !== '') { payload.grade = ev.quality; }
      if (ev.origin !== '') { payload.origin = ev.origin; }
      if (ev.amount_minor !== '') {
        payload.amountMinor = ev.amount_minor;
        payload.currency = ev.currency;
      }
      if (ev.event_type === 'STORNO') { payload.stornoOf = ev.ref_event_id; }
      if (ev.event_type === 'VERARBEITUNG_IN') { payload.role = 'input'; }
      if (ev.event_type === 'VERARBEITUNG_OUT') { payload.role = 'output'; }

      plan.events.push(M.createEvent({
        id: ev.event_id,
        lotId: ev.lot_id,
        ts: ev.ts,
        seq: seq,
        type: TYPE_MAP[ev.event_type],
        payload: payload,
        recordedBy: ev.actor || ev.station
      }));
    });

    return plan;
  }

  /**
   * Persistiert einen Import-Plan ueber TraceStorage (nur Browser/Storage).
   * Liefert Promise auf { imported, skipped }.
   */
  function applyPlan(plan, storage) {
    var S = storage || global.TraceStorage;
    var chain = Promise.resolve();
    plan.products.forEach(function (p) {
      chain = chain.then(function () { return S.saveProduct(p); });
    });
    plan.lots.forEach(function (l) {
      chain = chain.then(function () { return S.saveLot(l); });
    });
    plan.links.forEach(function (l) {
      chain = chain.then(function () { return S.saveLotLink(l); });
    });
    plan.events.forEach(function (e) {
      chain = chain.then(function () { return S.appendEvent(e); });
    });
    return chain.then(function () {
      return { imported: plan.events.length, skipped: plan.skippedEventIds.length };
    });
  }

  var TraceBridge = {
    TYPE_MAP: TYPE_MAP,
    productIdFor: productIdFor,
    originToFarmerId: originToFarmerId,
    planImport: planImport,
    applyPlan: applyPlan
  };

  global.TraceBridge = TraceBridge;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TraceBridge;
  }
})(typeof window !== 'undefined' ? window : globalThis);
