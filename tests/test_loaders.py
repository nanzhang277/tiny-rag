"""文档加载测试:md/txt 正常加载、元数据指回原文、不支持格式报错、目录递归。"""
import pytest

from rag.loaders import Document, UnsupportedFormatError, load_document, load_documents_from_dir


def test_load_txt(tmp_path):
    p = tmp_path / "note.txt"
    p.write_text("纯文本内容", encoding="utf-8")
    doc = load_document(p)
    assert isinstance(doc, Document)
    assert doc.text == "纯文本内容"
    assert doc.metadata["source"] == str(p)
    assert doc.metadata["title"] == "note"


def test_load_md(tmp_path):
    p = tmp_path / "guide.md"
    p.write_text("# 标题\n\n正文", encoding="utf-8")
    assert load_document(p).text.startswith("# 标题")


def test_unsupported_format(tmp_path):
    p = tmp_path / "paper.pdf"
    p.write_bytes(b"%PDF-1.4")
    with pytest.raises(UnsupportedFormatError):
        load_document(p)


def test_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_document(tmp_path / "nope.md")


def test_load_dir_sorted_and_recursive(tmp_path):
    (tmp_path / "sub").mkdir()
    (tmp_path / "b.txt").write_text("B", encoding="utf-8")
    (tmp_path / "sub" / "a.md").write_text("A", encoding="utf-8")
    (tmp_path / "skip.pdf").write_bytes(b"x")  # 不支持的扩展名被忽略
    docs = load_documents_from_dir(tmp_path)
    assert [d.metadata["title"] for d in docs] == ["b", "a"]  # 排序稳定可复现
