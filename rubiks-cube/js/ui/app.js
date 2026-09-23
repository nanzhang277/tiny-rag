/**
 * 应用装配（§域1 范围）：状态 + 渲染 + rAF 动画 + FIFO 输入队列 + 按钮面板。
 * 打乱/求解/计时按钮为本期禁用占位，由后续域（S2/S3）接入。
 */
(function (global) {
  'use strict';

  const Rubik = global.Rubik;
  const MOVE_DURATION_MS = 160; // 手动转动 160ms/步（§D3）
  const DEFAULT_VIEW = 'rotateX(-28deg) rotateY(-34deg)'; // 固定视角，U/F/R 三面可见

  const holder = { cube: Rubik.Cube.solved() };
  let generation = 0; // 重置时递增，使进行中的动画放弃提交过期状态

  const viewEl = global.document.querySelector('.cube-view');
  viewEl.style.transform = DEFAULT_VIEW;

  const cubeView = Rubik.mountCube(global.document.querySelector('.scene'));

  function commit(move) {
    // 动画完成：先提交逻辑状态，再按整数格位重算基变换（§D3，无浮点漂移）
    holder.cube = Rubik.applyMove(holder.cube, move);
    cubeView.render(holder.cube);
  }

  const queue = Rubik.createMoveQueue({
    execute(move, done) {
      const gen = generation;
      Rubik.animateProgress(
        MOVE_DURATION_MS,
        function (t) {
          cubeView.render(holder.cube, move, t);
        },
        function () {
          if (gen === generation) {
            commit(move);
          }
          done();
        }
      );
    },
  });

  function resetCube() {
    generation++;
    queue.clear();
    holder.cube = Rubik.Cube.solved();
    cubeView.render(holder.cube);
  }

  function resetView() {
    viewEl.style.transform = DEFAULT_VIEW;
  }

  Rubik.buildButtonPanel(global.document.querySelector('.panel'), {
    onMove: function (move) {
      queue.enqueue(move);
    },
    onReset: resetCube,
    onResetView: resetView,
  });
})(typeof window !== 'undefined' ? window : globalThis);
