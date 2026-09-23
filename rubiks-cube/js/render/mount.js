/**
 * DOM 装配薄层（§D3）：创建 26 个 .cubie × 6 .sticker，
 * 仅负责把 computeTransforms 的结果写入元素 style —— 全部几何决策在纯函数中。
 * 贴纸取色来自 toFacelets()（§D2：facelet 视图仅用于渲染取色）。
 */
(function (global) {
  'use strict';

  const Rubik = (global.Rubik = global.Rubik || {});

  const PLASTIC = '#0d0d0f'; // 魔方本体（不可见内面）颜色

  // 贴纸所在面：CSS 定位用旋转 + translateZ 推到立方体表面
  const STICKER_FACE_TRANSFORM = {
    U: 'rotateX(90deg)',
    D: 'rotateX(-90deg)',
    R: 'rotateY(90deg)',
    L: 'rotateY(-90deg)',
    F: '',
    B: 'rotateY(180deg)',
  };

  function halfCell() {
    return Rubik.CELL_PX / 2;
  }

  function buildSticker(doc, face, color) {
    const sticker = doc.createElement('div');
    sticker.className = 'sticker sticker-' + face;
    sticker.style.background = color;
    return sticker;
  }

  /**
   * 在 sceneEl 内装配魔方 DOM，返回渲染句柄。
   * render(state, animatingMove?, t?)：把纯函数输出写入每个 cubie。
   */
  function mountCube(sceneEl) {
    const doc = global.document;
    const solved = Rubik.Cube.solved();
    const facelets = solved.toFacelets(); // solved 基准快照：贴纸颜色由此取

    sceneEl.style.setProperty('--cell', Rubik.CELL_PX + 'px');
    const cubeEl = doc.createElement('div');
    cubeEl.className = 'cube';
    sceneEl.appendChild(cubeEl);

    const elements = {};
    for (const cubie of Rubik.CUBIES) {
      const el = doc.createElement('div');
      el.className = 'cubie cubie-' + cubie.kind;
      el.dataset.cubie = cubie.id;

      // 该块每张贴纸的颜色：贴纸 j 的颜色 = solved 态其对应面贴纸的颜色
      let stickerColors = null;
      if (cubie.kind === 'corner') {
        stickerColors = Rubik.CORNER_COLOR[cubie.piece].map(function (faceLetter, j) {
          return Rubik.COLORS[facelets[Rubik.CORNER_FACELET[cubie.piece][j]]];
        });
      } else if (cubie.kind === 'edge') {
        stickerColors = Rubik.EDGE_COLOR[cubie.piece].map(function (faceLetter, j) {
          return Rubik.COLORS[facelets[Rubik.EDGE_FACELET[cubie.piece][j]]];
        });
      } else {
        stickerColors = [Rubik.COLORS[facelets[faceletIndexOfCenter(cubie.id)]]];
      }

      // 6 个面：可见贴纸上色，其余为本体塑料色
      const coloredByFace = {};
      const colorTable = cubie.kind === 'corner' ? Rubik.CORNER_COLOR[cubie.piece]
        : cubie.kind === 'edge' ? Rubik.EDGE_COLOR[cubie.piece]
        : [cubie.id];
      colorTable.forEach(function (faceLetter, j) {
        coloredByFace[faceLetter] = stickerColors[j];
      });
      for (const face of ['U', 'D', 'R', 'L', 'F', 'B']) {
        const color = coloredByFace[face] || PLASTIC;
        const sticker = buildSticker(doc, face, color);
        const rot = STICKER_FACE_TRANSFORM[face];
        sticker.style.transform = `${rot} translateZ(${halfCell()}px)`;
        el.appendChild(sticker);
      }

      cubeEl.appendChild(el);
      elements[cubie.id] = el;
    }

    function render(state, animatingMove, t) {
      const transforms = Rubik.computeTransforms(state, animatingMove, t);
      for (const id of Object.keys(transforms)) {
        elements[id].style.transform = transforms[id];
      }
    }

    render(solved);
    return { render: render, cubeEl: cubeEl, elements: elements };
  }

  function faceletIndexOfCenter(face) {
    const faceIndex = 'URFDLB'.indexOf(face);
    return faceIndex * 9 + 4;
  }

  Rubik.mountCube = mountCube;
})(typeof window !== 'undefined' ? window : globalThis);
