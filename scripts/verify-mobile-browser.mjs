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

async function assertCreateExit(locator,name){
  await locator.waitFor({state:'visible'});
  assert.equal((await locator.textContent())?.trim(),'✕',`${name} must use the split-create close control`);
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
        .filter(node=>!['n1','n2','n16'].includes(node.id)&&!node.lineage)
        .map(node=>{const point=window.__debug.scene.screenPositionForNode(node.id);return point?{...point,id:node.id,title:node.title}:null;})
        .filter(target=>target&&target.x>24&&target.x<366&&target.y>88&&target.y<808)
        .slice(0,8);
    });
    console.log(`mobile raycast targets: ${targets.length}`);
    assert.ok(targets.length>=4,'mobile scene must expose at least four finite on-screen ordinary raycast targets for visual calibration');
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

    // Gate B: first turn up to eight ordinary on-screen candidates into structural white controls.
    // A projected centre alone does not prove that a sphere is actually visible; another foreground
    // sphere may occlude it after a legitimate 3D layout change. Select the four calibration spheres
    // only after the real screenshot proves that their white controls are visibly exposed.
    const calibrationCandidateIds=targets.map(target=>target.id);
    const originals=await page.evaluate(ids=>{
      const original=[];
      ids.forEach(id=>{const node=window.__debug.renderNodes.find(candidate=>candidate.id===id);if(!node)return;original.push({id,type:node.type,status:node.status,mastery:node.mastery,effectiveLayer:node.effectiveLayer});node.type='reasoning';node.status='verified';node.mastery='none';});
      window.__debug.scene.markDirty();window.__debug.scene.start();return original;
    },calibrationCandidateIds);
    await page.waitForTimeout(180);
    await page.evaluate(()=>window.__debug.scene.stop());
    const candidateControlPoints=await page.evaluate(ids=>ids.map(id=>window.__debug.scene.screenPositionForNode(id)),calibrationCandidateIds);
    assert.ok(candidateControlPoints.every(Boolean),'calibration control candidates must remain on screen');
    const controlScreenshot=await canvasHost.screenshot({type:'png'});
    const candidateControl=await analyzeScreenshot(page,controlScreenshot,toLocalRegions(candidateControlPoints));
    const calibrationIndices=candidateControl.regions
      .map((stats,index)=>({index,score:stats.whitePeak*1000+stats.white}))
      .sort((a,b)=>b.score-a.score)
      .filter(entry=>candidateControl.regions[entry.index].whitePeak>=.80)
      .slice(0,4)
      .map(entry=>entry.index);
    assert.equal(calibrationIndices.length,4,'mobile palette calibration requires four screenshot-confirmed visible ordinary spheres');
    const calibrationIds=calibrationIndices.map(index=>calibrationCandidateIds[index]);
    const controlRegions=calibrationIndices.map(index=>candidateControl.regions[index]);
    console.log('mobile screenshot-confirmed calibration ids',calibrationIds);

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
    console.log('mobile semantic local control',controlRegions);
    console.log('mobile semantic local palette',palette.regions);
    assert.equal(palette.width,visual.width,'actual and semantic-palette screenshots must share the same width');
    assert.equal(palette.height,visual.height,'actual and semantic-palette screenshots must share the same height');
    assert.ok(palette.regions[0].cyan>=controlRegions[0].cyan+6,`inner calibration must add local ice-blue pixels (control=${controlRegions[0].cyan}, palette=${palette.regions[0].cyan})`);
    assert.ok(palette.regions[0].cyanPeak>=.60,`inner ice-blue must stay bright in the real composite (peak=${palette.regions[0].cyanPeak})`);
    // The intended middle hue sits on an intentionally blue background. Replacing a white control sphere
    // with a purer/brighter blue can reduce the total count of already-blue background pixels, so count
    // deltas are not a reliable signal. Require a strong local brightness gain in the true-blue hue instead.
    assert.ok(palette.regions[1].trueBluePeak>=.75,`middle true-blue must stay bright in the real composite (peak=${palette.regions[1].trueBluePeak})`);
    assert.ok(palette.regions[1].trueBluePeak>=controlRegions[1].trueBluePeak+.15,`middle calibration must increase local true-blue brightness (control=${controlRegions[1].trueBluePeak}, palette=${palette.regions[1].trueBluePeak})`);
    assert.ok(palette.regions[2].violet>=controlRegions[2].violet+6,`outer calibration must add local violet pixels (control=${controlRegions[2].violet}, palette=${palette.regions[2].violet})`);
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
    const createOverlay=page.locator('#knowledgeCreateOverlay.show');
    await createOverlay.waitFor({state:'visible'});
    assert.equal((await createOverlay.locator('h3').textContent())?.trim(),'新增知识','Ctrl+N must open the new standalone create flow');
    assert.equal(await createOverlay.locator('[data-create-reasoning]').count(),0,'standalone mobile create must not expose the old reasoning field');
    assert.equal(await createOverlay.locator('[data-picker]').count(),0,'standalone mobile create must not expose premise/conclusion pickers');
    await assertCreateExit(createOverlay.locator('[data-create-close]'),'split create modal exit');
    await createOverlay.locator('[data-create-close]').click();
    await page.locator('#knowledgeCreateOverlay').waitFor({state:'hidden'});

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

    // Product acceptance intentionally stops at first-tap focus. The former second-tap
    // NodeDetail route was retired; layout validation must not depend on reopening details.
    const target=targets[0];
    await page.evaluate(()=>window.__debug.scene.start());
    await page.touchscreen.tap(target.x,target.y);
    await page.waitForTimeout(900);
    assert.equal(await page.locator('#panel.open').count(),0,'first node tap must focus the node without opening the legacy panel');
    assert.equal(await page.locator('#nodeDetailOverlay.open').count(),0,'first node tap must focus without opening near-node details');
    const centered=await page.evaluate(id=>window.__debug.scene.screenPositionForNode(id),target.id);
    assert.ok(centered,'focused node must remain renderable');
    assert.ok(Math.hypot(centered.x-(hostBox.x+hostBox.width/2),centered.y-(hostBox.y+hostBox.height/2))<4,'first node tap must rotate the whole graph until the node reaches screen center');

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

    await page.goto(new URL('ios-install.html',origin).href,{waitUntil:'domcontentloaded'});
    await assertExit(page.locator('.exit'),'iOS install exit');

    assert.deepEqual(errors.filter(error=>/NaN|computeBoundingSphere|pageerror/i.test(error)),[]);
    await context.close();
  }finally{await browser.close();}
  console.log('Mobile viewport, bright semantic colors, Personal node/edge visibility, split create exit, first-tap focus, search focus, exit navigation, raycast and UI click checks passed');
}finally{server.kill('SIGKILL');server.unref();}
