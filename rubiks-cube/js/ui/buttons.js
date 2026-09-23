/**
 * 按钮键盘与输入队列（§D3）：12 个面转按钮按面分组并标注面色；
 * 动画进行中的操作进入 FIFO 队列，防状态错乱。
 * createMoveQueue 为纯逻辑工厂（可测）；buildButtonPanel 为 DOM 装配薄层（手工清单兜底）。
 */
(function (global) {
  'use strict';

  const Rubik = (global.Rubik = global.Rubik || {});

  /**
   * FIFO 操作队列。
   * executor: { execute(move, done), busy? } —— execute 开始一步操作，
   * 完成时必须调用 done()；done 前到达的操作按序排队。
   */
  function createMoveQueue(executor) {
    const pending = [];
    let running = false;

    function start(move) {
      running = true;
      executor.execute(move, function () {
        running = false;
        if (pending.length > 0) {
          start(pending.shift());
        }
      });
    }

    return {
      enqueue(move) {
        if (running) {
          pending.push(move);
        } else {
          start(move);
        }
      },
      clear() {
        pending.length = 0;
      },
      get pendingCount() {
        return pending.length;
      },
      get running() {
        return running;
      },
    };
  }

  // ---------- DOM 装配薄层（浏览器环境） ----------

  const FACE_LABELS = { U: '上', R: '右', F: '前', D: '下', L: '左', B: '后' };

  function el(tag, className, text) {
    const node = global.document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text != null) {
      node.textContent = text;
    }
    return node;
  }

  /**
   * 构建按钮面板。callbacks: { onMove(move), onReset(), onResetView(),
   * onTimer? } —— 计时开始/停止已接入（§D5）；打乱/求解仍为禁用占位（域2/域4 接入）。
   * 面板内含 .timer-display 成绩展示元素（m:ss.cs）。
   */
  function buildButtonPanel(container, callbacks) {
    const doc = global.document;
    const panel = el('div', 'btn-panel');

    // 12 个面转按钮，按面分组并标注面色
    for (const face of ['U', 'R', 'F', 'D', 'L', 'B']) {
      const group = el('div', 'btn-group');
      const swatch = el('span', 'face-swatch');
      swatch.style.backgroundColor = Rubik.COLORS[face];
      group.appendChild(swatch);
      group.appendChild(el('span', 'face-label', `${FACE_LABELS[face]} ${face}`));

      const cw = doc.createElement('button');
      cw.className = 'btn btn-move';
      cw.textContent = face;
      cw.title = `${face} 顺时针 90°（从 ${face} 面外侧看）`;
      cw.addEventListener('click', function () {
        callbacks.onMove(face);
      });
      const ccw = doc.createElement('button');
      ccw.className = 'btn btn-move';
      ccw.textContent = face + "'";
      ccw.title = `${face}' 逆时针 90°`;
      ccw.addEventListener('click', function () {
        callbacks.onMove(face + "'");
      });
      group.appendChild(cw);
      group.appendChild(ccw);
      panel.appendChild(group);
    }

    // 功能区
    const actions = el('div', 'btn-actions');
    // 计时成绩展示（m:ss.cs，§D5）：stopped 后保留成绩，由 app.js 订阅刷新
    const timerDisplay = el('div', 'timer-display', '0:00.00');
    actions.appendChild(timerDisplay);
    function actionButton(label, cls, disabled, onClick) {
      const b = doc.createElement('button');
      b.className = 'btn ' + cls;
      b.textContent = label;
      b.disabled = !!disabled;
      if (!disabled && onClick) {
        b.addEventListener('click', onClick);
      }
      return b;
    }
    actions.appendChild(actionButton('打乱', 'btn-func', true, null));
    actions.appendChild(actionButton('求解', 'btn-func', true, null));
    actions.appendChild(actionButton('计时开始/停止', 'btn-func', false, function () {
      if (callbacks.onTimer) {
        callbacks.onTimer();
      }
    }));
    actions.appendChild(actionButton('重置', 'btn-func', false, function () {
      callbacks.onReset();
    }));
    actions.appendChild(actionButton('重置视角', 'btn-func', false, function () {
      callbacks.onResetView();
    }));
    panel.appendChild(actions);

    container.appendChild(panel);
    return panel;
  }

  Rubik.createMoveQueue = createMoveQueue;
  Rubik.buildButtonPanel = buildButtonPanel;
})(typeof window !== 'undefined' ? window : globalThis);
