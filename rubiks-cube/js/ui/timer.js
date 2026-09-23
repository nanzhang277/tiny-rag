/**
 * 计时功能（§D5）：四态状态机 idle → armed → running → stopped，
 * 开始/停止为手动按钮；时钟 now() 可注入，实现基于时间戳差值（不用 setInterval 计数）。
 * createTimer/formatTime 为纯逻辑工厂（可测）；DOM 接线在 app.js（手工清单兜底）。
 */
(function (global) {
  'use strict';

  const Rubik = (global.Rubik = global.Rubik || {});

  const pad2 = function (n) {
    return String(n).padStart(2, '0');
  };

  /** 时长 ms → "m:ss.cs"（厘秒向下截断）。 */
  function formatTime(ms) {
    const totalCs = Math.floor(ms / 10);
    const m = Math.floor(totalCs / 6000);
    const ss = pad2(Math.floor(totalCs / 100) % 60);
    const cs = pad2(totalCs % 100);
    return `${m}:${ss}.${cs}`;
  }

  Rubik.formatTime = formatTime;

  /**
   * 计时状态机。clock: { now() } 可注入假时钟。
   * 迁移（§D5）：idle →(打乱完成)→ armed →(开始)→ running →(停止)→ stopped →(重置/再打乱)→ idle。
   * 非法迁移调用一律忽略并保持原状态（按钮驱动 UI，无效操作不抛错）。
   */
  function createTimer(clock) {
    const now = clock.now;
    let state = 'idle';
    let startedAt = 0; // running 起点（ms 时间戳）
    let stoppedAt = 0; // stopped 定格点（ms 时间戳）
    const listeners = [];

    function notify() {
      for (const listener of listeners) {
        listener(state, getElapsed());
      }
    }

    function getElapsed() {
      if (state === 'running') {
        return now() - startedAt;
      }
      if (state === 'stopped') {
        return stoppedAt - startedAt;
      }
      return 0;
    }

    return {
      getState() {
        return state;
      },
      getElapsed,
      /** 订阅迁移通知：listener(state, elapsedMs)，仅成功迁移时调用。 */
      subscribe(listener) {
        listeners.push(listener);
      },
      /** 打乱完成（域2 接线调用）：idle → armed。 */
      onScrambleDone() {
        if (state === 'idle') {
          state = 'armed';
          notify();
        }
      },
      /** 手动开始：armed → running。 */
      start() {
        if (state === 'armed') {
          startedAt = now();
          state = 'running';
          notify();
        }
      },
      /** 手动停止：running → stopped，成绩定格保留。 */
      stop() {
        if (state === 'running') {
          stoppedAt = now();
          state = 'stopped';
          notify();
        }
      },
      /** 重置/再打乱：stopped 或 armed → idle，清零展示。 */
      reset() {
        if (state === 'stopped' || state === 'armed') {
          startedAt = 0;
          stoppedAt = 0;
          state = 'idle';
          notify();
        }
      },
    };
  }

  Rubik.createTimer = createTimer;
})(typeof window !== 'undefined' ? window : globalThis);
