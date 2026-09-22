# 04 检索 Retrieval

## 解决什么问题

知识库切成了几百块,问题来了:**哪几块和当前问题最相关?**这是 RAG 的心脏,也是全项目最大的"祛魅"点——向量检索没有任何魔法:

1. 把问题和所有 chunk 都变成向量(03 环节);
2. 逐行算余弦相似度——把所有向量**归一化**(除以自身模长)后,点积就直接等于余弦值,于是"全库检索"变成**一次矩阵乘向量**;
3. 取分数最大的前 k 个。

生产级向量数据库(FAISS、Milvus…)的核心无非是这件事 + 各种加速索引。学习版用最裸的形态看清本质。

BM25 是另一路信号:经典关键词检索算法(ES/Lucene 的默认评分)。直觉:一个词在"这一块"出现越多、在其他块出现越少,这块就越相关。向量懂"意思相近"(同义改写也能命中),BM25 懂"词面命中"(专有名词一字不差才最可靠),两路各取 top-k 后用 **RRF 融合**。

RRF(Reciprocal Rank Fusion)为什么用**排名**不用原始分数?向量相似度(0~1)和 BM25 分数(可以是十几)量纲完全不同,直接相加没有意义;排名是无量纲的,天然可比。每路结果里排第 r 名的候选得 1/(k+r+1)(k=60,论文经验值,平滑头部权重差),同一候选跨路累加。

## 代码在哪

- 全部在 `rag/retrieval.py`(约 180 行):
  - `cosine_top_k(query_vec, matrix, k)`:手写余弦 top-k,核心就三行——归一化、矩阵乘、排序;
  - `tokenize`:中文用 jieba 分词,英文/数字自然成词;BM25 支持注入自己的分词器;
  - `VectorRetriever`:问题 → 向量化 → `cosine_top_k`;向量库懒加载(第一次 search 才读入内存);
  - `BM25Retriever`:手写简版约 50 行,预计算每块词频表 `tf` 与每个词的文档频率 `df`;若想省事换 `rank-bm25` 轻库只是配置级改动——"手写为了理解,接口为了替换"的示范;
  - `rrf_fuse`:按排名倒数融合多路结果,同一候选靠 `(source, chunk_index)` 这把唯一键跨路对上号;
  - `HybridRetriever`:向量一路 + BM25 一路,RRF 融合后取前 top_k。
- 配置入口:`config.yaml` 的 `retrieval:` 节(`vector_top_k` / `bm25_top_k` / `rrf_k`)。
- 行为快照:`tests/test_retrieval.py`(构造小矩阵与小语料断言,全程离线)。

## 做什么实验

实验 1(离线):余弦 top-k 手算对照。三个二维向量,单位向量与 (1,1) 夹角 45° → 余弦 0.7071;归一化后一次矩阵乘全算完。

```python
import numpy as np
from rag.retrieval import cosine_top_k

m = np.array([[1.0, 0.0], [0.7071, 0.7071], [0.0, 1.0]])
q = np.array([1.0, 1.0])
print(cosine_top_k(q, m, 3))
# 实测:[(1, 0.99999…), (0, 0.7071), (2, 0.7071)]
# 并列分数时 stable 排序保持行号顺序(0 在 2 前)——结果可复现
```

实验 2(离线):BM25 手算对照。三个单块小语料,查询"向量检索",k1=1.5、b=0.75,三块等长(len=3=avg_len):

- IDF(该词出现在 3 块中的 2 块):ln((3−2+0.5)/(2+0.5)+1) = ln(1.6) ≈ 0.470;
- 块 c0 出现 1 次:0.470 × 1×2.5/(1+1.5×1.0) = **0.470**;
- 块 c1 出现 2 次:0.470 × 2×2.5/(2+1.5) ≈ **0.671** —— 词频更高,分数更高;
- 块 c2 出现 0 次:分数 0,直接不出现在结果里。

```python
from rag.chunking import Chunk
from rag.retrieval import BM25Retriever

chunks = [
    Chunk(text="向量检索 语义 相似", metadata={"id": "c0"}),
    Chunk(text="向量检索 向量检索 检索", metadata={"id": "c1"}),
    Chunk(text="BM25 关键词 打分", metadata={"id": "c2"}),
]
r = BM25Retriever(chunks, tokenizer=lambda t: t.split())
print([(sr.chunk.metadata["id"], round(sr.score, 4)) for sr in r.search("向量检索", 3)])
# 实测:[('c1', 0.6714), ('c0', 0.47)] —— 与手算完全一致
```

实验 3(离线):RRF 只看排名,不看原始分数。构造一个"BM25 第一名原始分 99"的极端例子,验证融合排序只由排名决定:

```python
from rag.chunking import Chunk
from rag.retrieval import SearchResult, rrf_fuse

def mk(i): return Chunk(text=f"块{i}", metadata={"source": i, "chunk_index": 0})
list_a = [SearchResult(mk("A"), 0.9), SearchResult(mk("B"), 0.8), SearchResult(mk("C"), 0.7)]
list_b = [SearchResult(mk("B"), 99.0), SearchResult(mk("D"), 50.0), SearchResult(mk("A"), 1.0)]
for sr in rrf_fuse([list_a, list_b]):
    print(sr.chunk.metadata["source"], round(sr.score, 6))
# 实测:B(0.032522) > A(0.032266) > D(0.016129) > C(0.015873)
# B 在两路分列第 2、第 1 名,赢了"第 1 + 第 3"的 A;99 分这个原始分根本没被用到
```

实验 4(需 API key):先 `python cli.py ingest data/docs`,再跑 `python cli.py eval`,对比表中 vector 与 hybrid 两行的 recall@5 / MRR——观察混合检索相对纯向量检索带来多少提升(在专有名词较多的评测集上差异会更明显)。
