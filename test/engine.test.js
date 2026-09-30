// Run: node test/engine.test.js
const S = require('../sudoku16.js');
const assert = require('assert');

function validSolution(g) {
  for (const u of S.UNITS) {
    const seen = new Set(u.map(i => g[i]));
    if (seen.size !== 16 || [...seen].some(v => v < 0 || v > 15)) return false;
  }
  return true;
}

let failures = 0;
for (const difficulty of Object.keys(S.DIFFICULTIES)) {
  for (let seed = 1; seed <= 5; seed++) {
    const t0 = Date.now();
    const p = S.generate({ difficulty, seed });
    const ms = Date.now() - t0;
    try {
      assert.ok(validSolution(p.solution), 'solution invalid');
      p.puzzle.forEach((v, i) => { if (v >= 0) assert.strictEqual(v, p.solution[i], 'given mismatch'); });
      const r = S.countSolutions(p.puzzle, { limit: 2 });
      assert.ok(!r.aborted, 'uniqueness check aborted');
      assert.strictEqual(r.count, 1, 'not unique');
      assert.deepStrictEqual(r.solution, p.solution, 'solver found different solution');
      // Walk the whole puzzle with hints only: every hint must be correct.
      const g = p.puzzle.slice(); let logical = 0, reveals = 0;
      while (g.includes(-1)) {
        const h = S.getHint(g, p.solution);
        assert.ok(h, 'no hint');
        assert.strictEqual(h.digit, p.solution[h.cell], 'wrong hint');
        assert.strictEqual(g[h.cell], -1, 'hint on filled cell');
        g[h.cell] = h.digit; h.logical ? logical++ : reveals++;
      }
      if (difficulty !== 'expert') assert.strictEqual(reveals, 0, 'non-logical hint on graded puzzle');
      console.log(`ok  ${difficulty.padEnd(6)} seed=${seed} givens=${p.givens} ${ms}ms nodes=${r.nodes} hints: logical=${logical} reveal=${reveals}`);
    } catch (e) { failures++; console.log(`FAIL ${difficulty} seed=${seed}: ${e.message}`); }
  }
}
process.exit(failures ? 1 : 0);
