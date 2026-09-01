import { getLocale, t, type AppLocale } from './Locale';
import { SYSTEM_TEXT_CATALOG, type SystemTextKey } from './SystemCatalog';

type UiCopyPair = Readonly<Record<AppLocale, string>>;

/**
 * Supplemental system-owned copy for imperative controllers.
 *
 * SYSTEM_TEXT_CATALOG remains the primary catalog. This small supplement only
 * contains copy that did not previously have a key, so controllers do not grow
 * ad-hoc locale ternaries or translate user/community values.
 */
export const SUPPLEMENTAL_SYSTEM_UI_TEXT = {
  'layer.label.core': { 'zh-CN': '核心 · 系统基础', en: 'Core · System foundations' },
  'layer.help.inner': {
    'zh-CN': '定义、直接事实或观察，以及知识点之间不依赖推导的静态语义关系。第一层描述“是什么 / 有什么关系”，不是推理链。',
    en: 'Definitions, direct facts or observations, and static semantic relations that do not depend on inference. Layer 1 describes what something is or how things relate; it is not a reasoning chain.',
  },
  'layer.help.middle': {
    'zh-CN': '所有严谨推理，或明确声称严谨的推理结构，包括公理体系、证明、定理、演绎规则和形式化推导。',
    en: 'Rigorous reasoning, or reasoning structures explicitly presented as rigorous, including axiom systems, proofs, theorems, deductive rules, and formal derivations.',
  },
  'layer.help.outer': {
    'zh-CN': '有争议的知识，或作者在提交时明确声明为概率性 / 不确定性的描述，例如“可能”“也许”“概率为 80%”以及假说、预测、观点和价值判断。',
    en: 'Disputed knowledge, or claims explicitly submitted as probabilistic or uncertain, such as “possibly”, “perhaps”, “80% probability”, hypotheses, predictions, opinions, and value judgments.',
  },
  'create.conclusionSingle': { 'zh-CN': '结论（只能选择一个）', en: 'Conclusion (select one only)' },
  'create.conclusionSingleRequired': { 'zh-CN': '请从已有节点中选择且只能选择一个结论。', en: 'Select exactly one existing conclusion.' },
  'create.reasoningSingleConclusionNote': {
    'zh-CN': '一个推理球固定服务一个具体结论球。前提可以选择多个，结论只能选择一个；重新选择结论会替换之前的选择。',
    en: 'Each reasoning ball serves one specific conclusion ball. You may select multiple premises, but only one conclusion; selecting another conclusion replaces the previous choice.',
  },
  'create.nodeSubmitted': { 'zh-CN': '节点已提交：{title}', en: 'Node submitted: {title}' },
  'create.reasoningSubmitted': { 'zh-CN': '推理已提交：{title}', en: 'Reasoning submitted: {title}' },

  'detail.energyMinus': { 'zh-CN': '能量 −{energy}', en: 'Energy −{energy}' },
  'detail.identityFailed': { 'zh-CN': '身份确认失败，暂不能投票', en: 'Identity verification failed; voting is temporarily unavailable' },
  'detail.voteStateSyncFailed': { 'zh-CN': '投票状态同步失败', en: 'Could not sync vote status' },
  'detail.syncFailedWithMessage': { 'zh-CN': '同步失败：{message}', en: 'Sync failed: {message}' },
  'detail.startFailedWithMessage': { 'zh-CN': '启动失败：{message}', en: 'Could not start: {message}' },
  'detail.voteFailedWithMessage': { 'zh-CN': '投票失败：{message}', en: 'Vote failed: {message}' },
  'detail.voteFailed': { 'zh-CN': '投票失败', en: 'Vote failed' },
  'detail.voteSubmitting': { 'zh-CN': '正在提交{side}票 · 能量 −1…', en: 'Submitting {side} vote · Energy −1…' },
  'detail.revalidationVoteSubmitting': { 'zh-CN': '正在提交{side}票…', en: 'Submitting {side} vote…' },
  'detail.creatorCannotVote': { 'zh-CN': '你是该知识的提交者，不能参与本轮投票 · {tally}', en: 'You submitted this knowledge, so you cannot vote in this round · {tally}' },
  'detail.voted': { 'zh-CN': '已投{side}', en: 'Voted {side}' },
  'detail.stage': { 'zh-CN': '第 {stage} 阶段', en: 'Stage {stage}' },
  'detail.accuracyGate': { 'zh-CN': '准确率≥{percent}%', en: 'Accuracy ≥{percent}%' },
  'detail.correct': { 'zh-CN': '已判定正确', en: 'Judged correct' },
  'detail.incorrect': { 'zh-CN': '已判定错误', en: 'Judged incorrect' },
  'detail.cascadePassed': { 'zh-CN': '级联重审通过', en: 'Cascade review passed' },
  'detail.cascadeSuspended': { 'zh-CN': '级联重审未通过，知识已悬置', en: 'Cascade review failed; knowledge is suspended' },
  'detail.cascadeNoInitiator': { 'zh-CN': '无发起人、无发起人票', en: 'No initiator and no initiator vote' },
} as const satisfies Record<string, UiCopyPair>;

export type SupplementalSystemUiTextKey = keyof typeof SUPPLEMENTAL_SYSTEM_UI_TEXT;
export type SystemUiTextKey = SystemTextKey | SupplementalSystemUiTextKey;
export type UserKnowledgeLayerKey = 'inner' | 'middle' | 'outer';

function interpolate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

export function systemUiText(
  key: SystemUiTextKey,
  values: Record<string, string | number> = {},
): string {
  const locale = getLocale();
  const pair = key in SYSTEM_TEXT_CATALOG
    ? SYSTEM_TEXT_CATALOG[key as SystemTextKey]
    : SUPPLEMENTAL_SYSTEM_UI_TEXT[key as SupplementalSystemUiTextKey];
  return interpolate(pair[locale], values);
}

const LAYER_LABEL_KEYS = {
  inner: 'taxonomy.inner',
  middle: 'taxonomy.middle',
  outer: 'taxonomy.outer',
} as const;

export function knowledgeLayerLabel(layer: UserKnowledgeLayerKey): string {
  return t(LAYER_LABEL_KEYS[layer]);
}

export function knowledgeLayerHelp(layer: UserKnowledgeLayerKey): string {
  return systemUiText(`layer.help.${layer}` as SupplementalSystemUiTextKey);
}

export function voteSideText(side: 'AGREE' | 'DISAGREE'): string {
  return systemUiText(side === 'AGREE' ? 'common.agree' : 'common.disagree');
}

export function voteTallyText(
  agreeCount: number,
  disagreeCount: number,
  requiredVotes: number,
): string {
  return `${voteSideText('AGREE')} ${agreeCount}/${requiredVotes} · ${voteSideText('DISAGREE')} ${disagreeCount}/${requiredVotes}`;
}
