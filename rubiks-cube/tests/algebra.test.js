'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

require('../js/core/notation.js');
require('../js/core/cube.js');
require('../js/core/moves.js');
const { Cube, applyMove } = globalThis.Rubik;

// 18 个可执行 move = 6 面 × {1, 2, 3}（' = 3 次幂）
const ALL_MOVES = [];
for (const f of ['U', 'R', 'F', 'D', 'L', 'B']) {
  ALL_MOVES.push(f, f + '2', f + "'");
}

function applySeq(cube, moves) {
  return moves.reduce((c, m) => applyMove(c, m), cube);
}

test('测试1：每个基本 move 执行 4 次 = 恒等（18 个 move 全覆盖）', () => {
  for (const m of ALL_MOVES) {
    let cube = Cube.solved();
    for (let i = 0; i < 4; i++) {
      cube = applyMove(cube, m);
    }
    assert.equal(cube.isSolved(), true, `${m} × 4 应为恒等`);
  }
});

test('测试1：任一 move 与其逆抵消（18 个 move 全覆盖）', () => {
  const INVERSE = {};
  for (const f of ['U', 'R', 'F', 'D', 'L', 'B']) {
    INVERSE[f] = f + "'";
    INVERSE[f + "'"] = f;
    INVERSE[f + '2'] = f + '2';
  }
  for (const m of ALL_MOVES) {
    const inv = INVERSE[m];
    assert.equal(applyMove(applyMove(Cube.solved(), m), inv).isSolved(), true, `${m} ${inv} 应抵消`);
    assert.equal(applyMove(applyMove(Cube.solved(), inv), m).isSolved(), true, `${inv} ${m} 应抵消`);
  }
});

test('测试1：move² 与自身抵消（幂次派生一致性）', () => {
  for (const f of ['U', 'R', 'F', 'D', 'L', 'B']) {
    const m2 = f + '2';
    const cube = applyMove(applyMove(Cube.solved(), m2), m2);
    assert.equal(cube.isSolved(), true, `${m2} × 2 应为恒等`);
  }
});

test('测试3：经典恒等式 (R U R\' U\')^6 = 恒等', () => {
  let cube = Cube.solved();
  for (let i = 0; i < 6; i++) {
    cube = applySeq(cube, ['R', 'U', "R'", "U'"]);
  }
  assert.equal(cube.isSolved(), true, '(R U R\' U\')^6 应为恒等');
});
