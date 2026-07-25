/**
 * offline-kit.js
 *
 * Geteilte generische Engines fuer Rawkeeps West-Afrika-Offline-Apps.
 * Identisch in: agri-aggregator, agri-lease, agri-trace, cold-chain-manager,
 * feed-mill, market-link. Diese Datei enthaelt KEINE App-spezifischen Daten
 * (keine DB-Namen, keine Uebersetzungswoerterbuecher, keine CSV-/Beleg-Spalten)
 * -- die bleiben in der jeweiligen js/storage.js, js/i18n.js, js/csv.js,
 * js/receipt.js jeder App.
 *
 * Aenderung propagieren: hier fixen, dann diese Datei unveraendert in die
 * anderen fuenf Repos kopieren. Es gibt kein Build-Tool/Package-Registry
 * zwischen diesen Repos -- "geteilt" heisst hier "von Hand synchron gehalten",
 * und diese Datei macht diesen Abgleich per einfachem Diff trivial.
 *
 * Keine Netzwerk-Requests (kein fetch, kein XHR) -- ausschliesslich
 * Browser-eigene Storage-/DOM-APIs.
 */
(function (global) {
  'use strict';

  // -----------------------------------------------------------------------
  // Storage-Engine: IndexedDB als primaerer Speicher, localStorage-Fallback.
  // Ein Object Store pro Entitaet (keyPath: 'id'). Alle Funktionen liefern
  // Promises.
  // -----------------------------------------------------------------------
  function createOfflineStorage(config) {
    var dbName = config.dbName;
    var dbVersion = config.dbVersion || 1;
    var stores = config.stores; // { key: storeName, ... }
    var localStoragePrefix = config.localStoragePrefix;

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
        var request = global.indexedDB.open(dbName, dbVersion);
        request.onupgradeneeded = function (event) {
          var db = event.target.result;
          Object.keys(stores).forEach(function (key) {
            var storeName = stores[key];
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

    function localStorageKey(storeName) {
      return localStoragePrefix + storeName;
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

    function makeCrud(storeName) {
      return {
        save: function (record) {
          return saveRecord(storeName, record);
        },
        list: function () {
          return listRecords(storeName);
        },
        get: function (id) {
          return getRecord(storeName, id);
        },
        remove: function (id) {
          return removeRecord(storeName, id);
        }
      };
    }

    var api = {
      STORES: stores,
      saveRecord: saveRecord,
      listRecords: listRecords,
      getRecord: getRecord,
      removeRecord: removeRecord,
      makeCrud: makeCrud
    };

    // Generiert fuer jeden Store save/list/get/delete-Methoden (z.B.
    // saveFarmer, listFarmers, getFarmer, deleteFarmer, ...).
    Object.keys(stores).forEach(function (key) {
      var storeName = stores[key];
      var suffix = key.charAt(0).toUpperCase() + key.slice(1);
      var singular = suffix.replace(/s$/, '');
      var crud = makeCrud(storeName);
      api['save' + singular] = crud.save;
      api['list' + suffix] = crud.list;
      api['get' + singular] = crud.get;
      api['delete' + singular] = crud.remove;
    });

    return api;
  }

  // -----------------------------------------------------------------------
  // i18n-Engine: woerterbuchbasiertes t()/setLanguage()/getLanguage(),
  // Persistenz in localStorage.
  // -----------------------------------------------------------------------
  function createI18n(config) {
    var languageStorageKey = config.languageStorageKey;
    var supportedLanguages = config.supportedLanguages;
    var defaultLanguage = config.defaultLanguage;
    var translations = config.translations;

    function isSupportedLanguage(lang) {
      return supportedLanguages.indexOf(lang) !== -1;
    }

    function hasLocalStorage() {
      return typeof global.localStorage !== 'undefined' && global.localStorage !== null;
    }

    function t(key, lang) {
      var targetLang = isSupportedLanguage(lang) ? lang : getLanguage();
      var entry = translations[key];
      if (!entry) {
        return key;
      }
      return entry[targetLang] || entry[defaultLanguage] || key;
    }

    function setLanguage(lang) {
      if (!isSupportedLanguage(lang)) {
        throw new Error('Nicht unterstuetzte Sprache: ' + lang + ' (erlaubt: ' + supportedLanguages.join(', ') + ').');
      }
      if (hasLocalStorage()) {
        global.localStorage.setItem(languageStorageKey, lang);
      }
      return lang;
    }

    function getLanguage() {
      if (hasLocalStorage()) {
        var stored = global.localStorage.getItem(languageStorageKey);
        if (isSupportedLanguage(stored)) {
          return stored;
        }
      }
      return defaultLanguage;
    }

    return {
      SUPPORTED_LANGUAGES: supportedLanguages,
      DEFAULT_LANGUAGE: defaultLanguage,
      TRANSLATIONS: translations,
      t: t,
      setLanguage: setLanguage,
      getLanguage: getLanguage
    };
  }

  // -----------------------------------------------------------------------
  // CSV-Engine: RFC4180-Escaping/-Parsing, ohne externe Bibliotheken.
  // -----------------------------------------------------------------------
  var CSV_LINE_BREAK = '\r\n';

  function csvEscapeField(value) {
    var str = value === undefined || value === null ? '' : String(value);
    var needsQuoting = /[",\n\r]/.test(str);
    if (!needsQuoting) {
      return str;
    }
    return '"' + str.replace(/"/g, '""') + '"';
  }

  function toCsvRow(fields) {
    return fields.map(csvEscapeField).join(',');
  }

  function buildCsv(headerColumns, rows) {
    var lines = [toCsvRow(headerColumns)];
    rows.forEach(function (row) {
      lines.push(toCsvRow(row));
    });
    return lines.join(CSV_LINE_BREAK);
  }

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var str = typeof text === 'string' ? text : '';
    var len = str.length;
    var i = 0;

    while (i < len) {
      var ch = str.charAt(i);

      if (inQuotes) {
        if (ch === '"') {
          if (str.charAt(i + 1) === '"') {
            field += '"';
            i += 2;
          } else {
            inQuotes = false;
            i += 1;
          }
        } else {
          field += ch;
          i += 1;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        i += 1;
      } else if (ch === ',') {
        row.push(field);
        field = '';
        i += 1;
      } else if (ch === '\r' || ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        if (ch === '\r' && str.charAt(i + 1) === '\n') {
          i += 2;
        } else {
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    }

    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    return rows;
  }

  function dataRowsOf(rows) {
    if (rows.length === 0) {
      return [];
    }
    return rows.slice(1).filter(function (r) {
      return !(r.length === 1 && r[0] === '');
    });
  }

  // -----------------------------------------------------------------------
  // Beleg-Engine: HTML-Escaping + Integer-Geldformatierung + der
  // window.print()-basierte "PDF ueber Browser-Druckdialog"-Mechanismus.
  // -----------------------------------------------------------------------
  function escapeHtml(value) {
    var str = value === undefined || value === null ? '' : String(value);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMoney(amount, currency) {
    var safeAmount = Number.isInteger(amount) ? amount : 0;
    return String(safeAmount) + ' ' + String(currency || '');
  }

  function printReceipt(rootId, html) {
    if (typeof global.document === 'undefined') {
      throw new Error('printReceipt benoetigt eine Browser-Umgebung mit document.');
    }
    var doc = global.document;
    var root = doc.getElementById(rootId);
    if (!root) {
      root = doc.createElement('div');
      root.id = rootId;
      doc.body.appendChild(root);
    }
    root.innerHTML = html;
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print();
    }
    return root;
  }

  var OfflineKit = {
    createOfflineStorage: createOfflineStorage,
    createI18n: createI18n,
    csv: {
      csvEscapeField: csvEscapeField,
      toCsvRow: toCsvRow,
      buildCsv: buildCsv,
      parseCsv: parseCsv,
      dataRowsOf: dataRowsOf
    },
    receipt: {
      escapeHtml: escapeHtml,
      formatMoney: formatMoney,
      printReceipt: printReceipt
    }
  };

  global.OfflineKit = OfflineKit;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = OfflineKit;
  }
})(typeof window !== 'undefined' ? window : globalThis);
