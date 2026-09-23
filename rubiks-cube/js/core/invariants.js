/**
 * 可达性校验（§D2）：合法转动永恒可达；外部注入/求解前必须校验，
 * 不可达状态显式报错拒绝。
 *   1. 角块方向和 ≡ 0 (mod 3)
 *   2. 棱块翻转和为偶数
 *   3. 角块置换奇偶性 = 棱块置换奇偶性
 */
(function (global) {
  'use strict';

  const Rubik = (global.Rubik = global.Rubik || {});

  /** 置换奇偶性：按环分解，长为 L 的环贡献 (L-1) 个对换。 */
  function permutationParity(pos) {
    const seen = new Array(pos.length).fill(false);
    let parity = 0;
    for (let i = 0; i < pos.length; i++) {
      if (seen[i]) {
        continue;
      }
      let len = 0;
      let j = i;
      while (!seen[j]) {
        seen[j] = true;
        j = pos[j];
        len++;
      }
      parity ^= (len - 1) & 1;
    }
    return parity;
  }

  function isSolvable(cube) {
    const coSum = cube.corners.ori.reduce((a, b) => a + b, 0) % 3;
    if (coSum !== 0) {
      return false;
    }
    const eoSum = cube.edges.ori.reduce((a, b) => a + b, 0) % 2;
    if (eoSum !== 0) {
      return false;
    }
    return permutationParity(cube.corners.pos) === permutationParity(cube.edges.pos);
  }

  /** 不可达状态显式报错拒绝。 */
  function assertSolvable(cube) {
    if (!isSolvable(cube)) {
      throw new Error(
        '不可达状态：角方向和 / 棱翻转和 / 角棱置换奇偶性不变量被破坏'
      );
    }
  }

  Rubik.isSolvable = isSolvable;
  Rubik.assertSolvable = assertSolvable;
  Rubik.permutationParity = permutationParity;
})(typeof window !== 'undefined' ? window : globalThis);
