'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

require('../js/core/notation.js');
require('../js/core/cube.js');
require('../js/core/moves.js');
require('../js/render/transforms.js');
const { Cube, applyMove, computeTransforms, COLORS, shadeColor } = globalThis.Rubik;

// ---------- 测试自含的 CSS 3D 矩阵工具（列主序，与浏览器 matrix3d 一致） ----------

function identity4() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function mul4(a, b) {
  // 列主序 4x4：out[col*4+row] = Σ a[k*4+row] * b[col*4+k]
  const out = new Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        s += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = s;
    }
  }
  return out;
}

function rotAxisAngle(axis, deg) {
  // CSS rotate3d：绕轴右手旋转（标准 Rodrigues，与浏览器约定一致）
  const [x, y, z] = axis;
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const t = 1 - c;
  // 行主序的旋转矩阵，转成列主序数组
  const m = [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
  return [m[0], m[3], m[6], 0, m[1], m[4], m[7], 0, m[2], m[5], m[8], 0, 0, 0, 0, 1];
}

function applyToPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
  ];
}

/** 解析 'rotate3d(...) translate3d(...) matrix3d(...)' → 复合后的 4x4（列主序）。 */
function parseTransform(str) {
  let m = identity4();
  const re = /(rotate3d|translate3d|matrix3d)\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(str)) !== null) {
    const args = match[2].split(',').map((s) => parseFloat(s));
    let f;
    if (match[1] === 'rotate3d') {
      f = rotAxisAngle(args.slice(0, 3), args[3]);
    } else if (match[1] === 'translate3d') {
      f = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, args[0], args[1], args[2], 1];
    } else {
      f = args;
    }
    m = mul4(m, f);
  }
  return m;
}

function assertVecClose(actual, expected, tol, msg) {
  for (let i = 0; i < expected.length; i++) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= tol,
      `${msg} 分量 ${i}: ${actual[i]} ≁ ${expected[i]}`
    );
  }
}

function assertMatClose(actual, expected, tol, msg) {
  assertVecClose(actual, expected, tol, msg);
}

/** CSS 坐标系基向量：css = (x, -y, z)，世界 y 向上。 */
const CSS_NORMAL = {
  U: [0, -1, 0],
  D: [0, 1, 0],
  R: [1, 0, 0],
  L: [-1, 0, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
};

const FACE_AXIS_CSS = {
  U: [0, -1, 0],
  D: [0, 1, 0],
  R: [1, 0, 0],
  L: [-1, 0, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
};

// ---------- 配色常量与亮度 ----------

test('配色常量符合规格（§D3）', () => {
  assert.equal(COLORS.U, '#FFFFFF');
  assert.equal(COLORS.D, '#FFD500');
  assert.equal(COLORS.F, '#009B48');
  assert.equal(COLORS.B, '#0046AD');
  assert.equal(COLORS.R, '#B90000');
  assert.equal(COLORS.L, '#FF5900');
});

test('shadeColor 按亮度系数缩放 RGB', () => {
  assert.equal(shadeColor('#FFFFFF', 0), 'rgb(0,0,0)');
  assert.equal(shadeColor('#FFD500', 1), 'rgb(255,213,0)');
  assert.equal(shadeColor('#009B48', 0.5), 'rgb(0,78,36)');
});

// ---------- 测试8：渲染纯函数 ----------

// 26 个 cubie 的 id → css 平移基准（世界坐标 → css = (x, -y, z)，格距 34px）
const CELL = 34;
const HOME_CSS = {
  URF: [1, -1, 1], UFL: [-1, -1, 1], ULB: [-1, -1, -1], UBR: [1, -1, -1],
  DFR: [1, 1, 1], DLF: [-1, 1, 1], DBL: [-1, 1, -1], DRB: [1, 1, -1],
  UR: [1, -1, 0], UF: [0, -1, 1], UL: [-1, -1, 0], UB: [0, -1, -1],
  DR: [1, 1, 0], DF: [0, 1, 1], DL: [-1, 1, 0], DB: [0, 1, -1],
  FR: [1, 0, 1], FL: [-1, 0, 1], BL: [-1, 0, -1], BR: [1, 0, -1],
  U: [0, -1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, 1, 0], L: [-1, 0, 0], B: [0, 0, -1],
};
const CUBIE_IDS = Object.keys(HOME_CSS);
const IDENT_3D = 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)';

test('测试8：solved 态输出 26 个 transform 快照（基准位置 + 恒等旋转）', () => {
  const transforms = computeTransforms(Cube.solved());
  assert.equal(Object.keys(transforms).length, 26);
  for (const id of CUBIE_IDS) {
    const [x, y, z] = HOME_CSS[id];
    assert.equal(
      transforms[id],
      `translate3d(${x * CELL}px,${y * CELL}px,${z * CELL}px) ` + IDENT_3D,
      `cubie ${id}`
    );
  }
});

test('测试8：单步 R 后受影响 cubie 抽样（URF 块到 UBR 位，贴纸法向按 R 顺时针映射）', () => {
  const after = applyMove(Cube.solved(), 'R');
  const transforms = computeTransforms(after);

  const m = parseTransform(transforms.URF);
  assertMatClose(
    [m[12], m[13], m[14]],
    [HOME_CSS.UBR[0] * CELL, HOME_CSS.UBR[1] * CELL, HOME_CSS.UBR[2] * CELL],
    1e-9,
    'URF 块平移到 UBR 格位'
  );
  // URF 块三张贴纸的法向：U→B、R→R、F→U（R 顺时针：从右侧看 U→B、F→U）
  assertVecClose(applyToPoint(m, CSS_NORMAL.U), CSS_NORMAL.B, 1e-9, 'U 贴纸 → B');
  assertVecClose(applyToPoint(m, CSS_NORMAL.R), CSS_NORMAL.R, 1e-9, 'R 贴纸 → R');
  assertVecClose(applyToPoint(m, CSS_NORMAL.F), CSS_NORMAL.U, 1e-9, 'F 贴纸 → U');

  // 不在 R 层的 cubie 位置不变（抽样 UFL 与中心 U）
  assertMatClose(parseTransform(transforms.UFL), parseTransform(computeTransforms(Cube.solved()).UFL), 0, 'UFL 不受影响');
  assertMatClose(parseTransform(transforms.F), parseTransform(computeTransforms(Cube.solved()).F), 0, 'F 中心不受影响');
});

test('测试8：动画连续性 —— 6 个基本 move 在 t=0 / t=1 与逻辑状态衔接无漂移', () => {
  for (const face of ['U', 'R', 'F', 'D', 'L', 'B']) {
    const before = Cube.solved();
    const after = applyMove(before, face);
    const baseBefore = computeTransforms(before);
    const baseAfter = computeTransforms(after);
    const at0 = computeTransforms(before, face, 0);
    const at1 = computeTransforms(before, face, 1);
    for (const id of CUBIE_IDS) {
      assertMatClose(parseTransform(at0[id]), parseTransform(baseBefore[id]), 1e-9, `${face} t=0 ${id}`);
      const m1 = parseTransform(at1[id]);
      const mBase = parseTransform(baseAfter[id]);
      if (id === face) {
        // 面中心块：cubie 模型不跟踪其绕法向的自转（单色可见贴纸，视觉无差异）。
        // 断言位置精确衔接且可见面法向不变。
        assertVecClose([m1[12], m1[13], m1[14]], [mBase[12], mBase[13], mBase[14]], 1e-9, `${face} t=1 中心位置 ${id}`);
        const n = CSS_NORMAL[id];
        assertVecClose(applyToPoint(m1, n), n, 1e-9, `${face} t=1 中心法向 ${id}`);
      } else {
        assertMatClose(m1, mBase, 1e-6, `${face} t=1 ${id}`);
      }
    }
  }
});

test('测试8：动画中非动层 cubie 变换保持不变', () => {
  const base = computeTransforms(Cube.solved());
  const mid = computeTransforms(Cube.solved(), 'U', 0.5);
  for (const id of CUBIE_IDS) {
    // U 动层：世界 y = +1 → css y = -34 的 cubie（HOME_CSS 第二分量为 -1）
    if (HOME_CSS[id][1] === -1) {
      assert.notEqual(mid[id], base[id], `动层 cubie ${id} 应带层旋转`);
    } else {
      assert.equal(mid[id], base[id], `非动层 cubie ${id} 应不变`);
    }
  }
});

test('测试8：动画角度单调驱动（t=0.5 时动层绕轴 45°）', () => {
  const mid = computeTransforms(Cube.solved(), 'U', 0.5);
  const m = parseTransform(mid.UF);
  // UF 的平移被层旋转半程带动：世界 (0,1,1) 绕 y 转 45° 后的 css 坐标
  const angle = (45 * Math.PI) / 180;
  const expectedX = Math.sin(angle) * CELL; // 前方点向左转：x = -z·sin... 取右手系验证
  const expectedZ = Math.cos(angle) * CELL;
  assertVecClose([m[12], m[13], m[14]], [-expectedX, -CELL, expectedZ], 1e-6, 'UF 半程位置');
});
