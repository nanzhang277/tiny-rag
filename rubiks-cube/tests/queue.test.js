'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

require('../js/core/notation.js');
require('../js/ui/buttons.js');
const { createMoveQueue } = globalThis.Rubik;

/** 手动驱动done 的假执行器：记录执行顺序，测试里逐个放行。 */
function fakeExecutor() {
  const started = [];
  let pendingDone = null;
  return {
    started,
    execute(move, done) {
      started.push(move);
      pendingDone = done;
    },
    finish() {
      const d = pendingDone;
      pendingDone = null;
      if (d) {
        d();
      }
    },
    get busy() {
      return pendingDone !== null;
    },
  };
}

test('空闲时入队立即执行', () => {
  const ex = fakeExecutor();
  const queue = createMoveQueue(ex);
  queue.enqueue('R');
  assert.deepEqual(ex.started, ['R']);
});

test('动画进行中入队进入 FIFO 队列，完成后再依次执行', () => {
  const ex = fakeExecutor();
  const queue = createMoveQueue(ex);
  queue.enqueue('R');
  queue.enqueue('U');
  queue.enqueue("R'");
  assert.deepEqual(ex.started, ['R'], '忙时后续操作应排队');
  ex.finish();
  assert.deepEqual(ex.started, ['R', 'U'], '完成后应启动队首');
  ex.finish();
  ex.finish();
  assert.deepEqual(ex.started, ['R', 'U', "R'"], 'FIFO 顺序');
  // 队列清空后不再执行
  ex.finish();
  assert.deepEqual(ex.started, ['R', 'U', "R'"]);
});

test('done 前不会启动下一个操作', () => {
  const ex = fakeExecutor();
  const queue = createMoveQueue(ex);
  queue.enqueue('F');
  queue.enqueue('B');
  assert.deepEqual(ex.started, ['F']);
  assert.equal(ex.busy, true);
  ex.finish();
  assert.deepEqual(ex.started, ['F', 'B']);
});

test('清空队列', () => {
  const ex = fakeExecutor();
  const queue = createMoveQueue(ex);
  queue.enqueue('R');
  queue.enqueue('L');
  queue.clear();
  ex.finish();
  assert.deepEqual(ex.started, ['R'], 'clear 应丢弃未执行的操作');
  assert.equal(queue.pendingCount, 0);
});
