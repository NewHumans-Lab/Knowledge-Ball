import type { EventStore } from '../event/EventStore';
import type { GraphState } from '../state/GraphState';
import { nodeList } from '../state/GraphState';
import type { GraphProjection } from '../projection/GraphProjection';
import { executeKnowledgeEdit } from '../command/KnowledgeEdit';
import { resolveNode } from '../command/ResolveNode';
import { setMastery } from '../command/SetMastery';
import { suspendNode } from '../command/SuspendNode';
import { disputeNode } from '../command/DisputeNode';
import type { NodeType } from '../event/Event';
import type { DomainEvent } from '../event/Event';

const DEMO_NODE_IDS = new Set(['n1','n2','n16','logic-deduction','n3','n4','r-n5','n5','r-n6','n6','r-n15','n15','r-n7','n7','n-ai-trend','r-n8','n8','n-market-observation','r-n9','n9','n-autonomy-definition','r-n10','n10','n11','r-n12','n12','r-n13','n13','r-n14','n14','n11-counter']);
export function isDemoSeedEvent(event:DomainEvent):boolean {
  if(event.type==='KnowledgeAdded')return event.payload.edit.mode==='atomic'?DEMO_NODE_IDS.has(event.payload.edit.node.id):DEMO_NODE_IDS.has(event.payload.edit.reasoning.id)&&DEMO_NODE_IDS.has(event.payload.edit.conclusion.id);
  if(event.type==='KnowledgeStatusChanged')return DEMO_NODE_IDS.has(event.payload.edit.nodeId);
  if(event.type==='KnowledgeNegated')return event.payload.edit.targetId==='n11'&&event.payload.edit.counterexampleIds.length===1&&event.payload.edit.counterexampleIds[0]==='n11-counter';
  return false;
}

type DerivedType = Exclude<NodeType, 'axiom' | 'definition' | 'fact' | 'logic-symbol' | 'reasoning'>;

export async function seedDemoKnowledge(
  store: EventStore<GraphState>,
  projection: GraphProjection,
): Promise<void> {
  if (nodeList(projection.state).length > 0) return;

  const addAtomic = async (
    id: string,
    title: string,
    type: 'axiom' | 'definition' | 'fact' | 'logic-symbol',
    description: string,
  ) => {
    await executeKnowledgeEdit(store, projection, {
      kind: 'add',
      mode: 'atomic',
      node: { id, title, type, reasoning: description },
    });
  };

  const addTheory = async (
    id: string,
    title: string,
    type: DerivedType,
    description: string,
    premises: string[],
    inference: string,
  ) => {
    await executeKnowledgeEdit(store, projection, {
      kind: 'add',
      mode: 'theory',
      requiredPremiseIds: premises,
      reasoning: {
        id: `r-${id}`,
        title: `推理过程：${title}`,
        type: 'reasoning',
        reasoning: inference,
        logicRuleId: 'logic-deduction',
      },
      conclusion: { id, title, type, reasoning: description },
    });
  };

  const resolve = async (...ids: string[]) => {
    for (const id of ids) await resolveNode(store, { nodeId: id });
  };

  await addAtomic('n1', '同一律', 'axiom', '在同一语境与同一时刻，任何对象与其自身保持同一。');
  await addAtomic('n2', '排中律', 'axiom', '对于一个确定命题，在经典逻辑中命题或其否定至少一个成立。');
  await addAtomic('n16', '矛盾律', 'axiom', '同一命题在同一语境与同一时刻不能同时为真又为假。');
  await addAtomic('logic-deduction', '演绎蕴含 →', 'logic-symbol', '表示结论由列出的全部前提经演绎规则推出。');
  await resolve('n1', 'n2', 'n16', 'logic-deduction');
  await setMastery(store, { nodeId: 'n1', mastery: 'mastered' });
  await setMastery(store, { nodeId: 'n2', mastery: 'touched' });
  await setMastery(store, { nodeId: 'n16', mastery: 'mastered' });

  await addAtomic('n3', '质数的定义', 'definition', '质数是大于一且正因数恰好只有一和自身的自然数。');
  await addAtomic('n4', '标准大气压下水的沸点', 'fact', '在一个标准大气压下，纯水的正常沸点为一百摄氏度。');
  await resolve('n3', 'n4');
  await setMastery(store, { nodeId: 'n3', mastery: 'mastered' });
  await setMastery(store, { nodeId: 'n4', mastery: 'touched' });

  await addTheory('n5', '勾股定理', 'theorem', '直角三角形两直角边平方和等于斜边平方。', ['n1', 'n2'], '在欧氏几何公理和直角三角形定义下，通过相似三角形面积关系推得平方关系。');
  await addTheory('n6', '反证法证明质数无穷', 'theorem', '质数的数量不是有限个。', ['n3'], '假设质数有限，将全部质数相乘再加一；新数不能被列表中任何质数整除，由此产生矛盾。');
  await addTheory('n15', '欧拉乘积证明质数无穷', 'theorem', '调和级数与欧拉乘积共同推出质数必有无限多个。', ['n3'], '若质数有限，欧拉乘积会收敛为有限值，但它等于发散的调和级数，因此假设不成立。');
  await resolve('r-n5', 'n5', 'r-n6', 'n6', 'r-n15', 'n15');
  await setMastery(store, { nodeId: 'n5', mastery: 'mastered' });
  await setMastery(store, { nodeId: 'n6', mastery: 'mastered' });
  await setMastery(store, { nodeId: 'n15', mastery: 'touched' });

  await addTheory('n7', '黎曼猜想', 'hypothesis', '黎曼 ζ 函数的所有非平凡零点实部都等于二分之一。', ['n3'], '欧拉乘积把 ζ 函数与质数联系起来；零点分布证据支持临界线假说，但尚不构成证明。');
  await resolveNode(store, { nodeId: 'r-n7' });
  await setMastery(store, { nodeId: 'n7', mastery: 'touched' });
  await suspendNode(store, { nodeId: 'n7' });

  await addAtomic('n-ai-trend', '人工智能能力增长记录', 'fact', '公开基准和产品能力显示人工智能系统在多项任务上持续进步。');
  await addTheory('n8', '2035 年实现 AGI 的预测', 'prediction', '预测二〇三五年前后可能出现可跨领域完成多数认知任务的系统。', ['n-ai-trend'], '将历史能力提升趋势外推到通用任务范围，但外推假设和定义边界仍待未来验证。');
  await resolveNode(store, { nodeId: 'n-ai-trend' });
  await resolveNode(store, { nodeId: 'r-n8' });
  await suspendNode(store, { nodeId: 'n8' });

  await addAtomic('n-market-observation', '市场价格协调观察', 'fact', '分散交易中的价格会聚合参与者的局部供需信息。');
  await addTheory('n9', '自由市场效率观点', 'opinion', '在信息分散且外部性受控时，自由市场通常比集中计划更有效率。', ['n-market-observation'], '价格信号降低信息汇总成本，但结论依赖竞争、产权和外部性约束。');
  await resolveNode(store, { nodeId: 'n-market-observation' });
  await resolveNode(store, { nodeId: 'r-n9' });
  await setMastery(store, { nodeId: 'n9', mastery: 'touched' });
  await disputeNode(store, { nodeId: 'n9' });

  await addAtomic('n-autonomy-definition', '个体自主的定义', 'definition', '个体自主指个人能够在不受不当强迫时形成并执行自己的选择。');
  await addTheory('n10', '个体自由优先', 'value', '当集体效率与基本自主发生冲突时，应优先保护个体自由。', ['n-autonomy-definition'], '该结论由明确的规范性优先级推出，不宣称它是可由经验单独证明的事实。');
  await resolveNode(store, { nodeId: 'n-autonomy-definition' });
  await resolveNode(store, { nodeId: 'r-n10' });
  await disputeNode(store, { nodeId: 'n10' });

  await addAtomic('n11', 'LK-99 常温常压超导声称', 'fact', '二〇二三年的论文声称 LK-99 在常温常压下具有超导性。');
  await addTheory('n12', 'LK-99 无损耗输电推论', 'theorem', '如果 LK-99 的超导声称成立并可工程化，就可能构造低损耗输电系统。', ['n11'], '把材料超导性质与输电中的电阻损耗关系结合，得到条件性工程结论。');
  await addTheory('n13', 'LK-99 数据中心节能预测', 'prediction', '若该材料可规模应用，数据中心供配电损耗可能显著下降。', ['n12'], '由低损耗输电能力外推到数据中心供电系统，工程规模化仍是额外约束。');
  await addTheory('n14', 'LK-99 电网投资观点', 'opinion', '若材料实现产业化，全球电网基础设施的投资结构可能改变。', ['n12'], '从工程能力变化推到资本配置变化，中间依赖成本、监管与产能条件。');
  await addAtomic('n11-counter', 'LK-99 独立复现实验反例', 'fact', '多个独立实验未观察到所声称的常温常压超导转变，并给出磁悬浮现象的非超导解释。');
  await resolve('r-n12', 'n12', 'r-n13', 'n13', 'r-n14', 'n14', 'n11-counter');
  await setMastery(store, { nodeId: 'n11', mastery: 'touched' });
  await executeKnowledgeEdit(store, projection, {
    kind: 'negate',
    target: 'conclusion',
    targetId: 'n11',
    counterexampleIds: ['n11-counter'],
  });
}
