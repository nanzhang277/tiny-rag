# tiny-rag

一个仅供学习的迷你 RAG 系统:麻雀虽小,五脏俱全。**代码即教材**——加载、切块、向量化、检索、重排、生成、评测,每个环节都是一个可独立讲解、单独替换、可做对比实验的模块;检索内核用 numpy 手写,全程不引入 LangChain / LlamaIndex 等重型框架,为的是看清本质而不是学会调包。

**从这里开始学习:[docs/00-overview.md](docs/00-overview.md)** —— 学习路线图,以及每个环节的"解决什么问题 → 代码在哪 → 做什么实验"。

## 快速开始

前提:Python ≥ 3.10;一个智谱 API key([智谱开放平台](https://open.bigmodel.cn)申请,默认配置选便宜型号即可跑通)。读代码与纯逻辑实验全程离线,只有出网实验需要 key。

```bash
pip install -e ".[dev]"                # 安装(含 pytest)
export ZHIPUAI_API_KEY=<你的智谱 key>   # 密钥只走环境变量,绝不入库
```

### 1. 建库(ingest)

```bash
python cli.py ingest data/docs
```

预期输出(JSON 日志在 stderr,结果在 stdout;数字因文档与参数而异):

```
2026-09-22 12:00:00,000 INFO {"stage": "load", "files": 3}
2026-09-22 12:00:00,010 INFO {"stage": "chunking", "strategy": "recursive", "chunks": 10}
2026-09-22 12:00:01,500 INFO {"stage": "embedding", "model": "embedding-3", "rows": 10, "seconds": 1.48}
2026-09-22 12:00:01,510 INFO {"stage": "save", "vectors_file": "data/vectors.npz", "total_seconds": 1.51}
建库完成: {'documents': 3, 'chunks': 10, 'dim': 1024, 'seconds': 1.51}
```

产物:`data/vectors.npz`(向量矩阵)+ `data/meta.jsonl`(每行一块的文本与元数据,行号与矩阵对齐)。

### 2. 问答(ask)

```bash
python cli.py ask "RAG 解决了哪些问题?"
```

流式逐段打印,形如(回答由模型生成,每次措辞可能不同;重点是句末的引用编号):

```
RAG 主要解决了两个核心问题:一是大模型的知识停留在训练截止时间,无法感知新知识 [1];二是模型可能"一本正经地编造"(幻觉),引用真实资料能显著降低幻觉 [1]。
```

`[1]` 编号对应检索到的资料序号,可回溯到知识库原文。加 `--no-stream` 可对照阻塞模式;加 `--verbose` 可看每环节耗时打点。

### 3. 评测(eval)

```bash
python cli.py eval
```

输出 Markdown 对比表 + GLM 自评(指标数字为示例,以实际运行为准):

```
## 检索指标对比

| chunking | retrieval | rerank | recall@5 | MRR |
|---|---|---|---|---|
| fixed | vector | off | 0.500 | 0.417 |
| fixed | hybrid | off | 0.667 | 0.500 |
| recursive | vector | off | 0.833 | 0.667 |
| recursive | hybrid | off | 0.833 | 0.717 |
| recursive | hybrid | on | 0.833 | 0.750 |

## GLM 自评(recursive + hybrid + rerank on)

- faithfulness 忠实度: 4.50 / 5
- relevance 相关性: 4.33 / 5
```

对比表就是"配置开关 → 指标变化"的实验台:换切块策略、换检索方式、开关精排,各跑一遍看指标——评测驱动调优。

## 目录结构

```
tiny-rag/
├── rag/                  # 核心包:一个模块 = 一个环节 = 一章教材
│   ├── config.py         # 配置管理:YAML 默认值 + 环境变量密钥,两层
│   ├── loaders.py        # 01 文档加载:md/txt → Document{text, metadata}
│   ├── chunking.py       # 02 切块:fixed / recursive 两种策略,size/overlap 可配
│   ├── embedding.py      # 03 向量化:智谱 embedding 批量+重试;本地向量库 npz+jsonl
│   ├── retrieval.py      # 04 检索:numpy 余弦 top-k + 手写 BM25 + RRF 融合(全手写)
│   ├── rerank.py         # 05 重排:智谱 rerank;LLM 打分降级
│   ├── generation.py     # 06 生成:Prompt 组装 + [1][2] 引用 + GLM 流式
│   ├── evaluation.py     # 07 评测:recall@k / MRR + 配置对比表 + GLM 自评
│   ├── pipeline.py       # 编排:ingest / query 两条链 + 逐环节耗时打点
│   └── retry.py          # 指数退避重试,所有出网调用共用
├── cli.py                # 入口:ingest / ask / eval 三个子命令
├── config.yaml           # 全部可调参数(不含密钥):换模型/调参数 = 改这里,不改代码
├── docs/                 # 学习地图,从 00-overview.md 开始
├── tests/                # 三层测试:纯逻辑 / stub 编排(离线)/ e2e 冒烟(默认跳过)
└── data/
    ├── docs/             # 示例知识库(3 篇 md,本仓库的设计文档也在其中)
    └── eval/             # 内置评测集 eval_set.json(6 条问答对 + 标注出处)
```

## 测试

```bash
python -m pytest tests/ -v
```

- 默认**全离线**:纯逻辑测试(小矩阵/小语料直接断言)+ stub provider 编排测试,不需要 API key,预期全部 passed;
- 端到端冒烟(`tests/test_e2e_smoke.py`、`tests/test_embedding_e2e.py`)默认跳过;需要真实 key 时显式开启:

```bash
export TINY_RAG_E2E=1    # 且已设置 ZHIPUAI_API_KEY
python -m pytest tests/ -v
```

## 密钥安全

- API key **只**从环境变量 `ZHIPUAI_API_KEY` 读取(`rag/config.py`),代码、配置文件、git 历史中均无密钥;`Config` 的 `repr` 也隐藏该字段,打印配置不泄漏;
- `.env` 已列入 `.gitignore`;
- 提交前可自查密钥泄漏:

```bash
git grep -nIiE "(sk-[a-zA-Z0-9]{8,}|api[_-]?key[\"' ]*[:=][\"' ]*[a-zA-Z0-9]{16,})" || echo "CLEAN"
```

## 更多

- 学习地图:`docs/`(00 总览 → 01-07 七个环节 → 08 工程底座,每篇"解决什么问题 → 代码在哪 → 做什么实验");
- 换模型:`config.yaml` 改 `llm.model` / `embedding.model` / `rerank.model`,不改代码;
- 设计取舍:`data/docs/tiny_rag_design.md`——它同时是内置知识库的一员:本仓库的文档,自己就是这套 RAG 的语料。
