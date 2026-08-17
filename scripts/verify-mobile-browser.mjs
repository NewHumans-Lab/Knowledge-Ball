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

async function analyzeScreenshot(page,screenshot){
  const screenshotUrl=`data:image/png;base64,${screenshot.toString('base64')}`;
  return page.evaluate(async src=>{
    const image=new Image();image.src=src;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('2D screenshot analysis context unavailable');
    ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const hsv=(r,g,b)=>{const rn=r/255,gn=g/255,bn=b/255,max=Math.max(rn,gn,bn),min=Math.min(rn,gn,bn),d=max-min;let h=0;if(d){if(max===rn)h=60*(((gn-bn)/d)%6);else if(max===gn)h=60*((bn-rn)/d+2);else h=60*((rn-gn)/d+4);if(h<0)h+=360;}return{h,s:max?d/max:0,v:max};};
    let trueBlue=0,violet=0,cyan=0,white=0,greenDominant=0,visible=0;
    // Sample every fourth pixel. Hue/saturation are more faithful than absolute RGB
    // thresholds after WebGL transparency is composited over the deep-space background.
    for(let i=0;i<data.length;i+=16){const r=data[i],g=data[i+1],b=data[i+2],a=data[i+3];if(a<180)continue;const {h,s,v}=hsv(r,g,b);if(v<.12)continue;visible++;
      if(s<=.12&&v>=.42)white++;
      if(h>=185&&h<215&&s>=.25&&v>=.14)cyan++;
      if(h>=215&&h<238&&s>=.28&&v>=.14)trueBlue++;
      if(h>=238&&h<=285&&s>=.25&&v>=.14)violet++;
      if(h>=80&&h<=165&&s>=.25&&v>=.14)greenDominant++;
    }
    return{width:canvas.width,height:canvas.height,trueBlue,violet,cyan,white,greenDominant,visible};
  },screenshotUrl);
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
        .filter(target=>target&&target.x>12&&target.x<378&&target.y>70&&target.y<820)
        .slice(0,8);
    });
    console.log(`mobile raycast targets: ${targets.length}`);
    assert.ok(targets.length>=4,'mobile scene must expose at least four finite on-screen raycast targets for visual calibration');
    assert.ok(targets.every(target=>Number.isFinite(target.x)&&Number.isFinite(target.y)),'mobile raycast targets must be finite');

    // Gate A: capture the actual graph exactly as current data renders on a phone viewport.
    // This verifies the production-like composition is no longer contaminated by the old teal/green visual path.
    await mkdir('artifacts',{recursive:true});
    const screenshot=await page.locator('#canvasHost').screenshot({path:'artifacts/mobile-scene-visual.png',type:'png'});
    assert.ok(screenshot.length>5_000,'mobile WebGL scene screenshot must contain real rendered visual data');
    const visual=await analyzeScreenshot(page,screenshot);
    console.log('mobile actual-scene visual pixels',visual);
    assert.ok(visual.visible>1_000,'mobile scene must contain enough visible non-background rendered pixels');
    assert.ok(visual.white>=100,'actual WebGL screenshot must visibly contain the white structural/core light language');
    assert.ok(visual.trueBlue>=100,'actual WebGL screenshot must visibly contain a true-blue scene signal, not only cyan/teal');
    assert.ok(visual.greenDominant<=5,'old green/teal contamination must not reappear in the actual scene screenshot');

    // Gate B: data distribution is allowed to vary, so calibrate the renderer itself with four real,
    // on-screen graph nodes temporarily assigned to the canonical semantic classes. The screenshot is
    // still a genuine Three.js/mobile composition; only the semantic fixture is controlled. Restore immediately.
    const calibrationIds=targets.slice(0,4).map(target=>target.id);
    const originals=await page.evaluate(ids=>{
      const specs=[['definition','verified'],['theorem','verified'],['hypothesis','verified'],['reasoning','verified']];
      const original=[];
      ids.forEach((id,index)=>{const node=window.__debug.renderNodes.find(candidate=>candidate.id===id);if(!node)return;original.push({id,type:node.type,status:node.status,mastery:node.mastery});node.type=specs[index][0];node.status=specs[index][1];node.mastery='none';});
      window.__debug.scene.markDirty();window.__debug.scene.start();return original;
    },calibrationIds);
    await page.waitForTimeout(180);
    await page.evaluate(()=>window.__debug.scene.stop());
    const paletteScreenshot=await page.locator('#canvasHost').screenshot({path:'artifacts/mobile-scene-palette.png',type:'png'});
    assert.ok(paletteScreenshot.length>5_000,'semantic palette screenshot must contain real rendered visual data');
    const palette=await analyzeScreenshot(page,paletteScreenshot);
    console.log('mobile semantic-palette visual pixels',palette);
    assert.equal(palette.width,visual.width,'actual and semantic-palette screenshots must share the same width');
    assert.equal(palette.height,visual.height,'actual and semantic-palette screenshots must share the same height');
    assert.ok(palette.cyan>=100,'real WebGL calibration must visibly retain the inner ice-blue color family');
    assert.ok(palette.trueBlue>=100,'real WebGL calibration must visibly retain the middle true-blue color family');
    // The background contains a stable blue-violet field, so compare against the immediately preceding
    // actual-scene frame: adding a real outer hypothesis node must measurably increase violet pixels.
    assert.ok(palette.violet>=visual.violet+20,`real WebGL calibration must visibly add outer violet pixels (actual=${visual.violet}, palette=${palette.violet})`);
    assert.ok(palette.white>=100,'real WebGL calibration must visibly retain structural white');
    assert.ok(palette.greenDominant<=5,'semantic calibration must not reintroduce green/teal contamination');
    await page.evaluate(original=>{for(const saved of original){const node=window.__debug.renderNodes.find(candidate=>candidate.id===saved.id);if(node){node.type=saved.type;node.status=saved.status;node.mastery=saved.mastery;}}window.__debug.scene.markDirty();window.__debug.scene.start();},originals);
    await page.waitForTimeout(100);
    await page.evaluate(()=>window.__debug.scene.stop());

    await page.locator('.ai-add').click();
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
    await page.touchscreen.tap(target.x,target.y);
    await page.locator('#panel.open').waitFor({state:'visible'});
    await assertExit(page.locator('#panelClose'),'node detail exit');
    const originalTitle=(await page.locator('#panelTitle').textContent())?.trim();
    assert.ok(originalTitle,'node detail must expose a title');

    await page.locator('#btnEditNode').click();
    await page.locator('#panelTitle').filter({hasText:'编辑节点'}).waitFor({state:'visible'});
    assert.equal(await page.locator('#panelClose').getAttribute('aria-label'),'返回节点详情','subview exit must return to node detail');
    await page.locator('#panelClose').click();
    await page.waitForFunction(title=>document.getElementById('panelTitle')?.textContent?.trim()===title,originalTitle);
    assert.ok(await page.locator('#panel').evaluate(element=>element.classList.contains('open')),'subview exit must keep the node detail open');

    await page.locator('#panelClose').click();
    await page.waitForFunction(()=>!document.getElementById('panel')?.classList.contains('open'));

    await page.goto(new URL('ios-install.html',origin).href,{waitUntil:'domcontentloaded'});
    await assertExit(page.locator('.exit'),'iOS install exit');

    assert.deepEqual(errors.filter(error=>/NaN|computeBoundingSphere|pageerror/i.test(error)),[]);
    await context.close();
  }finally{await browser.close();}
  console.log('Mobile viewport, actual scene pixels, semantic palette, exit navigation, raycast and UI click checks passed');
}finally{server.kill('SIGKILL');server.unref();}
