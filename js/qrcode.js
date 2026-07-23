/**
 * qrcode.js
 *
 * Vollstaendig lokaler QR-Code-Generator (Byte-Modus, EC-Level M, Versionen
 * 1-10) -- KEINE externe Library, KEIN CDN, KEIN Netzwerk. Der Encoder ist
 * rein funktional (toModules) und daher unter Node testbar; renderToCanvas /
 * toSvgString sind duenne Ausgabe-Helfer fuer den Browser bzw. den
 * druckbaren Chargen-Pass.
 *
 * Algorithmus nach ISO/IEC 18004: Reed-Solomon ueber GF(256) (Primitiv
 * 0x11D), Block-Interleaving, Maskenwahl per Penalty-Score, BCH-Format-/
 * Versionsinformation. Implementierung in Anlehnung an das oeffentlich
 * dokumentierte Referenzverfahren (Nayuki), hier eigenstaendig und offline.
 */
(function (global) {
  'use strict';

  // EC-Codewords pro Block, Index [Level][Version] (Version 1-10).
  var ECC_CODEWORDS_PER_BLOCK = {
    L: [null, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
    M: [null, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
  };
  // Anzahl EC-Bloecke, Index [Level][Version].
  var NUM_EC_BLOCKS = {
    L: [null, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
    M: [null, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
  };
  var MAX_VERSION = 10;

  // ---------------------------------------------------------------------
  // GF(256) / Reed-Solomon
  // ---------------------------------------------------------------------
  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  function rsComputeDivisor(degree) {
    var result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < result.length; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < result.length) {
          result[j] ^= result[j + 1];
        }
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  function rsComputeRemainder(data, divisor) {
    var result = new Array(divisor.length).fill(0);
    data.forEach(function (b) {
      var factor = b ^ result[0];
      result.shift();
      result.push(0);
      for (var i = 0; i < result.length; i++) {
        result[i] ^= gfMul(divisor[i], factor);
      }
    });
    return result;
  }

  // ---------------------------------------------------------------------
  // Kapazitaets-Berechnung
  // ---------------------------------------------------------------------
  function getNumRawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) {
        result -= 36;
      }
    }
    return result;
  }

  function getNumDataCodewords(ver, level) {
    return (
      Math.floor(getNumRawDataModules(ver) / 8) -
      ECC_CODEWORDS_PER_BLOCK[level][ver] * NUM_EC_BLOCKS[level][ver]
    );
  }

  // ---------------------------------------------------------------------
  // Bit-/Byte-Aufbereitung
  // ---------------------------------------------------------------------
  function toUtf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  function appendBits(value, len, bb) {
    for (var i = len - 1; i >= 0; i--) {
      bb.push((value >>> i) & 1);
    }
  }

  function chooseVersion(dataLen, level) {
    for (var ver = 1; ver <= MAX_VERSION; ver++) {
      var capacityBits = getNumDataCodewords(ver, level) * 8;
      var charCountBits = ver < 10 ? 8 : 16;
      var usedBits = 4 + charCountBits + dataLen * 8;
      if (usedBits <= capacityBits) {
        return ver;
      }
    }
    throw new Error('QR: Nutzdaten zu lang fuer Version 1-10 (Byte-Modus).');
  }

  function buildDataCodewords(bytes, ver, level) {
    var bb = [];
    var charCountBits = ver < 10 ? 8 : 16;
    appendBits(0x4, 4, bb); // Modus: Byte
    appendBits(bytes.length, charCountBits, bb);
    bytes.forEach(function (b) {
      appendBits(b, 8, bb);
    });

    var capacityBits = getNumDataCodewords(ver, level) * 8;
    // Terminator (max 4 Nullbits).
    appendBits(0, Math.min(4, capacityBits - bb.length), bb);
    // Auf Byte-Grenze auffuellen.
    appendBits(0, (8 - (bb.length % 8)) % 8, bb);
    // Pad-Bytes 0xEC / 0x11 im Wechsel.
    for (var pad = 0xec; bb.length < capacityBits; pad ^= 0xec ^ 0x11) {
      appendBits(pad, 8, bb);
    }

    var codewords = new Array(bb.length / 8).fill(0);
    bb.forEach(function (bit, i) {
      codewords[i >>> 3] |= bit << (7 - (i & 7));
    });
    return codewords;
  }

  function addEccAndInterleave(data, ver, level) {
    var numBlocks = NUM_EC_BLOCKS[level][ver];
    var blockEccLen = ECC_CODEWORDS_PER_BLOCK[level][ver];
    var rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);

    var blocks = [];
    var rsDiv = rsComputeDivisor(blockEccLen);
    var k = 0;
    for (var i = 0; i < numBlocks; i++) {
      var datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      var dat = data.slice(k, k + datLen);
      k += dat.length;
      var ecc = rsComputeRemainder(dat, rsDiv);
      if (i < numShortBlocks) {
        dat.push(0);
      }
      blocks.push(dat.concat(ecc));
    }

    var result = [];
    for (var col = 0; col < blocks[0].length; col++) {
      for (var b = 0; b < blocks.length; b++) {
        // Das eingefuegte Fuell-Byte der kurzen Bloecke ueberspringen.
        if (col !== shortBlockLen - blockEccLen || b >= numShortBlocks) {
          result.push(blocks[b][col]);
        }
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------
  // Matrix-Aufbau
  // ---------------------------------------------------------------------
  function alignmentPositions(ver) {
    if (ver === 1) {
      return [];
    }
    var numAlign = Math.floor(ver / 7) + 2;
    var size = ver * 4 + 17;
    var step = Math.ceil((size - 13) / (2 * numAlign - 2)) * 2;
    var positions = [6];
    for (var pos = size - 7; positions.length < numAlign; pos -= step) {
      positions.splice(1, 0, pos);
    }
    return positions;
  }

  function getBit(x, i) {
    return (x >>> i) & 1;
  }

  function makeMatrix(ver, dataCodewords, level) {
    var size = ver * 4 + 17;
    var modules = [];
    var isFunction = [];
    var y;
    for (y = 0; y < size; y++) {
      modules.push(new Array(size).fill(0));
      isFunction.push(new Array(size).fill(false));
    }

    function setFn(x, yy, val) {
      modules[yy][x] = val ? 1 : 0;
      isFunction[yy][x] = true;
    }

    function drawFinder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var xx = cx + dx;
          var yy = cy + dy;
          if (xx < 0 || xx >= size || yy < 0 || yy >= size) {
            continue;
          }
          var dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFn(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }

    // Timing-Muster.
    for (var t = 0; t < size; t++) {
      setFn(6, t, t % 2 === 0);
      setFn(t, 6, t % 2 === 0);
    }
    // Finder + Separatoren (Separatoren = 0, durch drawFinder-Rand abgedeckt).
    drawFinder(3, 3);
    drawFinder(size - 4, 3);
    drawFinder(3, size - 4);

    // Alignment-Muster.
    var align = alignmentPositions(ver);
    for (var ai = 0; ai < align.length; ai++) {
      for (var aj = 0; aj < align.length; aj++) {
        // Ecken mit Findern ueberspringen.
        if (
          (ai === 0 && aj === 0) ||
          (ai === 0 && aj === align.length - 1) ||
          (ai === align.length - 1 && aj === 0)
        ) {
          continue;
        }
        var cx = align[ai];
        var cy = align[aj];
        for (var ady = -2; ady <= 2; ady++) {
          for (var adx = -2; adx <= 2; adx++) {
            setFn(cx + adx, cy + ady, Math.max(Math.abs(adx), Math.abs(ady)) !== 1);
          }
        }
      }
    }

    // Dunkles Modul + reservierte Bereiche fuer Format-/Versionsinfo.
    setFn(8, size - 8, true);
    reserveInfoAreas(size, setFn, ver);

    // Daten platzieren (Zickzack von rechts).
    placeData(modules, isFunction, size, dataCodewords);

    // Beste Maske waehlen.
    var bestMask = 0;
    var bestPenalty = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      applyMask(modules, isFunction, size, mask);
      drawFormatBits(modules, isFunction, size, level, mask);
      var penalty = penaltyScore(modules, size);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestMask = mask;
      }
      applyMask(modules, isFunction, size, mask); // rueckgaengig (XOR)
    }
    applyMask(modules, isFunction, size, bestMask);
    drawFormatBits(modules, isFunction, size, level, bestMask);
    if (ver >= 7) {
      drawVersionBits(modules, size, ver);
    }

    return { size: size, modules: modules, version: ver, mask: bestMask };
  }

  function reserveInfoAreas(size, setFn, ver) {
    // Format-Info-Bereiche (nur reservieren; Werte spaeter).
    var i;
    for (i = 0; i <= 5; i++) {
      setFn(8, i, false);
    }
    setFn(8, 7, false);
    setFn(8, 8, false);
    setFn(7, 8, false);
    for (i = 9; i < 15; i++) {
      setFn(14 - i, 8, false);
    }
    for (i = 0; i < 8; i++) {
      setFn(size - 1 - i, 8, false);
    }
    for (i = 8; i < 15; i++) {
      setFn(8, size - 15 + i, false);
    }
    // Versionsinfo-Bereiche.
    if (ver >= 7) {
      for (i = 0; i < 18; i++) {
        var a = size - 11 + (i % 3);
        var b = Math.floor(i / 3);
        setFn(a, b, false);
        setFn(b, a, false);
      }
    }
  }

  function placeData(modules, isFunction, size, data) {
    var i = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) {
        right = 5;
      }
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var yy = upward ? size - 1 - vert : vert;
          if (!isFunction[yy][x] && i < data.length * 8) {
            modules[yy][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  function maskCondition(mask, y, x) {
    switch (mask) {
      case 0:
        return (x + y) % 2 === 0;
      case 1:
        return y % 2 === 0;
      case 2:
        return x % 3 === 0;
      case 3:
        return (x + y) % 3 === 0;
      case 4:
        return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5:
        return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6:
        return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7:
        return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      default:
        return false;
    }
  }

  function applyMask(modules, isFunction, size, mask) {
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (!isFunction[y][x] && maskCondition(mask, y, x)) {
          modules[y][x] ^= 1;
        }
      }
    }
  }

  function drawFormatBits(modules, isFunction, size, level, mask) {
    var formatBits = level === 'L' ? 1 : 0; // L=1, M=0
    var data = (formatBits << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) {
      rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    }
    var bits = ((data << 10) | rem) ^ 0x5412;

    function set(x, y, bit) {
      modules[y][x] = bit;
      isFunction[y][x] = true;
    }
    for (i = 0; i <= 5; i++) {
      set(8, i, getBit(bits, i));
    }
    set(8, 7, getBit(bits, 6));
    set(8, 8, getBit(bits, 7));
    set(7, 8, getBit(bits, 8));
    for (i = 9; i < 15; i++) {
      set(14 - i, 8, getBit(bits, i));
    }
    for (i = 0; i < 8; i++) {
      set(size - 1 - i, 8, getBit(bits, i));
    }
    for (i = 8; i < 15; i++) {
      set(8, size - 15 + i, getBit(bits, i));
    }
    set(8, size - 8, 1); // dunkles Modul
  }

  function drawVersionBits(modules, size, ver) {
    var rem = ver;
    for (var i = 0; i < 12; i++) {
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    }
    var bits = (ver << 12) | rem;
    for (i = 0; i < 18; i++) {
      var bit = getBit(bits, i);
      var a = size - 11 + (i % 3);
      var b = Math.floor(i / 3);
      modules[b][a] = bit;
      modules[a][b] = bit;
    }
  }

  // Penalty-Bewertung (vereinfachte, standardkonforme Regeln 1-4).
  function penaltyScore(modules, size) {
    var score = 0;
    var x;
    var y;
    // Regel 1: Reihen/Spalten mit >=5 gleichen Modulen.
    for (y = 0; y < size; y++) {
      var runColor = -1;
      var runLen = 0;
      for (x = 0; x < size; x++) {
        if (modules[y][x] === runColor) {
          runLen++;
          if (runLen === 5) score += 3;
          else if (runLen > 5) score += 1;
        } else {
          runColor = modules[y][x];
          runLen = 1;
        }
      }
    }
    for (x = 0; x < size; x++) {
      var rc = -1;
      var rl = 0;
      for (y = 0; y < size; y++) {
        if (modules[y][x] === rc) {
          rl++;
          if (rl === 5) score += 3;
          else if (rl > 5) score += 1;
        } else {
          rc = modules[y][x];
          rl = 1;
        }
      }
    }
    // Regel 2: 2x2-Bloecke gleicher Farbe.
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
          score += 3;
        }
      }
    }
    // Regel 4: Abweichung vom 50%-Dunkelanteil.
    var dark = 0;
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) {
        if (modules[y][x]) dark++;
      }
    }
    var total = size * size;
    var ratio = (dark * 100) / total;
    var k = Math.floor(Math.abs(ratio - 50) / 5);
    score += k * 10;
    return score;
  }

  // ---------------------------------------------------------------------
  // Oeffentliche API
  // ---------------------------------------------------------------------
  /**
   * Erzeugt die QR-Modulmatrix fuer einen Text. Rueckgabe:
   * { size, version, mask, modules } mit modules[y][x] in {0,1}.
   */
  function toModules(text, opts) {
    opts = opts || {};
    var level = opts.level === 'L' ? 'L' : 'M';
    var bytes = toUtf8Bytes(String(text === undefined || text === null ? '' : text));
    var ver = chooseVersion(bytes.length, level);
    var dataCodewords = buildDataCodewords(bytes, ver, level);
    var allCodewords = addEccAndInterleave(dataCodewords, ver, level);
    return makeMatrix(ver, allCodewords, level);
  }

  /**
   * Zeichnet den QR-Code auf ein Canvas-Element (Browser).
   */
  function renderToCanvas(canvas, text, opts) {
    opts = opts || {};
    var qr = toModules(text, opts);
    var scale = opts.scale || 4;
    var border = opts.border === undefined ? 4 : opts.border;
    var dim = (qr.size + border * 2) * scale;
    canvas.width = dim;
    canvas.height = dim;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = '#000000';
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) {
          ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
        }
      }
    }
    return qr;
  }

  /**
   * Baut einen SVG-String (fuer den druckbaren Chargen-Pass, ohne Canvas).
   */
  function toSvgString(text, opts) {
    opts = opts || {};
    var qr = toModules(text, opts);
    var border = opts.border === undefined ? 4 : opts.border;
    var dim = qr.size + border * 2;
    var parts = [];
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) {
          parts.push('M' + (x + border) + ',' + (y + border) + 'h1v1h-1z');
        }
      }
    }
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
      dim +
      ' ' +
      dim +
      '" shape-rendering="crispEdges" role="img" aria-label="QR">' +
      '<rect width="' +
      dim +
      '" height="' +
      dim +
      '" fill="#ffffff"/>' +
      '<path d="' +
      parts.join('') +
      '" fill="#000000"/></svg>'
    );
  }

  var TraceQR = {
    toModules: toModules,
    renderToCanvas: renderToCanvas,
    toSvgString: toSvgString,
    MAX_VERSION: MAX_VERSION
  };

  global.TraceQR = TraceQR;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TraceQR;
  }
})(typeof window !== 'undefined' ? window : globalThis);
