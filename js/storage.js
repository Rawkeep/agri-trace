/**
 * storage.js
 *
 * Persistenz-Wrapper fuer agri-trace. IndexedDB als primaerer Speicher;
 * steht IndexedDB nicht zur Verfuegung, wird transparent auf localStorage
 * zurueckgefallen. Ausschliesslich Browser-eigene Storage-APIs -- keine
 * Netzwerk-Requests (kein fetch, kein XHR).
 *
 * Alle Funktionen liefern Promises. Fuer den Ereignis-Store gibt es
 * bewusst KEINE Update-/Delete-Operation: Ereignisse sind append-only
 * (appendEvent legt ausschliesslich neue Datensaetze an; Korrekturen
 * erfolgen ueber Storno-Ereignisse, siehe js/trace.js).
 *
 * Die generische Speicher-Engine (IndexedDB/localStorage-Backend) lebt in
 * js/shared/offline-kit.js -- identisch in allen sechs Rawkeep-Offline-Apps.
 * Diese Datei haelt nur die agri-trace-spezifischen Werte (DB-Name/Stores)
 * und die bewusst eingeschraenkte, nicht-generische oeffentliche API.
 */
(function (global) {
  'use strict';

  // OfflineKit lokal aufloesen: im Browser via global, in Node via require.
  var OfflineKit =
    global.OfflineKit ||
    (typeof module !== 'undefined' && module.exports && typeof require === 'function'
      ? require('./shared/offline-kit.js')
      : undefined);

  var STORES = {
    products: 'products',
    lots: 'lots',
    events: 'events',
    lotLinks: 'lotLinks'
  };

  var kit = OfflineKit.createOfflineStorage({
    dbName: 'agri_trace_db',
    dbVersion: 1,
    stores: STORES,
    localStoragePrefix: 'agri_trace_store_'
  });

  // -----------------------------------------------------------------------
  // Oeffentliche, entitaetsspezifische API.
  // Produkte, Chargen und Verknuepfungen sind mutierbar (Status-Update der
  // Charge z.B. auf 'verkauft'); der Ereignis-Store ist strikt append-only.
  // -----------------------------------------------------------------------
  function saveProduct(product) {
    return kit.saveRecord(STORES.products, product);
  }
  function listProducts() {
    return kit.listRecords(STORES.products);
  }
  function getProduct(id) {
    return kit.getRecord(STORES.products, id);
  }

  function saveLot(lot) {
    return kit.saveRecord(STORES.lots, lot);
  }
  function listLots() {
    return kit.listRecords(STORES.lots);
  }
  function getLot(id) {
    return kit.getRecord(STORES.lots, id);
  }

  function saveLotLink(link) {
    return kit.saveRecord(STORES.lotLinks, link);
  }
  function listLotLinks() {
    return kit.listRecords(STORES.lotLinks);
  }

  /**
   * Legt ein Ereignis an. Existiert bereits ein Ereignis mit derselben id,
   * wird das Anlegen abgelehnt -- Ereignisse werden nie ueberschrieben.
   */
  function appendEvent(event) {
    if (!event || typeof event.id === 'undefined' || event.id === null) {
      return Promise.reject(new Error('Ereignis benoetigt ein id-Feld.'));
    }
    return kit.getRecord(STORES.events, event.id).then(function (existing) {
      if (existing) {
        return Promise.reject(new Error('Ereignisse sind append-only: id existiert bereits (' + event.id + ').'));
      }
      return kit.saveRecord(STORES.events, event);
    });
  }
  function listEvents() {
    return kit.listRecords(STORES.events);
  }
  function getEvent(id) {
    return kit.getRecord(STORES.events, id);
  }

  var TraceStorage = {
    STORES: STORES,
    saveProduct: saveProduct,
    listProducts: listProducts,
    getProduct: getProduct,
    saveLot: saveLot,
    listLots: listLots,
    getLot: getLot,
    saveLotLink: saveLotLink,
    listLotLinks: listLotLinks,
    appendEvent: appendEvent,
    listEvents: listEvents,
    getEvent: getEvent
  };

  global.TraceStorage = TraceStorage;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TraceStorage;
  }
})(typeof window !== 'undefined' ? window : globalThis);
