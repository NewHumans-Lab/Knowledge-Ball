import { CommandHandler } from '../event/Command';
import { Graph } from '../graph/Graph';

export interface CreateNodePayload {
  nodeId: string;
  title: string;
  type: string;
  layer: string;
}

export const CreateNode: CommandHandler<CreateNodePayload> = {
  commandName: 'CreateNode',
  validate(payload, state) {
    const graph = state as Graph;
    if (graph.nodes.has(payload.nodeId)) {
      throw new Error(`Node ${payload.nodeId} already exists`);
    }
    if (!payload.title?.trim()) {
      throw new Error('title required');
    }
  },
};