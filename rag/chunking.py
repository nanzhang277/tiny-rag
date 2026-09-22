"""切块(Chunking):把长文档切成适合检索的小段。

为什么必须切块?
1. embedding 模型有输入长度上限;
2. "一块只讲一件事"检索才准 —— 切块粒度直接决定检索质量,
   所以它必须"可配置、可对比"(eval 会对比 fixed 与 recursive 两种策略)。

两种策略:
- FixedLengthChunker:按固定字符数滑窗硬切。简单粗暴,作为对照基线。
- RecursiveChunker:优先按段落/句子等自然边界切,切不开才硬切。
  多数生产系统的默认选择。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from rag.loaders import Document


@dataclass
class Chunk:
    """切块结果:文本 + 指回原文的元数据(source / chunk_index)。"""

    text: str
    metadata: dict = field(default_factory=dict)


class BaseChunker(ABC):
    """切块器接口。新增策略 = 继承并实现 split,再在 build_chunker 注册一行。"""

    # 策略标识,写入每块 metadata["chunker"],eval 靠它对比不同策略的检索效果。
    name: str = ""

    def __init__(self, size: int = 500, overlap: int = 50):
        if size <= 0:
            raise ValueError("size 必须为正数")
        if overlap >= size:
            raise ValueError(f"overlap({overlap}) 必须小于 size({size}),否则窗口原地踏步")
        self.size = size
        self.overlap = overlap

    @abstractmethod
    def split(self, doc: Document) -> list[Chunk]: ...

    def _make(self, doc: Document, text: str, index: int) -> Chunk:
        """切块结果 = 文本 + 继承原文元数据 + 本块定位信息(chunk_index / chunker)。"""
        meta = dict(doc.metadata)
        meta.update(chunk_index=index, chunker=self.name)
        return Chunk(text=text, metadata=meta)


class FixedLengthChunker(BaseChunker):
    """固定长度滑窗切块:每 size 个字符一块,相邻块重叠 overlap 个字符。

    overlap 的意义:防止关键句子恰好被切在边界上,两块各留一半、哪块都不完整。
    """

    name = "fixed"

    def split(self, doc: Document) -> list[Chunk]:
        step = self.size - self.overlap
        chunks: list[Chunk] = []
        for start in range(0, len(doc.text), step):
            piece = doc.text[start : start + self.size]
            if piece.strip():  # 跳过纯空白块
                chunks.append(self._make(doc, piece, len(chunks)))
            if start + self.size >= len(doc.text):
                break
        return chunks


class RecursiveChunker(BaseChunker):
    """递归切块:按分隔符优先级(段落→句子→…)切出自然边界块,全部失效才硬切。

    思路:先用最粗的分隔符(段落)切开;只有单个片段仍超长,才换更细的
    分隔符继续切。自然边界块不再跨块合并 —— "一块只讲一件事"。
    语义说明:为保持实现简单可读,overlap 通过"下一块开头携带上一块有效
    内容末尾 overlap 个字符"实现,因此块长上限为 size + overlap。
    """

    name = "recursive"

    # 依次尝试的分隔符:先段落,再句读,最后退化为硬切。
    SEPARATORS = ["\n\n", "\n", "。", ".", "!", "?", "!", "?", ";", ";", ","]

    def split(self, doc: Document) -> list[Chunk]:
        blocks = self._split_by(doc.text, 0)
        chunks: list[Chunk] = []
        prev_tail = ""
        for blk in blocks:
            text = prev_tail + blk if prev_tail else blk
            if text.strip():
                chunks.append(self._make(doc, text, len(chunks)))
            # overlap:下一块开头携带上一块"有效内容"的末尾(先去掉尾部空白再取)。
            content = blk.rstrip()
            prev_tail = content[-self.overlap :] if self.overlap > 0 and content else ""
        return chunks

    def _split_by(self, text: str, sep_idx: int) -> list[str]:
        """用第 sep_idx 个分隔符切;单个片段仍超长,才用更细的分隔符继续切。"""
        if sep_idx >= len(self.SEPARATORS):
            # 所有分隔符都试过仍超长 → 按固定长度硬切
            return [text[i : i + self.size] for i in range(0, len(text), self.size)]
        sep = self.SEPARATORS[sep_idx]
        parts = text.split(sep)
        if len(parts) == 1:  # 这个分隔符切不开,换更细的
            return self._split_by(text, sep_idx + 1)
        out: list[str] = []
        for i, part in enumerate(parts):
            if not part.strip():
                continue
            piece = part + sep if i < len(parts) - 1 else part  # 切掉的分隔符补回去
            if len(piece) <= self.size:
                out.append(piece)
            else:
                out.extend(self._split_by(piece, sep_idx + 1))
        return out


def build_chunker(strategy: str, size: int, overlap: int) -> BaseChunker:
    """按配置构造切块器。换策略 = 改配置,不改调用方代码。"""
    if strategy == "fixed":
        return FixedLengthChunker(size, overlap)
    if strategy == "recursive":
        return RecursiveChunker(size, overlap)
    raise ValueError(f"未知切块策略: {strategy}(可选 fixed / recursive)")
