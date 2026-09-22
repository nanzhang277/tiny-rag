# 07 评测 Evaluation

## 解决什么问题

**没有指标就没有优化。**"感觉比之前好"不是工程语言——改了切块策略、换了检索方式,到底有没有变好?好多少?必须先量化,再动手调。这是贯穿全项目的工程理念:**评测驱动调优**。

三块能力,成本从零到低:

1. **检索指标(纯数学,零成本)**:
   - `recall@k` = 前 k 名里命中的正确答案数 / 正确答案总数——"该找到的找到了几成";
   - `MRR`(Mean Reciprocal Rank)= 第一条正确答案的排名倒数——第 1 名 → 1.0,第 2 名 → 0.5,没中 → 0,"最好答案排多前"。
2. **配置对比**:chunking(fixed/recursive)× 检索(vector/hybrid)× rerank(on/off),每个开关都可能影响效果,拍脑袋选不如跑表——"能对比"是本系统的核心诉求。
3. **GLM 自评**:检索指标只衡量"找没找到",不衡量"答得好不好"。让 GLM 按评分表给回答的**忠实度**(是否只依据资料、没有编造)与**相关性**(是否切题完整)打 1-5 分。花小钱——自评只跑默认组合,不跑全表。

评测库建在 `data/eval/` 临时路径,不碰你已建的知识库。

## 代码在哪

- `rag/evaluation.py`:
  - `recall_at_k` / `mrr`:两个纯函数,各 5 行,零依赖零成本;
  - `load_eval_set`:读内置评测集 `data/eval/eval_set.json`(问答对 + 标注出处 `source`,由示例文档生成,共 6 条),带最小 schema 校验;
  - `EvalConfig`:一组对比开关(chunking / retrieval / rerank)——"同题不同配置,指标可对比";
  - `run_eval`:跑全部 5 组组合(fixed/vector、fixed/hybrid、recursive/vector、recursive/hybrid、recursive/hybrid+rerank),返回 Markdown 对比表;同一 chunking 策略只重建一次库,向量不重算;最后对默认组合跑 GLM 自评;
  - `llm_judge` + `JUDGE_PROMPT`:评分表 Prompt;`_parse_scores` 从模型回答里宽容地抠 JSON(模型可能裹 ```json 代码块或多说话,抠不出按 0 分计)。
- 评测入口:`python cli.py eval`(延迟导入——ask/ingest 不背评测的依赖)。
- 行为快照:`tests/test_evaluation.py`(离线,注入假 embedder / 假 LLM 跑通全流程)。

## 做什么实验

实验 1(离线):手算 recall@k 与 MRR,建立对指标的直觉。正确出处是 `a.md` 和 `c.md`,检索返回顺序 `["b.md", "a.md", "c.md", "d.md"]`:

- recall@1:前 1 名只有 b.md,命中 0/2 = **0.0**——该找的一个都没找到;
- recall@3:前 3 名含 a.md、c.md,命中 2/2 = **1.0**——找全了;
- MRR:第一条正确答案 a.md 排第 2 → 1/2 = **0.5**。

```python
from rag.evaluation import recall_at_k, mrr

ids = ["b.md", "a.md", "c.md", "d.md"]
rel = {"a.md", "c.md"}
print(recall_at_k(ids, rel, 1), recall_at_k(ids, rel, 3), mrr(ids, rel))
# 实测:0.0 1.0 0.5 —— 与手算一致
```

实验 2(需 API key):跑一次完整 `python cli.py eval`,解读输出:

- 对比表五行,逐列看:recursive 是否胜过 fixed?hybrid 是否胜过 vector?rerank on 是否抬高了 MRR?
- 如果某两行指标打平,选择更便宜/更快的组合——指标是决策依据,不是越高越好的教条;
- GLM 自评两项分数若低(如 < 3),瓶颈多半在生成或检索质量,回到 02/04 环节调参再跑——这就是"评测驱动调优"的循环。

实验 3(离线):无 key 时跑 `python cli.py eval`,观察失败方式:stdout 零输出、stderr 报错 `[embedding] API 调用失败: …`、退出码 1、无 traceback——报错直接指向出错的环节(为什么是 embedding?评测第一步是重建评测库,建库第一步是向量化),细节见 `08-engineering.md`。
