# Issue tracker: 本地 Markdown

本仓库的 issue、spec 与工单以 markdown 文件形式存放在 `.scratch/` 下。

## 约定

- 每个 feature 一个目录: `.scratch/<feature-slug>/`
- spec 为 `.scratch/<feature-slug>/spec.md`
- 实现工单为每票一个文件: `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, 从 `01` 编号, 不合并成单个 tickets 文件
- triage 状态记录在每个 issue 文件顶部的 `Status:` 行 (角色字符串见 `docs/agents/triage-labels.md`)
- 评论与对话历史追加到文件末尾的 `## Comments` 标题下

## 当技能要求「发布到 issue tracker」

在 `.scratch/<feature-slug>/` 下新建文件 (必要时先建目录)。

## 当技能要求「获取相关工单」

读取被引用的路径。用户通常会直接给出文件路径或工单编号。

## Wayfinding 操作

供 `/wayfinder` 使用。**map** 是一个文件, 每个 **child** 工单是一个文件。

- **Map**: `.scratch/<effort>/map.md` — Notes / Decisions-so-far / Fog 正文。
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, 从 `01` 编号, 正文写问题。`Type:` 行记录工单类型 (`research`/`prototype`/`grilling`/`task`); `Status:` 行记录 `claimed`/`resolved`。
- **Blocking**: 顶部附近的 `Blocked by: NN, NN` 行。所列文件全部 `resolved` 时该工单解除阻塞。
- **Frontier**: 扫描 `.scratch/<effort>/issues/` 中开放、未阻塞、未认领的文件; 编号最小者优先。
- **Claim**: 做任何工作前先写 `Status: claimed` 并保存。
- **Resolve**: 在 `## Answer` 标题下追加答案, 写 `Status: resolved`, 然后把上下文指针 (要点 + 链接) 追加到 `map.md` 的 Decisions-so-far。
