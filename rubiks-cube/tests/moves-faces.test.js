'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

require('../js/core/notation.js');
require('../js/core/cube.js');
require('../js/core/moves.js');
const { Cube, applyMove } = globalThis.Rubik;

// 从复原态出发单面转 90°：本面保持本面色，邻面行/列按「顺时针 = 从该面外侧看」循环。
test('R（右层顺时针）：R 面不变，U←F、B←U、D←B、F←D', () => {
  const f = applyMove(Cube.solved(), 'R').toFacelets();
  for (let i = 9; i <= 17; i++) {
    assert.equal(f[i], 'R', `R 面 ${i}`);
  }
  assert.deepEqual([f[2], f[5], f[8]], ['F', 'F', 'F'], 'U 右列 ← F 右列');
  assert.deepEqual([f[45], f[48], f[51]], ['U', 'U', 'U'], 'B 左列 ← U 右列');
  assert.deepEqual([f[32], f[35]], ['B', 'B'], 'D 右列（D6/D9）← B 左列');
  assert.deepEqual([f[20], f[23], f[26]], ['D', 'D', 'D'], 'F 右列 ← D 右列');
});

test('F（前层顺时针）：F 面不变，R←U、D←R、L←D、U←L', () => {
  const f = applyMove(Cube.solved(), 'F').toFacelets();
  for (let i = 18; i <= 26; i++) {
    assert.equal(f[i], 'F', `F 面 ${i}`);
  }
  assert.deepEqual([f[9], f[12], f[15]], ['U', 'U', 'U'], 'R 左列 ← U 底行');
  assert.deepEqual([f[27], f[28], f[29]], ['R', 'R', 'R'], 'D 顶行 ← R 左列');
  assert.deepEqual([f[38], f[41], f[44]], ['D', 'D', 'D'], 'L 右列 ← D 顶行');
  assert.deepEqual([f[6], f[7], f[8]], ['L', 'L', 'L'], 'U 底行 ← L 右列');
});

test('D（底层顺时针，从下面看）：D 面不变，F←L、R←F、B←R、L←B', () => {
  const f = applyMove(Cube.solved(), 'D').toFacelets();
  for (let i = 27; i <= 35; i++) {
    assert.equal(f[i], 'D', `D 面 ${i}`);
  }
  assert.deepEqual([f[24], f[25], f[26]], ['L', 'L', 'L'], 'F 底行 ← L 底行');
  assert.deepEqual([f[15], f[16], f[17]], ['F', 'F', 'F'], 'R 底行 ← F 底行');
  assert.deepEqual([f[51], f[52], f[53]], ['R', 'R', 'R'], 'B 底行 ← R 底行');
  assert.deepEqual([f[42], f[43], f[44]], ['B', 'B', 'B'], 'L 底行 ← B 底行');
});

test('L（左层顺时针）：L 面不变，U←B、F←U、D←F、B←D', () => {
  const f = applyMove(Cube.solved(), 'L').toFacelets();
  for (let i = 36; i <= 44; i++) {
    assert.equal(f[i], 'L', `L 面 ${i}`);
  }
  assert.deepEqual([f[0], f[3], f[6]], ['B', 'B', 'B'], 'U 左列 ← B 右列');
  assert.deepEqual([f[18], f[21], f[24]], ['U', 'U', 'U'], 'F 左列 ← U 左列');
  assert.deepEqual([f[27], f[30], f[33]], ['F', 'F', 'F'], 'D 左列 ← F 左列');
  assert.deepEqual([f[47], f[50], f[53]], ['D', 'D', 'D'], 'B 右列 ← D 左列');
});

test('B（后层顺时针）：B 面不变，U←R、L←U、D←L、R←D', () => {
  const f = applyMove(Cube.solved(), 'B').toFacelets();
  for (let i = 45; i <= 53; i++) {
    assert.equal(f[i], 'B', `B 面 ${i}`);
  }
  assert.deepEqual([f[0], f[1], f[2]], ['R', 'R', 'R'], 'U 顶行 ← R 右列');
  assert.deepEqual([f[36], f[39], f[42]], ['U', 'U', 'U'], 'L 左列 ← U 顶行');
  assert.deepEqual([f[33], f[34], f[35]], ['L', 'L', 'L'], 'D 底行 ← L 左列');
  assert.deepEqual([f[11], f[14], f[17]], ['D', 'D', 'D'], 'R 右列 ← D 底行');
});

test('两步序列 "R U"：方向更新（ori）敏感的位置抽样', () => {
  let cube = Cube.solved();
  cube = applyMove(cube, 'R');
  cube = applyMove(cube, 'U');
  const f = cube.toFacelets();
  // URF 位上是走了 R 再被 U 转回的 URF 块，ori=1
  assert.equal(f[8], 'F', 'U9');
  assert.equal(f[9], 'U', 'R1');
  assert.equal(f[20], 'R', 'F3');
  // UR 位上是 UB 棱块（U 顶层循环带来）
  assert.equal(f[5], 'U', 'U6');
  assert.equal(f[10], 'B', 'R2');
});
