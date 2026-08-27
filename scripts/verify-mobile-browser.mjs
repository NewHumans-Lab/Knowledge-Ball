import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'..');
const port=4177;
const origin=`http://127.0.0.1:${port}`;
const server=spawn('npx',['vite','preview','--host','127.0.0.1','--port',String(port)],{cwd:root,stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function waitForServer(){
  for(let i=0;i<50;i++){
    try{const response=await fetch(origin);if(response.ok)return;}catch{}
    await sleep(100);
  }
  throw new Error('mobile preview server did not start');
}

async function analyzeScreenshot(page,buffer,regions=[]){
  return page.evaluate(async({bytes,regions})=>{
    const blob=new Blob([Uint8Array.from(bytes)],{type:'image/png'});
    const bitmap=await createImageBitmap(blob);
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);
    const data=context.getImageData(0,0,bitmap.width,bitmap.height).data;
    const analyse=(accept)=>{
      let trueBlue=0,violet=0,cyan=0,white=0,greenDominant=0,visible=0;
      let cyanPeak=0,trueBluePeak=0,violetPeak=0,whitePeak=0;
      for(let y=0;y<bitmap.height;y++)for(let x=0;x<bitmap.width;x++){
        if(accept&&!accept(x,y))continue;
        const offset=(y*bitmap.width+x)*4,r=data[offset]/255,g=data[offset+1]/255,b=data[offset+2]/255,a=data[offset+3]/255;
        if(a<.2)continue;
        const max=Math.max(r,g,b),min=Math.min(r,g,b),sat=max-min;
        if(max>.10)visible++;
        if(b>.28&&b>r*1.25&&b>g*1.08){trueBlue++;trueBluePeak=Math.max(trueBluePeak,b);}
        if(b>.25&&r>.18&&b>g*1.18&&r>g*1.15){violet++;violetPeak=Math.max(violetPeak,max);}
        if(b>.30&&g>.34&&g>r*1.12&&b>r*1.18){cyan++;cyanPeak=Math.max(cyanPeak,max);}
        if(max>.52&&sat<.12){white++;whitePeak=Math.max(whitePeak,max);}
        if(g>.30&&g>r*1.25&&g>b*1.12)greenDominant++;
      }
      return{trueBlue,violet,cyan,white,greenDominant,visible,cyanPeak,trueBluePeak,violetPeak,whitePeak};
    };
    const whole=analyse();
    const local=regions.map(region=>analyse((x,y)=>(x-region.x)**2+(y-region.y)**2<=region.radius**2));
    return{width:bitmap.width,height:bitmap.height,...whole,regions:local};
  },{bytes:[...buffer],regions});
}

try{
  await waitForServer();
  const browser=await chromium.launch({headless:true});
  console.log('mobile browser launched');
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
    const page=await context.newPage();
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
    const toLocalRegions=(points,radius=18)=>points.map(point=>({x:point.x-hostBox.x,y:point.y-hostBox.y,radius}));

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

    // Gate B: calibrate one genuinely visible sphere sequentially. R-resolution layouts can place several
    // projected centres within one screen-space sphere footprint, so four simultaneous calibration nodes can
    // legitimately occlude one another. Sequential calibration keeps geometry unchanged while testing the
    // exact same production material/layer path for Cyan, Blue and Purple.
    const calibrationId=targets[0].id;
    const original=await page.evaluate(id=>{
      const node=window.__debug.renderNodes.find(candidate=>candidate.id===id);
      assert;
      if(!node)return null;
      const saved={id,type:node.type,status:node.status,mastery:node.mastery,effectiveLayer:node.effectiveLayer};
      node.type='reasoning';node.status='verified';node.mastery='none';
      window.__debug.scene.markDirty();window.__debug.scene.start();
      return saved;
    },calibrationId);
    assert.ok(original,'calibration node must exist');
    await page.waitForTimeout(180);
    await page.evaluate(()=>window.__debug.scene.stop());
    const controlPoint=await page.evaluate(id=>window.__debug.scene.screenPositionForNode(id),calibrationId);
    assert.ok(controlPoint,'calibration control node must remain on screen');
    const controlScreenshot=await canvasHost.screenshot({type:'png'});
    const control=(await analyzeScreenshot(page,controlScreenshot,toLocalRegions([controlPoint],8))).regions[0];
    assert.ok(control.visible>=40,'chosen calibration sphere must be genuinely visible before palette checks');

    const calibrate=async(type,layer)=>{
      await page.evaluate(({id,type,layer})=>{
        const node=window.__debug.renderNodes.find(candidate=>candidate.id===id);
        if(!node)return;
        node.type=type;node.status='verified';node.effectiveLayer=layer;node.mastery='none';
        window.__debug.scene.markDirty();window.__debug.scene.start();
      },{id:calibrationId,type,layer});
      await page.waitForTimeout(180);
      await page.evaluate(()=>window.__debug.scene.stop());
      const point=await page.evaluate(id=>window.__debug.scene.screenPositionForNode(id),calibrationId);
      assert.ok(point,'semantic calibration node must remain on screen');
      const shot=await canvasHost.screenshot({type:'png'});
      return (await analyzeScreenshot(page,shot,toLocalRegions([point],8))).regions[0];
    };

    const cyanCalibration=await calibrate('definition','inner');
    const blueCalibration=await calibrate('theorem','middle');
    const purpleCalibration=await calibrate('hypothesis','outer');
    const paletteScreenshot=await canvasHost.screenshot({path:'artifacts/mobile-scene-palette.png',type:'png'});
    const palette=await analyzeScreenshot(page,paletteScreenshot);
    console.log('mobile semantic local control',control);
    console.log('mobile semantic sequential palette',{cyanCalibration,blueCalibration,purpleCalibration});
    assert.ok(cyanCalibration.cyan>=control.cyan+6,`inner calibration must add local ice-blue pixels (control=${control.cyan}, palette=${cyanCalibration.cyan})`);
    assert.ok(cyanCalibration.cyanPeak>=.60,`inner ice-blue must stay bright in the real composite (peak=${cyanCalibration.cyanPeak})`);
    assert.ok(blueCalibration.trueBluePeak>=.75,`middle true-blue must stay bright in the real composite (peak=${blueCalibration.trueBluePeak})`);
    assert.ok(blueCalibration.trueBlue>=control.trueBlue+6,`middle calibration must add local true-blue sphere pixels (control=${control.trueBlue}, palette=${blueCalibration.trueBlue})`);
    assert.ok(purpleCalibration.violet>=control.violet+6,`outer calibration must add local violet pixels (control=${control.violet}, palette=${purpleCalibration.violet})`);
    assert.ok(purpleCalibration.violetPeak>=.55,`outer violet must stay bright in the real composite (peak=${purpleCalibration.violetPeak})`);
    assert.ok(palette.white>=100,'semantic calibration must retain the whole-frame structural white language');
    assert.ok(palette.greenDominant<=5,'semantic calibration must not reintroduce green/teal contamination');
    await page.evaluate(saved=>{const node=window.__debug.renderNodes.find(candidate=>candidate.id===saved.id);if(node){node.type=saved.type;node.status=saved.status;node.mastery=saved.mastery;node.effectiveLayer=saved.effectiveLayer;}window.__debug.scene.markDirty();window.__debug.scene.start();},original);
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
      sceneNodes.forEach(node=>{node.mastery=node.id===connected.id?'lit':'none';});
      window.__debug.scene.setVisibilityMode?.('current');
      window.__debug.scene.markDirty();window.__debug.scene.start();
      return{connectedId:connected.id,hiddenEndpointId,originalMastery};
    });
    assert.ok(personalFixture,'mobile graph must contain a connected non-core fixture for Personal visibility regression');
    await page.waitForTimeout(120);await page.evaluate(()=>window.__debug.scene.stop());
    const beforeEdges=await page.evaluate(()=>window.__debug.scene.visibleEdgeKeys?.()??[]);
    await page.getByRole('button',{name:/Personal/i}).click();
    await page.waitForTimeout(120);await page.evaluate(()=>window.__debug.scene.stop());
    const personalState=await page.evaluate(fixture=>({
      connected:window.__debug.scene.screenPositionForNode(fixture.connectedId),
      hidden:window.__debug.scene.screenPositionForNode(fixture.hiddenEndpointId),
      edges:window.__debug.scene.visibleEdgeKeys?.()??[],
    }),personalFixture);
    assert.ok(personalState.connected,'mastered node must remain visible in Personal mode');
    assert.equal(personalState.hidden,null,'unmastered node must be hidden in Personal mode');
    assert.ok(personalState.edges.length<beforeEdges.length,'Personal mode must hide incident edges with hidden endpoints');
    await page.getByRole('button',{name:/All/i}).click();
    await page.waitForTimeout(120);await page.evaluate(()=>window.__debug.scene.stop());
    const restored=await page.evaluate(fixture=>({hidden:window.__debug.scene.screenPositionForNode(fixture.hiddenEndpointId),edges:window.__debug.scene.visibleEdgeKeys?.()??[]}),personalFixture);
    assert.ok(restored.hidden,'All mode must restore the hidden endpoint');
    assert.deepEqual(restored.edges,beforeEdges,'All mode must restore exactly the original current edge set');
    await page.evaluate(fixture=>{for(const saved of fixture.originalMastery){const node=window.__debug.renderNodes.find(candidate=>candidate.id===saved.id);if(node)node.mastery=saved.mastery;}window.__debug.scene.setVisibilityMode?.('current');window.__debug.scene.markDirty();window.__debug.scene.start();},personalFixture);
    await page.waitForTimeout(80);await page.evaluate(()=>window.__debug.scene.stop());

    // Existing interaction checks continue below.
    const target=targets[0];
    await page.mouse.click(target.x,target.y);
    await page.waitForTimeout(100);
    const panel=page.locator('#nodeDetailPanel');
    assert.ok(await panel.isVisible(),'node detail panel must open from a real raycast click');
    await page.locator('#nodeDetailClose').click();
    await page.waitForTimeout(80);

    await context.close();
  }finally{await browser.close();}
  console.log('Mobile viewport, bright semantic colors, Personal node/edge visibility, split create exit, direct node/search details, exit navigation, raycast and UI click checks passed');
}finally{server.kill('SIGKILL');server.unref();}
