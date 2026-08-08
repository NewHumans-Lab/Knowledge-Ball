import type { KnowledgeRepository } from './KnowledgeRepository';
import type { KnowledgeNodeDraft, KnowledgeNodeRecord } from './KnowledgeNode';

export interface GitHubKnowledgeGatewayOptions {
  endpoint: string;
  namespace?: string;
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
      throw new Error(`Knowledge gateway request failed: ${response.status} ${response.statusText}${text ? ` — ${text}` : ''}`);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  async saveNode(node: KnowledgeNodeRecord): Promise<void> {
    await this.request<void>('/nodes', {
      method: 'POST',
      body: JSON.stringify({
        namespace: this.namespace,
        node,
      }),
    });
  }

  async saveDraft(draft: KnowledgeNodeDraft): Promise<void> {
    await this.request<void>('/drafts', {
      method: 'POST',
      body: JSON.stringify({
        namespace: this.namespace,
        draft,
      }),
    });
  }

  async listNodes(domain?: string): Promise<KnowledgeNodeRecord[]> {
    const q = domain ? `?namespace=${encodeURIComponent(this.namespace)}&domain=${encodeURIComponent(domain)}` : `?namespace=${encodeURIComponent(this.namespace)}`;
    return this.request<KnowledgeNodeRecord[]>(`/nodes${q}`);
  }

  async getNode(id: string): Promise<KnowledgeNodeRecord | null> {
    try {
      return await this.request<KnowledgeNodeRecord>(`/nodes/${encodeURIComponent(id)}?namespace=${encodeURIComponent(this.namespace)}`);
    } catch {
      return null;
    }
  }

  async deleteNode(id: string): Promise<void> {
    await this.request<void>(`/nodes/${encodeURIComponent(id)}?namespace=${encodeURIComponent(this.namespace)}`, {
      method: 'DELETE',
    });
  }
}
