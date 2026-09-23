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

  /**
   * 带代际（generation）守卫的单步动画执行器（§D3 状态一致性）：
   * 重置会递增 generation 使进行中的动画过期——过期动画不得污染重置后的
   * 基准快照，过期完成时不得提交过期 move，done() 始终回调（防队列卡死）。
   *
   * deps: {
   *   getGeneration()                      —— 读取当前代际
   *   animateProgress(ms, onFrame, onDone) —— 动画驱动（可注入假 rAF 便于测试）
   *   renderFrame(move, t)                 —— 动画帧渲染
   *   renderCurrent()                      —— 过期完成时按当前逻辑态重算基变换
   *   commit(move)                         —— 正常完成：先提交逻辑状态再重算基变换
   * }
   */
  function createGuardedAnimator(deps) {
    return {
      run(durationMs, move, done) {
        const gen = deps.getGeneration();
        deps.animateProgress(
          durationMs,
          function (t) {
            if (gen !== deps.getGeneration()) {
              return; // 过期帧：放弃渲染，不得污染重置后的基准快照
            }
            deps.renderFrame(move, t);
          },
          function () {
            if (gen === deps.getGeneration()) {
              deps.commit(move);
            } else {
              deps.renderCurrent(); // 过期完成：不提交，按当前逻辑态重算基变换
            }
            done();
          }
        );
      },
    };
  }
  Rubik.createGuardedAnimator = createGuardedAnimator;
})(typeof window !== 'undefined' ? window : globalThis);
