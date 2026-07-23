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
 */
(function (global) {
  'use strict';

  var DB_NAME = 'agri_trace_db';
  var DB_VERSION = 1;

  var STORES = {
    products: 'products',
    lots: 'lots',
    events: 'events',
    lotLinks: 'lotLinks'
  };

  var LOCAL_STORAGE_PREFIX = 'agri_trace_store_';

  var dbPromise = null;

  function hasIndexedDb() {
    return typeof global.indexedDB !== 'undefined' && global.indexedDB !== null;
  }

  function hasLocalStorage() {
    return typeof global.localStorage !== 'undefined' && global.localStorage !== null;
  }

  function openDatabase() {
    if (dbPromise) {
      return dbPromise;
    }
    dbPromise = new Promise(function (resolve, reject) {
      var request = global.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function (event) {
        var db = event.target.result;
        Object.keys(STORES).forEach(function (key) {
          var storeName = STORES[key];
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: 'id' });
          }
        });
      };
      request.onsuccess = function (event) {
        resolve(event.target.result);
      };
      request.onerror = function (event) {
        reject(event.target.error || new Error('IndexedDB konnte nicht geoeffnet werden.'));
      };
    });
    return dbPromise;
  }

  // -----------------------------------------------------------------------
  // localStorage-Fallback: jede Entitaet als JSON-Array unter eigenem Key.
  // -----------------------------------------------------------------------
  function localStorageKey(storeName) {
    return LOCAL_STORAGE_PREFIX + storeName;
  }

  function localStorageReadAll(storeName) {
    var raw = global.localStorage.getItem(localStorageKey(storeName));
    if (!raw) {
      return [];
    }
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function localStorageWriteAll(storeName, items) {
    global.localStorage.setItem(localStorageKey(storeName), JSON.stringify(items));
  }

  function localStorageSave(storeName, record) {
    return new Promise(function (resolve, reject) {
      try {
        var items = localStorageReadAll(storeName);
        var index = items.findIndex(function (item) {
          return item.id === record.id;
        });
        if (index === -1) {
          items.push(record);
        } else {
          items[index] = record;
        }
        localStorageWriteAll(storeName, items);
        resolve(record);
      } catch (err) {
        reject(err);
      }
    });
  }

  function localStorageList(storeName) {
    return new Promise(function (resolve, reject) {
      try {
        resolve(localStorageReadAll(storeName));
      } catch (err) {
        reject(err);
      }
    });
  }

  function localStorageGet(storeName, id) {
    return new Promise(function (resolve, reject) {
      try {
        var items = localStorageReadAll(storeName);
        var found = items.find(function (item) {
          return item.id === id;
        });
        resolve(found || null);
      } catch (err) {
        reject(err);
      }
    });
  }

  function localStorageRemove(storeName, id) {
    return new Promise(function (resolve, reject) {
      try {
        var items = localStorageReadAll(storeName);
        var filtered = items.filter(function (item) {
          return item.id !== id;
        });
        localStorageWriteAll(storeName, filtered);
        resolve(true);
      } catch (err) {
        reject(err);
      }
    });
  }

  // -----------------------------------------------------------------------
  // IndexedDB-Backend.
  // -----------------------------------------------------------------------
  function indexedDbSave(storeName, record) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        var request = store.put(record);
        request.onsuccess = function () {
          resolve(record);
        };
        request.onerror = function (event) {
          reject(event.target.error || new Error('Speichern fehlgeschlagen: ' + storeName));
        };
      });
    });
  }

  function indexedDbList(storeName) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        var request = store.getAll();
        request.onsuccess = function (event) {
          resolve(event.target.result || []);
        };
        request.onerror = function (event) {
          reject(event.target.error || new Error('Lesen fehlgeschlagen: ' + storeName));
        };
      });
    });
  }

  function indexedDbGet(storeName, id) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        var request = store.get(id);
        request.onsuccess = function (event) {
          resolve(event.target.result || null);
        };
        request.onerror = function (event) {
          reject(event.target.error || new Error('Lesen fehlgeschlagen: ' + storeName));
        };
      });
    });
  }

  function indexedDbRemove(storeName, id) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        var request = store.delete(id);
        request.onsuccess = function () {
          resolve(true);
        };
        request.onerror = function (event) {
          reject(event.target.error || new Error('Loeschen fehlgeschlagen: ' + storeName));
        };
      });
    });
  }

  // -----------------------------------------------------------------------
  // Backend-Auswahl: IndexedDB bevorzugt, sonst localStorage-Fallback.
  // -----------------------------------------------------------------------
  function saveRecord(storeName, record) {
    if (!record || typeof record.id === 'undefined' || record.id === null) {
      return Promise.reject(new Error('Datensatz benoetigt ein id-Feld: ' + storeName));
    }
    if (hasIndexedDb()) {
      return indexedDbSave(storeName, record);
    }
    if (hasLocalStorage()) {
      return localStorageSave(storeName, record);
    }
    return Promise.reject(new Error('Kein Storage-Backend verfuegbar (weder IndexedDB noch localStorage).'));
  }

  function listRecords(storeName) {
    if (hasIndexedDb()) {
      return indexedDbList(storeName);
    }
    if (hasLocalStorage()) {
      return localStorageList(storeName);
    }
    return Promise.reject(new Error('Kein Storage-Backend verfuegbar (weder IndexedDB noch localStorage).'));
  }

  function getRecord(storeName, id) {
    if (hasIndexedDb()) {
      return indexedDbGet(storeName, id);
    }
    if (hasLocalStorage()) {
      return localStorageGet(storeName, id);
    }
    return Promise.reject(new Error('Kein Storage-Backend verfuegbar (weder IndexedDB noch localStorage).'));
  }

  function removeRecord(storeName, id) {
    if (hasIndexedDb()) {
      return indexedDbRemove(storeName, id);
    }
    if (hasLocalStorage()) {
      return localStorageRemove(storeName, id);
    }
    return Promise.reject(new Error('Kein Storage-Backend verfuegbar (weder IndexedDB noch localStorage).'));
  }

  // -----------------------------------------------------------------------
  // Oeffentliche, entitaetsspezifische API.
  // Produkte, Chargen und Verknuepfungen sind mutierbar (Status-Update der
  // Charge z.B. auf 'verkauft'); der Ereignis-Store ist strikt append-only.
  // -----------------------------------------------------------------------
  function saveProduct(product) {
    return saveRecord(STORES.products, product);
  }
  function listProducts() {
    return listRecords(STORES.products);
  }
  function getProduct(id) {
    return getRecord(STORES.products, id);
  }

  function saveLot(lot) {
    return saveRecord(STORES.lots, lot);
  }
  function listLots() {
    return listRecords(STORES.lots);
  }
  function getLot(id) {
    return getRecord(STORES.lots, id);
  }

  function saveLotLink(link) {
    return saveRecord(STORES.lotLinks, link);
  }
  function listLotLinks() {
    return listRecords(STORES.lotLinks);
  }

  /**
   * Legt ein Ereignis an. Existiert bereits ein Ereignis mit derselben id,
   * wird das Anlegen abgelehnt -- Ereignisse werden nie ueberschrieben.
   */
  function appendEvent(event) {
    if (!event || typeof event.id === 'undefined' || event.id === null) {
      return Promise.reject(new Error('Ereignis benoetigt ein id-Feld.'));
    }
    return getRecord(STORES.events, event.id).then(function (existing) {
      if (existing) {
        return Promise.reject(new Error('Ereignisse sind append-only: id existiert bereits (' + event.id + ').'));
      }
      return saveRecord(STORES.events, event);
    });
  }
  function listEvents() {
    return listRecords(STORES.events);
  }
  function getEvent(id) {
    return getRecord(STORES.events, id);
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
