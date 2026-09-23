'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

require('../js/render/animate.js');
const { createGuardedAnimator } = globalThis.Rubik;

/** 可手动驱动的假动画驱动（注入 createGuardedAnimator，代替真实 rAF）。 */
function fakeAnimator() {
  const runs = [];
  return {
    runs,
    // 与 animateProgress(durationMs, onFrame, onDone) 同签名
    animateProgress(_ms, onFrame, onDone) {
      const run = { onFrame, onDone };
      runs.push(run);
      return run;
    },
    // 与真实 rAF 一致：各次动画的循环各自独立走到收尾，按 index（默认最新）驱动
    frame(t, index) {
      runs[index === undefined ? runs.length - 1 : index].onFrame(t);
    },
    finish(index) {
      const run = runs[index === undefined ? runs.length - 1 : index];
      run.onFrame(1); // 收尾帧 t=1
      run.onDone();
    },
  };
}

function makeHarness() {
  const fake = fakeAnimator();
  const calls = { frames: [], commits: [], renderCurrentCount: 0 };
  let generation = 0;
  return {
    calls,
    fake,
    bumpGeneration() {
      generation++;
    },
    deps: {
      getGeneration() {
        return generation;
      },
      animateProgress: fake.animateProgress,
      renderFrame(move, t) {
        calls.frames.push([move, t]);
      },
      renderCurrent() {
        calls.renderCurrentCount++;
      },
      commit(move) {
        calls.commits.push(move);
      },
    },
  };
}

test('对照组：无重置的完整动画逐帧渲染，t=1 提交 move', () => {
  const h = makeHarness();
  const animator = createGuardedAnimator(h.deps);
  let done = false;
  animator.run(160, 'U', function () {
    done = true;
  });
  h.fake.frame(0);
  h.fake.frame(0.5);
  h.fake.finish();
  assert.deepEqual(h.calls.frames, [['U', 0], ['U', 0.5], ['U', 1]], '逐帧渲染至 t=1');
  assert.deepEqual(h.calls.commits, ['U'], '正常完成应提交 move');
  assert.equal(h.calls.renderCurrentCount, 0, '正常完成无需额外重绘');
  assert.equal(done, true, 'done 必须回调');
});

test('🟠1：重置后代际递增，过期动画帧不得渲染（不得污染重置后基准快照）', () => {
  const h = makeHarness();
  const animator = createGuardedAnimator(h.deps);
  animator.run(160, 'U', function () {});
  h.bumpGeneration(); // 模拟动画进行中点击「重置」
  h.fake.frame(0.5); // 重置后到达的过期帧
  h.fake.finish(); // 过期收尾
  assert.equal(h.calls.frames.length, 0, '过期帧不得渲染，界面应保持重置后的基准快照');
});

test('🟠1：过期完成不提交过期 move，按当前逻辑态重算基变换，done 照常回调', () => {
  const h = makeHarness();
  const animator = createGuardedAnimator(h.deps);
  let done = false;
  animator.run(160, 'U', function () {
    done = true;
  });
  h.bumpGeneration(); // 重置
  h.fake.finish();
  assert.deepEqual(h.calls.commits, [], '过期完成不得提交过期 move');
  assert.equal(h.calls.renderCurrentCount, 1, '过期完成应按当前逻辑态重算基变换');
  assert.equal(done, true, 'done 必须回调，避免输入队列卡死');
});

test('🟠1：过期后重开的动画按新代际正常提交', () => {
  const h = makeHarness();
  const animator = createGuardedAnimator(h.deps);
  animator.run(160, 'U', function () {});
  h.bumpGeneration(); // 重置，旧动画过期
  animator.run(160, 'R', function () {}); // 重置后用户再次转动
  h.fake.finish(0); // 过期 U 动画的 rAF 循环走完（真实浏览器中仍会到达 t=1）
  h.fake.finish(1); // 新 R 动画完成
  assert.deepEqual(h.calls.commits, ['R'], '新代际动画正常提交');
  assert.equal(h.calls.renderCurrentCount, 1, '仅过期动画触发一次重绘');
  assert.deepEqual(h.calls.frames, [['R', 1]], '过期帧不渲染，新动画帧正常');
});
