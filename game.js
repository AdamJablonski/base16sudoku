/* game.js — p5.js front end for Mine Sudoku 16 (base-16 sudoku with mines). */
(function () {
  'use strict';
  const S = window.Sudoku16;
  const HEX = S.SYMBOLS;
  const MAX_LIVES = 3;

  const $ = id => document.getElementById(id);
  const ui = {
    difficulty: $('difficulty'), newGame: $('newGame'), hint: $('hint'), notes: $('notes'),
    lives: $('lives'), timer: $('timer'), stats: $('stats'), message: $('message'),
    keypad: $('keypad'), seed: $('seed'),
  };

  // ---- Game state ----------------------------------------------------------

  const G = {
    state: 'loading',          // loading | playing | won | lost
    puzzle: null, solution: null, grid: null, given: null,
    notes: new Uint16Array(256),   // pencil marks (bitmask per cell)
    mines: new Uint16Array(256),   // digits that exploded in each cell
    lives: MAX_LIVES, mistakes: 0, hintsUsed: 0,
    selected: -1, notesMode: false, hint: null,
    startMs: 0, endMs: 0, seed: 0, difficulty: 'medium',
  };

  // Visual effects
  const fx = { particles: [], blasts: [], shake: 0, flash: 0, flashColor: [255, 120, 40] };

  // ---- Setup / new game ----------------------------------------------------

  function newGame(seed) {
    G.state = 'loading';
    G.difficulty = ui.difficulty.value;
    setMessage('Laying mines… (generating a puzzle with a single, verified solution)');
    // Let the browser paint the message before the (synchronous) generator runs.
    setTimeout(() => {
      const p = S.generate({ difficulty: G.difficulty, seed });
      G.puzzle = p.puzzle; G.solution = p.solution; G.seed = p.seed;
      G.grid = p.puzzle.slice();
      G.given = p.puzzle.map(v => v >= 0);
      G.notes.fill(0); G.mines.fill(0);
      G.lives = MAX_LIVES; G.mistakes = 0; G.hintsUsed = 0;
      G.selected = -1; G.hint = null; G.notesMode = false;
      G.startMs = Date.now(); G.endMs = 0;
      fx.particles.length = 0; fx.blasts.length = 0;
      G.state = 'playing';
      ui.seed.textContent = 'Puzzle #' + G.seed + ' (' + p.givens + ' givens).';
      try {
        const url = new URL(location.href);
        url.searchParams.set('seed', G.seed); url.searchParams.set('d', G.difficulty);
        history.replaceState(null, '', url);
      } catch (e) { /* file:// or sandboxed — ignore */ }
      setMessage('Tread carefully. ' + (256 - p.givens) + ' cells, each hiding 15 mines.');
      refreshUI();
    }, 30);
  }

  function setMessage(html, cls) {
    ui.message.innerHTML = html;
    ui.message.className = cls || '';
  }

  // ---- Actions -------------------------------------------------------------

  function canEdit(i) { return G.state === 'playing' && i >= 0 && !G.given[i] && G.grid[i] < 0; }

  function enterDigit(d, asNote) {
    const i = G.selected;
    if (!canEdit(i)) return;
    const bit = 1 << d;
    if (asNote || G.notesMode) {
      if (G.mines[i] & bit) return; // known mine, no point noting it
      G.notes[i] ^= bit;
      refreshUI();
      return;
    }
    if (G.solution[i] === d) {
      G.grid[i] = d;
      G.notes[i] = 0;
      for (const p of S.PEERS[i]) G.notes[p] &= ~bit;
      if (G.hint && G.hint.cell === i) G.hint = null;
      sparkle(i);
      if (!G.grid.includes(-1)) win();
      else if (G.grid.filter(v => v === d).length === 16) setMessage('All sixteen ' + HEX[d] + 's defused.', 'ok');
    } else {
      explode(i, d);
    }
    refreshUI();
  }

  function clearNotes() {
    const i = G.selected;
    if (canEdit(i)) { G.notes[i] = 0; refreshUI(); }
  }

  function explode(i, d) {
    G.mines[i] |= 1 << d;
    G.notes[i] &= ~(1 << d);
    G.lives--; G.mistakes++;
    if (G.hint && G.hint.cell !== i) G.hint = null;
    const { x, y } = cellCenter(i);
    fx.blasts.push({ cell: i, digit: d, t: 0 });
    for (let k = 0; k < 90; k++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 9;
      const hot = Math.random();
      fx.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, life: 1,
        decay: 0.012 + Math.random() * 0.03, size: 3 + Math.random() * 7,
        col: hot < 0.25 ? [255, 240, 160] : hot < 0.6 ? [255, 150, 30] : hot < 0.85 ? [220, 50, 30] : [90, 90, 90],
        grav: 0.15,
      });
    }
    fx.shake = 18; fx.flash = 1; fx.flashColor = [255, 120, 40];
    boomSound();
    if (G.lives <= 0) {
      lose(i, d);
    } else {
      setMessage('💥 BOOM! ' + HEX[d] + ' was a mine at ' + S.cellName(i) + '. ' +
        G.lives + ' ' + (G.lives === 1 ? 'life' : 'lives') + ' left.', 'danger');
    }
  }

  function showHint() {
    if (G.state !== 'playing') return;
    // Second press on an active hint fills it in.
    if (G.hint && G.grid[G.hint.cell] < 0) {
      G.selected = G.hint.cell;
      const nm = G.notesMode; G.notesMode = false;
      enterDigit(G.hint.digit);
      G.notesMode = nm;
      return;
    }
    const h = S.getHint(G.grid, G.solution);
    if (!h) return;
    G.hint = h; G.hintsUsed++;
    G.selected = h.cell;
    let html = '💡 ' + h.text;
    if (h.reasons.length) {
      html += '<small>First: ' + h.reasons.slice(0, 3).join(' Then: ') +
        (h.reasons.length > 3 ? ' (+' + (h.reasons.length - 3) + ' more eliminations)' : '') + '</small>';
    }
    html += '<small>Press Hint again to place it.</small>';
    setMessage(html, 'hint');
    refreshUI();
  }

  function win() {
    G.state = 'won'; G.endMs = Date.now(); G.hint = null;
    setMessage('🏆 Field cleared in ' + fmtTime(G.endMs - G.startMs) + ' with ' + G.mistakes +
      ' explosion' + (G.mistakes === 1 ? '' : 's') + ' and ' + G.hintsUsed + ' hint' + (G.hintsUsed === 1 ? '' : 's') + '.', 'ok');
    for (let k = 0; k < 8; k++) setTimeout(() => {
      const x = Math.random() * boardSize, y = Math.random() * boardSize * 0.7;
      for (let j = 0; j < 60; j++) {
        const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 5;
        fx.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: 0.012,
          size: 4, col: [[70, 200, 110], [250, 200, 60], [90, 160, 250]][j % 3], grav: 0.06 });
      }
    }, k * 250);
  }

  function lose(i, d) {
    G.state = 'lost'; G.endMs = Date.now(); G.hint = null;
    setMessage('☠️ ' + HEX[d] + ' at ' + S.cellName(i) + ' was your last mistake. The solution is shown in red.', 'danger');
    fx.shake = 30;
  }

  // ---- Sound ---------------------------------------------------------------

  let actx = null;
  function boomSound() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const dur = 0.9, sr = actx.sampleRate, buf = actx.createBuffer(1, dur * sr, sr), data = buf.getChannelData(0);
      for (let k = 0; k < data.length; k++) data[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / data.length, 2.5);
      const src = actx.createBufferSource(); src.buffer = buf;
      const lp = actx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2200, actx.currentTime);
      lp.frequency.exponentialRampToValueAtTime(120, actx.currentTime + dur);
      const gain = actx.createGain(); gain.gain.value = 0.9;
      src.connect(lp).connect(gain).connect(actx.destination);
      src.start();
    } catch (e) { /* audio unavailable */ }
  }

  // ---- UI (HTML) -----------------------------------------------------------

  const keyButtons = [];
  function buildKeypad() {
    for (let d = 0; d < 16; d++) {
      const b = document.createElement('button');
      b.innerHTML = HEX[d] + '<span class="left"></span>';
      b.addEventListener('click', () => enterDigit(d));
      ui.keypad.appendChild(b);
      keyButtons.push(b);
    }
    const notes = document.createElement('button');
    notes.className = 'wide'; notes.textContent = 'Toggle notes';
    notes.addEventListener('click', toggleNotes);
    const erase = document.createElement('button');
    erase.className = 'wide'; erase.textContent = 'Clear notes';
    erase.addEventListener('click', clearNotes);
    ui.keypad.append(notes, erase);
  }

  function toggleNotes() { G.notesMode = !G.notesMode; refreshUI(); }

  function refreshUI() {
    ui.lives.textContent = '❤️'.repeat(Math.max(0, G.lives)) + '🖤'.repeat(MAX_LIVES - Math.max(0, G.lives));
    ui.notes.textContent = 'Notes: ' + (G.notesMode ? 'on' : 'off');
    ui.notes.classList.toggle('active', G.notesMode);
    if (G.grid) {
      const left = G.grid.filter(v => v < 0).length;
      ui.stats.textContent = left + ' left · ' + G.mistakes + ' 💥 · ' + G.hintsUsed + ' 💡';
      for (let d = 0; d < 16; d++) {
        const placed = G.grid.filter(v => v === d).length;
        keyButtons[d].querySelector('.left').textContent = 16 - placed || '';
        keyButtons[d].disabled = placed === 16;
      }
    }
    ui.hint.disabled = G.state !== 'playing';
  }

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  ui.newGame.addEventListener('click', () => newGame());
  ui.hint.addEventListener('click', showHint);
  ui.notes.addEventListener('click', toggleNotes);
  ui.difficulty.addEventListener('change', () => newGame());

  document.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const d = HEX.indexOf(k.toUpperCase());
    if (k.length === 1 && d >= 0) { enterDigit(d, e.shiftKey); e.preventDefault(); return; }
    // Shift+digit on some layouts yields symbols; map via e.code.
    const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
    if (m && e.shiftKey) { enterDigit(+m[1], true); e.preventDefault(); return; }
    const sel = G.selected < 0 ? 0 : G.selected;
    const r = Math.floor(sel / 16), c = sel % 16;
    switch (k) {
      case 'ArrowUp': G.selected = ((r + 15) % 16) * 16 + c; break;
      case 'ArrowDown': G.selected = ((r + 1) % 16) * 16 + c; break;
      case 'ArrowLeft': G.selected = r * 16 + (c + 15) % 16; break;
      case 'ArrowRight': G.selected = r * 16 + (c + 1) % 16; break;
      case ' ': case 'n': case 'N': toggleNotes(); break;
      case 'h': case 'H': showHint(); break;
      case 'Backspace': case 'Delete': clearNotes(); break;
      case 'Escape': G.selected = -1; break;
      default: return;
    }
    e.preventDefault();
  });

  // ---- Rendering (p5, instance mode) --------------------------------------

  let boardSize = 640;
  function cellCenter(i) {
    const cs = boardSize / 16;
    return { x: (i % 16 + 0.5) * cs, y: (Math.floor(i / 16) + 0.5) * cs };
  }

  function sparkle(i) {
    const { x, y } = cellCenter(i);
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, sp = 0.5 + Math.random() * 2;
      fx.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: 0.05,
        size: 3, col: [70, 170, 250], grav: 0 });
    }
  }

  const sketch = p => {
    function fitSize() {
      const host = $('board');
      const w = Math.min(host.clientWidth || 640, 720);
      const h = Math.max(320, window.innerHeight - 250);
      return Math.floor(Math.min(w, h) / 16) * 16;
    }

    p.setup = () => {
      boardSize = fitSize();
      p.createCanvas(boardSize, boardSize).parent('board');
      p.textAlign(p.CENTER, p.CENTER);
      p.textFont('monospace');
    };

    p.windowResized = () => { boardSize = fitSize(); p.resizeCanvas(boardSize, boardSize); };

    p.mousePressed = () => {
      if (p.mouseX < 0 || p.mouseY < 0 || p.mouseX >= boardSize || p.mouseY >= boardSize) return;
      const cs = boardSize / 16;
      G.selected = Math.floor(p.mouseY / cs) * 16 + Math.floor(p.mouseX / cs);
    };

    function drawMine(x, y, r, alpha) {
      p.push();
      p.stroke(20, alpha); p.strokeWeight(r * 0.18);
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        p.line(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      p.noStroke(); p.fill(20, alpha); p.circle(x, y, r * 1.4);
      p.fill(230, 60, 50, alpha); p.circle(x - r * 0.2, y - r * 0.2, r * 0.35);
      p.pop();
    }

    p.draw = () => {
      const cs = boardSize / 16;
      p.background(27, 29, 35);
      if (!G.grid) { p.fill(150); p.textSize(18); p.text('Generating…', boardSize / 2, boardSize / 2); return; }

      p.push();
      if (fx.shake > 0.5) { p.translate(p.random(-fx.shake, fx.shake), p.random(-fx.shake, fx.shake)); fx.shake *= 0.88; }

      // Paper
      p.noStroke(); p.fill(246, 243, 235); p.rect(0, 0, boardSize, boardSize);

      const sel = G.selected;
      const selVal = sel >= 0 ? G.grid[sel] : -1;
      const pulse = 0.5 + 0.5 * Math.sin(p.millis() / 180);

      for (let i = 0; i < 256; i++) {
        const r = Math.floor(i / 16), c = i % 16, x = c * cs, y = r * cs;
        // Background tints
        if (sel >= 0 && (S.ROW[i] === S.ROW[sel] || S.COL[i] === S.COL[sel] || S.BOXOF[i] === S.BOXOF[sel])) {
          p.fill(225, 232, 245); p.rect(x, y, cs, cs);
        }
        if (G.hint && G.hint.unit != null && S.UNITS[G.hint.unit].includes(i)) {
          p.fill(255, 226, 150, 150); p.rect(x, y, cs, cs);
        }
        if (selVal >= 0 && G.grid[i] === selVal) { p.fill(190, 210, 245); p.rect(x, y, cs, cs); }
        if (i === sel) { p.fill(160, 190, 240); p.rect(x, y, cs, cs); }

        // Scorch marks where mines went off
        if (G.mines[i] && G.grid[i] < 0) {
          p.fill(60, 40, 30, 40); p.circle(x + cs / 2, y + cs / 2, cs * 0.95);
          p.fill(60, 40, 30, 40); p.circle(x + cs / 2, y + cs / 2, cs * 0.6);
        }

        const v = G.grid[i];
        if (v >= 0) {
          if (G.given[i]) { p.fill(25); p.textStyle(p.BOLD); } else { p.fill(30, 90, 200); p.textStyle(p.NORMAL); }
          p.textSize(cs * 0.58);
          p.text(HEX[v], x + cs / 2, y + cs / 2 + 1);
        } else if (G.state === 'lost') {
          p.fill(215, 60, 60, 170); p.textStyle(p.NORMAL); p.textSize(cs * 0.55);
          p.text(HEX[G.solution[i]], x + cs / 2, y + cs / 2 + 1);
        } else {
          // Notes (grey) and known mines (red, struck through) in a 4x4 mini grid
          const m = G.notes[i] | G.mines[i];
          if (m) {
            p.textStyle(p.NORMAL); p.textSize(cs * 0.2);
            for (let d = 0; d < 16; d++) {
              if (!(m & (1 << d))) continue;
              const nx = x + (d % 4 + 0.5) * cs / 4, ny = y + (Math.floor(d / 4) + 0.5) * cs / 4;
              if (G.mines[i] & (1 << d)) {
                p.fill(210, 50, 40); p.text(HEX[d], nx, ny);
                p.stroke(210, 50, 40); p.strokeWeight(1); p.line(nx - cs / 12, ny + cs / 14, nx + cs / 12, ny - cs / 14); p.noStroke();
              } else { p.fill(110); p.text(HEX[d], nx, ny); }
            }
          }
        }
      }

      // Hint target
      if (G.hint && G.grid[G.hint.cell] < 0) {
        const x = (G.hint.cell % 16) * cs, y = Math.floor(G.hint.cell / 16) * cs;
        p.noFill(); p.stroke(240, 160, 30, 150 + 105 * pulse); p.strokeWeight(3);
        p.rect(x + 2, y + 2, cs - 4, cs - 4, 4);
        p.noStroke(); p.fill(200, 120, 0, 110 + 80 * pulse); p.textSize(cs * 0.5); p.textStyle(p.BOLD);
        p.text(HEX[G.hint.digit], x + cs / 2, y + cs / 2 + 1);
      }

      // Grid lines
      for (let k = 0; k <= 16; k++) {
        const thick = k % 4 === 0;
        p.stroke(thick ? 40 : 185); p.strokeWeight(thick ? 2.5 : 1);
        p.line(k * cs, 0, k * cs, boardSize); p.line(0, k * cs, boardSize, k * cs);
      }

      // Mines revealed at the moment of explosion
      for (let k = fx.blasts.length - 1; k >= 0; k--) {
        const b = fx.blasts[k]; b.t += 1;
        const { x, y } = cellCenter(b.cell);
        const a = b.t < 40 ? 255 : Math.max(0, 255 - (b.t - 40) * 8);
        drawMine(x, y, cs * 0.4 * Math.min(1, b.t / 6), a);
        p.noFill(); p.stroke(255, 140, 40, Math.max(0, 255 - b.t * 6)); p.strokeWeight(4);
        p.circle(x, y, b.t * cs * 0.35);
        if (a <= 0) fx.blasts.splice(k, 1);
      }

      // Particles
      p.noStroke();
      for (let k = fx.particles.length - 1; k >= 0; k--) {
        const q = fx.particles[k];
        q.x += q.vx; q.y += q.vy; q.vy += q.grav; q.vx *= 0.97; q.vy *= 0.97; q.life -= q.decay;
        if (q.life <= 0) { fx.particles.splice(k, 1); continue; }
        p.fill(q.col[0], q.col[1], q.col[2], 255 * q.life);
        p.circle(q.x, q.y, q.size * (0.5 + q.life));
      }
      p.pop();

      // Flash
      if (fx.flash > 0.02) {
        p.noStroke(); p.fill(fx.flashColor[0], fx.flashColor[1], fx.flashColor[2], 140 * fx.flash);
        p.rect(0, 0, boardSize, boardSize); fx.flash *= 0.85;
      }
      if (G.state === 'lost') { p.fill(40, 0, 0, 40); p.rect(0, 0, boardSize, boardSize); }

      // Timer
      if (G.state !== 'loading') ui.timer.textContent = fmtTime((G.endMs || Date.now()) - G.startMs);
    };
  };

  // ---- Boot ----------------------------------------------------------------

  buildKeypad();
  new p5(sketch);
  const params = new URLSearchParams(location.search);
  if (S.DIFFICULTIES[params.get('d')]) ui.difficulty.value = params.get('d');
  const seedParam = params.get('seed');
  newGame(seedParam && /^\d+$/.test(seedParam) ? +seedParam : undefined);
})();
