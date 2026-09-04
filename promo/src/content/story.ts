export const FPS = 30;
export const FILM_SECONDS = 300;
export const FILM_FRAMES = FPS * FILM_SECONDS;

export type SceneStatus =
  | "problem"
  | "product"
  | "committed-design"
  | "implemented"
  | "boundary"
  | "roadmap";

export type StoryScene = {
  id: string;
  durationSeconds: number;
  eyebrow: string;
  title: string;
  support: string;
  narrationEn: string;
  narrationZh: string;
  status: SceneStatus;
};

export const STORY: readonly StoryScene[] = [
  {
    id: "01-question",
    durationSeconds: 26,
    eyebrow: "THE QUESTION BEHIND THE ANSWER",
    title: "Why should this be true?",
    support: "Premises. Evidence. Objections. Revision.",
    status: "problem",
    narrationEn:
      "We can now ask a machine a question and receive an answer in seconds. But the hardest questions did not disappear. Where did this conclusion come from? Which premises carry it? What is the strongest live objection? And if the answer changes tomorrow, who can still see why?",
    narrationZh:
      "今天，我们向机器提问，几秒内就能得到答案。但最难的问题并未消失：结论从何而来？由哪些前提支撑？最有力的现存反对是什么？如果答案明天改变，谁还能看见原因？",
  },
  {
    id: "02-missing-structure",
    durationSeconds: 31,
    eyebrow: "INFORMATION IS ABUNDANT",
    title: "Structure is still expensive.",
    support: "The reader still rebuilds the dependency graph.",
    status: "problem",
    narrationEn:
      "Publishing made information abundant. Search made it retrievable. Generative AI made synthesis instantaneous. Yet the structure behind an answer remains scattered across pages, footnotes, comments, and overwritten revisions. A reader still has to rebuild the dependency graph by hand: the definition in use, the independent evidence, the hidden assumption, the counterexample, and the moment a prior conclusion stopped holding. Knowledge Ball begins at that unresolved layer.",
    narrationZh:
      "发布让信息充裕，搜索让信息可检索，生成式人工智能让综合几乎即时完成。但答案背后的结构仍散落在网页、脚注、评论和被覆盖的修订中。读者仍需手工重建定义、独立证据、隐藏假设、反例，以及旧结论失效的时刻。知识球从这一未解决的层面开始。",
  },
  {
    id: "03-new-unit",
    durationSeconds: 35,
    eyebrow: "A DIFFERENT UNIT OF KNOWLEDGE",
    title: "Identity is not a claim version.",
    support: "Claims and reasoning become inspectable objects.",
    status: "product",
    narrationEn:
      "It is not another answer engine. It is a spatial, versioned knowledge network designed to make claims inspectable, challengeable, revisable, and learnable. A durable Knowledge Node keeps its identity. A Claim Version records one assertion at one point in time. A Reasoning Node binds explicit premises to one concrete conclusion. A material change creates a new version; it does not silently overwrite the old one. Names remain labels. Identity, lineage, and relationships carry the history.",
    narrationZh:
      "它不是另一个答案引擎，而是一套空间化、版本化的知识网络，让主张可检查、可挑战、可修订、可学习。稳定知识节点保留身份，主张版本记录特定时点的表述，推理节点把明确前提连接到具体结论。实质变化产生新版本，不会静默覆盖旧版本。名称只是标签，身份、谱系与关系承载历史。",
  },
  {
    id: "04-space",
    durationSeconds: 34,
    eyebrow: "SEMANTICS BECOME SPACE",
    title: "The 3D field is operational.",
    support: "Overview first. Relationships second. Detail on focus.",
    status: "committed-design",
    narrationEn:
      "Those relationships become space. The cyan inner shell holds definitions, facts, and logic symbols. The blue middle shell holds other admitted public knowledge. The violet outer shell holds pending, disputed, predictive, and value-laden content. Geometry is not decoration. Shells encode semantic status. Chains encode dependency. Deterministic placement protects spatial memory. The interface leads with overview, then relationships, then full content when the user zooms or focuses.",
    narrationZh:
      "这些关系被映射为空间。青色内层承载定义、事实与逻辑符号；蓝色中层承载其他已接纳的公共知识；紫色外层承载待验证、争议、预测与价值主张。几何不是装饰：球壳编码语义状态，知识链编码依赖，确定性位置保护空间记忆。界面先给全局，再呈关系，最后在缩放或聚焦时展示完整内容。",
  },
  {
    id: "05-verdict",
    durationSeconds: 40,
    eyebrow: "CREATION IS NOT ACCEPTANCE",
    title: "A verdict is bounded—and reversible.",
    support: "Version-bound review. Explicit opposition. Auditable history.",
    status: "committed-design",
    narrationEn:
      "Creation is not acceptance. Under the committed protocol design, a candidate is checked for reference integrity, legal relations, cycles, duplicate risk, and real semantic change. Support and opposition stake against that exact version. The first side to reach the current eligibility-adjusted threshold produces a bounded verdict. Bounded matters. Correct means currently accepted under a known evidence set and rule set—not eternal truth, and not truth manufactured by popularity. New evidence can create a new version or opposing branch. The active view may change while admitted history remains auditable.",
    narrationZh:
      "创建成功不等于被接纳。按已确定的协议设计，候选内容要检查引用完整性、关系合法性、循环、重复风险和真实语义变化。支持与反对都绑定到具体版本。一方先达到当前资格门槛，只形成有边界的裁决。正确表示在已知证据与规则下当前被接纳，不是永恒真理，也不是由流行度制造的真理。新证据可产生新版本或反对分支，当前视图改变，已接纳历史仍可审计。",
  },
  {
    id: "06-energy",
    durationSeconds: 33,
    eyebrow: "ACCOUNTABILITY WITHOUT TOKEN ECONOMICS",
    title: "Energy closes the loop.",
    support: "Version-bound stakes. Double-entry conservation.",
    status: "committed-design",
    narrationEn:
      "Energy gives judgment a cost, but it is not a token launch and it is not external financial value. In the current design, submitting a candidate, supporting it, or opposing it each locks one unit against a specific version. Settlement follows double-entry accounting. Every internal transfer balances, and global net Energy remains zero. The ledger is authoritative. A client may request an action and display the result; it may never declare a balance or perform privileged settlement.",
    narrationZh:
      "能量让判断承担成本，但它不是代币发行，也不代表外部金融价值。当前设计中，提交候选、支持或反对都会针对具体版本锁定一单位能量。结算采用复式记账，每笔内部转移借贷相等，全局净能量保持为零。账本是权威来源；客户端只能请求操作并显示结果，不能自行声明余额或执行特权结算。",
  },
  {
    id: "07-two-graphs",
    durationSeconds: 32,
    eyebrow: "TWO QUESTIONS. TWO STORES.",
    title: "Public validity ≠ private mastery.",
    support: "Your learning state never rewrites shared knowledge.",
    status: "boundary",
    narrationEn:
      "One network, two strictly separated questions. Public knowledge asks: what version does the protocol currently accept, and why? Private mastery asks: what have I seen, understood, saved, illuminated, or hidden? Personal state does not enter public voting, public events, or public accuracy. Hiding a conclusion in personal mode can hide its reasoning without rewriting the shared graph. Visitors may inspect public knowledge. Public changes still pass through identity, permission, and protocol boundaries.",
    narrationZh:
      "同一网络回答两个严格分离的问题。公共知识问：协议当前接纳哪个版本，为什么？个人掌握问：我看过、理解、收藏、点亮或隐藏了什么？个人状态不进入公共投票、公共事件或公开准确率。在个人模式隐藏结论，可以连同其推理一起隐藏，却不会改写共享知识图。访客可查看公共知识；公共变更仍必须经过身份、权限与协议边界。",
  },
  {
    id: "08-system-and-use",
    durationSeconds: 33,
    eyebrow: "A SYSTEM WITH AN AUTHORITY BOUNDARY",
    title: "Models may propose. The protocol admits.",
    support: "Learning · research · organizations · AI context",
    status: "implemented",
    narrationEn:
      "The working prototype is built with TypeScript, Vite, and Three.js, with the web implementation shared into Android and Windows packages. The backend direction uses Supabase and Postgres for identity, events, the Energy ledger, and row-level security. The server—not the visualization—is the authority boundary. The practical starting points are bounded domains: learning maps, research synthesis, organizational decisions, and structured context for AI. Models may extract candidate claims and relationships. People confirm intent. The protocol, not the model, decides admission.",
    narrationZh:
      "可运行原型基于 TypeScript、Vite 与 Three.js，网页实现共享到 Android 和 Windows 封装。后端方向使用 Supabase 与 Postgres 承载身份、事件、能量账本和行级安全。权威边界在服务端，而不在可视化层。现实起点是边界清楚的领域：学习地图、研究综合、组织决策与人工智能的结构化上下文。模型可以提取候选主张与关系，人确认意图，最终是否接纳由协议决定。",
  },
  {
    id: "09-honest-close",
    durationSeconds: 36,
    eyebrow: "A PROTOTYPE WITH EXPLICIT GATES",
    title: "Knowledge is energy.",
    support:
      "Every conclusion can be questioned. Every revision leaves a reason.",
    status: "roadmap",
    narrationEn:
      "As of White Paper one point zero, Knowledge Ball is a working prototype with a converging protocol—not infrastructure proven at internet scale. The theory is coherent. Engineering viability is moderate. Commercial value remains unproven. Large-scale operation still needs evidence: stronger identity, domain governance, source quality, deterministic layout, recovery, and sustained mobile performance. That honesty is part of the product. Knowledge is energy. Every conclusion can be questioned. Every revision leaves a reason. Every person can see the real distance between themselves and what they want to know.",
    narrationZh:
      "截至白皮书 1.0，知识球是可运行原型和正在收敛的协议，不是已经通过互联网规模验证的基础设施。理论模型自洽，工程可行性中等，商业价值尚未验证。大规模运行仍需更强身份、领域治理、来源质量、确定性布局、恢复能力与长期移动性能证据。这种诚实本身就是产品的一部分。知识就是能量。任何结论都可以被追问，任何修订都留下原因，每个人都能看见自己与目标知识之间的真实距离。",
  },
] as const;

export const NARRATION_EN = STORY.map((scene) => scene.narrationEn).join(
  "\n\n",
);
export const NARRATION_ZH = STORY.map((scene) => scene.narrationZh).join(
  "\n\n",
);

export const sceneStartFrame = (index: number) =>
  STORY.slice(0, index).reduce(
    (total, scene) => total + scene.durationSeconds * FPS,
    0,
  );

export const STORY_DURATION_FRAMES = STORY.reduce(
  (total, scene) => total + scene.durationSeconds * FPS,
  0,
);
