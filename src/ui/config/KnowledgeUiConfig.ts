import type { Mastery, NodeType } from '../../domain/KnowledgeModel';
export type KnowledgeNodeType = NodeType;
export type KnowledgeNodeStatus = 'pending' | 'verified' | 'suspended' | 'disputed' | 'falsified';
export type KnowledgeMastery = Mastery;
export type KnowledgeDomain = 'logic' | 'mathematics' | 'physics' | 'biology' | 'chemistry' | 'computer-science' | 'economics' | 'history' | 'philosophy' | 'general';

export const TWIN_META = { n6: { twinGroup: 'twinPrime', sharedTitle: '质数数量无穷' }, n15: { twinGroup: 'twinPrime', sharedTitle: '质数数量无穷' } } as const;
export const TYPE_LABEL: Record<KnowledgeNodeType, string> = { axiom:'公理', definition:'定义', fact:'事实', theorem:'定理', hypothesis:'假说', prediction:'预测', opinion:'观点', value:'价值判断', reasoning:'推理过程', 'logic-symbol':'逻辑符号' };
export const STATUS_LABEL: Record<KnowledgeNodeStatus, string> = { verified:'已验证', pending:'等待验证', suspended:'悬置', disputed:'争议中', falsified:'已证伪' };
export const MASTERY_LABEL: Record<KnowledgeMastery, string> = { none:'未接触（无光点）', touched:'接触过（荧光）', mastered:'完全掌握（强光）' };
// Relational-field palette: colour communicates epistemic role; status controls intensity.
export const TYPE_COLOR: Record<KnowledgeNodeType, number> = { axiom:0xB9C8C2, definition:0x9EB8AE, fact:0xB8E3D2, theorem:0xC7AC68, hypothesis:0x9384B5, prediction:0xB8E3D2, opinion:0x9384B5, value:0xC7AC68, reasoning:0x9384B5, 'logic-symbol':0x9EB8AE };
export const TYPE_COLOR_HEX: Record<KnowledgeNodeType, string> = { axiom:'#B9C8C2', definition:'#9EB8AE', fact:'#B8E3D2', theorem:'#C7AC68', hypothesis:'#9384B5', prediction:'#B8E3D2', opinion:'#9384B5', value:'#C7AC68', reasoning:'#9384B5', 'logic-symbol':'#9EB8AE' };
export const STATUS_COLOR_HEX: Record<KnowledgeNodeStatus, string> = { verified:'#B8E3D2', pending:'#9384B5', suspended:'#667D78', disputed:'#D28170', falsified:'#D28170' };
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
