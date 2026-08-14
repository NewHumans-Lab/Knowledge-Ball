import { compactEnergy, createProductionAuthClient, type AccountProfile } from '../auth/AuthClient';
import { safeAvatarUrl } from '../auth/AuthProfilePresentation';
import { setMastery } from '../command/SetMastery';

interface DebugState { store?: Parameters<typeof setMastery>[0]; projection?: { state?: { nodesById?: Record<string, { id:string; title:string; mastery?:string }> } }; }
declare global { interface Window { __debug?: DebugState; } }

const account = createProductionAuthClient();
let cached: AccountProfile | null = null;
let markingNode = false;

function start(): void {
  installStyles();
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.avatar-btn') : null;
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation(); openAccount();
  }, true);
  const panel = document.getElementById('panel');
  if (panel) new MutationObserver(() => void markViewedNode()).observe(panel, { subtree:true, childList:true, attributes:true });
  updateAvatar();
  if (account) void account.publicSession().then(() => loadAccount()).catch(() => undefined);
}

async function markViewedNode(): Promise<void> {
  const panel = document.getElementById('panel');
  if (!panel?.classList.contains('open')) return;
  panel.querySelector<HTMLElement>('.mastery-demo-controls')?.remove();
  const privacy = panel.querySelector<HTMLElement>('.mastery-private');
  if (privacy) privacy.textContent = 'LOCAL ONLY · 查看即自动点亮，只保存在当前设备';
  const title = document.getElementById('panelTitle')?.textContent?.trim();
  const debug = window.__debug; const nodes = debug?.projection?.state?.nodesById;
  if (!title || !nodes || !debug?.store || markingNode) return;
  const node = Object.values(nodes).find(candidate => candidate.title === title);
  if (!node || node.mastery !== 'none') return;
  markingNode = true;
  try { await setMastery(debug.store, { nodeId:node.id, mastery:'touched' }); } finally { markingNode = false; }
}

function openAccount(shouldLoad = true): void {
  const overlay = document.getElementById('accountOverlay'); const body = overlay?.querySelector<HTMLElement>('.modal-body');
  if (!overlay || !body) return;
  body.innerHTML = `
    <div class="kb-profile-head"><div class="kb-profile-avatar" id="kbProfileAvatar"></div><div><strong id="kbProfileName"></strong><small id="kbProfileUsername"></small></div></div>
    <div class="kb-profile-bio" id="kbProfileBio"></div>
    <div class="account-stat"><span>我的能量</span><b id="kbMyBalance">${cached ? compactEnergy(cached.myBalance) : '—'}</b></div>
    <div class="account-stat"><span>总能量</span><b id="kbTotalEnergy">${cached ? compactEnergy(cached.totalEnergy) : '—'}</b></div>
    <div class="account-stat"><span>准确率</span><b>${cached?.accuracy ?? 0}%</b></div>
    <button class="btn primary kb-account-main-action" id="kbEditProfile" type="button">编辑资料</button>
    <div class="form-hint kb-auth-status" id="kbAccountStatus"></div>`;
  renderProfile(body, cached);
  body.querySelector('#kbEditProfile')?.addEventListener('click', () => editProfile(body));
  overlay.classList.add('show');
  if (account && shouldLoad) void loadAccount(body);
}

async function loadAccount(body?: HTMLElement): Promise<void> {
  if (!account) return;
  try { cached = await account.getAccount(); updateAvatar(); if (body) openAccount(false); }
  catch (error) { const status=body?.querySelector<HTMLElement>('#kbAccountStatus'); if(status) status.textContent=error instanceof Error?error.message:'账户读取失败'; }
}

function editProfile(body: HTMLElement): void {
  if (!account) return;
  const username=prompt('用户名（3-24 位小写字母、数字或下划线）',cached?.username??''); if(username===null)return;
  const displayName=prompt('显示名称',cached?.displayName??'')??''; const avatarUrl=prompt('头像 HTTPS 地址（可选）',cached?.avatarUrl??'')??''; const bio=prompt('个人简介（最多 280 字）',cached?.bio??'')??'';
  void account.updateProfile({username,displayName,avatarUrl,bio}).then(profile=>{cached=profile;openAccount(false);}).catch(error=>{const status=body.querySelector<HTMLElement>('#kbAccountStatus');if(status)status.textContent=error instanceof Error?error.message:'资料保存失败';});
}

function renderProfile(body:HTMLElement, profile:AccountProfile|null):void {
  const avatar=body.querySelector<HTMLElement>('#kbProfileAvatar');
  if(avatar){avatar.replaceChildren();const src=safeAvatarUrl(profile?.avatarUrl);if(src){const image=document.createElement('img');image.src=src;image.alt='';image.referrerPolicy='no-referrer';image.addEventListener('error',()=>{image.remove();avatar.textContent=initial(profile);},{once:true});avatar.append(image);}else avatar.textContent=initial(profile);}
  const set=(selector:string,value:string)=>{const element=body.querySelector<HTMLElement>(selector);if(element)element.textContent=value;};
  set('#kbProfileName',name(profile));set('#kbProfileUsername',`@${profile?.username??'设置用户名'}`);
  set('#kbProfileBio',profile?.bio??'匿名参与者也可以编辑知识、投票并设置公开资料。');
  set('#kbAccountStatus',account?'正在自动同步账户数据…':'远程服务未配置，本地知识功能仍可使用。');
}
function updateAvatar(): void { const avatar=document.querySelector<HTMLElement>('.avatar-btn');if(!avatar)return;avatar.replaceChildren();const src=safeAvatarUrl(cached?.avatarUrl);if(src){const image=document.createElement('img');image.src=src;image.alt='';image.referrerPolicy='no-referrer';image.addEventListener('error',()=>{image.remove();avatar.textContent=initial(cached);},{once:true});avatar.append(image);}else avatar.textContent=initial(cached);avatar.title='个人空间 · 匿名参与';avatar.dataset.authState='anonymous'; }
function name(profile:AccountProfile|null):string{return profile?.displayName||profile?.username||'匿名探索者';}
function initial(profile:AccountProfile|null):string{return name(profile).slice(0,1).toUpperCase();}
function installStyles():void{const style=document.createElement('style');style.textContent=`.kb-profile-head{display:flex;align-items:center;gap:12px;margin-bottom:10px}.kb-profile-head small{display:block;color:var(--ink-faint);margin-top:3px}.kb-profile-avatar{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;overflow:hidden;background:var(--bg-deep);border:1px solid var(--brass-dim);color:var(--brass);font-weight:700}.kb-profile-avatar img,.avatar-btn img{width:100%;height:100%;object-fit:cover}.kb-profile-bio{font-size:12px;color:var(--ink-dim);line-height:1.6;margin-bottom:12px}.kb-account-main-action{width:100%;margin-top:10px}`;document.head.appendChild(style);}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
