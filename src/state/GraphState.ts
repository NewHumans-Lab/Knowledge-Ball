import { Graph } from '../graph/Graph';

// 快照结构。纯 event-sourcing 的教条是"只信任事件"，
// 但工程现实是必须能从某个 seq 点恢复，否则冷启动 replay 100k 事件会卡死
export interface GraphSnapshot {
  atSeq: number;
  graph: {
    nodes: ReturnType<Graph['nodes']['entries']> extends never ? never : unknown;
  };
}

export function serializeSnapshot(graph: Graph, atSeq: number) {
  return {
    atSeq,
    nodes: Array.from(graph.nodes.values()),
    edges: Array.from(graph.edges.values()),
  };
}

export function restoreFromSnapshot(snapshot: ReturnType<typeof serializeSnapshot>): Graph {
  const g = new Graph();
  for (const n of snapshot.nodes) g.addNode(n);
  for (const e of snapshot.edges) g.addEdge(e);
  return g;
}