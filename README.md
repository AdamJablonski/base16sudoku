# Mine Sudoku 0x10

A browser game that mixes Sudoku and Minesweeper, played on a 16×16 grid with base-16 digits `0`–`F`.

- Standard Sudoku rules: every row, column and 4×4 box holds each of `0`–`F` exactly once.
- Every empty cell has one safe digit. The other 15 are mines. Enter a wrong digit and the mine explodes,
  costing you one of your 3 lives. The digit that blew up stays in the cell, marked in red and crossed out.
- Lose all 3 lives and the solution is revealed.

## Play

Open `index.html` in a browser. There's no build step. p5.js loads from a CDN.
You can also serve the folder, for example with `python3 -m http.server`.

Controls: click or use the arrow keys to select a cell. Type `0`–`9` and `A`–`F`, or use the on-screen keypad.
`Space`/`N` toggles notes mode, `Shift`+digit adds a quick note, `Del` clears notes and `H` gives a hint.

The URL tracks `?seed=…&d=…`, so you can share it to replay the same puzzle.

## Single-solution puzzles and hints

The engine is in `sudoku16.js` and has no dependencies. It runs in both the browser and Node.

- **Generator:** it builds a random full grid, then removes cells in symmetric pairs. A cell is only
  removed if the puzzle still has exactly one solution:
  - Easy, Medium and Hard puzzles must be fully solvable by human techniques (naked and hidden singles,
    plus locked candidates and naked pairs on Hard). Each of these steps is a forced deduction, so this
    proves the solution is unique.
  - Expert puzzles are made as sparse as possible. A bitmask backtracking solver counts solutions up to 2
    after every removal. If the search exceeds its node budget, the cell is put back, so a puzzle is never
    emitted without proof that it's unique.
- **Hints:** these come from the same logic engine, working on the digits currently on the board. A hint
  names the cell, the digit and the reason, such as "Hidden single: R3C7 is the only place for B in box 2",
  including any eliminations that led to it. Press Hint again to place it. If no logical step exists (only
  possible on Expert), the hint reveals the most constrained cell from the unique solution.

## Tests

```
npm test
```

This generates puzzles at every difficulty and checks that:
- the solver confirms each one has exactly one solution
- the givens match the solution
- every hint is correct across a full hint-only playthrough
- non-Expert puzzles never need a non-logical reveal
