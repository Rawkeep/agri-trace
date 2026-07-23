/**
 * trace.js
 *
 * Kern-IP der Rueckverfolgbarkeit -- rein funktional, ohne Storage/DOM, damit
 * unter Node testbar (dual-export). Deckt ab:
 *   - Append-only + Storno (Korrektur ohne Mutation),
 *   - Verarbeitung mit Split/Merge (Eltern->Kind) + Massenbilanz
 *     (Sigma Input >= Sigma Output, Differenz = Ausbeuteverlust, nie negativ),
 *   - Rueckruf-Simulation (Vorfahren / Nachkommen / Geschwister einer Charge),
 *   - Suche (lot_id / Farmer / Produkt / Zeitraum),
 *   - Export der Ereigniskette als JSON und CSV (chronologisch).
 *
 * Alle Funktionen sind seiteneffektfrei: sie mutieren die uebergebenen
 * Arrays nicht, sondern liefern neue Objekte/Arrays zurueck. Das Persistieren
 * uebernimmt der Aufrufer (js/app.js ueber js/storage.js).
 */
(function (global) {
  'use strict';

  // Models lokal aufloesen: in Node via require, im Browser via global.
  var Models =
    typeof module !== 'undefined' && module.exports && typeof require === 'function'
      ? require('./models.js')
      : global.TraceModels;

  var EPSILON = 1e-9;

  function round3(value) {
    return Math.round(value * 1000) / 1000;
  }

  // ---------------------------------------------------------------------
  // Chronologie
  // ---------------------------------------------------------------------
  /**
   * Liefert eine chronologisch sortierte KOPIE der Ereignisse (ts, dann seq).
   * Das Eingangs-Array bleibt unveraendert.
   */
  function sortEventsChronologically(events) {
    return (events || []).slice().sort(function (a, b) {
      if (a.ts < b.ts) return -1;
      if (a.ts > b.ts) return 1;
      return (a.seq || 0) - (b.seq || 0);
    });
  }

  /**
   * Naechste freie seq-Nummer (max vorhandene + 1). Gibt bei identischem
   * Zeitstempel eine stabile Erfassungsreihenfolge.
   */
  function nextSeq(events) {
    var max = -1;
    (events || []).forEach(function (e) {
      if (typeof e.seq === 'number' && e.seq > max) {
        max = e.seq;
      }
    });
    return max + 1;
  }

  /**
   * Nur die Ereignisse einer bestimmten Charge, chronologisch.
   */
  function eventsForLot(lotId, events) {
    return sortEventsChronologically(
      (events || []).filter(function (e) {
        return e.lotId === lotId;
      })
    );
  }

  // ---------------------------------------------------------------------
  // Storno (Korrektur ohne Mutation)
  // ---------------------------------------------------------------------
  /**
   * Erzeugt ein Storno-Ereignis, das ein bestehendes Ereignis fachlich
   * aufhebt. Das Ziel-Ereignis wird NICHT veraendert oder geloescht -- die
   * Kette bleibt vollstaendig (Append-only). Rueckgabe: das neue Ereignis.
   */
  function makeStornoEvent(events, targetEventId, opts) {
    opts = opts || {};
    var target = (events || []).filter(function (e) {
      return e.id === targetEventId;
    })[0];
    if (!target) {
      throw new Error('Storno nicht moeglich: Ziel-Ereignis nicht gefunden (' + targetEventId + ').');
    }
    if (target.type === 'storno') {
      throw new Error('Ein Storno-Ereignis kann nicht storniert werden.');
    }
    return Models.createEvent({
      lotId: target.lotId,
      type: 'storno',
      ts: typeof opts.ts === 'string' ? opts.ts : new Date().toISOString(),
      seq: nextSeq(events),
      recordedBy: typeof opts.recordedBy === 'string' ? opts.recordedBy : '',
      payload: {
        stornoOf: target.id,
        stornoOfType: target.type,
        reason: typeof opts.reason === 'string' ? opts.reason : ''
      }
    });
  }

  /**
   * Menge der stornierten Ereignis-IDs (jene, die von einem Storno referenziert
   * werden). Praktisch fuer die Anzeige des effektiven Ketten-Zustands.
   */
  function stornoedEventIds(events) {
    var ids = {};
    (events || []).forEach(function (e) {
      if (e.type === 'storno' && e.payload && e.payload.stornoOf) {
        ids[e.payload.stornoOf] = true;
      }
    });
    return ids;
  }

  // ---------------------------------------------------------------------
  // Massenbilanz
  // ---------------------------------------------------------------------
  /**
   * Massenbilanz einer Verarbeitung. inputKgList/outputKgList sind Arrays von
   * Zahlen (kg). Ergebnis: { inputSum, outputSum, yieldLoss }. Ist die Ausbeute
   * groesser als der Input (yieldLoss < 0), wird ein Fehler geworfen -- Masse
   * darf nicht aus dem Nichts entstehen.
   */
  function computeMassBalance(inputKgList, outputKgList) {
    var inputSum = (inputKgList || []).reduce(function (s, v) {
      return s + Number(v);
    }, 0);
    var outputSum = (outputKgList || []).reduce(function (s, v) {
      return s + Number(v);
    }, 0);
    var yieldLoss = inputSum - outputSum;
    if (yieldLoss < -EPSILON) {
      throw new Error(
        'Massenbilanz verletzt: Output (' +
          round3(outputSum) +
          ' kg) > Input (' +
          round3(inputSum) +
          ' kg). Ausbeuteverlust darf nicht negativ sein.'
      );
    }
    return {
      inputSum: round3(inputSum),
      outputSum: round3(outputSum),
      yieldLoss: round3(Math.max(0, yieldLoss))
    };
  }

  // ---------------------------------------------------------------------
  // Verarbeitung (Split / Merge)
  // ---------------------------------------------------------------------
  /**
   * Plant eine Verarbeitung: n Eltern-Chargen -> m Kind-Chargen mit
   * kg-Anteilen. Erzeugt Kind-Chargen (originType 'verarbeitung'),
   * Eltern->Kind-Verknuepfungen (lot_links, anteil_kg proportional zum
   * Eltern-Input) sowie je Eltern-Charge ein 'verarbeitung'-Ereignis.
   *
   * params = {
   *   parents:  [{ lotId, inputKg }],
   *   children: [{ productId, weightKg, farmerId?, village?, h3Cell?, harvestDate? }],
   *   recordedBy?, ts?
   * }
   *
   * Rueckgabe: { childLots, links, events, balance }. Persistieren + Status
   * der Eltern-Chargen setzt der Aufrufer. Wirft bei verletzter Massenbilanz.
   */
  function planProcessing(params, existingEvents) {
    params = params || {};
    var parents = params.parents || [];
    var children = params.children || [];
    if (parents.length === 0) {
      throw new Error('Verarbeitung benoetigt mindestens eine Eltern-Charge.');
    }
    if (children.length === 0) {
      throw new Error('Verarbeitung benoetigt mindestens eine Kind-Charge.');
    }

    var inputKgList = parents.map(function (p) {
      if (!(typeof p.inputKg === 'number' && isFinite(p.inputKg) && p.inputKg > 0)) {
        throw new Error('Ungueltiger Eltern-Input (kg) fuer ' + p.lotId + '.');
      }
      return p.inputKg;
    });
    var outputKgList = children.map(function (c) {
      return c.weightKg;
    });

    // Wirft, falls Output > Input (negativer Ausbeuteverlust).
    var balance = computeMassBalance(inputKgList, outputKgList);
    var inputSum = inputKgList.reduce(function (s, v) {
      return s + v;
    }, 0);

    var ts = typeof params.ts === 'string' ? params.ts : new Date().toISOString();
    var recordedBy = typeof params.recordedBy === 'string' ? params.recordedBy : '';

    // 1) Kind-Chargen anlegen (mit eigener id fuer die Verknuepfungen).
    var childLots = children.map(function (c) {
      return Models.createLot({
        productId: c.productId,
        weightKg: c.weightKg,
        farmerId: c.farmerId || '',
        village: c.village || '',
        h3Cell: c.h3Cell || '',
        harvestDate: c.harvestDate || '',
        originType: 'verarbeitung',
        createdAt: ts
      });
    });

    // 2) Verknuepfungen Eltern->Kind. anteil_kg = Kind-Gewicht anteilig am
    //    Eltern-Input, sodass Summe aller Anteile = Sigma Output.
    var links = [];
    parents.forEach(function (p, pIdx) {
      var parentShareRatio = inputKgList[pIdx] / inputSum;
      childLots.forEach(function (child) {
        var shareKg = round3(child.weightKg * parentShareRatio);
        if (shareKg <= 0) {
          return;
        }
        links.push(
          Models.createLotLink({
            parentLotId: p.lotId,
            childLotId: child.id,
            shareKg: shareKg
          })
        );
      });
    });

    // 3) Je Eltern-Charge ein 'verarbeitung'-Ereignis (Audit-Log).
    var seq = nextSeq(existingEvents);
    var childLotIds = childLots.map(function (c) {
      return c.id;
    });
    var events = parents.map(function (p, pIdx) {
      var ev = Models.createEvent({
        lotId: p.lotId,
        type: 'verarbeitung',
        ts: ts,
        seq: seq + pIdx,
        recordedBy: recordedBy,
        payload: {
          inputKg: p.inputKg,
          childLotIds: childLotIds,
          inputSum: balance.inputSum,
          outputSum: balance.outputSum,
          yieldLoss: balance.yieldLoss
        }
      });
      return ev;
    });

    return {
      childLots: childLots,
      links: links,
      events: events,
      balance: balance
    };
  }

  // ---------------------------------------------------------------------
  // Rueckruf-Simulation
  // ---------------------------------------------------------------------
  function buildLotMap(lots) {
    var map = {};
    (lots || []).forEach(function (l) {
      map[l.id] = l;
    });
    return map;
  }

  function directParents(lotId, links) {
    return (links || [])
      .filter(function (l) {
        return l.childLotId === lotId;
      })
      .map(function (l) {
        return l.parentLotId;
      });
  }

  function directChildren(lotId, links) {
    return (links || [])
      .filter(function (l) {
        return l.parentLotId === lotId;
      })
      .map(function (l) {
        return l.childLotId;
      });
  }

  function transitiveClosure(startIds, stepFn, links) {
    var seen = {};
    var order = [];
    var queue = startIds.slice();
    while (queue.length > 0) {
      var current = queue.shift();
      if (seen[current]) {
        continue;
      }
      seen[current] = true;
      order.push(current);
      stepFn(current, links).forEach(function (next) {
        if (!seen[next]) {
          queue.push(next);
        }
      });
    }
    return order;
  }

  function toLotInfo(ids, lotMap) {
    var unique = {};
    var result = [];
    ids.forEach(function (id) {
      if (unique[id]) {
        return;
      }
      unique[id] = true;
      var lot = lotMap[id] || null;
      result.push({
        lotId: id,
        weightKg: lot ? lot.weightKg : null,
        productId: lot ? lot.productId : null,
        status: lot ? lot.status : null
      });
    });
    return result;
  }

  /**
   * Rueckruf-Simulation fuer eine Charge. Liefert in einem Aufruf:
   *   - ancestors:   alle Vorfahren (transitiv aufwaerts ueber lot_links),
   *   - descendants: alle Nachkommen (transitiv abwaerts),
   *   - siblings:    alle Geschwister (teilen mindestens eine Eltern-Charge),
   * jeweils mit betroffener Menge (kg) aus der jeweiligen Charge.
   */
  function recallSimulation(lotId, lots, links) {
    var lotMap = buildLotMap(lots);
    if (!lotMap[lotId]) {
      throw new Error('Rueckruf nicht moeglich: Charge nicht gefunden (' + lotId + ').');
    }

    // Vorfahren: von den direkten Eltern aus transitiv aufwaerts.
    var ancestors = transitiveClosure(directParents(lotId, links), directParents, links);
    // Nachkommen: von den direkten Kindern aus transitiv abwaerts.
    var descendants = transitiveClosure(directChildren(lotId, links), directChildren, links);

    // Geschwister: alle Kinder der eigenen Eltern (ohne die Charge selbst).
    var parents = directParents(lotId, links);
    var siblingIds = [];
    parents.forEach(function (parentId) {
      directChildren(parentId, links).forEach(function (childId) {
        if (childId !== lotId) {
          siblingIds.push(childId);
        }
      });
    });

    return {
      lotId: lotId,
      lot: toLotInfo([lotId], lotMap)[0],
      ancestors: toLotInfo(ancestors, lotMap),
      descendants: toLotInfo(descendants, lotMap),
      siblings: toLotInfo(siblingIds, lotMap)
    };
  }

  // ---------------------------------------------------------------------
  // Suche
  // ---------------------------------------------------------------------
  /**
   * Filtert Chargen nach lot_id (Teilstring), Farmer, Produkt und
   * Erntedatum-Bereich (dateFrom/dateTo, inklusive, ISO-Datum).
   */
  function searchLots(lots, criteria) {
    criteria = criteria || {};
    var lotId = criteria.lotId ? String(criteria.lotId).toLowerCase() : '';
    return (lots || []).filter(function (lot) {
      if (lotId && lot.id.toLowerCase().indexOf(lotId) === -1) {
        return false;
      }
      if (criteria.farmerId && lot.farmerId !== criteria.farmerId) {
        return false;
      }
      if (criteria.productId && lot.productId !== criteria.productId) {
        return false;
      }
      if (criteria.dateFrom && (!lot.harvestDate || lot.harvestDate < criteria.dateFrom)) {
        return false;
      }
      if (criteria.dateTo && (!lot.harvestDate || lot.harvestDate > criteria.dateTo)) {
        return false;
      }
      return true;
    });
  }

  // ---------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------
  var CSV_COLUMNS = ['event_id', 'lot_id', 'ts', 'seq', 'typ', 'erfasser', 'payload_json'];

  function csvEscape(value) {
    var str = value === null || value === undefined ? '' : String(value);
    if (/[",\n\r]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  /**
   * JSON-Export der Ereigniskette (chronologisch). Optional auf eine Charge
   * beschraenkt, sonst alle Ereignisse.
   */
  function exportChainJson(events, lotId) {
    var chain = lotId ? eventsForLot(lotId, events) : sortEventsChronologically(events);
    return JSON.stringify(chain, null, 2);
  }

  /**
   * CSV-Export der Ereigniskette (chronologisch), inkl. Kopfzeile. Enthaelt
   * jedes Ereignis mit Zeitstempel; payload wird als JSON-Spalte gefuehrt.
   */
  function exportChainCsv(events, lotId) {
    var chain = lotId ? eventsForLot(lotId, events) : sortEventsChronologically(events);
    var lines = [CSV_COLUMNS.join(',')];
    chain.forEach(function (e) {
      lines.push(
        [
          csvEscape(e.id),
          csvEscape(e.lotId),
          csvEscape(e.ts),
          csvEscape(e.seq),
          csvEscape(e.type),
          csvEscape(e.recordedBy),
          csvEscape(JSON.stringify(e.payload || {}))
        ].join(',')
      );
    });
    return lines.join('\n');
  }

  var TraceLogic = {
    sortEventsChronologically: sortEventsChronologically,
    nextSeq: nextSeq,
    eventsForLot: eventsForLot,
    makeStornoEvent: makeStornoEvent,
    stornoedEventIds: stornoedEventIds,
    computeMassBalance: computeMassBalance,
    planProcessing: planProcessing,
    recallSimulation: recallSimulation,
    directParents: directParents,
    directChildren: directChildren,
    searchLots: searchLots,
    exportChainJson: exportChainJson,
    exportChainCsv: exportChainCsv,
    CSV_COLUMNS: CSV_COLUMNS
  };

  global.TraceLogic = TraceLogic;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TraceLogic;
  }
})(typeof window !== 'undefined' ? window : globalThis);
