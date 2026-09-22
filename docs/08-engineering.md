# 08 工程底座 Engineering

## 解决什么问题

前七个环节是"业务逻辑"。要把它们变成能日常维护、敢反复改动的系统,还需要四件工程底座:

1. **配置管理**:换模型、调切块大小不该改代码。两层设计——YAML 存默认值(可以入库,不含密钥),环境变量只存密钥(永不入库)。**密钥安全底线:API key 只从环境变量 `ZHIPUAI_API_KEY` 读取**,配置文件、代码、git 历史里都不出现。
2. **失败重试**:网络抖动与限流是常态,出网调用必须自动重试。策略是指数退避(失败后等 1s、2s、4s…再试),避免被打挂的服务雪上加霜;重试耗尽后抛出的异常信息带上环节名——**报错直接指向出错环节**,而不是甩一个堆栈让你全文搜索。
3. **可观测**:一次 `ask` 要过检索、精排、生成多个环节,慢了要知道慢在哪、错了要知道错在哪。做法是**结构化日志**:一个环节一行 JSON(`log_event`),机器可读、可 grep、可做耗时分析;`--verbose` 打开 DEBUG 级明细。
4. **测试策略**:三层,成本从低到高——
   - 纯逻辑模块不碰网络:切块、余弦 top-k、RRF、指标计算,构造小矩阵/小语料直接断言;
   - 编排逻辑用假 provider(stub embedding/LLM,见 `tests/fakes.py`)测数据流串联,全程离线;
   - 端到端冒烟需真实 key,**默认跳过**,设 `TINY_RAG_E2E=1` 显式开启——CI 里永远离线跑,本地随时验证真链路。

## 代码在哪

- **两层配置**:`rag/config.py`——`Config.load()` 按"代码默认值 → YAML 覆盖 → 环境变量注入密钥"三层加载;`_YAML_FIELDS` 是 YAML 键路径到字段名的显式映射表(新增配置项登记一行,不用魔法自动绑定);`require_api_key()` 缺 key 时给出可操作的提示而非堆栈;`api_key` 字段 `repr=False`,打印配置也不会泄漏。
- **重试**:`rag/retry.py`——`with_retries(fn, stage, ...)` 一份逻辑被 embedding / rerank / chat 三处共用(DRY);耗尽后抛 `APIError(stage, ...)`,消息形如 `[embedding] API 调用失败: …`。注意:默认对**任何异常**都重试,所以缺 key 这类"重试也没用"的错误也会走完退避(约 1+2+4=7 秒)才报错——一个值得观察的真实行为。
- **结构化日志**:`rag/pipeline.py`——`log_event(stage, **fields)` 每环节一行 JSON;`ingest` 打点 load / chunking / embedding / save,`query` 打点 retrieval / rerank / generation / query_total;日志走 stderr(stdout 只留给结果输出,二者可以分开重定向)。
- **编排**:`rag/pipeline.py` 的 `ingest` / `query`——编排层不写业务逻辑,只做依赖装配、顺序调用、耗时打点;所有出网组件都能从参数注入替身。
- **CLI**:`cli.py`——三个子命令 + 统一错误出口(捕获业务异常,stderr 打印、退出码 1、无 traceback)。
- 行为快照:`tests/test_config.py`、`tests/test_retry.py`、`tests/test_pipeline.py`、`tests/test_cli.py`。

## 做什么实验

实验 1(需 API key,先 `python cli.py ingest data/docs`):打开 verbose 看每环节耗时,找出瓶颈环节。

```bash
python cli.py --verbose ask "RAG 解决了哪些问题?"
# stderr 里的 JSON 行形如:
# {"stage": "retrieval", "hits": 20, "seconds": 0.4}
# {"stage": "rerank", "provider": "zhipu", "kept": 5, "seconds": 1.2}
# {"stage": "generation", "model": "glm-4-flash", "chars": 180}
# {"stage": "query_total", "seconds": 2.1}
```

对比各环节 `seconds`:瓶颈通常是 rerank 或 generation(出网大模型调用),检索本身(本地矩阵运算)是微秒级——这就是"先量化,再优化"的第一手证据:优化本地代码收益甚微,换更快的模型或关掉精排才是大头。

实验 2(离线):观察报错链路的三个设计——报错指向环节、无 traceback、退出码非零:

```bash
env -u ZHIPUAI_API_KEY python cli.py ask "测试"
# 全新克隆上会先撞另一类报错(还没有向量库):
#   错误: [Errno 2] No such file or directory: 'data/vectors.npz'   退出码 1
# 它如实告诉你缺的动作:先 ingest。

python3 - <<'EOF'
from rag.config import Config
from rag.embedding import ZhipuEmbedding
try:
    ZhipuEmbedding(Config.load()).embed_texts(["测试"])   # 无 key
except Exception as exc:
    print(exc)   # [embedding] API 调用失败: 重试 3 次后仍失败: 未检测到 API key…
                 # 注意先等了约 7 秒 —— 1s+2s+4s 指数退避,见上文"值得观察的真实行为"
EOF
```
