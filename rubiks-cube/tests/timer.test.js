'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

require('../js/ui/timer.js');
const { formatTime, createTimer } = globalThis.Rubik;

/** 假时钟：手动推进的 now()。 */
function fakeClock(startMs) {
  let now = startMs;
  return {
    now: () => now,
    advance(ms) {
      now += ms;
    },
  };
}

test('formatTime: 0ms → "0:00.00"', () => {
  assert.strictEqual(formatTime(0), '0:00.00');
});

test('formatTime: 59000ms → "0:59.00"', () => {
  assert.strictEqual(formatTime(59000), '0:59.00');
});

test('formatTime: 60000ms → "1:00.00"', () => {
  assert.strictEqual(formatTime(60000), '1:00.00');
});

test('formatTime: 65430ms → "1:05.43"（厘秒）', () => {
  assert.strictEqual(formatTime(65430), '1:05.43');
});

test('formatTime: 65439ms → "1:05.43"（厘秒向下截断，不四舍五入）', () => {
  assert.strictEqual(formatTime(65439), '1:05.43');
});

test('createTimer: 初始状态 idle、经过时间 0', () => {
  const clock = fakeClock(1000);
  const timer = createTimer({ now: clock.now });
  assert.strictEqual(timer.getState(), 'idle');
  assert.strictEqual(timer.getElapsed(), 0);
});

test('start: armed → running，经过时间 = 时间戳差值（假时钟推进）', () => {
  const clock = fakeClock(1000);
  const timer = createTimer({ now: clock.now });
  timer.onScrambleDone();
  clock.advance(500);
  timer.start();
  assert.strictEqual(timer.getState(), 'running');
  assert.strictEqual(timer.getElapsed(), 0);
  clock.advance(1250);
  assert.strictEqual(timer.getElapsed(), 1250);
  clock.advance(8000);
  assert.strictEqual(timer.getElapsed(), 9250);
});

test('stop: running → stopped，成绩定格且保留展示（假时钟继续走也不变）', () => {
  const clock = fakeClock(1000);
  const timer = createTimer({ now: clock.now });
  timer.onScrambleDone();
  clock.advance(100);
  timer.start();
  clock.advance(4230);
  timer.stop();
  assert.strictEqual(timer.getState(), 'stopped');
  assert.strictEqual(timer.getElapsed(), 4230);
  clock.advance(9999);
  assert.strictEqual(timer.getElapsed(), 4230); // stopped 后保留成绩
});

test('reset: stopped → idle 清零；再打乱回路完整复跑（第二次成绩独立正确）', () => {
  const clock = fakeClock(1000);
  const timer = createTimer({ now: clock.now });
  timer.onScrambleDone();
  clock.advance(50);
  timer.start();
  clock.advance(3000);
  timer.stop();
  timer.reset();
  assert.strictEqual(timer.getState(), 'idle');
  assert.strictEqual(timer.getElapsed(), 0);

  // 再打乱回路：idle → armed → running → stopped
  timer.onScrambleDone();
  assert.strictEqual(timer.getState(), 'armed');
  clock.advance(200);
  timer.start();
  clock.advance(1750);
  timer.stop();
  assert.strictEqual(timer.getState(), 'stopped');
  assert.strictEqual(timer.getElapsed(), 1750);
});

test('非法迁移防护：§D5 迁移图之外的调用一律忽略并保持原状态', () => {
  const clock = fakeClock(1000);

  // idle 下：start/stop/reset 均无效
  const t1 = createTimer({ now: clock.now });
  t1.start();
  t1.stop();
  t1.reset();
  assert.strictEqual(t1.getState(), 'idle');

  // armed 下：stop / 再次 onScrambleDone 无效
  const t2 = createTimer({ now: clock.now });
  t2.onScrambleDone();
  t2.stop();
  t2.onScrambleDone();
  assert.strictEqual(t2.getState(), 'armed');
  assert.strictEqual(t2.getElapsed(), 0);

  // running 下：onScrambleDone / reset 无效（§D5 迁移图无 running 出口除 stop 外）
  const t3 = createTimer({ now: clock.now });
  t3.onScrambleDone();
  t3.start();
  clock.advance(500);
  t3.onScrambleDone();
  t3.reset();
  assert.strictEqual(t3.getState(), 'running');
  assert.strictEqual(t3.getElapsed(), 500);

  // stopped 下：stop / onScrambleDone 无效（须经 reset 回 idle 才能再打乱）
  const t4 = createTimer({ now: clock.now });
  t4.onScrambleDone();
  t4.start();
  clock.advance(100);
  t4.stop();
  t4.stop();
  t4.onScrambleDone();
  assert.strictEqual(t4.getState(), 'stopped');
  assert.strictEqual(t4.getElapsed(), 100);
});

test('reset: armed → idle（armed 中再次打乱时复位）', () => {
  const clock = fakeClock(1000);
  const timer = createTimer({ now: clock.now });
  timer.onScrambleDone();
  timer.reset();
  assert.strictEqual(timer.getState(), 'idle');
  assert.strictEqual(timer.getElapsed(), 0);
});

test('onScrambleDone: idle → armed（打乱完成的预留迁移）', () => {
  const clock = fakeClock(1000);
  const timer = createTimer({ now: clock.now });
  timer.onScrambleDone();
  assert.strictEqual(timer.getState(), 'armed');
  assert.strictEqual(timer.getElapsed(), 0);
});

test('subscribe: 每次成功迁移通知监听者（state 与 elapsed），无效调用不通知', () => {
  const clock = fakeClock(1000);
  const timer = createTimer({ now: clock.now });
  const events = [];
  timer.subscribe(function (state, elapsed) {
    events.push([state, elapsed]);
  });

  timer.onScrambleDone(); // → armed
  clock.advance(100);
  timer.start(); // → running
  clock.advance(2000);
  timer.stop(); // → stopped，定格 2000
  timer.stop(); // 无效，不通知
  timer.reset(); // → idle，清零
  timer.start(); // 无效，不通知

  assert.deepStrictEqual(events, [
    ['armed', 0],
    ['running', 0], // start 那一刻起表，elapsed 从 0 起算
    ['stopped', 2000],
    ['idle', 0],
  ]);
});
