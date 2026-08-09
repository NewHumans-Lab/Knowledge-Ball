import type { PublicKnowledgeNode, PersonalKnowledgeState } from './KnowledgeModel';

export interface LegacyKnowledgeNode {
  id:string; title:string; type:PublicKnowledgeNode['type']; reasoning:string; status:'pending'|'verified'|'disputed'|'falsified'|'suspended';
  mastery?:PersonalKnowledgeState['mastery']; hidden?:boolean; supersededBy?:string; tags?:string[]; version?:number; createdAt?:string; updatedAt?:string;
}
export interface MigratedKnowledge { schemaVersion:2; publicNodes:PublicKnowledgeNode[]; personalStates:PersonalKnowledgeState[]; }

export function migrateKnowledgeV1(records: LegacyKnowledgeNode[]): MigratedKnowledge {
  const publicNodes = records.map(record => {
    const timestamp = record.updatedAt ?? record.createdAt ?? new Date(0).toISOString();
    const epistemicStatus = record.status === 'suspended' ? 'pending' : record.status;
    return {
      id:record.id, title:record.title, type:record.type, description:record.reasoning,
      epistemicStatus, availability:record.status === 'suspended' ? 'suspended' : 'active',
      lifecycle:record.supersededBy ? 'superseded' : 'current', tags:[...(record.tags ?? [])], version:record.version ?? 1,
      createdAt:record.createdAt ?? timestamp, updatedAt:timestamp,
    } satisfies PublicKnowledgeNode;
  });
  const personalStates = records.filter(record => record.mastery && record.mastery !== 'none').map(record => ({
    nodeId:record.id, mastery:record.mastery!, updatedAt:record.updatedAt ?? record.createdAt ?? new Date(0).toISOString(), version:1,
  }));
  return { schemaVersion:2, publicNodes, personalStates };
}
