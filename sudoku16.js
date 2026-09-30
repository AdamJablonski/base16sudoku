/*
 * sudoku16.js — engine for 16x16 (base-16) Sudoku.
 *
 * Digits are stored internally as 0..15 and displayed as 0-9, A-F.
 * Empty cells are -1. Cell index i = row * 16 + col.
 *
 * Provides:
 *   - a fast bitmask backtracking solver (MRV + naked/hidden single pruning)
 *     that can count solutions (used to prove uniqueness)
 *   - a human-style logic solver (singles, locked candidates, naked pairs)
 *     used both to grade puzzles and to produce explainable hints
 *   - a puzzle generator that only ever emits puzzles with exactly one solution
 *
 * Works in the browser (window.Sudoku16) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sudoku16 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const N = 16;
  const BOX = 4;
  const CELLS = N * N;
  const FULL = 0xffff;
  const SYMBOLS = '0123456789ABCDEF';

  // ---- Static geometry -----------------------------------------------------

  const ROW = new Uint8Array(CELLS);
  const COL = new Uint8Array(CELLS);
  const BOXOF = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    ROW[i] = (i / N) | 0;
    COL[i] = i % N;
    BOXOF[i] = ((ROW[i] / BOX) | 0) * BOX + ((COL[i] / BOX) | 0);
  }

  // UNITS[0..15] rows, [16..31] cols, [32..47] boxes
  const UNITS = [];
  for (let r = 0; r < N; r++) UNITS.push(Array.from({ length: N }, (_, c) => r * N + c));
  for (let c = 0; c < N; c++) UNITS.push(Array.from({ length: N }, (_, r) => r * N + c));
  for (let b = 0; b < N; b++) {
    const r0 = ((b / BOX) | 0) * BOX, c0 = (b % BOX) * BOX;
    const cells = [];
    for (let dr = 0; dr < BOX; dr++) for (let dc = 0; dc < BOX; dc++) cells.push((r0 + dr) * N + c0 + dc);
    UNITS.push(cells);
  }

  const PEERS = [];
  for (let i = 0; i < CELLS; i++) {
    const s = new Set([...UNITS[ROW[i]], ...UNITS[16 + COL[i]], ...UNITS[32 + BOXOF[i]]]);
    s.delete(i);
    PEERS.push(Int16Array.from(s));
  }

  const POP = new Uint8Array(1 << 16);
  for (let m = 1; m < POP.length; m++) POP[m] = POP[m >> 1] + (m & 1);

  function bitIndex(m) { return 31 - Math.clz32(m & -m); } // lowest set bit
  function bitsOf(m) { const out = []; while (m) { const b = m & -m; out.push(31 - Math.clz32(b)); m ^= b; } return out; }

  function unitName(u) {
    if (u < 16) return 'row ' + (u + 1);
    if (u < 32) return 'column ' + (u - 15);
    return 'box ' + (u - 31);
  }
  function cellName(i) { return 'R' + (ROW[i] + 1) + 'C' + (COL[i] + 1); }
  function sym(d) { return SYMBOLS[d]; }

  // ---- RNG -----------------------------------------------------------------

  function makeRng(seed) {
    let a = seed >>> 0;
    return function () { // mulberry32
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---- Backtracking solver / solution counter ------------------------------

  /**
   * Counts solutions of `grid` up to `limit`.
   * opts: { limit = 2, maxNodes = Infinity, rng = null (randomise branch order) }
   * Returns { count, solution, aborted, nodes }.
   * If aborted is true the count is a lower bound only.
   */
  function countSolutions(grid, opts) {
    opts = opts || {};
    const limit = opts.limit || 2;
    const maxNodes = opts.maxNodes || Infinity;
    const rng = opts.rng || null;

    const g = Int8Array.from(grid);
    const rm = new Uint16Array(N), cm = new Uint16Array(N), bm = new Uint16Array(N);
    for (let i = 0; i < CELLS; i++) {
      const v = g[i];
      if (v < 0) continue;
      const bit = 1 << v;
      if ((rm[ROW[i]] | cm[COL[i]] | bm[BOXOF[i]]) & bit) return { count: 0, solution: null, aborted: false, nodes: 0 };
      rm[ROW[i]] |= bit; cm[COL[i]] |= bit; bm[BOXOF[i]] |= bit;
    }

    let count = 0, nodes = 0, aborted = false, solution = null;
    const cand = new Uint16Array(CELLS);

    function place(i, v) { const b = 1 << v; g[i] = v; rm[ROW[i]] |= b; cm[COL[i]] |= b; bm[BOXOF[i]] |= b; }
    function unplace(i, v) { const b = ~(1 << v); g[i] = -1; rm[ROW[i]] &= b; cm[COL[i]] &= b; bm[BOXOF[i]] &= b; }

    function rec() {
      if (++nodes > maxNodes) { aborted = true; return true; }

      // Pick the most constrained cell (MRV).
      let bestCell = -1, bestN = 17, empties = 0;
      for (let i = 0; i < CELLS; i++) {
        if (g[i] >= 0) { cand[i] = 0; continue; }
        empties++;
        const m = FULL & ~(rm[ROW[i]] | cm[COL[i]] | bm[BOXOF[i]]);
        cand[i] = m;
        const n = POP[m];
        if (n === 0) return false;
        if (n < bestN) { bestN = n; bestCell = i; }
      }
      if (empties === 0) {
        count++;
        if (!solution) solution = Array.from(g);
        return count >= limit;
      }

      // Hidden singles / dead digits in units (only needed if no naked single).
      let hsCell = -1, hsDigit = -1;
      if (bestN > 1) {
        for (let u = 0; u < 48 && hsCell < 0; u++) {
          const cells = UNITS[u];
          const used = u < 16 ? rm[u] : u < 32 ? cm[u - 16] : bm[u - 32];
          let once = 0, twice = 0;
          for (let k = 0; k < N; k++) { const m = cand[cells[k]]; twice |= once & m; once |= m; }
          if ((once | used) !== FULL) return false; // some digit has nowhere to go
          const single = once & ~twice;
          if (single) {
            hsDigit = bitIndex(single);
            const bit = 1 << hsDigit;
            for (let k = 0; k < N; k++) if (cand[cells[k]] & bit) { hsCell = cells[k]; break; }
          }
        }
      }

      if (hsCell >= 0) {
        place(hsCell, hsDigit);
        if (rec()) return true;
        unplace(hsCell, hsDigit);
        return false;
      }

      const digits = bitsOf(cand[bestCell]);
      if (rng) shuffle(digits, rng);
      for (const d of digits) {
        place(bestCell, d);
        if (rec()) return true;
        unplace(bestCell, d);
      }
      return false;
    }

    rec();
    return { count, solution, aborted, nodes };
  }

  function hasUniqueSolution(grid, maxNodes) {
    const r = countSolutions(grid, { limit: 2, maxNodes: maxNodes || 200000 });
    return !r.aborted && r.count === 1;
  }

  // ---- Human-style logic ---------------------------------------------------

  /** Candidate masks for every empty cell of `grid` (0 for filled cells). */
  function computeCandidates(grid) {
    const rm = new Uint16Array(N), cm = new Uint16Array(N), bm = new Uint16Array(N);
    for (let i = 0; i < CELLS; i++) {
      const v = grid[i];
      if (v >= 0) { const b = 1 << v; rm[ROW[i]] |= b; cm[COL[i]] |= b; bm[BOXOF[i]] |= b; }
    }
    const cand = new Uint16Array(CELLS);
    for (let i = 0; i < CELLS; i++) if (grid[i] < 0) cand[i] = FULL & ~(rm[ROW[i]] | cm[COL[i]] | bm[BOXOF[i]]);
    return cand;
  }

  const TECH = { NAKED_SINGLE: 1, HIDDEN_SINGLE: 2, LOCKED: 3, NAKED_PAIR: 4 };

  /**
   * Finds one logical step on (grid, cand). Does not mutate.
   * maxTech limits which techniques are allowed.
   * Returns null or a step:
   *   { type:'place', tech, cell, digit, unit?, text }
   *   { type:'elim',  tech, elims:[[cell,mask],...], unit, digit?, text }
   */
  function findStep(grid, cand, maxTech) {
    // Naked single
    for (let i = 0; i < CELLS; i++) {
      if (grid[i] < 0 && POP[cand[i]] === 1) {
        const d = bitIndex(cand[i]);
        return { type: 'place', tech: TECH.NAKED_SINGLE, cell: i, digit: d,
          text: 'Naked single: ' + cellName(i) + ' has only one possible digit left, ' + sym(d) + '.' };
      }
    }
    // Hidden single (boxes first — usually easiest to spot)
    for (let k = 0; k < 48; k++) {
      const u = (k + 32) % 48;
      const cells = UNITS[u];
      let once = 0, twice = 0;
      for (let j = 0; j < N; j++) { const m = cand[cells[j]]; twice |= once & m; once |= m; }
      const single = once & ~twice;
      if (single) {
        const d = bitIndex(single), bit = 1 << d;
        for (let j = 0; j < N; j++) if (cand[cells[j]] & bit) {
          return { type: 'place', tech: TECH.HIDDEN_SINGLE, cell: cells[j], digit: d, unit: u,
            text: 'Hidden single: ' + cellName(cells[j]) + ' is the only place for ' + sym(d) + ' in ' + unitName(u) + '.' };
        }
      }
    }
    if (maxTech < TECH.LOCKED) return null;

    // Locked candidates: pointing (box -> line) and claiming (line -> box)
    for (let b = 0; b < N; b++) {
      const cells = UNITS[32 + b];
      for (let d = 0; d < N; d++) {
        const bit = 1 << d;
        const pos = cells.filter(c => cand[c] & bit);
        if (pos.length < 2) continue;
        for (const [lineOf, base] of [[ROW, 0], [COL, 16]]) {
          const line = lineOf[pos[0]];
          if (!pos.every(c => lineOf[c] === line)) continue;
          const elims = UNITS[base + line].filter(c => BOXOF[c] !== b && (cand[c] & bit)).map(c => [c, bit]);
          if (elims.length) return { type: 'elim', tech: TECH.LOCKED, elims, unit: base + line, digit: d,
            text: 'Pointing: in box ' + (b + 1) + ', ' + sym(d) + ' can only be in ' + unitName(base + line) +
              ', so it is removed from the rest of that ' + (base ? 'column' : 'row') + '.' };
        }
      }
    }
    for (let u = 0; u < 32; u++) {
      const cells = UNITS[u];
      for (let d = 0; d < N; d++) {
        const bit = 1 << d;
        const pos = cells.filter(c => cand[c] & bit);
        if (pos.length < 2) continue;
        const b = BOXOF[pos[0]];
        if (!pos.every(c => BOXOF[c] === b)) continue;
        const elims = UNITS[32 + b].filter(c => (u < 16 ? ROW[c] !== u : COL[c] !== u - 16) && (cand[c] & bit)).map(c => [c, bit]);
        if (elims.length) return { type: 'elim', tech: TECH.LOCKED, elims, unit: 32 + b, digit: d,
          text: 'Claiming: in ' + unitName(u) + ', ' + sym(d) + ' is confined to box ' + (b + 1) +
            ', so it is removed from the rest of that box.' };
      }
    }
    if (maxTech < TECH.NAKED_PAIR) return null;

    // Naked pairs
    for (let u = 0; u < 48; u++) {
      const cells = UNITS[u].filter(c => grid[c] < 0 && POP[cand[c]] === 2);
      for (let x = 0; x < cells.length; x++) for (let y = x + 1; y < cells.length; y++) {
        const m = cand[cells[x]];
        if (cand[cells[y]] !== m) continue;
        const elims = UNITS[u].filter(c => c !== cells[x] && c !== cells[y] && (cand[c] & m)).map(c => [c, cand[c] & m]);
        if (elims.length) {
          const ds = bitsOf(m).map(sym).join('/');
          return { type: 'elim', tech: TECH.NAKED_PAIR, elims, unit: u,
            text: 'Naked pair: ' + cellName(cells[x]) + ' and ' + cellName(cells[y]) + ' both hold only ' + ds +
              ', so ' + ds + ' are removed from the rest of ' + unitName(u) + '.' };
        }
      }
    }
    return null;
  }

  function applyPlace(grid, cand, i, d) {
    grid[i] = d; cand[i] = 0;
    const clear = ~(1 << d);
    const p = PEERS[i];
    for (let k = 0; k < p.length; k++) cand[p[k]] &= clear;
  }

  /**
   * Solves as far as possible with logic up to maxTech.
   * Returns { solved, grid, hardest, steps }.
   */
  function logicSolve(puzzle, maxTech) {
    const grid = Int8Array.from(puzzle);
    const cand = computeCandidates(grid);
    let hardest = 0, steps = 0, empties = 0;
    for (let i = 0; i < CELLS; i++) if (grid[i] < 0) empties++;
    while (empties > 0) {
      const s = findStep(grid, cand, maxTech);
      if (!s) break;
      steps++;
      if (s.tech > hardest) hardest = s.tech;
      if (s.type === 'place') { applyPlace(grid, cand, s.cell, s.digit); empties--; }
      else for (const [c, m] of s.elims) cand[c] &= ~m;
    }
    return { solved: empties === 0, grid: Array.from(grid), hardest, steps };
  }

  /**
   * Produces a hint for the player's current grid.
   * Runs eliminations silently until a placement is found, so the hint is always
   * "put digit X in cell Y" plus the chain of reasons that justify it.
   * If logic gets stuck and a solution is supplied, falls back to revealing a cell.
   * Only correct placements are ever suggested (verified against the solution when given).
   */
  function getHint(grid, solution) {
    const g = Int8Array.from(grid);
    const cand = computeCandidates(g);
    const reasons = [];
    for (let guard = 0; guard < 500; guard++) {
      const s = findStep(g, cand, TECH.NAKED_PAIR);
      if (!s) break;
      if (s.type === 'place') {
        if (solution && solution[s.cell] !== s.digit) break; // should be impossible; be safe
        return { cell: s.cell, digit: s.digit, unit: s.unit, tech: s.tech, text: s.text, reasons, logical: true };
      }
      reasons.push(s.text);
      for (const [c, m] of s.elims) cand[c] &= ~m;
    }
    if (!solution) return null;
    // Fallback: reveal the most constrained empty cell from the unique solution.
    let best = -1, bestN = 99;
    for (let i = 0; i < CELLS; i++) if (g[i] < 0 && POP[cand[i]] < bestN) { bestN = POP[cand[i]]; best = i; }
    if (best < 0) return null;
    return { cell: best, digit: solution[best], tech: 0, reasons: [], logical: false,
      text: 'No simple deduction found here, so the hint reveals ' + cellName(best) + ' = ' + sym(solution[best]) +
        ' from the unique solution.' };
  }

  // ---- Generation ----------------------------------------------------------

  function patternSolution(rng) {
    // Guaranteed-valid fallback: shifted pattern + random symmetry-preserving shuffles.
    const bands = shuffle([0, 1, 2, 3], rng), stacks = shuffle([0, 1, 2, 3], rng);
    const rows = [], cols = [];
    for (const b of bands) for (const r of shuffle([0, 1, 2, 3], rng)) rows.push(b * 4 + r);
    for (const s of stacks) for (const c of shuffle([0, 1, 2, 3], rng)) cols.push(s * 4 + c);
    const digits = shuffle(Array.from({ length: N }, (_, i) => i), rng);
    const g = new Array(CELLS);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const R = rows[r], C = cols[c];
      g[r * N + c] = digits[(R * BOX + ((R / BOX) | 0) + C) % N];
    }
    return g;
  }

  function randomSolution(rng) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const r = countSolutions(new Array(CELLS).fill(-1), { limit: 1, maxNodes: 5000, rng });
      if (r.count === 1 && !r.aborted) return r.solution;
    }
    return patternSolution(rng);
  }

  const DIFFICULTIES = {
    easy:   { label: 'Easy',   targetGivens: 170, maxTech: TECH.HIDDEN_SINGLE },
    medium: { label: 'Medium', targetGivens: 140, maxTech: TECH.HIDDEN_SINGLE },
    hard:   { label: 'Hard',   targetGivens: 115, maxTech: TECH.NAKED_PAIR },
    expert: { label: 'Expert', targetGivens: 0,   maxTech: 0 }, // unique only, as sparse as possible
  };

  /**
   * Generates a puzzle with exactly one solution.
   * opts: { difficulty = 'medium', seed = random }
   * Returns { puzzle, solution, givens, difficulty, seed }.
   */
  function generate(opts) {
    opts = opts || {};
    const difficulty = DIFFICULTIES[opts.difficulty] ? opts.difficulty : 'medium';
    const cfg = DIFFICULTIES[difficulty];
    const seed = (opts.seed != null ? opts.seed : Math.floor(Math.random() * 2 ** 31)) >>> 0;
    const rng = makeRng(seed);

    const solution = randomSolution(rng);
    const puzzle = solution.slice();
    let givens = CELLS;

    // Remove cells in 180°-symmetric pairs.
    const order = shuffle(Array.from({ length: CELLS / 2 }, (_, i) => i), rng);
    for (const i of order) {
      if (givens <= cfg.targetGivens) break;
      const j = CELLS - 1 - i;
      const a = puzzle[i], b = puzzle[j];
      puzzle[i] = -1; puzzle[j] = -1;
      let ok;
      if (cfg.maxTech) {
        // Solvable by the allowed techniques => unique (every step is a forced deduction).
        ok = logicSolve(puzzle, cfg.maxTech).solved;
      } else {
        ok = hasUniqueSolution(puzzle, 20000);
      }
      if (ok) givens -= 2;
      else { puzzle[i] = a; puzzle[j] = b; }
    }

    return { puzzle, solution, givens, difficulty, seed };
  }

  function toString(grid) { return grid.map(v => (v < 0 ? '.' : SYMBOLS[v])).join(''); }
  function fromString(s) { return Array.from(s).map(ch => (ch === '.' ? -1 : SYMBOLS.indexOf(ch.toUpperCase()))); }

  return {
    N, BOX, CELLS, SYMBOLS, ROW, COL, BOXOF, UNITS, PEERS, POP, TECH, DIFFICULTIES,
    makeRng, countSolutions, hasUniqueSolution, computeCandidates, findStep, logicSolve,
    getHint, generate, toString, fromString, cellName, bitsOf,
  };
});
