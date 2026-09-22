"""切块测试:两种策略的行为、overlap 语义、参数校验、配置工厂。"""
import pytest

from rag.chunking import (
    FixedLengthChunker,
    RecursiveChunker,
    build_chunker,
)
from rag.loaders import Document


def test_fixed_length_window_and_overlap():
    text = "0" * 10 + "1" * 10 + "2" * 10 + "3" * 10 + "4" * 10 \
        + "5" * 10 + "6" * 10 + "7" * 10 + "8" * 10 + "9" * 10    # 100 字符,每 10 个相同数字,便于核对切片
    doc = Document(text=text, metadata={"source": "a.txt"})
    chunks = FixedLengthChunker(size=30, overlap=10).split(doc)
    assert len(chunks) == 5                       # step=20: 0,20,40,60,80
    assert chunks[0].text == "0" * 10 + "1" * 10 + "2" * 10   # [0:30]
    assert chunks[0].text[-10:] == chunks[1].text[:10]        # overlap 区重合
    assert chunks[1].metadata["chunk_index"] == 1


def test_fixed_overlap_must_be_less_than_size():
    with pytest.raises(ValueError):
        FixedLengthChunker(size=30, overlap=30)


def test_recursive_prefers_paragraph_boundaries():
    text = "第一段内容。\n\n第二段内容。\n\n第三段内容。"
    chunks = RecursiveChunker(size=100, overlap=0).split(Document(text=text))
    assert len(chunks) == 3                       # 三个自然段各成一块
    assert chunks[0].text.startswith("第一段")


def test_recursive_hard_splits_when_no_separator():
    chunks = RecursiveChunker(size=100, overlap=0).split(Document(text="字" * 250))
    assert all(len(c.text) <= 100 for c in chunks)
    assert sum(len(c.text) for c in chunks) == 250  # 不丢内容


def test_recursive_overlap_carries_previous_tail():
    text = "A" * 80 + "\n\n" + "B" * 80
    chunks = RecursiveChunker(size=100, overlap=20).split(Document(text=text))
    assert chunks[1].text.startswith("A" * 20)    # 第二块开头带第一块末尾 20 字符
    assert chunks[1].text[20:].startswith("B")


def test_build_chunker_from_config():
    assert isinstance(build_chunker("fixed", 100, 10), FixedLengthChunker)
    assert isinstance(build_chunker("recursive", 100, 10), RecursiveChunker)
    with pytest.raises(ValueError):
        build_chunker("semantic", 100, 10)        # 未知策略明确报错
