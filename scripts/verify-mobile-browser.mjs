import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin='http://127.0.0.1:4173/Knowledge-Ball/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1'],{stdio:'ignore'});

async function assertExit(locator,name){
  await locator.waitFor({state:'visible'});
  assert.equal((await locator.textContent())?.trim(),'❌',`${name} must use the explicit exit icon`);
  const box=await locator.boundingBox();
  assert.ok(box,`${name} must have a mobile bounding box`);
  assert.ok(box.width>=44&&box.height>=44,`${name} must expose at least a 44px touch target`);
  assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=390&&box.y+box.height<=844,`${name} must stay inside the mobile viewport`);
}

async function assertNodeDetailExit(locator,name){
  await locator.waitFor({state:'visible'});
  assert.equal((await locator.textContent())?.trim(),'×',`${name} must use the neutral X close control`);
  const box=await locator.boundingBox();
  assert.ok(box,`${name} must have a mobile bounding box`);
  assert.ok(box.width>=44&&box.height>=44,`${name} must expose at least a 44px touch target`);
  assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=390&&box.y+box.height<=844,`${name} must stay inside the mobile viewport`);
}

async function analyzeScreenshot(page,screenshot,regions=[]){
  const screenshotUrl=`data:image/png;base64,${screenshot.toString('base64')}`;
  return page.evaluate(async ({src,regions})=>{
    const image=new Image();image.src=src;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('2D screenshot analysis context unavailable');
    ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const hsv=(r,g,b)=>{const rn=r/255,gn=g/255,bn=b/255,max=Math.max(rn,gn,bn),min=Math.min(rn,gn,bn),d=max-min;let h=0;if(d){if(max===rn)h=60*(((gn-bn)/d)%6);else if(max===gn)h=60*((bn-rn)/d+2);else h=60*((rn-gn)/d+4);if(h<0)h+=360;}return{h,s:max?d/max:0,v:max};};
    const empty=()=>({trueBlue:0,violet:0,cyan:0,white:0,greenDominant:0,visible:0,cyanPeak:0,trueBluePeak:0,violetPeak:0,whitePeak:0});
    const add=(stats,r,g,b,a)=>{if(a<180)return;const {h,s,v}=hsv(r,g,b);if(v<.12)return;stats.visible++;
      if(s<=.12&&v>=.42){stats.white++;stats.whitePeak=Math.max(stats.whitePeak,v);}
      if(h>=185&&h<215&&s>=.25&&v>=.14){stats.cyan++;stats.cyanPeak=Math.max(stats.cyanPeak,v);}
      if(h>=215&&h<238&&s>=.28&&v>=.14){stats.trueBlue++;stats.trueBluePeak=Math.max(stats.trueBluePeak,v);}
      if(h>=238&&h<=285&&s>=.25&&v>=.14){stats.violet++;stats.violetPeak=Math.max(stats.violetPeak,v);}
      if(h>=80&&h<=165&&s>=.25&&v>=.14)stats.greenDominant++;
    };
    const global=empty();
    // Sample every fourth pixel for the whole-frame gate. Hue/saturation are more faithful than
    // absolute RGB thresholds after WebGL is composited over the deep-space background.
    for(let i=0;i<data.length;i+=16)add(global,data[i],data[i+1],data[i+2],data[i+3]);
    const local=regions.map(region=>{const stats=empty(),radius=Math.max(1,Math.round(region.radius??18)),cx=Math.round(region.x),cy=Math.round(region.y);for(let y=Math.max(0,cy-radius);y<=Math.min(canvas.height-1,cy+radius);y++){for(let x=Math.max(0,cx-radius);x<=Math.min(canvas.width-1,cx+radius);x++){const dx=x-cx,dy=y-cy;if(dx*dx+dy*dy>radius*radius)continue;const i=(y*canvas.width+x)*4;add(stats,data[i],data[i+1],data[i+2],data[i+3]);}}return stats;});
    return{width:canvas.width,height:canvas.height,...global,regions:local};
  },{src:screenshotUrl,regions});
}

try{
  for(let attempt=0;attempt<50;attempt++){try{if((await fetch(origin)).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  const browser=await chromium.launch({headless:true,args:['--use-gl=swiftshader']});
  console.log('mobile browser launched');
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    const page=await context.newPage(),errors=[];page.setDefaultTimeout(10_000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    console.log('mobile page loaded');
    await page.waitForFunction(()=>Boolean(window.__debug?.scene&&window.__debug?.renderNodes?.length),null,{timeout:10_000});
    const targets=await page.evaluate(()=>{
      window.__debug.scene.stop();
      return window.__debug.renderNodes
        .filter(node=>!['n1','n2','n16'].includes(node.id))
        .map(node=>{const point=window.__debug.scene.screenPositionForNode(node.id);return point?{...point,id:node.id,title:node.title}:null;})
        .filter(target=>target&&target.x>24&&target.x<366&&target.y>88&&target.y<808)
        .slice(0,8);
    });
    console.log(`mobile raycast targets: ${targets.length}`);
    assert.ok(targets.length>=4,'mobile scene must expose at least four finite on-screen raycast targets for visual calibration');
    assert.ok(targets.every(target=>Number.isFinite(target.x)&&Number.isFinite(target.y)),'mobile raycast targets must be finite');

    const canvasHost=page.locator('#canvasHost');
    const hostBox=await canvasHost.boundingBox();
    assert.ok(hostBox,'mobile canvas host must expose a finite bounding box');
    const toLocalRegions=points=>points.map(point=>({x:point.x-hostBox.x,y:point.y-hostBox.y,radius:18}));

    // Gate A: capture the actual graph exactly as current data renders on a phone viewport.
    await mkdir('artifacts',{recursive:true});
    const screenshot=await canvasHost.screenshot({path:'artifacts/mobile-scene-visual.png',type:'png'});
    assert.ok(screenshot.length>5_000,'mobile WebGL scene screenshot must contain real rendered visual data');
    const visual=await analyzeScreenshot(page,screenshot);
    console.log('mobile actual-scene visual pixels',visual);
    assert.ok(visual.visible>1_000,'mobile scene must contain enough visible non-background rendered pixels');
    assert.ok(visual.white>=100,'actual WebGL screenshot must visibly contain the white structural/core light language');
    assert.ok(visual.trueBlue>=100,'actual WebGL screenshot must visibly contain a true-blue scene signal, not only cyan/teal');
    assert.ok(visual.trueBluePeak>=.55,'actual true-blue scene signal must remain visibly bright instead of collapsing into near-black blue');
    assert.ok(visual.greenDominant<=5,'old green/teal contamination must not reappear in the actual scene screenshot');

    // Gate B: calibrate semantic colors around four real on-screen nodes. The local peak checks are
    // deliberate: hue alone is insufficient because a correctly-hued node can still be visually too dark.
    // Layer color is now controlled by effectiveLayer, not by NodeType, so the calibration must exercise
    // the same canonical layer input consumed by the production scene.
    const calibrationIds=targets.slice(0,4).map(target=>target.id);
    const originals=await page.evaluate(ids=>{
      const original=[];
      ids.forEach(id=>{const node=window.__debug.renderNodes.find(candidate=>candidate.id===id);if(!node)return;original.push({id,type:node.type,status:node.status,mastery:node.mastery,effectiveLayer:node.effectiveLayer});node.type='reasoning';node.status='verified';node.mastery='none';});
      window.__debug.scene.markDirty();window.__debug.scene.start();return original;
    },calibrationIds);
    await page.waitForTimeout(180);
    await page.evaluate(()=>window.__debug.scene.stop());
    const controlPoints=await page.evaluate(ids=>ids.map(id=>window.__debug.scene.screenPositionForNode(id)),calibrationIds);
    assert.ok(controlPoints.every(Boolean),'calibration control nodes must remain on screen');
    const controlScreenshot=await canvasHost.screenshot({type:'png'});
    const control=await analyzeScreenshot(page,controlScreenshot,toLocalRegions(controlPoints));

    await page.evaluate(ids=>{
      const specs=[['definition','verified','inner'],['theorem','verified','middle'],['hypothesis','verified','outer'],['reasoning','verified','middle']];
      ids.forEach((id,index)=>{const node=window.__debug.renderNodes.find(candidate=>candidate.id===id);if(!node)return;node.type=specs[index][0];node.status=specs[index][1];node.effectiveLayer=specs[index][2];node.mastery='none';});
      window.__debug.scene.markDirty();window.__debug.scene.start();
    },calibrationIds);
    await page.waitForTimeout(180);
    await page.evaluate(()=>window.__debug.scene.stop());
    const palettePoints=await page.evaluate(ids=>ids.map(id=>window.__debug.scene.screenPositionForNode(id)),calibrationIds);
    assert.ok(palettePoints.every(Boolean),'semantic palette nodes must remain on screen');
    const paletteScreenshot=await canvasHost.screenshot({path:'artifacts/mobile-scene-palette.png',type:'png'});
    assert.ok(paletteScreenshot.length>5_000,'semantic palette screenshot must contain real rendered visual data');
    const palette=await analyzeScreenshot(page,paletteScreenshot,toLocalRegions(palettePoints));
    console.log('mobile semantic-palette visual pixels',palette);
    console.log('mobile semantic local control',control.regions);
    console.log('mobile semantic local palette',palette.regions);
    assert.equal(palette.width,visual.width,'actual and semantic-palette screenshots must share the same width');
    assert.equal(palette.height,visual.height,'actual and semantic-palette screenshots must share the same height');
    assert.ok(palette.regions[0].cyan>=control.regions[0].cyan+6,`inner calibration must add local ice-blue pixels (control=${control.regions[0].cyan}, palette=${palette.regions[0].cyan})`);
    assert.ok(palette.regions[0].cyanPeak>=.60,`inner ice-blue must stay bright in the real composite (peak=${palette.regions[0].cyanPeak})`);
    // The intended middle hue sits on an intentionally blue background. Replacing a white control sphere
    // with a purer/brighter blue can reduce the total count of already-blue background pixels, so count
    // deltas are not a reliable signal. Require a strong local brightness gain in the true-blue hue instead.
    assert.ok(palette.regions[1].trueBluePeak>=.75,`middle true-blue must stay bright in the real composite (peak=${palette.regions[1].trueBluePeak})`);
    assert.ok(palette.regions[1].trueBluePeak>=control.regions[1].trueBluePeak+.15,`middle calibration must increase local true-blue brightness (control=${control.regions[1].trueBluePeak}, palette=${palette.regions[1].trueBluePeak})`);
    assert.ok(palette.regions[2].violet>=control.regions[2].violet+6,`outer calibration must add local violet pixels (control=${control.regions[2].violet}, palette=${palette.regions[2].violet})`);
    assert.ok(palette.regions[2].violetPeak>=.55,`outer violet must stay bright in the real composite (peak=${palette.regions[2].violetPeak})`);
    assert.ok(palette.white>=100,'semantic calibration must retain the whole-frame structural white language');
    assert.ok(palette.greenDominant<=5,'semantic calibration must not reintroduce green/teal contamination');
    await page.evaluate(original=>{for(const saved of original){const node=window.__debug.renderNodes.find(candidate=>candidate.id===saved.id);if(node){node.type=saved.type;node.status=saved.status;node.mastery=saved.mastery;node.effectiveLayer=saved.effectiveLayer;}}window.__debug.scene.markDirty();window.__debug.scene.start();},originals);
    await page.waitForTimeout(100);
    await page.evaluate(()=>window.__debug.scene.stop());

    // Gate C: the real Personal control must hide both untouched nodes and every
    // edge incident to them, then restore exactly the same edge set when disabled.
    const personalFixture=await page.evaluate(()=>{
      const sceneNodes=window.__debug.renderNodes.slice(0,48);
      const ids=new Set(sceneNodes.map(node=>node.id));
      const connected=sceneNodes.find(node=>!['n1','n2','n16'].includes(node.id)&&node.premises?.some(id=>ids.has(id)&&!['n1','n2','n16'].includes(id)));
      if(!connected)return null;
      const hiddenEndpointId=connected.premises.find(id=>ids.has(id)&&!['n1','n2','n16'].includes(id));
      if(!hiddenEndpointId)return null;
      const originalMastery=sceneNodes.map(node=>({id:node.id,mastery:node.mastery}));
      sceneNodes.forEach(node=>{if(!['n1','n2','n16'].includes(node.id))node.mastery='touched';});
      const hiddenEndpoint=sceneNodes.find(node=>node.id===hiddenEndpointId);
      if(!hiddenEndpoint)return null;
      hiddenEndpoint.mastery='none';
      window.__debug.scene.markDirty();window.__debug.scene.start();
      return{hiddenEndpointId,originalMastery};
    });
    assert.ok(personalFixture,'mobile scene must contain a non-core connected relation for Personal-mode visibility testing');
    await page.waitForTimeout(120);
    const fullEdgeCount=await page.evaluate(()=>{window.__debug.scene.stop();return window.__debug.scene.getVisibleEdgeCount();});
    assert.ok(fullEdgeCount>0,'full graph mode must render at least one relation line before Personal filtering');
    await page.locator('#btnPersonal').click();
    const personalEdgeCount=await page.evaluate(()=>window.__debug.scene.getVisibleEdgeCount());
    assert.ok(personalEdgeCount<fullEdgeCount,`Personal mode must hide lines incident to hidden nodes (full=${fullEdgeCount}, personal=${personalEdgeCount})`);
    await page.locator('#btnPersonal').click();
    const restoredEdgeCount=await page.evaluate(()=>window.__debug.scene.getVisibleEdgeCount());
    assert.equal(restoredEdgeCount,fullEdgeCount,'leaving Personal mode must restore exactly the prior visible relation-line count');
    await page.evaluate(saved=>{for(const item of saved){const node=window.__debug.renderNodes.find(candidate=>candidate.id===item.id);if(node)node.mastery=item.mastery;}window.__debug.scene.markDirty();window.__debug.scene.start();},personalFixture.originalMastery);
    await page.waitForTimeout(100);
    await page.evaluate(()=>window.__debug.scene.stop());

    assert.equal(await page.locator('.ai-add').count(),0,'search bar must not expose the old add-node button');
    await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'n',ctrlKey:true,bubbles:true,cancelable:true})));
    await page.locator('#modalOverlay.show').waitFor({state:'visible'});
    await assertExit(page.locator('#modalClose'),'create modal exit');
    await page.locator('#modalClose').click();
    await page.locator('#modalOverlay').waitFor({state:'hidden'});

    await page.locator('#btnSettings').click();
    await page.locator('#settingsOverlay.show').waitFor({state:'visible'});
    await assertExit(page.locator('#settingsClose'),'settings exit');
    await page.locator('#settingsClose').click();
    await page.locator('#settingsOverlay').waitFor({state:'hidden'});

    await page.locator('.avatar-btn').click();
    await page.locator('#accountOverlay.show').waitFor({state:'visible'});
    await assertExit(page.locator('#accountClose'),'account exit');
    await page.locator('#accountClose').click();
    await page.locator('#accountOverlay').waitFor({state:'hidden'});

    const target=targets[0];
    await page.evaluate(()=>window.__debug.scene.start());
    await page.touchscreen.tap(target.x,target.y);
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#panel.open').count(),0,'first node tap must focus the node without opening the legacy panel');
    assert.equal(await page.locator('#nodeDetailOverlay.open').count(),0,'first node tap must focus without opening near-node details');
    const centered=await page.evaluate(id=>window.__debug.scene.screenPositionForNode(id),target.id);
    assert.ok(centered,'focused node must remain renderable');
    assert.ok(Math.hypot(centered.x-(hostBox.x+hostBox.width/2),centered.y-(hostBox.y+hostBox.height/2))<4,'first node tap must rotate the whole graph until the node reaches screen center');
    const coreOverlap=await page.evaluate(({centered})=>['n1','n2','n16']
      .map(id=>{const point=window.__debug.scene.screenPositionForNode(id);return point?{...point,id,distance:Math.hypot(point.x-centered.x,point.y-centered.y)}:null;})
      .filter(Boolean).sort((a,b)=>a.distance-b.distance)[0],{centered});
    assert.ok(coreOverlap,'core triad must expose a projected point for overlap regression');
    assert.ok(coreOverlap.distance<=24,`nearest core node must overlap the focused node touch radius (distance=${coreOverlap.distance})`);
    await page.touchscreen.tap(coreOverlap.x,coreOverlap.y);
    const detail=page.locator('#nodeDetailOverlay.open');
    await detail.waitFor({state:'visible'});
    assert.equal(await page.locator('#panel.open').count(),0,'second tap must not restore the old large rectangular detail panel');
    assert.equal((await detail.locator('.node-detail-title').textContent())?.trim(),target.title,'focused ordinary node must win the second tap inside its existing hit radius even when a core node is closer');
    assert.ok((await detail.locator('.node-detail-meta').textContent())?.includes('贡献者'),'near-node detail must expose contributor metadata');
    assert.ok((await detail.locator('.node-detail-meta').textContent())?.includes('时间'),'near-node detail must expose server creation time');
    assert.equal((await detail.locator('.node-detail-content-label').textContent())?.trim(),'内容','near-node detail must use the concise content label');
    const detailBox=await detail.boundingBox();
    assert.ok(detailBox,'near-node detail must have a visible mobile box');
    assert.ok(detailBox.height>detailBox.width,'near-node detail must use a narrow vertical ellipse so premise/conclusion context can occupy the side space');
    assert.ok(centered.x>=detailBox.x&&centered.x<=detailBox.x+detailBox.width&&centered.y>=detailBox.y&&centered.y<=detailBox.y+detailBox.height,'near-node detail must sit in front of and visually occlude the selected sphere');
    const selectedLabelHidden=await page.evaluate(title=>[...document.querySelectorAll('.node-label')].find(label=>label.textContent?.trim()===title)?.style.display==='none',target.title);
    assert.equal(selectedLabelHidden,true,'near-node detail must hide only the selected sphere label');
    await assertNodeDetailExit(detail.locator('.node-detail-close'),'node detail exit');
    await detail.locator('.node-detail-close').click();
    await page.locator('#nodeDetailOverlay').waitFor({state:'hidden'});
    await page.waitForFunction(title=>[...document.querySelectorAll('.node-label')].some(label=>label.textContent?.trim()===title&&label.style.display!=='none'),target.title);

    // Re-open the focused node and verify all edit variants are entered through one text control.
    await page.touchscreen.tap(centered.x,centered.y);
    await page.locator('#nodeDetailOverlay.open').waitFor({state:'visible'});
    await page.locator('#nodeDetailOverlay .node-detail-edit').click();
    await page.locator('#nodeDetailOverlay [data-node-detail-action="edit"]').click();
    await page.locator('#panelTitle').filter({hasText:'编辑节点'}).waitFor({state:'visible'});
    assert.equal(await page.locator('#nodeDetailOverlay.open').count(),0,'choosing an edit operation must close the near-node viewer before opening the editor');
    assert.equal(await page.locator('#panelClose').getAttribute('aria-label'),'返回节点详情','legacy editor subview keeps its existing safe back semantics');
    await page.locator('#panelClose').click();
    await page.waitForFunction(title=>document.getElementById('panelTitle')?.textContent?.trim()===title,target.title);
    assert.ok(await page.locator('#panel').evaluate(element=>element.classList.contains('open')),'editor back must return to the existing operation host');
    await page.locator('#panelClose').click();
    await page.waitForFunction(()=>!document.getElementById('panel')?.classList.contains('open'));

    const searchTarget=targets[1];
    await page.evaluate(()=>window.__debug.scene.start());
    await page.locator('#aiInput').fill(searchTarget.title);
    const searchResult=page.locator(`[data-node-id="${searchTarget.id}"]`).first();
    await searchResult.waitFor({state:'visible'});
    await searchResult.click();
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#panel.open').count(),0,'search selection must focus without opening the legacy panel');
    assert.equal(await page.locator('#nodeDetailOverlay.open').count(),0,'search selection must focus without opening details');
    const searchCentered=await page.evaluate(id=>window.__debug.scene.screenPositionForNode(id),searchTarget.id);
    assert.ok(searchCentered,'search-focused node must remain renderable');
    assert.ok(Math.hypot(searchCentered.x-(hostBox.x+hostBox.width/2),searchCentered.y-(hostBox.y+hostBox.height/2))<4,'search selection must use the same center-focus behavior as a node tap');
    await page.touchscreen.tap(searchCentered.x,searchCentered.y);
    await page.locator('#nodeDetailOverlay.open').waitFor({state:'visible'});
    await page.locator('#nodeDetailOverlay .node-detail-close').click();
    await page.locator('#nodeDetailOverlay').waitFor({state:'hidden'});

    await page.goto(new URL('ios-install.html',origin).href,{waitUntil:'domcontentloaded'});
    await assertExit(page.locator('.exit'),'iOS install exit');

    assert.deepEqual(errors.filter(error=>/NaN|computeBoundingSphere|pageerror/i.test(error)),[]);
    await context.close();
  }finally{await browser.close();}
  console.log('Mobile viewport, bright semantic colors, Personal node/edge visibility, focus-before-details, near-node details, search focus, exit navigation, raycast and UI click checks passed');
}finally{server.kill('SIGKILL');server.unref();}