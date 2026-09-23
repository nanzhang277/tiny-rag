/**
 * rAF 动画驱动（§D3）：逐帧驱动进度参数 t: 0→1，
 * 不用 CSS transition 的 matrix 插值（90° 旋转矩阵插值路径不可控）。
 */
(function (global) {
  'use strict';

  const Rubik = (global.Rubik = global.Rubik || {});

  /**
   * 以 requestAnimationFrame 驱动 onFrame(t)，t ∈ [0,1]；
   * 结束时先以 t=1 收尾再调用 onDone()。
   */
  function animateProgress(durationMs, onFrame, onDone) {
    const start = global.performance.now();
    function step(now) {
      const t = Math.min((now - start) / durationMs, 1);
      onFrame(t);
      if (t < 1) {
        global.requestAnimationFrame(step);
      } else {
        onDone();
      }
    }
    global.requestAnimationFrame(step);
  }

  Rubik.animateProgress = animateProgress;
})(typeof window !== 'undefined' ? window : globalThis);
