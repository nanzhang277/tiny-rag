# 03 向量化 Embedding

## 解决什么问题

计算机不懂文字,只懂数字。要计算"两段话是否意思相近",得先把文字变成数字——这就是 embedding:把每段文本映射成一个高维向量(本系统默认 1024 维)。**向量就是语义的坐标**:意思相近的文本,坐标位置相近(向量夹角小);意思无关的,夹角大。这一步是向量检索的物理基础——没有它,后面的"余弦相似度"无从谈起。

本模块要处理三件工程现实:

1. **批量**:几百个 chunk 逐条请求太慢太贵,按 `embedding.batch_size` 打包批量请求;
2. **顺序还原**:API 不保证按输入顺序返回结果,响应里带 `index` 字段,必须按它排序还原——**顺序错 = 向量与文本错位 = 全库作废**,这是最容易踩的暗坑;
3. **持久化**:向量存 `data/vectors.npz`(numpy 矩阵),文本与元数据存 `data/meta.jsonl`(每行一个 JSON 对象)。两份文件**按行号一一对应**——"矩阵第 i 行 ↔ jsonl 第 i 行"这个对齐约定是全系统的地基,后面检索命中的每个 chunk 都靠它找回来。

## 代码在哪

- 接口与实现:`rag/embedding.py`
  - `BaseEmbedding`:抽象接口,`embed_texts(texts)` 返回矩阵,`texts[i]` 对应第 `i` 行——换 provider = 新写一个子类,检索层零改动;
  - `ZhipuEmbedding`:智谱实现,批量 + 指数退避重试(重试逻辑复用 `rag/retry.py` 的 `with_retries`,失败时报错定位到 `[embedding]` 环节);
  - `VectorStore`:本地向量库,`save` 全量覆盖写入、`load` 读回并校验行数一致(不一致说明库损坏,报错提示重新 ingest)。
- 配置入口:`config.yaml` 的 `embedding:` 节(`model` / `batch_size` / `dimensions`);密钥只从环境变量 `ZHIPUAI_API_KEY` 读(见 `rag/config.py`)。
- 行为快照:`tests/test_embedding.py`(离线,用假 HTTP 响应验证批量、顺序还原与持久化)。

## 做什么实验

实验 1(离线):亲手验证 npz + jsonl 的行对齐约定——存进去的顺序 = 读回来的顺序。

```python
import numpy as np
from rag.chunking import Chunk
from rag.embedding import VectorStore

store = VectorStore("data/learn_vectors.npz", "data/learn_meta.jsonl")
vectors = np.array([[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]])
chunks = [Chunk(text=f"第{i}块", metadata={"source": f"f{i}.md", "chunk_index": 0}) for i in range(3)]
store.save(vectors, chunks)
v2, c2 = store.load()
print(v2.shape, [c.text for c in c2])   # (3, 2) ['第0块', '第1块', '第2块'] —— 第 i 行 ↔ 第 i 块
```

实验 2(需 API key):打印两段相似文本、一段无关文本的余弦相似度,亲眼看到"语义距离"是真实存在的。

```python
import numpy as np
from rag.config import Config
from rag.embedding import ZhipuEmbedding

def cos(a, b):
    a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
    return float(a @ b)

emb = ZhipuEmbedding(Config.load())
v = emb.embed_texts(["猫是一种常见的宠物", "小猫喜欢玩毛线球", "今天股市收盘上涨百分之一"])
print("相似文本余弦:", round(cos(v[0], v[1]), 4))   # 预期明显更高
print("无关文本余弦:", round(cos(v[0], v[2]), 4))   # 预期明显更低
```
