import {
  NodeDetailController as LegacyNodeDetailController,
  type NodeDetailControllerOptions,
} from './NodeDetailControllerLegacy';

export * from './NodeDetailControllerLegacy';

/** Only relabels the two V3 head-changing entries; legacy detail behavior stays intact. */
export class NodeDetailController extends LegacyNodeDetailController {
  constructor(options: NodeDetailControllerOptions) {
    super(options);
  }

  override open(id: string): void {
    super.open(id);
    this.relabelLineageActions();
  }

  override refresh(id?: string | null): void {
    super.refresh(id);
    this.relabelLineageActions();
  }

  private relabelLineageActions(): void {
    const root = document.getElementById('nodeDetailOverlay');
    const edit = root?.querySelector<HTMLButtonElement>('[data-node-detail-action="edit"]');
    const negate = root?.querySelector<HTMLButtonElement>('[data-node-detail-action="negate"]');
    if (edit) edit.textContent = '优化';
    if (negate) negate.textContent = '提出对立观点';
  }
}
