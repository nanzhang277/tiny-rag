'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

require('../js/core/notation.js');
require('../js/core/cube.js');
require('../js/core/moves.js');
const { Cube } = globalThis.Rubik;
const { applyMove } = globalThis.Rubik;

function facelets(cube) {
  return cube.toFacelets();
}

test('U（顶层顺时针）：U 面保持全白，邻面顶行循环 R→F→L→B→R', () => {
  const after = applyMove(Cube.solved(), 'U');
  // 顺时针（从上往下看）：前→左、右→前、后→右、左→后
  assert.deepEqual(facelets(after).slice(0, 9), Array(9).fill('U'), 'U 面不变');
  assert.deepEqual(facelets(after).slice(18, 21), ['R', 'R', 'R'], 'F 顶行 ← R 顶行');
  assert.deepEqual(facelets(after).slice(9, 12), ['B', 'B', 'B'], 'R 顶行 ← B 顶行');
  assert.deepEqual(facelets(after).slice(45, 48), ['L', 'L', 'L'], 'B 顶行 ← L 顶行');
  assert.deepEqual(facelets(after).slice(36, 39), ['F', 'F', 'F'], 'L 顶行 ← F 顶行');
  assert.deepEqual(facelets(after).slice(27, 36), Array(9).fill('D'), 'D 面不变');
  assert.equal(after.isSolved(), false);
  // pos 循环：URF 位上现在是 UBR 块
  assert.deepEqual(after.corners.pos.slice(0, 4), [3, 0, 1, 2]);
  assert.deepEqual(after.edges.pos.slice(0, 4), [3, 0, 1, 2]);
  // U 不产生方向变化
  assert.deepEqual(after.corners.ori, [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(after.edges.ori, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('applyMove 不修改原状态（返回新状态）', () => {
  const solved = Cube.solved();
  applyMove(solved, 'U');
  assert.equal(solved.isSolved(), true);
});

test('applyMove 拒绝非法 move', () => {
  assert.throws(() => applyMove(Cube.solved(), 'X'), Error);
  assert.throws(() => applyMove(Cube.solved(), 'u'), Error);
});

test('applyMove 仅接受单个 move token（💡3：多 token 不得静默截断）', () => {
  assert.throws(() => applyMove(Cube.solved(), 'U R'), Error);
  assert.throws(() => applyMove(Cube.solved(), 'U R F'), Error);
  assert.throws(() => applyMove(Cube.solved(), ''), Error);
});
