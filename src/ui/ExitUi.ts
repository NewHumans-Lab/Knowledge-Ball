const EXIT_ICON = '❌';

interface ExitSpec {
  id: string;
  label: string;
}

const EXIT_CONTROLS: ExitSpec[] = [
  { id: 'panelClose', label: '返回知识球' },
  { id: 'modalClose', label: '返回上一层' },
  { id: 'accountClose', label: '返回知识球' },
  { id: 'settingsClose', label: '返回知识球' },
];

function configureExitButton(spec: ExitSpec): void {
  const button = document.getElementById(spec.id);
  if (!(button instanceof HTMLButtonElement)) return;
  button.type = 'button';
  button.textContent = EXIT_ICON;
  button.classList.add('kb-exit-control');
  button.setAttribute('aria-label', spec.label);
  button.setAttribute('title', spec.label);
}

function panelReturnControl(): HTMLButtonElement | null {
  const actions = document.getElementById('panelActions');
  if (!actions) return null;
  return actions.querySelector<HTMLButtonElement>('#cancelEdit, #cancelOperation, #cancelLineageCandidate');
}

function updatePanelExitLabel(): void {
  const button = document.getElementById('panelClose');
  if (!(button instanceof HTMLButtonElement)) return;
  const label = panelReturnControl() ? '返回节点详情' : '返回知识球';
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
}

function handlePanelExit(event: MouseEvent): void {
  const back = panelReturnControl();
  if (!back) return;

  // Edit / lineage candidate / negate / decompose / merge are subviews of one
  // knowledge node. Their cancel action already knows how to rebuild the
  // correct node detail. Reuse that path rather than teaching the exit control
  // protocol/domain logic.
  event.preventDefault();
  event.stopImmediatePropagation();
  back.click();
}

function installStyles(): void {
  const style = document.createElement('style');
  style.dataset.kbExitUi = 'true';
  style.textContent = `
    .kb-exit-control{
      min-width:44px!important;
      width:44px!important;
      min-height:44px!important;
      height:44px!important;
      padding:0!important;
      display:grid!important;
      place-items:center!important;
      flex:0 0 44px!important;
      border:1px solid rgba(123,199,199,.28)!important;
      border-radius:50%!important;
      background:rgba(5,18,23,.94)!important;
      color:#e7f0f1!important;
      font-size:18px!important;
      line-height:1!important;
      opacity:1!important;
      visibility:visible!important;
      cursor:pointer!important;
      z-index:2;
    }
    .kb-exit-control:focus-visible{
      outline:2px solid #75e0d3;
      outline-offset:2px;
    }
    @media (max-width:780px){
      /* The previous fixed panel started at viewport top while the app header had
         a higher z-index. That put the panel header (and its close button) behind
         the visible app header. Keep the full-screen detail inside .main instead. */
      #panel{
        position:absolute!important;
        inset:0!important;
        width:100%!important;
        border-radius:0!important;
        box-shadow:none!important;
      }
      .panel-header,.modal-header{
        padding-right:max(12px,env(safe-area-inset-right));
      }
      .kb-exit-control{
        min-width:44px!important;
        min-height:44px!important;
      }
    }
  `;
  document.head.appendChild(style);
}

function install(): void {
  installStyles();
  EXIT_CONTROLS.forEach(configureExitButton);

  const panelClose = document.getElementById('panelClose');
  panelClose?.addEventListener('click', handlePanelExit, true);

  const panelActions = document.getElementById('panelActions');
  if (panelActions) {
    new MutationObserver(updatePanelExitLabel).observe(panelActions, { childList: true, subtree: true });
  }
  updatePanelExitLabel();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
