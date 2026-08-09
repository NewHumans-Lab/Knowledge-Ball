import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class KnowledgeStore {
  constructor(file) {
    this.file = file;
    this.writeQueue = Promise.resolve();
  }

  async read() {
    try {
      return JSON.parse(await readFile(this.file, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return { namespaces: {} };
      throw error;
    }
  }

  async list(namespace) {
    const data = await this.read();
    return Object.values(data.namespaces[namespace]?.nodes ?? {});
  }

  async save(namespace, node) {
    return this.saveBatch(namespace, [node]);
  }

  async saveBatch(namespace, nodes) {
    return this.enqueue(async () => {
      const data = await this.read();
      const space = data.namespaces[namespace] ??= { nodes: {}, drafts: [] };
      for (const node of nodes) space.nodes[node.id] = node;
      await this.write(data);
    });
  }

  async saveDraft(namespace, draft) {
    return this.enqueue(async () => {
      const data = await this.read();
      const space = data.namespaces[namespace] ??= { nodes: {}, drafts: [] };
      (space.drafts ??= []).push(draft);
      await this.write(data);
    });
  }

  async get(namespace, id) {
    const data = await this.read();
    return data.namespaces[namespace]?.nodes?.[id] ?? null;
  }

  async delete(namespace, id) {
    return this.enqueue(async () => {
      const data = await this.read();
      if (data.namespaces[namespace]?.nodes) delete data.namespaces[namespace].nodes[id];
      await this.write(data);
    });
  }

  enqueue(operation) {
    const pending = this.writeQueue.catch(() => undefined).then(operation);
    this.writeQueue = pending;
    return pending;
  }

  async write(data) {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(data, null, 2));
    await rename(temporary, this.file);
  }
}
