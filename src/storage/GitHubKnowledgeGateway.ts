import type { KnowledgeRepository } from './KnowledgeRepository';
import type { KnowledgeNodeDraft, KnowledgeNodeRecord } from './KnowledgeNode';

export interface GitHubKnowledgeGatewayOptions {
  endpoint: string;
  namespace?: string;
}

export class KnowledgeGatewayError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly responseBody: string,
  ) {
    super(`Knowledge gateway request failed: ${status} ${statusText}${responseBody ? ` — ${responseBody}` : ''}`);
    this.name = 'KnowledgeGatewayError';
  }
}

export class GitHubKnowledgeGateway implements KnowledgeRepository {
  private endpoint: string;
  private namespace: string;

  constructor(options: GitHubKnowledgeGatewayOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.namespace = options.namespace ?? 'default';
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new KnowledgeGatewayError(response.status, response.statusText, text);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  async saveNode(node: KnowledgeNodeRecord): Promise<void> {
    await this.saveNodes([node]);
  }

  async saveNodes(nodes: KnowledgeNodeRecord[]): Promise<void> {
    const publicNodes = nodes.map(record => {
      const { mastery: _personalMastery, ...node } = record as KnowledgeNodeRecord & { mastery?: unknown };
      return node;
    });
    await this.request<void>('/nodes', {
      method: 'POST',
      body: JSON.stringify({
        namespace: this.namespace,
        nodes: publicNodes,
      }),
    });
  }

  async saveDraft(draft: KnowledgeNodeDraft): Promise<void> {
    void draft;
    throw new Error('Drafts are personal local state and cannot be uploaded to the public knowledge gateway');
  }

  async listNodes(domain?: string): Promise<KnowledgeNodeRecord[]> {
    const q = domain ? `?namespace=${encodeURIComponent(this.namespace)}&domain=${encodeURIComponent(domain)}` : `?namespace=${encodeURIComponent(this.namespace)}`;
    return this.request<KnowledgeNodeRecord[]>(`/nodes${q}`);
  }

  async getNode(id: string): Promise<KnowledgeNodeRecord | null> {
    try {
      return await this.request<KnowledgeNodeRecord>(`/nodes/${encodeURIComponent(id)}?namespace=${encodeURIComponent(this.namespace)}`);
    } catch (error) {
      if (error instanceof KnowledgeGatewayError && error.status === 404) return null;
      throw error;
    }
  }

  async deleteNode(id: string): Promise<void> {
    await this.request<void>(`/nodes/${encodeURIComponent(id)}?namespace=${encodeURIComponent(this.namespace)}`, {
      method: 'DELETE',
    });
  }
}
