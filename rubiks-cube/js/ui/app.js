/**
 * 应用装配：状态 + 渲染 + rAF 动画 + FIFO 输入队列 + 按钮面板 + 计时（§D5）。
 * 打乱/求解按钮仍为禁用占位，由后续域（QIQ-27/QIQ-28）接入。
 */
(function (global) {
  'use strict';

  const Rubik = global.Rubik;
  const MOVE_DURATION_MS = 160; // 手动转动 160ms/步（§D3）
  const DEFAULT_VIEW = 'rotateX(-28deg) rotateY(-34deg)'; // 固定视角，U/F/R 三面可见

  const holder = { cube: Rubik.Cube.solved() };
  let generation = 0; // 重置时递增，使进行中的动画放弃提交过期状态

  // 视角旋转设在 .scene 上（perspective 作用于其直接子层，见 css/style.css）
  const viewEl = global.document.querySelector('.scene');
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

  // ---------- 计时（§D5）：时间戳差值 + now() 注入，running 期间 rAF 仅刷新显示 ----------
  const timer = Rubik.createTimer({ now: function () {
    return Date.now();
  } });

  // 开始/停止同一按钮：armed → start，running → stop；其余状态由状态机忽略
  function toggleTimer() {
    if (timer.getState() === 'running') {
      timer.stop();
    } else {
      timer.start();
    }
  }

  Rubik.buildButtonPanel(global.document.querySelector('.panel'), {
    onMove: function (move) {
      queue.enqueue(move);
    },
    onReset: resetCube,
    onResetView: resetView,
    onTimer: toggleTimer,
  });

  const timerDisplay = global.document.querySelector('.timer-display');
  let displayRaf = 0; // running 期间的实时刷新循环句柄

  function stopDisplayLoop() {
    if (displayRaf) {
      global.cancelAnimationFrame(displayRaf);
      displayRaf = 0;
    }
  }

  timer.subscribe(function (state) {
    timerDisplay.textContent = Rubik.formatTime(timer.getElapsed());
    if (state === 'running') {
      const loop = function () {
        timerDisplay.textContent = Rubik.formatTime(timer.getElapsed());
        displayRaf = global.requestAnimationFrame(loop);
      };
      displayRaf = global.requestAnimationFrame(loop);
    } else {
      stopDisplayLoop();
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
