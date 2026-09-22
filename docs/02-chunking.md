# 02 切块 Chunking

## 解决什么问题

为什么不能把整篇文档直接送去向量化?三个原因:

1. **embedding 模型有输入长度上限**,长文档塞不进去;
2. **"一块只讲一件事"检索才准**——一块里混了五个话题,它和任何问题的相似度都会被稀释;
3. **粒度决定检索质量**:块太大,命中粒度粗、引用冗长;块太小,语义支离破碎。没有"一刀切"的最优粒度,所以切块必须**可配置、可对比**——这也是本环节被设计成两种策略 + 配置开关的原因。

两种策略:

- `FixedLengthChunker`:按固定字符数滑窗硬切。简单粗暴,作为对照基线;
- `RecursiveChunker`:优先按段落/句子等自然边界切,切不开才硬切。多数生产系统的默认选择。

相邻块重叠 `overlap` 个字符:防止关键句恰好被切在边界上,两块各留一半、哪块都不完整。

## 代码在哪

- 接口与两种策略:`rag/chunking.py`(`BaseChunker` / `FixedLengthChunker` / `RecursiveChunker`)
  - `BaseChunker` 是抽象接口,`name` 属性(如 "fixed" / "recursive")会写进每块的 `metadata["chunker"]`——eval 对比不同策略时靠它区分;
  - 每块的 `metadata` 继承原文档的 `source` / `title`,再追加 `chunk_index`(块序号)——"第几个文档的第几块"全程可追溯;
  - `RecursiveChunker` 按分隔符优先级(`\n\n` → `\n` → `。` → `.` → …)递归下切,全部失效才按固定长度硬切;为保持实现简单可读,它的块长上限是 size + overlap(docstring 里有说明);
  - `build_chunker(strategy, size, overlap)`:按配置构造切块器——换策略 = 改配置,不改调用方代码。
- 配置入口:`config.yaml` 的 `chunking:` 节(`strategy` / `size` / `overlap`)。
- 行为快照:`tests/test_chunking.py`。

## 做什么实验

实验 1(离线):同一篇文档分别用两种策略切,肉眼对比切块质量。

```python
from rag.loaders import load_document
from rag.chunking import FixedLengthChunker, RecursiveChunker

doc = load_document("data/docs/what_is_rag.md")
for cls in (FixedLengthChunker, RecursiveChunker):
    chunks = cls(size=200, overlap=30).split(doc)
    print(cls.name, "块数:", len(chunks), "块长:", [len(c.text) for c in chunks])

# 实测:fixed  → 2 块 [200, 116]     —— 第一块在 200 字符处拦腰截断,句子被切碎
#      recursive → 4 块 [11, 130, 108, 106] —— 标题独占一块,之后按段落自然边界切
```

实验 2(需 API key):改 `config.yaml` 的 `chunking.strategy`,重跑建库与评测,看对比表里 fixed 与 recursive 两行 recall@5 / MRR 的差异。

```bash
python cli.py ingest data/docs && python cli.py eval
# 改 config.yaml: chunking.strategy: fixed,再跑一遍对比
```

实验 3(需 API key):把 `config.yaml` 的 `chunking.overlap` 调成 0,观察边界句被切断时检索指标是否下降(对比 eval 表中的 recall@5 / MRR)。
