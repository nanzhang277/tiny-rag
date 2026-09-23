'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

require('../js/core/notation.js');
require('../js/core/cube.js');
require('../js/core/moves.js');
require('../js/core/invariants.js');
const { Cube, applyMove } = globalThis.Rubik;
const { isSolvable, assertSolvable } = globalThis.Rubik;

// 种子化 RNG（测试自含，零依赖）
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
const SUFFIX = ['', "'", '2'];

test('solved 态与任意合法 move 序列后的状态均可解（可达）', () => {
  assert.equal(isSolvable(Cube.solved()), true);
  const rand = mulberry32(20260923);
  for (let s = 0; s < 200; s++) {
    let cube = Cube.solved();
    const len = 1 + Math.floor(rand() * 40);
    for (let i = 0; i < len; i++) {
      const move = FACES[Math.floor(rand() * 6)] + SUFFIX[Math.floor(rand() * 3)];
      cube = applyMove(cube, move);
    }
    assert.equal(isSolvable(cube), true, `种子 ${s} 的随机序列后应可解`);
  }
});

test('负例：交换两个角块被拒绝（角/棱置换奇偶性不等）', () => {
  const cube = Cube.solved();
  const corners = { pos: cube.corners.pos.slice(), ori: cube.corners.ori.slice() };
  [corners.pos[0], corners.pos[1]] = [corners.pos[1], corners.pos[0]];
  const bad = new (cube.constructor)(corners, { pos: cube.edges.pos.slice(), ori: cube.edges.ori.slice() });
  assert.equal(isSolvable(bad), false);
  assert.throws(() => assertSolvable(bad), /不可达/);
});

test('负例：单翻一个棱块被拒绝（棱翻转和为奇数）', () => {
  const cube = Cube.solved();
  const edges = { pos: cube.edges.pos.slice(), ori: cube.edges.ori.slice() };
  edges.ori[0] = 1;
  const bad = new (cube.constructor)({ pos: cube.corners.pos.slice(), ori: cube.corners.ori.slice() }, edges);
  assert.equal(isSolvable(bad), false);
  assert.throws(() => assertSolvable(bad), /不可达/);
});

test('负例：交换两个棱块被拒绝（角/棱置换奇偶性不等）', () => {
  const cube = Cube.solved();
  const edges = { pos: cube.edges.pos.slice(), ori: cube.edges.ori.slice() };
  [edges.pos[0], edges.pos[1]] = [edges.pos[1], edges.pos[0]];
  const bad = new (cube.constructor)({ pos: cube.corners.pos.slice(), ori: cube.corners.ori.slice() }, edges);
  assert.equal(isSolvable(bad), false);
  assert.throws(() => assertSolvable(bad), /不可达/);
});

test('负例：角块方向和不为 0 (mod 3) 被拒绝', () => {
  const cube = Cube.solved();
  const corners = { pos: cube.corners.pos.slice(), ori: cube.corners.ori.slice() };
  corners.ori[0] = 1;
  corners.ori[1] = 1;
  const bad = new (cube.constructor)(corners, { pos: cube.edges.pos.slice(), ori: cube.edges.ori.slice() });
  assert.equal(isSolvable(bad), false);
  assert.throws(() => assertSolvable(bad), /不可达/);
});

test('assertSolvable 对可达状态不抛错', () => {
  assert.doesNotThrow(() => assertSolvable(Cube.solved()));
  let cube = applyMove(Cube.solved(), 'R');
  cube = applyMove(cube, 'U');
  assert.doesNotThrow(() => assertSolvable(cube));
});
