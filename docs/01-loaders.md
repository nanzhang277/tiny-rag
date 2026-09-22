# 01 文档加载 Loaders

## 解决什么问题

大模型不知道你公司内部的文档、不知道昨天刚发生的新闻——它的知识停在训练截止那一刻。RAG 的第一步,是把"你拥有的外部知识"变成程序能处理的最小单元。

这个最小单元不是文件,而是**纯文本 + 元数据**:

- `text`:文件读出来的纯文本内容;
- `metadata`:这段文本"从哪来"的档案,目前记两个字段——`source`(源文件路径)和 `title`(文件名去后缀)。

为什么 metadata 里的 `source` 如此重要?后面检索命中一块文本后,回答里要标 `[1][2]` 引用、评测要判断"有没有找到正确出处"——全靠 `source` 指回原文。**没有 source,检索结果就无法溯源,RAG 就退化成了普通的问答机。**

首版只支持 `.md` / `.markdown` / `.txt`。PDF 不做,但设计上留了扩展口(见下)。

## 代码在哪

`rag/loaders.py`(约 50 行,建议全文精读):

- `Document`:dataclass,只有 `text` / `metadata` 两个字段——"知识的最小单元"本单元;
- `load_document(path)`:加载单个文件;扩展名不在 `SUPPORTED_SUFFIXES` 集合里就抛 `UnsupportedFormatError`,文件不存在抛 `FileNotFoundError`;
- `load_documents_from_dir(path)`:递归加载目录下所有支持格式的文件,并**按文件路径排序**——排序是为了结果可复现,同一目录永远得到同一顺序;
- `SUPPORTED_SUFFIXES`:支持的扩展名集合,按扩展名分发就是扩展口本身。

行为快照:`tests/test_loaders.py`。依赖关系:本模块不依赖任何其他模块,是流水线源头;下游 `rag/chunking.py` 直接消费 `Document`。

扩展口设计:将来支持 PDF = 在 `SUPPORTED_SUFFIXES` 加一项 + 写一个解析函数,加载接口与所有下游代码零改动。这是"对扩展开放、对修改关闭"的最小示例。

## 做什么实验

实验 1(离线):加载示例知识库,观察 metadata——确认 source 就是后面引用标注的依据。

```python
from rag.loaders import load_documents_from_dir

for d in load_documents_from_dir("data/docs"):
    print(d.metadata, "| 正文前 20 字:", d.text[:20].replace("\n", " "))
```

实验 2(离线):造一个假 PDF,验证报错提示。注意报错文案直接告诉你"怎么扩展",而不是甩一个堆栈。

```python
from pathlib import Path
from rag.loaders import load_document, UnsupportedFormatError

Path("data/docs/fake.pdf").write_text("%PDF-1.4 fake")
try:
    load_document("data/docs/fake.pdf")
except UnsupportedFormatError as exc:
    print(exc)   # 暂不支持 .pdf 格式(首版支持 .md/.txt,PDF 为预留扩展口): fake.pdf
Path("data/docs/fake.pdf").unlink()
```

实验 3(离线,思考题):顺着 `UnsupportedFormatError` 的报错提示观察扩展口——如果要让系统支持 `.html`,你需要改哪几处?(答案:`SUPPORTED_SUFFIXES` 加一项;若要去除 HTML 标签再补一个解析函数。加载接口、切块、检索全部零改动。)
