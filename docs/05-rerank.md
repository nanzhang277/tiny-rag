# 05 重排 Rerank

## 解决什么问题

**检索 ≠ 排序。**上一环节的初筛(向量双塔 / BM25 词频)是"快而糙"的打分:问题和文档**各自独立**编码,几百个候选各打一个粗分——快,但没让问题和候选"见面"。rerank 是"慢而准"的交叉打分:把**(问题, 候选)成对**喂给模型细看,一次请求对全部候选重新打相关性分。

性价比套路:先用便宜的初筛把几百个候选缩到十几个,再花贵价对这十几个精排。全链路又快又准,两头都占。

两档实现,构成降级链路:

1. `ZhipuReranker`:智谱 rerank API,首选,一次请求批量打分;
2. `LLMReranker`:降级方案——没有 rerank 服务时,让任意 chat 模型逐候选打 0-10 分。慢,但"任何能聊天的模型都能当 reranker"。模型回答里抠不出数字就给 0 分:宁可沉底也不崩。

精排可整体关闭(`rerank_enabled: false`),pipeline 对 `None` 直接跳过该环节。

## 代码在哪

- `rag/rerank.py`:
  - `BaseReranker`:抽象接口,`rerank(query, results, top_n)` 返回按新分数降序的子集;
  - `ZhipuReranker`:调 `{api_base_url}/rerank`,批量传全部候选文本,失败经 `with_retries` 重试、报错定位到 `[rerank]` 环节;
  - `LLMReranker`:`SCORE_PROMPT` 要求模型只输出 0-10 整数,`_score_pair` 从回答里正则抠数字;
  - `build_reranker(cfg, llm)`:按配置装配——`rerank_enabled=false` → `None`;`rerank.provider: llm` → 降级方案;否则智谱实现。
- 配置入口:`config.yaml` 的 `rerank:` 节(`provider` / `model` / `top_n`)与 `rerank_enabled` 开关。
- 行为快照:`tests/test_rerank.py`(离线,用假 HTTP 响应与假 LLM 验证排序、降级与容错)。

## 做什么实验

实验 1(离线):验证降级链路的装配逻辑——配置怎么决定"用哪档精排、还是跳过"。

```python
from rag.config import Config
from rag.rerank import build_reranker

cfg = Config.load()
print(type(build_reranker(cfg, llm=None)).__name__)   # ZhipuReranker(默认配置)
cfg.rerank_enabled = False
print(build_reranker(cfg, llm=None))                  # None → pipeline 跳过精排环节
```

实验 2(需 API key,先 `python cli.py ingest data/docs`):把 `config.yaml` 的 `rerank.provider` 改成 `llm`,对比精排前后的候选顺序,亲眼看"检索 ≠ 排序"。

```python
from rag.config import Config
from rag.embedding import ZhipuEmbedding, VectorStore
from rag.retrieval import VectorRetriever, BM25Retriever, HybridRetriever
from rag.generation import GLMClient
from rag.rerank import build_reranker

cfg = Config.load()
store = VectorStore(cfg.vectors_file, cfg.meta_file)
_, chunks = store.load()
ret = HybridRetriever(VectorRetriever(ZhipuEmbedding(cfg), store), BM25Retriever(chunks), rrf_k=cfg.rrf_k)

q = "RAG 解决了哪些问题?"
results = ret.search(q, cfg.vector_top_k + cfg.bm25_top_k)
print("精排前:", [sr.chunk.metadata["chunk_index"] for sr in results[:5]])
reranker = build_reranker(cfg, GLMClient(cfg))
results = reranker.rerank(q, results, cfg.rerank_top_n)
print("精排后:", [sr.chunk.metadata["chunk_index"] for sr in results])
```

改完 `provider` 记得改回来。想进一步量化精排的价值,跑 `python cli.py eval` 看对比表最后一行(rerank on)与前几行(off)的 MRR 差异。
