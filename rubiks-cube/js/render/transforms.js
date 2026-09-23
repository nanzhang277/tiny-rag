/**
 * 渲染纯函数（§D3）：computeTransforms(state, animatingMove?, t?) → {cubieId: transformString}。
 * DOM 装配薄层（mount.js）仅负责把字符串写入元素。
 *
 * 坐标约定：
 *   世界系：x 右、y 上、z 前；格位坐标 ∈ {-1,0,1}³。
 *   CSS 系：css = (x, -y, z)（CSS 的 y 轴向下）；CSS 旋转为绕 css 轴的右手旋转。
 *   顺时针面转（从该面外侧看）= 世界系绕该面法向的 -90° 右手旋转
 *     = CSS 系绕 css 法向（y 分量取反）的 +90° 右手旋转。
 */
(function (global) {
  'use strict';

  const Rubik = (global.Rubik = global.Rubik || {});

  // 单格边长（px），css/style.css 通过 --cell 变量引用同一数值
  const CELL_PX = 34;

  // 配色常量（§D3 定稿值）
  const COLORS = { U: '#FFFFFF', D: '#FFD500', F: '#009B48', B: '#0046AD', R: '#B90000', L: '#FF5900' };
  // 每面固定亮度系数模拟明暗（无光照）
  const FACE_BRIGHTNESS = { U: 1.0, F: 0.92, R: 0.8, L: 0.7, B: 0.6, D: 0.55 };

  function shadeColor(hex, factor) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`;
  }

  // ---------- 26 个 cubie 的静态定义 ----------

  const FACE_COORD = { U: [0, 1, 0], D: [0, -1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] };
  const CORNER_NAMES = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
  const EDGE_NAMES = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];
  const CENTER_NAMES = ['U', 'R', 'F', 'D', 'L', 'B'];

  function coordFromName(name) {
    const c = [0, 0, 0];
    for (const ch of name) {
      const fc = FACE_COORD[ch];
      for (let i = 0; i < 3; i++) {
        c[i] += fc[i];
      }
    }
    return c;
  }

  // cubie 元素按「块」建 DOM（贴纸随之移动），id 为其复原态格位名
  const CUBIES = []
    .concat(
      CORNER_NAMES.map((name, piece) => ({ id: name, kind: 'corner', piece, coord: coordFromName(name) }))
    )
    .concat(
      EDGE_NAMES.map((name, piece) => ({ id: name, kind: 'edge', piece, coord: coordFromName(name) }))
    )
    .concat(
      CENTER_NAMES.map((name, piece) => ({ id: name, kind: 'center', piece, coord: FACE_COORD[name].slice() }))
    );

  const CSS_NORMAL = { U: [0, -1, 0], D: [0, 1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] };

  // ---------- 3x3 矩阵（行主序） ----------

  function mat3Identity() {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }

  function mat3Mul(a, b) {
    const out = new Array(9);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
      }
    }
    return out;
  }

  function transpose3(m) {
    return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
  }

  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  function mat3FromColumns(c0, c1, c2) {
    return [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]];
  }

  /**
   * 由「贴纸法向映射」重建块的整体旋转：
   * 块的第 j 张贴纸复原态法向 n_j（= 其基准色面的法向），当前法向 m_j
   * （= 所在格位、按 ori 偏移后的面贴纸所在面的法向）。R·n_j = m_j 唯一确定 R。
   */
  function rotationFor(kind, piece, slot, ori) {
    if (kind === 'center') {
      return mat3Identity();
    }
    const colorTable = kind === 'corner' ? Rubik.CORNER_COLOR : Rubik.EDGE_COLOR;
    const faceletTable = kind === 'corner' ? Rubik.CORNER_FACELET : Rubik.EDGE_FACELET;
    const count = colorTable[piece].length;

    const n0 = CSS_NORMAL[colorTable[piece][0]];
    const n1 = CSS_NORMAL[colorTable[piece][1]];
    const f0 = faceletTable[slot][ori % count];
    const f1 = faceletTable[slot][(1 + ori) % count];
    const m0 = CSS_NORMAL['URFDLB'[Math.floor(f0 / 9)]];
    const m1 = CSS_NORMAL['URFDLB'[Math.floor(f1 / 9)]];

    const N = mat3FromColumns(n0, n1, cross(n0, n1));
    const M = mat3FromColumns(m0, m1, cross(m0, m1));
    return mat3Mul(M, transpose3(N));
  }

  // ---------- 输出 ----------

  function fmt(n) {
    return String(Math.round(n * 1e6) / 1e6);
  }

  function cssCoord(worldCoord) {
    return [worldCoord[0] * CELL_PX, -worldCoord[1] * CELL_PX, worldCoord[2] * CELL_PX];
  }

  function matrix3dString(R) {
    // 列主序：matrix3d(col0..., col1..., col2..., 平移列)
    return (
      `matrix3d(${fmt(R[0])},${fmt(R[3])},${fmt(R[6])},0,` +
      `${fmt(R[1])},${fmt(R[4])},${fmt(R[7])},0,` +
      `${fmt(R[2])},${fmt(R[5])},${fmt(R[8])},0,` +
      `0,0,0,1)`
    );
  }

  function baseTransform(worldCoord, R) {
    const c = cssCoord(worldCoord);
    return `translate3d(${fmt(c[0])}px,${fmt(c[1])}px,${fmt(c[2])}px) ` + matrix3dString(R);
  }

  function findSlot(cube, cubie) {
    if (cubie.kind === 'center') {
      return cubie.piece;
    }
    const table = cubie.kind === 'corner' ? cube.corners : cube.edges;
    return table.pos.indexOf(cubie.piece);
  }

  function oriAt(cube, cubie, slot) {
    if (cubie.kind === 'center') {
      return 0;
    }
    const table = cubie.kind === 'corner' ? cube.corners : cube.edges;
    return table.ori[slot];
  }

  function slotCoordOf(cubie, slot) {
    if (cubie.kind === 'center') {
      return cubie.coord;
    }
    const names = cubie.kind === 'corner' ? CORNER_NAMES : EDGE_NAMES;
    return coordFromName(names[slot]);
  }

  /**
   * 渲染纯函数：返回 {cubieId: transformString}。
   * animatingMove 为 move 记号（如 "U" / "U'" / "U2"），t ∈ [0,1] 为动画进度；
   * 动层内 cubie 前乘绕轴旋转（绕魔方中心轴），保证 t=1 与提交逻辑状态后的
   * 整数格位基变换精确衔接（无浮点漂移）。
   */
  function computeTransforms(cube, animatingMove, t) {
    let anim = null;
    if (animatingMove) {
      const token = Rubik.parseMoves(animatingMove)[0];
      const face = token[0];
      const totalDeg = token.length === 1 ? 90 : token[1] === '2' ? 180 : -90;
      const axisWorld = FACE_COORD[face];
      anim = {
        axisWorld,
        cssAxis: [axisWorld[0], -axisWorld[1], axisWorld[2]],
        totalDeg,
        progress: t == null ? 1 : t,
      };
    }

    const result = {};
    for (const cubie of CUBIES) {
      const slot = findSlot(cube, cubie);
      const coord = slotCoordOf(cubie, slot);
      const R = rotationFor(cubie.kind, cubie.piece, slot, oriAt(cube, cubie, slot));
      let str = baseTransform(coord, R);
      if (anim) {
        const axis = anim.axisWorld;
        if (coord[0] * axis[0] + coord[1] * axis[1] + coord[2] * axis[2] === 1) {
          const deg = anim.totalDeg * anim.progress;
          str =
            `rotate3d(${fmt(anim.cssAxis[0])},${fmt(anim.cssAxis[1])},${fmt(anim.cssAxis[2])},${fmt(deg)}deg) ` +
            str;
        }
      }
      result[cubie.id] = str;
    }
    return result;
  }

  Rubik.COLORS = COLORS;
  Rubik.FACE_BRIGHTNESS = FACE_BRIGHTNESS;
  Rubik.shadeColor = shadeColor;
  Rubik.CUBIES = CUBIES;
  Rubik.CELL_PX = CELL_PX;
  Rubik.computeTransforms = computeTransforms;
})(typeof window !== 'undefined' ? window : globalThis);
