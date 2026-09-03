# 知识协议 v1：推理、依赖与编辑事件

本文档是当前代码执行的规范，不是界面说明。文中的“必须”“不得”同时约束浏览器命令、事件回放、远程批量写入和测试。

> 规范模型位置：`src/domain/KnowledgeModel.ts`。序列化结构版本为 2；旧 `schemaVersion: 1` 数据必须显式迁移，不能静默改变含义。

### 架构边界

- 公共节点只包含认识状态、可用性和生命周期；不得包含 `mastery`、个人笔记或任意 `hidden` 真相。
- `PersonalKnowledgeState` 使用独立个人事件及 `knowledge-ball.personal-events.v1` key；公共服务端收到 `mastery` 必须返回 `PERSONAL_STATE_IN_PUBLIC_PAYLOAD`。
- UI 只通过 `selectKnowledgeDisplay` 组合公共节点和当前用户个人掌握度。`falsified`、`superseded` 默认不显示，`suspended` 仍显示。
- 公共状态三个轴分别为 `pending|verified|disputed|falsified`、`active|suspended`、`current|superseded`。

| 关系 | 方向 | 关键约束 |
| --- | --- | --- |
| `premise` | 普通知识结论 → reasoning | 来源不能是 reasoning 或 logic-symbol |
| `conclusion` | reasoning → 理论结论 | 新 reasoning 与唯一结论必须在同一原子批次创建 |
| `logic-rule` | logic-symbol → reasoning | 每个 reasoning 恰好一个当前可用规则 |
| `counterexample` | 知识结论 → 被否定节点 | 不自指、不重复，来源当前可用 |
| `supersedes` | 历史节点 → 当前节点 | 历史保留，不硬删除，不参与普通依赖传播 |

结构依赖和循环检测覆盖 `premise`、`conclusion`、`logic-rule`。服务端读取、revision 检查、验证和写入位于同一个串行事务；失败不写节点且不增加 revision。稳定错误码统一由 `PROTOCOL_ERROR_CODES` 定义，UI 可以映射中文消息，但领域判断不得依赖中文字符串。

## 1. 唯一领域模型

系统把知识结论、推理过程和逻辑符号都建模为节点。公共知识状态与个人掌握状态正交：

| 字段 | 含义 |
| --- | --- |
| `id` | 永久 ID；创建后不变 |
| `title` | 节点名称 |
| `type` | 知识类型 |
| `description` | 普通知识节点的描述；推理节点的推理过程 |
| `epistemicStatus` | 公共认识状态 |
| `availability` | 公共可用性；上游失效时为 suspended |
| `lifecycle` | current 或 superseded；决定是否为当前版本 |
| `aliases` | 合并后保留的原名称 |
| `semanticKey` | 合并时声明的语义身份 |

`premises`、`logicRuleId`、`negatedBy`、`supersededBy` 是旧序列化结构；schema v2 由规范 `KnowledgeRelation` 生成关系。`mastery` 仅存在于独立的 `PersonalKnowledgeState`，不属于本表的公共节点。

节点类型为：

- `axiom`：公理；
- `definition`：定义；
- `fact`：事实；
- `theorem`：定理；
- `hypothesis`：假说；
- `prediction`：预测；
- `opinion`：观点；
- `value`：价值判断；
- `reasoning`：推理过程；
- `logic-symbol`：逻辑符号或推理规则。

公共状态为 `pending`、`verified`、`suspended`、`disputed`、`falsified`。个人掌握状态为 `none`、`touched`、`mastered`。

## 2. 依赖结构

完整理论必须形成：

```text
一个或多个已有知识前提 -> reasoning 节点 -> 非 reasoning 结论
                              |
                              +-> logicRuleId -> logic-symbol 节点
```

不得把已有前提直接写入理论结论的 `premises`。结论直接依赖推理过程，推理过程再依赖知识前提。逻辑符号不是字符串枚举，而是可增加、检索、否定和引用的一类知识节点，因此新的推理分类不需要修改协议枚举。

服务端对新节点批次执行以下结构验证：

1. 所有引用必须存在于既有节点或同一批次；
2. 禁止自引用和重复前提；
3. 依赖图不得成环；
4. 新推理必须至少有一个前提；
5. 新推理必须引用一个当前可用的 `logic-symbol`；
6. 新理论结论必须直接且只依赖一个 `reasoning` 节点；
7. 公理、定义、事实和逻辑符号作为原子知识增加时不得伪造前提。

## 3. 唯一性

所有新节点都必须同时满足：

- 规范化后的标题不与任何既有节点重复；
- 规范化后的描述或推理过程不与任何既有节点重复；
- 同一操作产生的多个新节点之间也不得重复；
- 比较使用 Unicode NFKC、去首尾空白、合并连续空白和忽略大小写。

“既有节点”包括已证伪、已合并、被替代和默认隐藏的历史节点。隐藏不是释放名称。编辑已有节点时，浏览器和服务端也不得把标题或描述改成其他节点已经占用的文本。

## 4. 命令与事件边界

用户编辑只能通过正式命令边界写入。命令先用完整投影验证，再追加一个事件：

| 行为 | 命令 `kind` | 原子事件 |
| --- | --- | --- |
| 增加 | `add` | `KnowledgeAdded` |
| 否定 | `negate` | `KnowledgeNegated` |
| 合并 | `merge` | `KnowledgeMerged` |

一个操作只能产生一个上述事件。验证失败时事件数量、投影和持久化内容都不得变化。事件写入前还要验证：

- ID、时间戳和协议版本；
- 事件类型与编辑 `kind` 一一对应；
- 当前投影是否仍满足该编辑的全部前置条件。

旧的 `NodeFalsified` 只为历史事件回放保留。运行中的新 `NodeFalsified` 会被拒绝；否定必须使用 `KnowledgeNegated`。

## 5. 增加

### 5.1 原子知识

`axiom`、`definition`、`fact`、`logic-symbol` 可以用 `mode: atomic` 增加一个无前提节点。

### 5.2 理论知识

`theorem`、`hypothesis`、`prediction`、`opinion`、`value` 必须用 `mode: theory` 一次提交：

1. 一个或多个当前可用的已有知识前提；
2. 一个新的 `reasoning` 节点；
3. 推理节点引用的已有 `logic-symbol`；
4. 一个新的理论结论。

只有完整形成“前提 -> 推理 -> 结论”后才追加 `KnowledgeAdded`。界面中原先“我确认不违反逻辑三大基本定律”的复选框已经删除，因为自我确认不能证明结构或推理有效。

## 6. 否定

每次否定，不论目标是知识结论还是推理过程，都必须提供至少一个当前可用的反例知识节点。反例：

- 必须已经存在；
- 不能是目标自身；
- 不能是 `reasoning` 节点；
- 不能重复；
- 不能是已证伪或默认隐藏的历史节点。

否定知识结论时：

1. 目标进入 `falsified`；
2. 目标写入 `hidden: true`；
3. 反例 ID 记录到 `negatedBy`；
4. 所有可达下游进入 `suspended`。

否定推理过程时，还必须提交一个完整的正确推理节点，包括新的标题、推理过程和逻辑符号。事件会把原推理隐藏并证伪，把原结论改为依赖新推理。缺少替换推理时整个事件无效。

### 6.1 重新解放已证伪节点

已证伪节点不能通过 `NodeResolved` 直接恢复。系统只在其 `negatedBy` 中记录的相反知识节点全部也被有效反例否定后，自动将原节点恢复为：

- `status: pending`；
- `hidden: false`。

因此恢复动作本身也留下反例链和否定事件，不会抹掉历史。

## 7. 合并

### 7.1 定义合并

定义合并至少需要两个当前可用的 `definition` 节点。来源描述必须是不同文字，调用方还必须提供非空的定义 `semanticKey`，声明它们实际定义同一概念。

成功后：

- 建立一个新的统一定义；
- 原定义标题进入统一定义的 `aliases`；
- 原定义写入 `supersededBy`、进入 `suspended` 并默认隐藏。

来源定义不会删除，且继续占用原标题和描述。

### 7.2 理论合并

理论合并至少需要两条独立推理链。系统按顺序验证：

1. 各链结构都完整；
2. 各链前提集合相同；
3. 推理节点彼此独立；
4. 推理节点使用同一逻辑符号；
5. 调用方先提供 `reasoningSemanticKey`，声明这些不同文字的推理过程语义相同；
6. 再提供结论 `semanticKey`，声明结论语义相同；
7. 先建立统一推理节点；
8. 再建立直接依赖统一推理的统一结论。

统一推理和统一结论在一个 `KnowledgeMerged` 事件中原子提交。来源推理与来源结论全部保留、写入 `supersededBy` 并默认隐藏。

## 8. 投影与显示

领域投影保存全部节点。默认 3D 投影只取 `hidden !== true` 的节点，所以否定和合并不会造成历史数据消失，也不会让界面堆满被替代节点。

普通结论球使用设置中的节点半径。所有 `reasoning` 球半径固定为结论球的三分之一：

```text
reasoningRadius = conclusionRadius / 3
```

该比例不受整体图缩放补偿影响。

## 9. 本地与远程原子性

本地事件存储保存一个完整编辑事件并按事件 ID 去重。刷新时按原顺序重放，隐藏、替代、反例、逻辑符号和恢复状态都必须复原，重复刷新不得增加事件或节点。

远程知识网关使用一个批量请求保存本次操作涉及的全部节点。服务端先在“既有节点 + 整个批次”上完成唯一性、引用、逻辑符号、链结构和无环验证，再通过一次队列化文件写入提交。因此不会先保存推理、却因结论失败而留下半条远程推理链。
