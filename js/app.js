/**
 * app.js
 *
 * Orchestrierungs-Layer (nur Browser): verdrahtet DOM, i18n, Storage und die
 * reine Trace-Logik. Enthaelt bewusst KEINE fachliche Kernlogik -- Massenbilanz,
 * Storno, Rueckruf und Export leben in js/trace.js (Node-getestet). app.js
 * ruft diese Funktionen auf und persistiert Ergebnisse ueber js/storage.js.
 *
 * Keine externen Requests: QR-Code lokal via TraceQR, Downloads via Blob.
 */
(function (global) {
  'use strict';

  var Models = global.TraceModels;
  var Storage = global.TraceStorage;
  var I18n = global.TraceI18n;
  var Trace = global.TraceLogic;
  var QR = global.TraceQR;

  var doc = global.document;
  var state = {
    selectedLotId: null,
    products: [],
    lots: [],
    events: [],
    lotLinks: []
  };

  function $(id) {
    return doc.getElementById(id);
  }

  function t(key) {
    return I18n.t(key);
  }

  function toast(message) {
    var el = $('toast');
    if (!el) {
      return;
    }
    el.textContent = message;
    el.classList.remove('hidden');
    global.setTimeout(function () {
      el.classList.add('hidden');
    }, 2500);
  }

  // -------------------------------------------------------------------
  // Daten laden / cachen
  // -------------------------------------------------------------------
  function reload() {
    return Promise.all([Storage.listProducts(), Storage.listLots(), Storage.listEvents(), Storage.listLotLinks()]).then(
      function (res) {
        state.products = res[0];
        state.lots = res[1];
        state.events = res[2];
        state.lotLinks = res[3];
      }
    );
  }

  function productName(productId) {
    var p = state.products.filter(function (x) {
      return x.id === productId;
    })[0];
    if (!p) {
      return productId || '';
    }
    return I18n.getLanguage() === 'fr' ? p.nameFr : p.nameEn;
  }

  // -------------------------------------------------------------------
  // i18n / Navigation
  // -------------------------------------------------------------------
  function applyI18n() {
    var lang = I18n.getLanguage();
    doc.documentElement.setAttribute('lang', lang);
    var nodes = doc.querySelectorAll('[data-i18n]');
    Array.prototype.forEach.call(nodes, function (node) {
      var key = node.getAttribute('data-i18n');
      var value = I18n.t(key, lang);
      if (node.tagName === 'TITLE') {
        node.textContent = value;
      } else {
        node.textContent = value;
      }
    });
    Array.prototype.forEach.call(doc.querySelectorAll('#language-switcher button'), function (btn) {
      btn.classList.toggle('active-lang', btn.getAttribute('data-lang') === lang);
    });
    populateEventTypeSelect();
  }

  function showView(viewId) {
    Array.prototype.forEach.call(doc.querySelectorAll('.view'), function (v) {
      v.classList.toggle('active', v.id === viewId);
    });
    Array.prototype.forEach.call(doc.querySelectorAll('.nav-btn'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === viewId);
    });
  }

  function populateEventTypeSelect() {
    var sel = $('event-type');
    if (!sel) {
      return;
    }
    var current = sel.value;
    sel.innerHTML = '';
    // Storno wird nicht direkt erfasst -- Korrektur erfolgt ueber die Kette.
    Models.EVENT_TYPES.filter(function (typ) {
      return typ !== 'storno' && typ !== 'verarbeitung';
    }).forEach(function (typ) {
      var opt = doc.createElement('option');
      opt.value = typ;
      opt.textContent = I18n.t('typ_' + typ);
      sel.appendChild(opt);
    });
    if (current) {
      sel.value = current;
    }
  }

  // -------------------------------------------------------------------
  // Produkte
  // -------------------------------------------------------------------
  function renderProducts() {
    var body = $('products-table-body');
    body.innerHTML = '';
    state.products.forEach(function (p) {
      var tr = doc.createElement('tr');
      tr.appendChild(td(p.nameEn));
      tr.appendChild(td(p.nameFr));
      tr.appendChild(td(p.hsCode));
      body.appendChild(tr);
    });
    populateProductSelects();
  }

  function populateProductSelects() {
    ['lot-product-id', 'search-product-id'].forEach(function (id) {
      var sel = $(id);
      if (!sel) {
        return;
      }
      var current = sel.value;
      var allowEmpty = id === 'search-product-id';
      sel.innerHTML = allowEmpty ? '<option value=""></option>' : '';
      state.products.forEach(function (p) {
        var opt = doc.createElement('option');
        opt.value = p.id;
        opt.textContent = productName(p.id);
        sel.appendChild(opt);
      });
      sel.value = current;
    });
  }

  function onProductSubmit(e) {
    e.preventDefault();
    try {
      var product = Models.createProduct({
        nameEn: $('product-name-en').value,
        nameFr: $('product-name-fr').value,
        hsCode: $('product-hs-code').value
      });
      Storage.saveProduct(product)
        .then(reload)
        .then(function () {
          renderProducts();
          renderAllLotSelects();
          $('product-form').reset();
          toast(t('saved'));
        });
    } catch (err) {
      toast(err.message);
    }
  }

  // -------------------------------------------------------------------
  // Chargen
  // -------------------------------------------------------------------
  function td(text) {
    var cell = doc.createElement('td');
    cell.textContent = text === null || text === undefined ? '' : String(text);
    return cell;
  }

  function renderLots(criteria) {
    var body = $('lots-table-body');
    body.innerHTML = '';
    var list = Trace.searchLots(state.lots, criteria || {});
    list
      .slice()
      .sort(function (a, b) {
        return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1;
      })
      .forEach(function (lot) {
        var tr = doc.createElement('tr');
        tr.className = 'clickable';
        tr.appendChild(td(lot.id));
        tr.appendChild(td(productName(lot.productId)));
        tr.appendChild(td(lot.weightKg));
        tr.appendChild(td(lot.farmerId));
        tr.appendChild(td(lot.harvestDate));
        tr.appendChild(td(lot.status));
        tr.addEventListener('click', function () {
          selectLot(lot.id);
        });
        body.appendChild(tr);
      });
  }

  function onLotSubmit(e) {
    e.preventDefault();
    try {
      var lot = Models.createLot({
        productId: $('lot-product-id').value,
        weightKg: parseFloat($('lot-weight-kg').value),
        farmerId: $('lot-farmer-id').value,
        village: $('lot-village').value,
        h3Cell: $('lot-h3').value,
        harvestDate: $('lot-harvest-date').value
      });
      var initEvent = Models.createEvent({
        lotId: lot.id,
        type: 'ankauf',
        seq: 0,
        payload: { weightKg: lot.weightKg, farmerId: lot.farmerId }
      });
      Storage.saveLot(lot)
        .then(function () {
          return Storage.appendEvent(initEvent);
        })
        .then(reload)
        .then(function () {
          renderLots();
          renderAllLotSelects();
          $('lot-form').reset();
          toast(t('saved'));
          selectLot(lot.id);
        });
    } catch (err) {
      toast(err.message);
    }
  }

  function selectLot(lotId) {
    state.selectedLotId = lotId;
    $('lot-detail').classList.remove('hidden');
    $('lot-detail-id').textContent = lotId;
    renderLotEvents();
  }

  function renderLotEvents() {
    var body = $('lot-events-body');
    body.innerHTML = '';
    var chain = Trace.eventsForLot(state.selectedLotId, state.events);
    var stornoed = Trace.stornoedEventIds(state.events);
    chain.forEach(function (ev) {
      var tr = doc.createElement('tr');
      if (ev.type === 'storno') {
        tr.className = 'storno-row';
      }
      if (stornoed[ev.id]) {
        tr.className = 'reversed-row';
      }
      tr.appendChild(td(ev.ts));
      tr.appendChild(td(I18n.t('typ_' + ev.type)));
      tr.appendChild(td(ev.recordedBy));
      tr.appendChild(td(JSON.stringify(ev.payload)));
      var actionCell = doc.createElement('td');
      if (ev.type !== 'storno' && !stornoed[ev.id]) {
        var btn = doc.createElement('button');
        btn.type = 'button';
        btn.textContent = t('reverse');
        btn.addEventListener('click', function () {
          reverseEvent(ev.id);
        });
        actionCell.appendChild(btn);
      }
      tr.appendChild(actionCell);
      body.appendChild(tr);
    });
  }

  function onEventSubmit(e) {
    e.preventDefault();
    if (!state.selectedLotId) {
      return;
    }
    try {
      var ev = Models.createEvent({
        lotId: state.selectedLotId,
        type: $('event-type').value,
        seq: Trace.nextSeq(state.events),
        recordedBy: $('event-recorded-by').value,
        payload: { note: $('event-note').value }
      });
      Storage.appendEvent(ev)
        .then(reload)
        .then(function () {
          renderLotEvents();
          $('event-note').value = '';
          toast(t('saved'));
        });
    } catch (err) {
      toast(err.message);
    }
  }

  // Korrektur = APPEND-ONLY Storno-Ereignis (nie Update/Delete).
  function reverseEvent(targetId) {
    try {
      var reason = global.prompt(t('reason') + '?') || '';
      var storno = Trace.makeStornoEvent(state.events, targetId, {
        reason: reason,
        recordedBy: $('event-recorded-by').value
      });
      Storage.appendEvent(storno)
        .then(reload)
        .then(renderLotEvents);
    } catch (err) {
      toast(err.message);
    }
  }

  // -------------------------------------------------------------------
  // Verarbeitung (Split/Merge)
  // -------------------------------------------------------------------
  function lotOptionHtml() {
    return (
      '<option value=""></option>' +
      state.lots
        .map(function (l) {
          return '<option value="' + l.id + '">' + l.id + ' (' + l.weightKg + ' kg)</option>';
        })
        .join('')
    );
  }

  function addParentRow() {
    var wrap = doc.createElement('div');
    wrap.className = 'form-row proc-row parent-row';
    var sel = doc.createElement('select');
    sel.className = 'proc-lot';
    sel.innerHTML = lotOptionHtml();
    sel.addEventListener('change', recomputeBalance);
    var inp = doc.createElement('input');
    inp.type = 'number';
    inp.min = '0';
    inp.step = '0.01';
    inp.className = 'proc-kg';
    inp.placeholder = 'kg';
    inp.addEventListener('input', recomputeBalance);
    wrap.appendChild(sel);
    wrap.appendChild(inp);
    $('parent-rows').appendChild(wrap);
  }

  function addChildRow() {
    var wrap = doc.createElement('div');
    wrap.className = 'form-row proc-row child-row';
    var sel = doc.createElement('select');
    sel.className = 'proc-product';
    sel.innerHTML = state.products
      .map(function (p) {
        return '<option value="' + p.id + '">' + productName(p.id) + '</option>';
      })
      .join('');
    var inp = doc.createElement('input');
    inp.type = 'number';
    inp.min = '0';
    inp.step = '0.01';
    inp.className = 'proc-kg';
    inp.placeholder = 'kg';
    inp.addEventListener('input', recomputeBalance);
    wrap.appendChild(sel);
    wrap.appendChild(inp);
    $('child-rows').appendChild(wrap);
  }

  function collectParents() {
    return Array.prototype.map
      .call($('parent-rows').querySelectorAll('.parent-row'), function (row) {
        return {
          lotId: row.querySelector('.proc-lot').value,
          inputKg: parseFloat(row.querySelector('.proc-kg').value)
        };
      })
      .filter(function (p) {
        return p.lotId && p.inputKg > 0;
      });
  }

  function collectChildren() {
    return Array.prototype.map
      .call($('child-rows').querySelectorAll('.child-row'), function (row) {
        return {
          productId: row.querySelector('.proc-product').value,
          weightKg: parseFloat(row.querySelector('.proc-kg').value)
        };
      })
      .filter(function (c) {
        return c.productId && c.weightKg > 0;
      });
  }

  function recomputeBalance() {
    var parents = collectParents();
    var children = collectChildren();
    var inputSum = parents.reduce(function (s, p) {
      return s + p.inputKg;
    }, 0);
    var outputSum = children.reduce(function (s, c) {
      return s + c.weightKg;
    }, 0);
    $('balance-input').textContent = Math.round(inputSum * 1000) / 1000;
    $('balance-output').textContent = Math.round(outputSum * 1000) / 1000;
    var loss = inputSum - outputSum;
    $('balance-loss').textContent = Math.round(loss * 1000) / 1000;
    var err = $('balance-error');
    if (loss < -1e-9) {
      err.classList.remove('hidden');
      err.textContent = t('massBalanceError');
    } else {
      err.classList.add('hidden');
    }
  }

  function onRunProcessing() {
    try {
      var plan = Trace.planProcessing(
        { parents: collectParents(), children: collectChildren(), recordedBy: '' },
        state.events
      );
      var ops = [];
      plan.childLots.forEach(function (lot) {
        ops.push(Storage.saveLot(lot));
      });
      plan.links.forEach(function (link) {
        ops.push(Storage.saveLotLink(link));
      });
      plan.events.forEach(function (ev) {
        ops.push(Storage.appendEvent(ev));
      });
      // Eltern-Chargen als 'verarbeitet' markieren.
      collectParents().forEach(function (p) {
        var lot = state.lots.filter(function (l) {
          return l.id === p.lotId;
        })[0];
        if (lot) {
          lot.status = 'verarbeitet';
          ops.push(Storage.saveLot(lot));
        }
      });
      Promise.all(ops)
        .then(reload)
        .then(function () {
          renderLots();
          renderAllLotSelects();
          $('parent-rows').innerHTML = '';
          $('child-rows').innerHTML = '';
          addParentRow();
          addChildRow();
          recomputeBalance();
          $('processing-result').textContent =
            t('yieldLoss') + ': ' + plan.balance.yieldLoss + ' kg | ' + plan.childLots.length + ' child lot(s)';
          toast(t('saved'));
        });
    } catch (err) {
      toast(err.message);
    }
  }

  // -------------------------------------------------------------------
  // Chargen-Pass (mit lokalem QR-Code)
  // -------------------------------------------------------------------
  function renderPassport() {
    var lotId = $('passport-lot-id').value;
    var area = $('passport-print-area');
    if (!lotId) {
      area.innerHTML = '';
      return;
    }
    var lot = state.lots.filter(function (l) {
      return l.id === lotId;
    })[0];
    if (!lot) {
      return;
    }
    var chain = Trace.eventsForLot(lotId, state.events);
    var stornoed = Trace.stornoedEventIds(state.events);

    var rows = chain
      .map(function (ev) {
        var cls = stornoed[ev.id] ? ' class="reversed-row"' : ev.type === 'storno' ? ' class="storno-row"' : '';
        return (
          '<tr' +
          cls +
          '><td>' +
          ev.ts +
          '</td><td>' +
          I18n.t('typ_' + ev.type) +
          '</td><td>' +
          escapeHtml(ev.recordedBy) +
          '</td><td>' +
          escapeHtml(JSON.stringify(ev.payload)) +
          '</td></tr>'
        );
      })
      .join('');

    // QR-Nutzlast: kompakte, lokal aufloesbare Kennung der Charge.
    var qrPayload = 'agri-trace|lot=' + lot.id + '|prod=' + lot.productId + '|kg=' + lot.weightKg;
    var qrSvg = QR.toSvgString(qrPayload, { border: 2 });

    area.innerHTML =
      '<div class="passport">' +
      '<div class="passport-head">' +
      '<div><h3>' +
      t('passportTitle') +
      '</h3>' +
      '<p><strong>' +
      t('lotId') +
      ':</strong> ' +
      escapeHtml(lot.id) +
      '<br><strong>' +
      t('product') +
      ':</strong> ' +
      escapeHtml(productName(lot.productId)) +
      '<br><strong>' +
      t('weight') +
      ':</strong> ' +
      lot.weightKg +
      '</p>' +
      '<p><strong>' +
      t('origin') +
      ':</strong> ' +
      escapeHtml(lot.farmerId) +
      ' / ' +
      escapeHtml(lot.village) +
      ' / ' +
      escapeHtml(lot.h3Cell) +
      '<br><strong>' +
      t('harvestDate') +
      ':</strong> ' +
      escapeHtml(lot.harvestDate) +
      '</p></div>' +
      '<div class="passport-qr">' +
      qrSvg +
      '</div>' +
      '</div>' +
      '<h4>' +
      t('eventChain') +
      '</h4>' +
      '<table><thead><tr><th>' +
      t('date') +
      '</th><th>' +
      t('eventType') +
      '</th><th>' +
      t('recordedBy') +
      '</th><th>Payload</th></tr></thead><tbody>' +
      rows +
      '</tbody></table></div>';
  }

  function escapeHtml(str) {
    return String(str === null || str === undefined ? '' : str).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // -------------------------------------------------------------------
  // Rueckruf-Simulation
  // -------------------------------------------------------------------
  function renderRecall() {
    var lotId = $('recall-lot-id').value;
    if (!lotId) {
      return;
    }
    try {
      var result = Trace.recallSimulation(lotId, state.lots, state.lotLinks);
      $('recall-result').innerHTML =
        recallBlock(t('ancestors'), result.ancestors) +
        recallBlock(t('descendants'), result.descendants) +
        recallBlock(t('siblings'), result.siblings);
    } catch (err) {
      toast(err.message);
    }
  }

  function recallBlock(title, list) {
    var rows = list.length
      ? list
          .map(function (x) {
            return '<tr><td>' + escapeHtml(x.lotId) + '</td><td>' + (x.weightKg === null ? '' : x.weightKg) + '</td></tr>';
          })
          .join('')
      : '<tr><td colspan="2">' + t('noResults') + '</td></tr>';
    return (
      '<div class="card"><h3>' +
      title +
      ' (' +
      list.length +
      ')</h3><table><thead><tr><th>' +
      t('lotId') +
      '</th><th>' +
      t('affectedKg') +
      '</th></tr></thead><tbody>' +
      rows +
      '</tbody></table></div>'
    );
  }

  // -------------------------------------------------------------------
  // Export (Blob-Download, offline)
  // -------------------------------------------------------------------
  function download(filename, content, mime) {
    var blob = new global.Blob([content], { type: mime });
    var url = global.URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    global.URL.revokeObjectURL(url);
  }

  function onExport(format) {
    var lotId = $('export-lot-id').value || null;
    var content = format === 'json' ? Trace.exportChainJson(state.events, lotId) : Trace.exportChainCsv(state.events, lotId);
    $('export-preview').textContent = content;
    var base = lotId ? lotId : 'all-lots';
    download('agri-trace_' + base + '.' + format, content, format === 'json' ? 'application/json' : 'text/csv');
  }

  // -------------------------------------------------------------------
  // Lot-Selects (Passport / Recall / Export)
  // -------------------------------------------------------------------
  function renderAllLotSelects() {
    ['passport-lot-id', 'recall-lot-id', 'export-lot-id'].forEach(function (id) {
      var sel = $(id);
      if (!sel) {
        return;
      }
      var current = sel.value;
      var allowEmpty = id === 'export-lot-id';
      sel.innerHTML = allowEmpty ? '<option value="">' + t('allLots') + '</option>' : '<option value=""></option>';
      state.lots.forEach(function (l) {
        var opt = doc.createElement('option');
        opt.value = l.id;
        opt.textContent = l.id + ' — ' + productName(l.productId);
        sel.appendChild(opt);
      });
      sel.value = current;
    });
    // Verarbeitungs-Zeilen-Selects aktualisieren.
    Array.prototype.forEach.call(doc.querySelectorAll('.proc-lot'), function (sel) {
      var current = sel.value;
      sel.innerHTML = lotOptionHtml();
      sel.value = current;
    });
  }

  // -------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------
  function bindEvents() {
    Array.prototype.forEach.call(doc.querySelectorAll('.nav-btn'), function (btn) {
      btn.addEventListener('click', function () {
        showView(btn.getAttribute('data-view'));
      });
    });
    $('lang-switch-en').addEventListener('click', function () {
      I18n.setLanguage('en');
      applyI18n();
      renderAll();
    });
    $('lang-switch-fr').addEventListener('click', function () {
      I18n.setLanguage('fr');
      applyI18n();
      renderAll();
    });

    $('product-form').addEventListener('submit', onProductSubmit);
    $('lot-form').addEventListener('submit', onLotSubmit);
    $('event-form').addEventListener('submit', onEventSubmit);
    $('btn-search').addEventListener('click', function () {
      renderLots({
        lotId: $('search-lot-id').value,
        farmerId: $('search-farmer-id').value,
        productId: $('search-product-id').value,
        dateFrom: $('search-date-from').value,
        dateTo: $('search-date-to').value
      });
    });

    $('btn-add-parent').addEventListener('click', addParentRow);
    $('btn-add-child').addEventListener('click', addChildRow);
    $('btn-run-processing').addEventListener('click', onRunProcessing);

    $('btn-show-passport').addEventListener('click', renderPassport);
    $('btn-print-passport').addEventListener('click', function () {
      renderPassport();
      global.print();
    });
    $('btn-run-recall').addEventListener('click', renderRecall);
    $('btn-export-json').addEventListener('click', function () {
      onExport('json');
    });
    $('btn-export-csv').addEventListener('click', function () {
      onExport('csv');
    });
  }

  function renderAll() {
    renderProducts();
    renderLots();
    renderAllLotSelects();
    if (state.selectedLotId) {
      renderLotEvents();
    }
  }

  function seedDemoProductsIfEmpty() {
    if (state.products.length > 0) {
      return Promise.resolve();
    }
    var demo = [
      Models.createProduct({ nameEn: 'Cocoa beans', nameFr: 'Feves de cacao', hsCode: '1801.00' }),
      Models.createProduct({ nameEn: 'Cashew nuts', nameFr: 'Noix de cajou', hsCode: '0801.31' })
    ];
    return Promise.all(demo.map(Storage.saveProduct)).then(reload);
  }

  function init() {
    bindEvents();
    applyI18n();
    reload()
      .then(seedDemoProductsIfEmpty)
      .then(function () {
        addParentRow();
        addChildRow();
        recomputeBalance();
        renderAll();
      });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Fuer eventuelle spaetere Node-/Browser-Introspektion (kein Kern-IP hier).
  var TraceApp = { init: init, showView: showView };
  global.TraceApp = TraceApp;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TraceApp;
  }
})(typeof window !== 'undefined' ? window : globalThis);
