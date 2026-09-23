'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

require('../js/core/cube.js');
const { Cube, FACELETS_PER_FACE } = globalThis.Rubik;

test('solved 态：cubie 模型 pos/ori 全恒等且 isSolved 为真', () => {
  const cube = Cube.solved();
  for (let i = 0; i < 8; i++) {
    assert.equal(cube.corners.pos[i], i);
    assert.equal(cube.corners.ori[i], 0);
  }
  for (let i = 0; i < 12; i++) {
    assert.equal(cube.edges.pos[i], i);
    assert.equal(cube.edges.ori[i], 0);
  }
  assert.equal(cube.isSolved(), true);
});

test('toFacelets：solved 态 54 贴纸，每面 9 张同色，符合六面基准色', () => {
  const cube = Cube.solved();
  const facelets = cube.toFacelets();
  assert.equal(facelets.length, 54);
  // Kociemba 面序：U R F D L B，每面 9 张按面自身视角行优先
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < FACELETS_PER_FACE; k++) {
      assert.equal(facelets[f * 9 + k], 'URFDLB'[f], `面 ${'URFDLB'[f]} 第 ${k} 张贴纸`);
    }
  }
  const counts = {};
  for (const c of facelets) {
    counts[c] = (counts[c] || 0) + 1;
  }
  assert.deepEqual(counts, { U: 9, R: 9, F: 9, D: 9, L: 9, B: 9 });
});

test('clone 独立：改动副本不影响原状态', () => {
  const cube = Cube.solved();
  const copy = cube.clone();
  copy.corners.pos[0] = 3;
  copy.corners.ori[1] = 2;
  copy.edges.pos[4] = 8;
  copy.edges.ori[5] = 1;
  assert.equal(cube.corners.pos[0], 0);
  assert.equal(cube.corners.ori[1], 0);
  assert.equal(cube.edges.pos[4], 4);
  assert.equal(cube.edges.ori[5], 0);
});
