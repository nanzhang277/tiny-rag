'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

require('../js/core/notation.js');
const { parseMoves, formatMoves } = globalThis.Rubik;

// Singmaster 记号：U R F D L B 顺时针，' 逆时针，2 = 180°，空格分隔。
const ALL_MOVES = [];
for (const f of ['U', 'R', 'F', 'D', 'L', 'B']) {
  ALL_MOVES.push(f, f + "'", f + '2');
}

test('parseMoves 解析标准记号序列', () => {
  assert.deepEqual(parseMoves("R U R' U'"), ['R', 'U', "R'", "U'"]);
  assert.deepEqual(parseMoves('R2 U'), ['R2', 'U']);
  assert.deepEqual(parseMoves('F2 B2 L2'), ['F2', 'B2', 'L2']);
});

test('parseMoves 容忍多余空白', () => {
  assert.deepEqual(parseMoves("  U   R' "), ['U', "R'"]);
  assert.deepEqual(parseMoves(''), []);
  assert.deepEqual(parseMoves('   '), []);
});

test('formatMoves 以单空格连接', () => {
  assert.equal(formatMoves(['R', 'U', "R'", "U'"]), "R U R' U'");
  assert.equal(formatMoves([]), '');
});

test('parseMoves ↔ formatMoves 往返一致（18 个 move 全覆盖）', () => {
  const seq = ALL_MOVES.join(' ');
  assert.deepEqual(parseMoves(seq), ALL_MOVES);
  assert.equal(formatMoves(ALL_MOVES), seq);
  assert.equal(formatMoves(parseMoves(seq)), seq);
});

test('parseMoves 拒绝非法记号并报错', () => {
  for (const bad of ['X', 'r', 'R3', 'RU', "R''", 'U2!', 'M', 'E', 'S']) {
    assert.throws(() => parseMoves(bad), Error, `应拒绝: ${bad}`);
  }
});

test('formatMoves 拒绝非法 move 元素', () => {
  assert.throws(() => formatMoves(['R', 'X']), Error);
  assert.throws(() => formatMoves(['R3']), Error);
});
