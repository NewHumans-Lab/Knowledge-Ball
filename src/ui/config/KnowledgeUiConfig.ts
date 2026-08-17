import type { Mastery, NodeType } from '../../domain/KnowledgeModel';
export type KnowledgeNodeType = NodeType;
export type KnowledgeNodeStatus = 'pending' | 'verified' | 'suspended' | 'disputed' | 'falsified';
export type KnowledgeMastery = Mastery;
export type KnowledgeDomain = 'logic' | 'mathematics' | 'physics' | 'biology' | 'chemistry' | 'computer-science' | 'economics' | 'history' | 'philosophy' | 'general';

export const TWIN_META = { n6: { twinGroup: 'twinPrime', sharedTitle: '质数数量无穷' }, n15: { twinGroup: 'twinPrime', sharedTitle: '质数数量无穷' } } as const;
export const TYPE_LABEL: Record<KnowledgeNodeType, string> = { axiom:'公理', definition:'定义', fact:'事实', theorem:'定理', hypothesis:'假说', prediction:'预测', opinion:'观点', value:'价值判断', reasoning:'推理过程', 'logic-symbol':'逻辑符号' };
export const STATUS_LABEL: Record<KnowledgeNodeStatus, string> = { verified:'已验证', pending:'等待验证', suspended:'悬置', disputed:'争议中', falsified:'已证伪' };
export const MASTERY_LABEL: Record<KnowledgeMastery, string> = { none:'未接触（无光点）', touched:'接触过（荧光）', mastered:'完全掌握（强光）' };

// Canonical node-color semantics. Database/domain fields remain the source of truth;
// the renderer maps those fields to this small visual vocabulary.
export const NODE_LAYER_COLOR = { inner:0x55ECFF, middle:0x16D9FF, outer:0x7C6CFF, core:0xFFFFFF } as const;
export const NODE_SPECIAL_COLOR = { structural:0xF7FBFF, falsified:0xEE675B } as const;
export const NODE_LAYER_COLOR_HEX = { inner:'#55ECFF', middle:'#16D9FF', outer:'#7C6CFF', core:'#FFFFFF' } as const;
export const NODE_SPECIAL_COLOR_HEX = { structural:'#F7FBFF', falsified:'#EE675B' } as const;

// Type colors are retained as a semantic fallback for non-scene UI. The live 3D scene
// additionally applies status/layer priority in KnowledgeScene.colorForNode().
export const TYPE_COLOR: Record<KnowledgeNodeType, number> = {
  axiom:NODE_LAYER_COLOR.inner,
  definition:NODE_LAYER_COLOR.inner,
  fact:NODE_LAYER_COLOR.middle,
  theorem:NODE_LAYER_COLOR.middle,
  hypothesis:NODE_LAYER_COLOR.outer,
  prediction:NODE_LAYER_COLOR.outer,
  opinion:NODE_LAYER_COLOR.outer,
  value:NODE_LAYER_COLOR.outer,
  reasoning:NODE_SPECIAL_COLOR.structural,
  'logic-symbol':NODE_SPECIAL_COLOR.structural,
};
export const TYPE_COLOR_HEX: Record<KnowledgeNodeType, string> = {
  axiom:NODE_LAYER_COLOR_HEX.inner,
  definition:NODE_LAYER_COLOR_HEX.inner,
  fact:NODE_LAYER_COLOR_HEX.middle,
  theorem:NODE_LAYER_COLOR_HEX.middle,
  hypothesis:NODE_LAYER_COLOR_HEX.outer,
  prediction:NODE_LAYER_COLOR_HEX.outer,
  opinion:NODE_LAYER_COLOR_HEX.outer,
  value:NODE_LAYER_COLOR_HEX.outer,
  reasoning:NODE_SPECIAL_COLOR_HEX.structural,
  'logic-symbol':NODE_SPECIAL_COLOR_HEX.structural,
};
export const KNOWLEDGE_BACKGROUND = [
  'radial-gradient(circle at 8% 13%, rgba(216,246,255,.60) 0, rgba(216,246,255,.60) 1px, transparent 1.6px)',
  'radial-gradient(circle at 18% 28%, rgba(216,246,255,.34) 0, rgba(216,246,255,.34) 1px, transparent 1.5px)',
  'radial-gradient(circle at 28% 9%, rgba(216,246,255,.46) 0, rgba(216,246,255,.46) 1px, transparent 1.5px)',
  'radial-gradient(circle at 37% 22%, rgba(216,246,255,.28) 0, rgba(216,246,255,.28) 1px, transparent 1.5px)',
  'radial-gradient(circle at 47% 7%, rgba(216,246,255,.54) 0, rgba(216,246,255,.54) 1px, transparent 1.6px)',
  'radial-gradient(circle at 57% 18%, rgba(216,246,255,.31) 0, rgba(216,246,255,.31) 1px, transparent 1.5px)',
  'radial-gradient(circle at 68% 11%, rgba(216,246,255,.52) 0, rgba(216,246,255,.52) 1px, transparent 1.6px)',
  'radial-gradient(circle at 79% 24%, rgba(216,246,255,.30) 0, rgba(216,246,255,.30) 1px, transparent 1.5px)',
  'radial-gradient(circle at 91% 10%, rgba(216,246,255,.48) 0, rgba(216,246,255,.48) 1px, transparent 1.6px)',
  'radial-gradient(circle at 12% 46%, rgba(216,246,255,.32) 0, rgba(216,246,255,.32) 1px, transparent 1.5px)',
  'radial-gradient(circle at 23% 61%, rgba(216,246,255,.50) 0, rgba(216,246,255,.50) 1px, transparent 1.6px)',
  'radial-gradient(circle at 34% 43%, rgba(216,246,255,.27) 0, rgba(216,246,255,.27) 1px, transparent 1.5px)',
  'radial-gradient(circle at 45% 68%, rgba(216,246,255,.42) 0, rgba(216,246,255,.42) 1px, transparent 1.6px)',
  'radial-gradient(circle at 58% 54%, rgba(216,246,255,.25) 0, rgba(216,246,255,.25) 1px, transparent 1.5px)',
  'radial-gradient(circle at 71% 67%, rgba(216,246,255,.47) 0, rgba(216,246,255,.47) 1px, transparent 1.6px)',
  'radial-gradient(circle at 83% 48%, rgba(216,246,255,.29) 0, rgba(216,246,255,.29) 1px, transparent 1.5px)',
  'radial-gradient(circle at 94% 63%, rgba(216,246,255,.43) 0, rgba(216,246,255,.43) 1px, transparent 1.6px)',
  'radial-gradient(circle at 7% 82%, rgba(216,246,255,.44) 0, rgba(216,246,255,.44) 1px, transparent 1.6px)',
  'radial-gradient(circle at 19% 92%, rgba(216,246,255,.28) 0, rgba(216,246,255,.28) 1px, transparent 1.5px)',
  'radial-gradient(circle at 32% 79%, rgba(216,246,255,.52) 0, rgba(216,246,255,.52) 1px, transparent 1.6px)',
  'radial-gradient(circle at 51% 91%, rgba(216,246,255,.30) 0, rgba(216,246,255,.30) 1px, transparent 1.5px)',
  'radial-gradient(circle at 65% 83%, rgba(216,246,255,.46) 0, rgba(216,246,255,.46) 1px, transparent 1.6px)',
  'radial-gradient(circle at 78% 94%, rgba(216,246,255,.26) 0, rgba(216,246,255,.26) 1px, transparent 1.5px)',
  'radial-gradient(circle at 91% 81%, rgba(216,246,255,.50) 0, rgba(216,246,255,.50) 1px, transparent 1.6px)',
  'radial-gradient(circle at 44% 48%, rgba(85,236,255,.035) 0%, transparent 44%)',
  'radial-gradient(circle at 61% 45%, rgba(124,108,255,.045) 0%, transparent 50%)',
  'radial-gradient(circle at 50% 46%, rgba(7,11,34,.98) 0%, rgba(3,5,18,1) 38%, #010208 76%, #000 100%)',
].join(',');

// Visual-only theme application. Geometry, edge styling, layout, interaction and protocol settings remain untouched.
if (typeof document !== 'undefined') {
  const rootStyle = document.documentElement.style;
  Object.entries(TYPE_COLOR_HEX).forEach(([type, color]) => rootStyle.setProperty(`--c-${type}`, color));
  Object.entries(NODE_LAYER_COLOR_HEX).forEach(([layer, color]) => rootStyle.setProperty(`--node-${layer}`, color));
  rootStyle.setProperty('--node-structural', NODE_SPECIAL_COLOR_HEX.structural);
  rootStyle.setProperty('--node-falsified', NODE_SPECIAL_COLOR_HEX.falsified);
  document.documentElement.style.background = '#000';
  document.body?.style.setProperty('background', '#000');
  document.querySelector<HTMLElement>('.app')?.style.setProperty('background', KNOWLEDGE_BACKGROUND);
}

export const STATUS_COLOR_HEX: Record<KnowledgeNodeStatus, string> = { verified:'#75E0D3', pending:'#A98AE8', suspended:'#547277', disputed:'#EE7A68', falsified:NODE_SPECIAL_COLOR_HEX.falsified };
export const LAYER_BANDS = { inner:{rMin:0,rMax:95}, middle:{rMin:95,rMax:170}, outer:{rMin:170,rMax:260}, core:{rMin:0,rMax:16} } as const;
export const LAYER_LABEL = { inner:'内层空间 · 基础', middle:'中层空间 · 高置信度', outer:'外层空间 · 待定/推测', core:'核心 · 三体系统' } as const;
export const TWIN_REST_LEN = 14;
export const VIEW_ORDER = ['outer','middle','inner','core'] as const;
export const VIEW_PRESET_Z: Record<(typeof VIEW_ORDER)[number], number> = { outer:640, middle:420, inner:230, core:64 };
export const DEFAULT_CAM_Z = 640;
export const MIN_GRAPH_ZOOM = 0.5;
export const MAX_GRAPH_ZOOM = 16;
export const CORE_LABEL_REVEAL_ZOOM = 10;
export const PENDING_PULSE_PERIOD_MS = 1000;
export const PENDING_PULSE_VISIBLE_MS = 650;
export const PENDING_PULSE_FADE_MS = 120;
export const PENDING_PULSE_LOW_MS = 100;
export const PENDING_PULSE_RISE_MS = 130;
export const PENDING_PULSE_MIN_OPACITY = 0.15;
export const PENDING_PULSE_MIN_SCALE = 0.95;
export const SUN_TRIAD_IDS = ['n1','n2','n16'] as const;
export const SUN_RADIUS_MM = 0.6;
export const SUN_GLOW_SCALE = 12;
export const SUN_ORBIT_RADIUS = 3.2;
export const SUN_ANGULAR_SPEED = 0.6;
// The enclosing visual Sun is deliberately 2x the default ordinary-node radius (9 -> 18).
// Its corona is much larger than the physical sphere so the central radiation remains visible at whole-graph scale.
export const CORE_SUN_RADIUS = 18;
export const CORE_SUN_GLOW_SCALE = 6;
export const CORE_SUN_COLOR = 0xFFFFFF;
export const CORE_SUN_LIGHT_INTENSITY = 24;
// distance=0 is required by Three.js for pure inverse-square attenuation without an artificial cutoff.
export const CORE_SUN_LIGHT_DISTANCE = 0;
export const CORE_SUN_LIGHT_DECAY = 2;
// Shadow reach is independent from PointLight.distance and covers the outer layer at maximum graph zoom.
export const CORE_SUN_SHADOW_FAR = LAYER_BANDS.outer.rMax * MAX_GRAPH_ZOOM * 1.1;
// No uniform ambient contribution: apparent solar illumination is determined by distance and occlusion.
export const CORE_AMBIENT_LIGHT_INTENSITY = 0;
/** Legacy compatibility only. Camera distance no longer drives zoom. */
export const SUN_REVEAL_CAM_Z = DEFAULT_CAM_Z / CORE_LABEL_REVEAL_ZOOM;
export function isKnowledgeDomain(value: string): value is KnowledgeDomain { return ['logic','mathematics','physics','biology','chemistry','computer-science','economics','history','philosophy','general'].includes(value); }
