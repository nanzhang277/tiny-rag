"""文档加载:md / txt 文件 → Document 对象。

RAG 第一环:把"外部知识"变成程序能处理的最小单元 —— 带元数据的纯文本。
metadata 里记录"这段文本从哪来"(源文件路径),检索命中后全靠它生成引用。

PDF 不在首版范围,但"按扩展名分发"的设计天然留了扩展口:
将来支持 PDF = 在 SUPPORTED_SUFFIXES 加一项 + 一个解析函数,其他代码零改动。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

SUPPORTED_SUFFIXES = {".md", ".markdown", ".txt"}


@dataclass
class Document:
    """加载后的最小知识单元:纯文本 + 元数据。"""

    text: str
    metadata: dict = field(default_factory=dict)


class UnsupportedFormatError(ValueError):
    """暂不支持的文件格式。PDF 是预留扩展口,不是首版目标。"""


def load_document(path: str | Path) -> Document:
    """加载单个文档。当前支持 .md / .markdown / .txt。"""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"文件不存在: {p}")
    if p.suffix.lower() not in SUPPORTED_SUFFIXES:
        raise UnsupportedFormatError(
            f"暂不支持 {p.suffix} 格式(首版支持 .md/.txt,PDF 为预留扩展口): {p.name}"
        )
    return Document(text=p.read_text(encoding="utf-8"), metadata=_meta_of(p))


def load_documents_from_dir(path: str | Path) -> list[Document]:
    """递归加载目录下所有支持格式的文件,按文件路径排序保证结果可复现。"""
    root = Path(path)
    if not root.exists():
        raise FileNotFoundError(f"路径不存在: {root}")
    files = sorted(
        f for f in root.rglob("*") if f.is_file() and f.suffix.lower() in SUPPORTED_SUFFIXES
    )
    return [load_document(f) for f in files]


def _meta_of(p: Path) -> dict:
    return {"source": str(p), "title": p.stem}
