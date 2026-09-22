# 06 生成 Generation

## 解决什么问题

检索到的资料块不能直接扔给模型。RAG 的生成环节做三件事:

1. **Prompt 组装**,三要素缺一不可:
   - **指令**:限定模型"只依据参考资料回答、不编造、句末标引用";
   - **资料**:每个候选块前加编号,`[1] 块文本`、`[2] 块文本`…拼成资料区;
   - **问题**:用户原话。
2. **引用标注**:回答里句末的 `[1][2]` 从哪来?就是资料区的序号。Prompt 要求模型引用某块时标注对应编号——于是每个论断都能回溯到知识库原文。**可溯源是 RAG 的灵魂**:没有编号引用,你无法验证模型是不是在编造。
3. **流式输出**:GLM 流式接口逐段返回,边生成边打印,体验上"秒回"。

两个边界情况的处理:

- **上下文超长**:资料区有预算(`max_context_chars`)。检索结果已按相关性降序,**从尾部(得分最低)开始丢弃**,直到装得下——保住最相关的,丢掉最次要的;
- **空检索结果**:如实回答"知识库中没有相关内容",**不硬编**——让模型闭着猜只会产出幻觉。

## 代码在哪

- `rag/generation.py`:
  - `PROMPT_TEMPLATE`:Prompt 模板,指令 + `{context}` 资料区 + `{question}` 三段结构;
  - `build_context(results, max_chars)`:拼编号资料区 + 超长丢弃(`CONTEXT_HEADROOM=10` 是给模板固定文案留的安全余量);
  - `answer_question(llm, question, results, ...)`:问答主入口——空检索检查 → 组装 → 生成;`llm` 接受任何实现 `complete` 的对象,所以测试能注入假 LLM;传 `stream_cb` 时改走流式,每段增量回调一次;
  - `GLMClient`:`complete`(阻塞一次生成)+ `stream`(SSE 流式)两种调用。单独成类是因为 chat 能力被"问答生成"和"LLM 打分降级 rerank"两处共用;SSE 行解析 `parse_sse_line` 独立成函数并单独测试,单行坏数据直接跳过不崩整次回答;
  - `Answer`:回答全文 + 本次依据的块。注意 `used_chunks` 记录的是检索结果全集——超长裁剪只发生在 Prompt 组装内部,"实际装进 Prompt 的是哪几块"要看 `build_context` 的返回值。
- 配置入口:`config.yaml` 的 `llm:` 节(`model` / `temperature` / `max_output_tokens` / `max_context_chars`)。
- 行为快照:`tests/test_generation.py`(离线,注入假 LLM 验证 Prompt 组装、裁剪、引用与空检索)。

## 做什么实验

实验 1(离线):注入一个"原样返回 Prompt"的假 LLM,直接观察组装出的 Prompt 与超长丢弃行为。5 块资料、每块约 208 字符,预算 800 只装得下 3 块——**丢的是得分最低的第 4、5 块**。

```python
import re
from rag.chunking import Chunk
from rag.generation import answer_question, build_context
from rag.retrieval import SearchResult

def mk(i, n=100):   # 每块约 204 字符
    return SearchResult(chunk=Chunk(text=f"第{i}块 " + "内容" * n, metadata={}), score=1.0 - i * 0.1)

results = [mk(i) for i in range(5)]
ctx = build_context(results, max_chars=800)
print("保留的块:", [ln.split(" ")[0] for ln in ctx.split("\n\n")])   # 实测:['[1]', '[2]', '[3]']

class EchoLLM:
    def complete(self, prompt): return prompt   # 原样返回,直接看组装结果
ans = answer_question(EchoLLM(), "测试问题", results, max_context_chars=800)
print("回答里出现的编号:", re.findall(r"\[\d\]", ans.text))

ans0 = answer_question(EchoLLM(), "测试问题", [], max_context_chars=800)
print("空检索回答:", ans0.text)   # 知识库中没有相关内容,无法回答这个问题。
```

实验 2(离线):把 `max_context_chars` 从 800 逐步调成 500、300,重跑实验 1,观察保留块数如何变化;把块长调大,验证丢弃总是从尾部(低分块)开始。

实验 3(需 API key,先 `python cli.py ingest data/docs`):真实流式生成——

```bash
python cli.py ask "RAG 解决了哪些问题?"     # 逐段打印,体验"秒回"
python cli.py ask "RAG 解决了哪些问题?" --no-stream   # 对照:等完整回答后一次打印
```

重点观察:回答句末的 `[1]` 编号,以及流式与阻塞两种模式的速度感受差异。
