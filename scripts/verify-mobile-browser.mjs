import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

const baseUrl=process.env.KNOWLEDGE_BALL_PREVIEW_URL||'http://127.0.0.1:4173/Knowledge-Ball/';
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({...devices['Pixel 5'],viewport:{width:390,height:844}});
  const page=await context.newPage();
  page.on('console',message=>{if(message.type()==='error')console.error('[browser]',message.text());});
  console.log('mobile browser launched');
  await page.goto(baseUrl,{waitUntil:'networkidle'});
  console.log('mobile page loaded');
  await page.waitForFunction(()=>Boolean(window.__debug?.scene&&window.__debug?.renderNodes?.length));
  await page.evaluate(()=>{window.__debug.scene.start();window.__debug.scene.markDirty();});
  await page.waitForTimeout(300);
  await page.evaluate(()=>window.__debug.scene.stop());

  const analyzeScreenshot=async(pageHandle,screenshot,regions=[])=>pageHandle.evaluate(async({bytes,regions})=>{
    const blob=new Blob([new Uint8Array(bytes)],{type:'image/png'});
    const image=await createImageBitmap(blob);
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
    const data=ctx.getImageData(0,0,image.width,image.height).data;
    const stats={width:image.width,height:image.height,trueBlue:0,violet:0,cyan:0,white:0,greenDominant:0,visible:0,cyanPeak:0,trueBluePeak:0,violetPeak:0,whitePeak:0,regions:[]};
    const collect=(left,top,right,bottom)=>{
      const r={trueBlue:0,violet:0,cyan:0,white:0,greenDominant:0,visible:0,cyanPeak:0,trueBluePeak:0,violetPeak:0,whitePeak:0};
      for(let y=Math.max(0,Math.floor(top));y<Math.min(image.height,Math.ceil(bottom));y++)for(let x=Math.max(0,Math.floor(left));x<Math.min(image.width,Math.ceil(right));x++){
        const i=(y*image.width+x)*4,R=data[i]/255,G=data[i+1]/255,B=data[i+2]/255,A=data[i+3]/255;
        if(A<.08||Math.max(R,G,B)<.08)continue;r.visible++;
        const trueBlue=B>.28&&B>R*1.18&&B>G*1.06;
        const violet=R>.20&&B>.28&&B>G*1.12&&R>G*1.06;
        const cyan=G>.28&&B>.32&&G>R*1.10&&B>R*1.12;
        const white=Math.min(R,G,B)>.48&&Math.max(R,G,B)-Math.min(R,G,B)<.18;
        const greenDominant=G>.25&&G>R*1.35&&G>B*1.18;
        if(trueBlue){r.trueBlue++;r.trueBluePeak=Math.max(r.trueBluePeak,B);}
        if(violet){r.violet++;r.violetPeak=Math.max(r.violetPeak,Math.max(R,B));}
        if(cyan){r.cyan++;r.cyanPeak=Math.max(r.cyanPeak,Math.max(G,B));}
        if(white){r.white++;r.whitePeak=Math.max(r.whitePeak,Math.min(R,G,B));}
        if(greenDominant)r.greenDominant++;
      }
      return r;
    };
    Object.assign(stats,collect(0,0,image.width,image.height));
    stats.width=image.width;stats.height=image.height;
    stats.regions=regions.map(region=>collect(region.x-region.radius,region.y-region.radius,region.x+region.radius,region.y+region.radius));
    image.close();return stats;
  },{bytes:[...screenshot],regions});

  const targets=await page.evaluate(()=>{
    return window.__debug.renderNodes
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
  // projected centres inside one screen-space footprint, so simultaneous calibration nodes can occlude
  // one another. Sequential calibration preserves geometry and still exercises the production palette.
  // The white control uses logic-symbol rather than manufacturing an unbound Reasoning node: Reasoning
  // now has a hard semantic invariant that it must serve exactly one ordinary conclusion.
  const calibrationId=targets[0].id;
  const original=await page.evaluate(id=>{
    const node=window.__debug.renderNodes.find(candidate=>candidate.id===id);if(!node)return null;
    const saved={id,type:node.type,status:node.status,mastery:node.mastery,effectiveLayer:node.effectiveLayer};
    node.type='logic-symbol';node.status='verified';node.mastery='none';
    window.__debug.scene.markDirty();window.__debug.scene.start();return saved;
  },calibrationId);
  assert.ok(original,'calibration node must exist');
  await page.waitForTimeout(180);
  await page.evaluate(()=>window.__debug.scene.stop());
  const controlPoint=await page.evaluate(id=>window.__debug.scene.screenPositionForNode(id),calibrationId);
  assert.ok(controlPoint,'calibration control node must remain on screen');
  const controlScreenshot=await canvasHost.screenshot({type:'png'});
  const control=(await analyzeScreenshot(page,controlScreenshot,toLocalRegions([controlPoint],8))).regions[0];
  assert.ok(control.visible>=40,'calibration sphere must be visibly sampled');

  const calibrate=async(type,layer)=>{
    await page.evaluate(({id,type,layer})=>{const node=window.__debug.renderNodes.find(candidate=>candidate.id===id);if(!node)return;node.type=type;node.status='verified';node.effectiveLayer=layer;node.mastery='none';window.__debug.scene.markDirty();window.__debug.scene.start();},{id:calibrationId,type,layer});
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
  assert.ok(paletteScreenshot.length>5_000,'semantic palette screenshot must contain real rendered visual data');
  const palette=await analyzeScreenshot(page,paletteScreenshot);
  console.log('mobile semantic local control',control);
  console.log('mobile semantic sequential palette',{cyanCalibration,blueCalibration,purpleCalibration});
  assert.equal(palette.width,visual.width,'actual and semantic-palette screenshots must share the same width');
  assert.equal(palette.height,visual.height,'actual and semantic-palette screenshots must share the same height');
  assert.ok(cyanCalibration.cyan>=control.cyan+6,`inner calibration must add local ice-blue pixels (control=${control.cyan}, palette=${cyanCalibration.cyan})`);
  assert.ok(cyanCalibration.cyanPeak>=.60,`inner ice-blue must stay bright in the real composite (peak=${cyanCalibration.cyanPeak})`);
  assert.ok(blueCalibration.trueBluePeak>=.75,`middle true-blue must stay bright in the real composite (peak=${blueCalibration.trueBluePeak})`);
  assert.ok(purpleCalibration.violet>=control.violet+6,`outer calibration must add local violet pixels (control=${control.violet}, palette=${purpleCalibration.violet})`);
  assert.ok(purpleCalibration.violetPeak>=.55,`outer violet must stay bright in the real composite (peak=${purpleCalibration.violetPeak})`);

  await page.evaluate(saved=>{
    const node=window.__debug.renderNodes.find(candidate=>candidate.id===saved.id);if(!node)return;
    node.type=saved.type;node.status=saved.status;node.mastery=saved.mastery;node.effectiveLayer=saved.effectiveLayer;
    window.__debug.scene.markDirty();window.__debug.scene.start();
  },original);
  await page.waitForTimeout(120);
  await page.evaluate(()=>window.__debug.scene.stop());

  assert.ok(await page.locator('#canvasHost canvas').count(),'mobile scene must retain its WebGL canvas');
  console.log('Mobile browser interaction and visual regression passed.');
}finally{
  await browser.close();
}
