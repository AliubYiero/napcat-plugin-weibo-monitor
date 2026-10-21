# Domain Docs

本仓库的工程技能在探索代码库时应如何消费领域文档。

## 探索前先读这些

- 根目录的 **`CONTEXT.md`** (本仓库为单上下文布局)。
- **`docs/adr/`** — 读取与你即将改动的区域相关的 ADR。

若上述文件不存在, **静默继续**: 不要提示缺失, 也不要主动建议创建。`/domain-modeling` 技能 (经 `/grill-with-docs` 与 `/improve-codebase-architecture` 触达) 会在术语或决策真正确定时按需创建。

## 文件结构

本仓库为单上下文布局 (尽管是 pnpm monorepo, 领域文档集中在根):

```
/
├── CONTEXT.md
├── docs/adr/
│   └── 0001-plugin-switch-and-command-prefix.md
└── packages/
    ├── plugin/
    ├── shared/
    └── webui/
```

若将来拆分为多上下文, 在根目录新增 `CONTEXT-MAP.md` 指向各上下文的 `CONTEXT.md`, 并为每个上下文建立自己的 `docs/adr/`。

## 使用术语表中的词汇

当输出中出现领域概念 (issue 标题、重构提案、假设、测试名) 时, 使用 `CONTEXT.md` 定义的术语, 不要漂移到术语表明确避免的同义词。

若需要的概念尚未进入术语表, 这是一个信号: 要么你在发明项目不使用的语言 (请重新考虑), 要么存在真实空缺 (记下来交给 `/domain-modeling`)。

## 标记 ADR 冲突

若你的输出与现有 ADR 矛盾, 明确指出来, 而不是静默覆盖:

> _与 ADR-0007 (事件溯源订单) 矛盾 — 但值得重新开启, 因为……_
