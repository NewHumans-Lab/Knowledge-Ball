export type KnowledgeNodeType = 'axiom' | 'definition' | 'fact' | 'theorem' | 'hypothesis' | 'prediction' | 'opinion' | 'value';
export type KnowledgeNodeStatus = 'pending' | 'verified' | 'suspended' | 'disputed' | 'falsified';
export type KnowledgeMastery = 'none' | 'touched' | 'mastered';
export type KnowledgeDomain = 'logic' | 'mathematics' | 'physics' | 'biology' | 'chemistry' | 'computer-science' | 'economics' | 'history' | 'philosophy' | 'general';

export const TWIN_META = { n6: { twinGroup: 'twinPrime', sharedTitle: '质数数量无穷' }, n15: { twinGroup: 'twinPrime', sharedTitle: '质数数量无穷' } } as const;
export const TYPE_LABEL: Record<KnowledgeNodeType, string> = { axiom:'公理', definition:'定义', fact:'事实', theorem:'定理', hypothesis:'假说', prediction:'预测', opinion:'观点', value:'价值判断' };
export const STATUS_LABEL: Record<KnowledgeNodeStatus, string> = { verified:'已验证', pending:'等待验证', suspended:'悬置', disputed:'争议中', falsified:'已证伪' };
export const MASTERY_LABEL: Record<KnowledgeMastery, string> = { none:'未接触（无光点）', touched:'接触过（荧光）', mastered:'完全掌握（强光）' };
export const TYPE_COLOR: Record<KnowledgeNodeType, number> = { axiom:0xE8E4D9, definition:0x7C93C9, fact:0x5BA88B, theorem:0xC9A227, hypothesis:0x9B7EDE, prediction:0x5FD1C9, opinion:0xE8825B, value:0xD8748A };
export const TYPE_COLOR_HEX: Record<KnowledgeNodeType, string> = { axiom:'#E8E4D9', definition:'#7C93C9', fact:'#5BA88B', theorem:'#C9A227', hypothesis:'#9B7EDE', prediction:'#5FD1C9', opinion:'#E8825B', value:'#D8748A' };
export const STATUS_COLOR_HEX: Record<KnowledgeNodeStatus, string> = { verified:'#5BA88B', pending:'#7C93C9', suspended:'#6B7290', disputed:'#E0A030', falsified:'#C85450' };
export const LAYER_BANDS = { inner:{rMin:0,rMax:95}, middle:{rMin:95,rMax:170}, outer:{rMin:170,rMax:260}, core:{rMin:0,rMax:16} } as const;
export const LAYER_LABEL = { inner:'内层空间 · 基础', middle:'中层空间 · 高置信度', outer:'外层空间 · 待定/推测', core:'核心 · 三体系统' } as const;
export const TWIN_REST_LEN = 14;
export const VIEW_ORDER = ['outer','middle','inner','core'] as const;
export const VIEW_PRESET_Z: Record<(typeof VIEW_ORDER)[number], number> = { outer:640, middle:420, inner:230, core:64 };
export const DEFAULT_CAM_Z = 640;
export const MIN_GRAPH_ZOOM = 0.5;
export const MAX_GRAPH_ZOOM = 16;
export const CORE_LABEL_REVEAL_ZOOM = 10;
export const SUN_TRIAD_IDS = ['n1','n2','n16'] as const;
export const SUN_RADIUS_MM = 0.6;
export const SUN_GLOW_SCALE = 12;
export const SUN_ORBIT_RADIUS = 3.2;
export const SUN_ANGULAR_SPEED = 0.6;
// The enclosing visual Sun is deliberately 2x the default ordinary-node radius (9 -> 18).
// Its corona is much larger than the physical sphere so the central radiation remains visible at whole-graph scale.
export const CORE_SUN_RADIUS = 18;
export const CORE_SUN_GLOW_SCALE = 6;
export const CORE_SUN_LIGHT_INTENSITY = 24;
export const CORE_SUN_LIGHT_DISTANCE = LAYER_BANDS.outer.rMax * 1.8;
export const CORE_AMBIENT_LIGHT_INTENSITY = 0.24;
/** Legacy compatibility only. Camera distance no longer drives zoom. */
export const SUN_REVEAL_CAM_Z = DEFAULT_CAM_Z / CORE_LABEL_REVEAL_ZOOM;
export function isKnowledgeDomain(value: string): value is KnowledgeDomain { return ['logic','mathematics','physics','biology','chemistry','computer-science','economics','history','philosophy','general'].includes(value); }
