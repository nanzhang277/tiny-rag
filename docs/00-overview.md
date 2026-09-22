# 00 学习地图总览

tiny-rag 是一个仅供学习的迷你 RAG 系统,核心理念是"麻雀虽小,五脏俱全":用尽可能小的体量覆盖 RAG 工程化的每个环节,而且**代码即教材**——每个环节是一个独立模块,可以单独讲解、单独替换、做对比实验。检索内核用 numpy 手写,全程不引入 LangChain / LlamaIndex 等重型框架,为的是看清本质而不是学会调包。

RAG(Retrieval-Augmented Generation,检索增强生成)解决大模型的两个先天短板:知识停留在训练截止时间、会"一本正经地编造"(幻觉)。做法很朴素:先从你自己的知识库里检索出与问题相关的资料片段,再把资料和问题一起交给大模型,让它"看着资料回答",并在句末标注引用。

## 两条流水线

整个系统就两条链。每条箭头对应一个模块,方括号里的编号对应 docs/ 里的文档。

```
Ingest(离线建库,跑一次,产物落盘):

  文档文件(.md/.txt)
      │
      ▼
  [01 loaders] 加载 → Document{text, metadata.source}
      │                      # source 记录"这段话从哪来",引用全靠它
      ▼
  [02 chunking] 切块 → Chunk{text, metadata.source + chunk_index}
      │                      # 长文档切成"一块只讲一件事"的小段
      ▼
  [03 embedding] 向量化 → 向量矩阵(批量请求 + 失败重试)
      │
      ▼
  持久化 → data/vectors.npz(向量矩阵) + data/meta.jsonl(每行一块的文本与元数据)
           # 两份文件按行号一一对应:"矩阵第 i 行 ↔ jsonl 第 i 行"是全系统的地基约定


Query(在线问答,每次提问跑一遍):

  用户问题
      │
      ├─→ [03 embedding] → [04 向量检索] ───┐
      │    (问题向量化)     (余弦 top-k)     │
      │                                     ├─→ [04 RRF 融合] → [05 rerank] → [06 生成] → 带 [1][2]
      └─→ [04 BM25 关键词检索] ──────────────┘    (按排名合并两路)  (可选精排)   (Prompt 组装    引用的回答
           (jieba 分词 + 词频打分)                                                  + GLM 流式)

  [07 evaluation] 横跨两条链:同一评测集在不同配置组合下跑分——先量化,再调优
  [08 engineering] 支撑所有环节:两层配置 / 指数退避重试 / 结构化日志 / 三层测试
```

为什么向量检索和 BM25 要并行?向量懂"意思相近"(同义改写也能命中),BM25 懂"词面命中"(专有名词、编号一字不差才最可靠),两种信号互补,由 RRF 按排名融合。

## 建议学习顺序

按 01 → 08 逐环节推进,每个环节固定三步:

1. **先读文档**:本目录对应篇目的「解决什么问题」——带着问题再看代码;
2. **再读代码**:对应模块(每个模块几百行以内)+ 它的测试文件(测试就是可执行的行为说明书);
3. **最后做实验**:照着「做什么实验」动手跑,改参数观察变化。

| 环节 | 文档 | 核心代码 | 实验是否需要 API key |
|---|---|---|---|
| 总览 | 00-overview.md | — | — |
| 文档加载 | 01-loaders.md | `rag/loaders.py` | 否 |
| 切块 | 02-chunking.md | `rag/chunking.py` | 实验一离线;实验二三要跑 eval,需要 |
| 向量化 | 03-embedding.md | `rag/embedding.py` | 实验一(持久化对齐)离线;实验二需要 |
| 检索 | 04-retrieval.md | `rag/retrieval.py` | 手算对照实验离线;eval 对比实验需要 |
| 重排 | 05-rerank.md | `rag/rerank.py` | 实验一(装配逻辑)离线;实验二需要 |
| 生成 | 06-generation.md | `rag/generation.py` | 实验一二(注入假 LLM)离线;实验三需要 |
| 评测 | 07-evaluation.md | `rag/evaluation.py` | 指标手算离线;完整 eval 需要 |
| 工程底座 | 08-engineering.md | `rag/config.py` `rag/retry.py` `rag/pipeline.py` | 实验二(报错链路)离线;实验一需要 |

## 依赖关系:哪些实验需要 API key

判据只有一条:**实验会不会发起真实的 HTTP API 调用**(embedding / chat / rerank)。

- 读文档、读代码,以及所有纯逻辑实验(切块对比、向量库对齐、余弦 top-k、BM25 手算、RRF 融合、指标计算、注入假 LLM 的 Prompt 组装)——**全部离线可做,零成本**;
- 凡是跑 `python cli.py ingest / ask / eval` 或真实调 API 的实验,需要 `export ZHIPUAI_API_KEY=<你的智谱 key>`(智谱开放平台申请,便宜型号即可跑通全部实验)。

所以即使暂时没有 key,本教程的学习主体(理解每个环节 + 离线实验)完全不受影响;有 key 后再把带标记的实验补跑一遍即可。
