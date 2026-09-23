# rubiks-cube —— 网页版三阶魔方

纯前端三阶魔方应用：CSS 3D 可视化、按钮键盘操作、（开发中）打乱 / 计时 / 层先法求解器。
零运行时依赖、无构建步骤，本地双击 `index.html` 即可运行。

> 当前进度：域 1（core 状态模型 + CSS 3D 可视化与按钮键盘交互）、域 3（计时：
> 状态机 + 手动开始/停止 + 成绩展示）已完成；
> 打乱（QIQ-27）、求解器（QIQ-28）、测试与 README 收口（QIQ-29）按串行链陆续接入。

## 本地运行

- **首选**：直接双击 `index.html`（经典 `<script>` 标签加载，file:// 协议可用）。
- 备选（可选）：在 `rubiks-cube/` 目录起静态服务器，如 `python3 -m http.server 8000`，访问 `http://localhost:8000`。

## 功能用法（当前）

- **12 个面转按钮**：`U U' R R' F F' D D' L L' B B'`，按面分组、左侧色块标注面色。
  字母含义见下方记号表；`X` = 该面顺时针 90°（从该面外侧看），`X'` = 逆时针。
  动画进行中点击会进入 FIFO 队列，按序依次执行（手动转动 160ms/步）。
- **重置**：魔方回到复原态（清空未执行的操作队列）。
- **重置视角**：恢复固定视角。
- **计时开始/停止**：四态状态机 `idle → armed → running → stopped`。
  当前「打乱完成 → armed」由打乱功能（QIQ-27）接线；armed 后点「计时开始/停止」开始计时，
  再点停止；stopped 后成绩保留展示，再次打乱或重置后回到 idle。
  展示格式 `m:ss.cs`（厘秒，向下截断）；实现基于时间戳差值（`now()` 可注入），不用 setInterval 计数。
- 打乱 / 求解按钮为禁用占位，由后续域接入。

## 配色表（常量定义于 `js/render/transforms.js`）

| 面 | 方位 | 颜色 | 色值 |
| --- | ---- | ---- | ---- |
| U | 上 | 白 | `#FFFFFF` |
| D | 下 | 黄 | `#FFD500` |
| F | 前 | 绿 | `#009B48` |
| B | 后 | 蓝 | `#0046AD` |
| R | 右 | 红 | `#B90000` |
| L | 左 | 橙 | `#FF5900` |

每面另有固定亮度系数模拟明暗（无光照）：U 1.0 / F 0.92 / R 0.80 / L 0.70 / B 0.60 / D 0.55。

## 记号表（Singmaster，§D2）

- `U R F D L B`：对应面的顺时针 90° 转，**顺时针 = 从该面外侧看**。
- `X'`：逆时针 90°；`X2`：180°。
- 18 个可执行 move 均由 6 张基本表（6 面顺时针 90°）幂次派生，无手写冗余表。
- 程序内 `parseMoves(str) ↔ formatMoves(seq)` 往返一致，非法记号报错。

## 架构说明

```
rubiks-cube/
  index.html            入口（经典 script，按依赖顺序加载）
  css/style.css         场景/贴纸/按钮样式（--cell 与 CELL_PX 同源）
  js/core/              领域核心（纯逻辑，Node 可测）
    notation.js         Singmaster 记号：parseMoves / formatMoves
    cube.js             cubie 状态模型（唯一事实源）+ toFacelets + isSolved
    moves.js            6 张基本 move 表 → 幂次派生 18 move；applyMove
    invariants.js       isSolvable / assertSolvable（三条不变量）
    solver/             求解器（后续域，暂空）
  js/render/
    transforms.js       渲染纯函数 computeTransforms + 配色/亮度常量
    animate.js          rAF 逐帧进度驱动（不用 CSS transition matrix 插值）
                        + 代际守卫动画执行器 createGuardedAnimator（重置后过期帧不渲染/不提交）
    mount.js            DOM 装配薄层：26 cubie × 6 sticker，仅写入 transform
  js/ui/
    buttons.js          12 面转按钮面板 + FIFO 输入队列（createMoveQueue 可测）
    timer.js            计时状态机 createTimer（now() 可注入）+ formatTime（可测）
    app.js              应用装配：状态/动画/提交时序/重置/计时接线
  tests/                node:test 单元与性质测试
```

关键设计（§D2/D3）：

- **cubie 模型是唯一事实源**：`corners/edges` 的 `pos/ori`；复原检测与状态判断都在模型上做；
  `toFacelets()` 的 54 贴纸数组仅用于渲染取色。
- **渲染是纯函数**：`computeTransforms(state, animatingMove?, t?) → {cubieId: transformString}`，
  DOM 层只负责写入；动画期间动层 cubie 前乘绕魔方中心轴的旋转，动画完成时
  **先提交逻辑状态、再按整数格位重算基变换**，杜绝浮点漂移累积。
- **坐标约定**：世界系 y 向上、z 朝前；CSS 系 `css = (x, -y, z)`；格距 `CELL_PX = 34`。

## 运行测试

```bash
cd rubiks-cube
node --test "tests/*.test.js"     # 等价于 node --test tests/（Node 22 对目录参数按脚本路径处理）
```

零第三方测试依赖，仅用 Node 内建 `node:test`。

## 手工验收清单

- [ ] 六面配色正确（对照上表；每面中心块颜色即该面基准色）。
- [ ] 动画方向与记号一致：任一面按钮，从该面外侧看顺时针按钮为顺时针旋转。
      逻辑锚点（已自动化）：每面顺时针转后邻面行/列按 U←F→… 循环正确、动画 t=1 与逻辑状态精确衔接。
- [ ] 12 个按钮全部可用，每项操作后魔方状态正确（动画结束无错位/漂移）。
- [ ] 动画进行中连续点击多个按钮：按点击顺序依次动画（FIFO）。
- [ ] 「重置」回到复原态；「重置视角」恢复默认视角。
- [ ] 计时开始/停止与展示：armed 后点「计时开始/停止」开始计时、再点停止，
      成绩以 `m:ss.cs` 保留展示。（注意：armed 由打乱完成触发，QIQ-27 接线前
      打乱按钮尚为占位，此项完整验证待打乱接入后进行；状态机本身已由假时钟单测覆盖。）
- [ ] `file://` 双击直开可用（无控制台报错）。
- [ ] `node --test "tests/*.test.js"` 全绿。
