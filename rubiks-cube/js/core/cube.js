/**
 * 魔方 cubie 状态模型（§D2，唯一事实源）。
 *
 * Kociemba 标准块编号：
 *   角块 8：URF UFL ULB UBR DFR DLF DBL DRB（ori ∈ {0,1,2}）
 *   棱块 12：UR UF UL UB DR DF DL DB FR FL BL BR（ori ∈ {0,1}）
 * pos[i] 为第 i 号位上的块编号；6 个中心块固定，定义六面基准色。
 */
(function (global) {
  'use strict';

  const Rubik = (global.Rubik = global.Rubik || {});

  const CORNERS = 8;
  const EDGES = 12;
  const FACELETS_PER_FACE = 9;
  const CORNER_FACELETS = 3;
  const EDGE_FACELETS = 2;

  // 6 个中心块固定：中心面贴纸（每面第 5 张）恒为本面基准色。
  const CENTER_FACELET = [4, 13, 22, 31, 40, 49];

  // 角块贴纸位置表：cornerFacelet[i][j] = 第 i 号位上第 j 张贴纸对应的 54 面贴纸下标。
  // 面贴纸下标按 U R F D L B 面序、每面 9 张按面自身视角行优先（U1=0 … B9=53）。
  const CORNER_FACELET = [
    [8, 9, 20],    // URF: U9, R1, F3
    [6, 18, 38],   // UFL: U7, F1, L3
    [0, 36, 47],   // ULB: U1, L1, B3
    [2, 45, 11],   // UBR: U3, B1, R3
    [29, 26, 15],  // DFR: D3, F9, R7
    [27, 44, 24],  // DLF: D1, L9, F7
    [33, 53, 42],  // DBL: D7, B9, L7
    [35, 17, 51],  // DRB: D9, R9, B7
  ];

  const EDGE_FACELET = [
    [5, 10],   // UR: U6, R2
    [7, 19],   // UF: U8, F2
    [3, 37],   // UL: U4, L2
    [1, 46],   // UB: U2, B2
    [32, 16],  // DR: D6, R8
    [28, 25],  // DF: D2, F8
    [30, 43],  // DL: D4, L8
    [34, 52],  // DB: D8, B8
    [23, 12],  // FR: F6, R4
    [21, 41],  // FL: F4, L6
    [50, 39],  // BL: B6, L4
    [48, 14],  // BR: B4, R6
  ];

  // 各块自带贴纸的基准色（面字母），贴纸与块的从属关系永不改变。
  const CORNER_COLOR = [
    ['U', 'R', 'F'],
    ['U', 'F', 'L'],
    ['U', 'L', 'B'],
    ['U', 'B', 'R'],
    ['D', 'F', 'R'],
    ['D', 'L', 'F'],
    ['D', 'B', 'L'],
    ['D', 'R', 'B'],
  ];

  const EDGE_COLOR = [
    ['U', 'R'],
    ['U', 'F'],
    ['U', 'L'],
    ['U', 'B'],
    ['D', 'R'],
    ['D', 'F'],
    ['D', 'L'],
    ['D', 'B'],
    ['F', 'R'],
    ['F', 'L'],
    ['B', 'L'],
    ['B', 'R'],
  ];

  function identityArray(n) {
    const a = new Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = i;
    }
    return a;
  }

  function Cube(corners, edges) {
    this.corners = corners || { pos: identityArray(CORNERS), ori: new Array(CORNERS).fill(0) };
    this.edges = edges || { pos: identityArray(EDGES), ori: new Array(EDGES).fill(0) };
  }

  /** 复原态。 */
  Cube.solved = function () {
    return new Cube();
  };

  Cube.prototype.clone = function () {
    return new Cube(
      { pos: this.corners.pos.slice(), ori: this.corners.ori.slice() },
      { pos: this.edges.pos.slice(), ori: this.edges.ori.slice() }
    );
  };

  /** 复原检测：corners 与 edges 的 pos/ori 均为恒等（在 cubie 模型上判断，§D2）。 */
  Cube.prototype.isSolved = function () {
    for (let i = 0; i < CORNERS; i++) {
      if (this.corners.pos[i] !== i || this.corners.ori[i] !== 0) {
        return false;
      }
    }
    for (let i = 0; i < EDGES; i++) {
      if (this.edges.pos[i] !== i || this.edges.ori[i] !== 0) {
        return false;
      }
    }
    return true;
  };

  /**
   * 派生 54 贴纸颜色数组（面字母），仅用于渲染取色（§D2）。
   * 位置 i 上 ori 偏移决定块的第 j 张贴纸落在该位的哪张面贴纸上。
   */
  Cube.prototype.toFacelets = function () {
    const facelets = new Array(54);
    for (let f = 0; f < 6; f++) {
      facelets[CENTER_FACELET[f]] = 'URFDLB'[f];
    }
    for (let i = 0; i < CORNERS; i++) {
      const cubie = this.corners.pos[i];
      const ori = this.corners.ori[i];
      for (let j = 0; j < CORNER_FACELETS; j++) {
        facelets[CORNER_FACELET[i][(j + ori) % 3]] = CORNER_COLOR[cubie][j];
      }
    }
    for (let i = 0; i < EDGES; i++) {
      const cubie = this.edges.pos[i];
      const ori = this.edges.ori[i];
      for (let j = 0; j < EDGE_FACELETS; j++) {
        facelets[EDGE_FACELET[i][(j + ori) % 2]] = EDGE_COLOR[cubie][j];
      }
    }
    return facelets;
  };

  Rubik.Cube = Cube;
  Rubik.CORNERS = CORNERS;
  Rubik.EDGES = EDGES;
  Rubik.FACELETS_PER_FACE = FACELETS_PER_FACE;
  Rubik.CORNER_FACELET = CORNER_FACELET;
  Rubik.EDGE_FACELET = EDGE_FACELET;
  Rubik.CORNER_COLOR = CORNER_COLOR;
  Rubik.EDGE_COLOR = EDGE_COLOR;
})(typeof window !== 'undefined' ? window : globalThis);
