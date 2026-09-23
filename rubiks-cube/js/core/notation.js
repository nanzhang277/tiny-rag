/**
 * Singmaster 记号（§D2）：U R F D L B 顺时针（从该面外侧看），' 逆时针，2 = 180°。
 * parseMoves(str) ↔ formatMoves(seq) 往返一致；非法记号报错。
 */
(function (global) {
  'use strict';

  const Rubik = (global.Rubik = global.Rubik || {});

  const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
  const SUFFIXES = ['', "'", '2'];
  const VALID = new Set();
  for (const f of FACES) {
    for (const s of SUFFIXES) {
      VALID.add(f + s);
    }
  }

  function assertMove(token) {
    if (typeof token !== 'string' || !VALID.has(token)) {
      throw new Error('非法记号: ' + JSON.stringify(token));
    }
  }

  /** 'U R2 B' → ['U', 'R2', 'B']；非法记号抛错。 */
  function parseMoves(str) {
    if (typeof str !== 'string') {
      throw new Error('记号序列必须是字符串');
    }
    const tokens = str.trim().length === 0 ? [] : str.trim().split(/\s+/);
    for (const t of tokens) {
      assertMove(t);
    }
    return tokens;
  }

  /** ['U', 'R2', 'B'] → 'U R2 B'；含非法元素抛错。 */
  function formatMoves(seq) {
    for (const t of seq) {
      assertMove(t);
    }
    return seq.join(' ');
  }

  Rubik.FACES = FACES;
  Rubik.parseMoves = parseMoves;
  Rubik.formatMoves = formatMoves;
})(typeof window !== 'undefined' ? window : globalThis);
