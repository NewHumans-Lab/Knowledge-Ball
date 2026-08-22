import { isUserKnowledgeLayer } from '../../domain/KnowledgeLayerPolicy';
import { encodeLineageIntent, type LineageIntentKind } from '../LineageIntentBridge';
import {
  PanelController as LegacyPanelController,
  type PanelControllerCallbacks,
  type PanelControllerElements,
} from './PanelControllerLegacy';

export * from './PanelControllerLegacy';

/**
 * Thin V3 convergence adapter around the pre-lineage panel.
 * All unrelated create/decompose/merge/settings behavior remains owned by the
 * legacy controller. Only the two head-changing actions are replaced here.
 */
export class PanelController extends LegacyPanelController {
  private readonly bridge: PanelControllerCallbacks & PanelControllerElements;

  constructor(options: PanelControllerCallbacks & PanelControllerElements) {
    super(options);
    this.bridge = options;
  }

  override openNodePanel(id: string): void {
    super.openNodePanel(id);
    this.installLineageActions(id);
  }

  private installLineageActions(id: string): void {
    const replaceAction = (buttonId: string, text: string, kind: LineageIntentKind) => {
      const original = this.bridge.panelActions.querySelector<HTMLButtonElement>(`#${buttonId}`);
      if (!original) return;
      const button = original.cloneNode(true) as HTMLButtonElement;
      button.textContent = text;
      original.replaceWith(button);
      button.addEventListener('click', () => this.openLineageCandidateForm(id, kind));
    };
    replaceAction('btnEditNode', 'Optimize · 优化', 'optimization');
    replaceAction('btnNegate', 'Oppose · 提出对立观点', 'opposition');
  }

  private openLineageCandidateForm(id: string, kind: LineageIntentKind): void {
    const node = this.bridge.getNodeById(id);
    if (!node) return;
    const optimization = kind === 'optimization';
    const candidateLayer = node.declaredLayer ?? node.effectiveLayer ?? 'outer';
    const defaultLayer = isUserKnowledgeLayer(candidateLayer) ? candidateLayer : 'outer';
    const escape = (value: string) => value
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

    this.bridge.panelTitle.textContent = optimization ? `优化：${node.title}` : `对立观点：${node.title}`;
    this.bridge.panelBody.innerHTML = `
      <div class="difference-card"><b>${optimization ? 'IMMUTABLE OPTIMIZATION' : 'IMMUTABLE OPPOSITION'}</b><br>${optimization
        ? '提交会生成新的灰色闪烁候选球；最终判定前当前球保持不变。'
        : '提交会生成新的红色闪烁候选球；最终判定前当前球不会被证伪、隐藏或换边。'}</div>
      <div class="field"><label>名称</label><input type="text" id="lineageCandidateTitle" value="${optimization ? escape(node.title) : ''}" placeholder="${optimization ? '可保留当前名称，也可改为新的唯一名称' : '请输入新的唯一名称'}"></div>
      <div class="field"><label>知识层级</label><select id="lineageCandidateLayer">
        <option value="inner" ${defaultLayer === 'inner' ? 'selected' : ''}>第一层 · 语义与基础事实</option>
        <option value="middle" ${defaultLayer === 'middle' ? 'selected' : ''}>第二层 · 严谨推理</option>
        <option value="outer" ${defaultLayer === 'outer' ? 'selected' : ''}>第三层 · 概率与争议</option>
      </select></div>
      <div class="field"><label>内容</label><textarea id="lineageCandidateDescription" placeholder="填写新的完整内容">${optimization ? escape(node.reasoning || '') : ''}</textarea></div>
      <p class="note-small" style="text-align:left;">节点类型、前提关系和逻辑规则身份全部沿用当前球。这里仅允许修改名称、层级和内容。</p>
    `;
    this.bridge.panelActions.innerHTML = `
      <button class="btn ${optimization ? 'primary' : 'danger'}" id="submitLineageCandidate">${optimization ? '提交优化候选' : '提交对立候选'}</button>
      <button class="btn ghost" id="cancelLineageCandidate">取消</button>
    `;

    this.bridge.panelActions.querySelector<HTMLButtonElement>('#cancelLineageCandidate')?.addEventListener('click', () => this.openNodePanel(id));
    this.bridge.panelActions.querySelector<HTMLButtonElement>('#submitLineageCandidate')?.addEventListener('click', async () => {
      const title = this.bridge.panelBody.querySelector<HTMLInputElement>('#lineageCandidateTitle')?.value.trim() ?? '';
      const layerValue = this.bridge.panelBody.querySelector<HTMLSelectElement>('#lineageCandidateLayer')?.value ?? '';
      const description = this.bridge.panelBody.querySelector<HTMLTextAreaElement>('#lineageCandidateDescription')?.value.trim() ?? '';
      if (!title || !description || !isUserKnowledgeLayer(layerValue)) {
        this.showToast('请完整填写名称、知识层级和内容。');
        return;
      }
      const encoded = encodeLineageIntent({ kind, layer: layerValue, title, description });
      try {
        // Reuse the existing callback boundary so app.ts and every unrelated
        // controller path stay untouched. EditNode decodes this explicit V3
        // intent and emits KnowledgeAdded optimization/opposition instead.
        await this.bridge.onEditNode(id, {
          title: encoded.title,
          type: node.type,
          reasoning: encoded.reasoning,
          premises: [...node.premises],
        });
        this.showToast(optimization ? '优化候选已提交，等待验证' : '对立候选已提交，等待验证');
        this.closeNodePanel();
      } catch (error) {
        console.error('[Knowledge-Ball] lineage candidate submission failed:', error);
        this.showToast(error instanceof Error ? `提交失败：${error.message}` : '提交失败');
      }
    });
  }
}
