/**
 * 基本转置（§D2）：仅手写 6 面顺时针 90° 的 move 表；
 * 18 个可执行 move（面 × {1,2,3}）一律由基本表幂次派生，禁止手写。
 *
 * 约定（Kociemba）：move 表的 cp[i] / ep[i] 表示「应用该 move 后，第 i 号位上
 * 到来的块编号」；co[i] / eo[i] 为随该块带入的方向增量。
 * 组合公式：newPos[i] = pos[cp[i]]，newOri[i] = (ori[cp[i]] + co[i]) mod 3。
 */
(function (global) {
  'use strict';

  const Rubik = (global.Rubik = global.Rubik || {});
  const { parseMoves } = Rubik;

  const CORNERS = 8;
  const EDGES = 12;

  function zeros(n) {
    return new Array(n).fill(0);
  }

  // 基本表：6 面顺时针 90°（从该面外侧看）。方向更新规则按 Kociemba 约定。
  const BASIC_MOVES = {
    U: {
      cp: [3, 0, 1, 2, 4, 5, 6, 7],
      co: zeros(CORNERS),
      ep: [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11],
      eo: zeros(EDGES),
    },
    R: {
      cp: [4, 1, 2, 0, 7, 5, 6, 3],
      co: [2, 0, 0, 1, 1, 0, 0, 2],
      ep: [8, 1, 2, 3, 11, 5, 6, 7, 4, 9, 10, 0],
      eo: zeros(EDGES),
    },
    F: {
      cp: [1, 5, 2, 3, 0, 4, 6, 7],
      co: [1, 2, 0, 0, 2, 1, 0, 0],
      ep: [0, 9, 2, 3, 4, 8, 6, 7, 1, 5, 10, 11],
      eo: [0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0],
    },
    D: {
      cp: [0, 1, 2, 3, 5, 6, 7, 4],
      co: zeros(CORNERS),
      ep: [0, 1, 2, 3, 5, 6, 7, 4, 8, 9, 10, 11],
      eo: zeros(EDGES),
    },
    L: {
      cp: [0, 2, 6, 3, 4, 1, 5, 7],
      co: [0, 1, 2, 0, 0, 2, 1, 0],
      ep: [0, 1, 10, 3, 4, 5, 9, 7, 8, 2, 6, 11],
      eo: zeros(EDGES),
    },
    B: {
      cp: [0, 1, 3, 7, 4, 5, 2, 6],
      co: [0, 0, 1, 2, 0, 0, 2, 1],
      ep: [0, 1, 2, 11, 4, 5, 6, 10, 8, 9, 3, 7],
      eo: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1],
    },
  };

  function assertBasicFace(face) {
    if (!Object.prototype.hasOwnProperty.call(BASIC_MOVES, face)) {
      throw new Error('非法 move: ' + JSON.stringify(face));
    }
  }

  /**
   * 应用一个 move（如 'U' / "U'" / 'U2'），返回新状态（不修改原状态）。
   * turns = 1 | 2 | 3（' = 3 次幂），由基本表幂次派生。
   */
  function applyMove(cube, move) {
    const token = parseMoves(move)[0];
    const face = token[0];
    assertBasicFace(face);
    const turns = token.length === 1 ? 1 : token[1] === '2' ? 2 : 3;

    const base = BASIC_MOVES[face];
    let cp = base.cp;
    let co = base.co;
    let ep = base.ep;
    let eo = base.eo;
    for (let t = 1; t < turns; t++) {
      cp = composePerm(cp, base.cp);
      co = composeOri(co, base.co, base.cp, 3);
      ep = composePerm(ep, base.ep);
      eo = composeOri(eo, base.eo, base.ep, 2);
    }

    const corners = {
      pos: cube.corners.pos.map((_, i) => cube.corners.pos[cp[i]]),
      ori: cube.corners.ori.map((_, i) => (cube.corners.ori[cp[i]] + co[i]) % 3),
    };
    const edges = {
      pos: cube.edges.pos.map((_, i) => cube.edges.pos[ep[i]]),
      ori: cube.edges.ori.map((_, i) => (cube.edges.ori[ep[i]] + eo[i]) % 2),
    };
    return new Rubik.Cube(corners, edges);
  }

  /** 置换复合：返回 p ∘ q（先 q 后 p 的到来映射）。 */
  function composePerm(p, q) {
    return q.map((_, i) => p[q[i]]);
  }

  /** 方向复合：(p 方向) ∘ (q 方向)，mod base。 */
  function composeOri(po, qo, q, base) {
    return qo.map((_, i) => (po[q[i]] + qo[i]) % base);
  }

  Rubik.applyMove = applyMove;
  Rubik.BASIC_MOVES = BASIC_MOVES;
})(typeof window !== 'undefined' ? window : globalThis);
