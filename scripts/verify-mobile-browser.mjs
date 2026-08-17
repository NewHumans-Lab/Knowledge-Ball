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
        .map(node=>{const point=window.__debug.scene.screenPositionForNode(node.id);return point?{...point,title:node.title}:null;})
        .filter(target=>target&&target.x>12&&target.x<378&&target.y>70&&target.y<820)
        .slice(0,8);
    });
    console.log(`mobile raycast targets: ${targets.length}`);
    assert.ok(targets.length,'mobile scene must expose finite on-screen raycast targets');
    assert.ok(targets.every(target=>Number.isFinite(target.x)&&Number.isFinite(target.y)),'mobile raycast targets must be finite');

    // Real visual-experience gate: capture the actual composited WebGL scene at a phone viewport,
    // then inspect screenshot pixels rather than merely checking source constants.
    await mkdir('artifacts',{recursive:true});
    const screenshot=await page.locator('#canvasHost').screenshot({path:'artifacts/mobile-scene-visual.png',type:'png'});
    assert.ok(screenshot.length>5_000,'mobile WebGL scene screenshot must contain real rendered visual data');
    const screenshotUrl=`data:image/png;base64,${screenshot.toString('base64')}`;
    const visual=await page.evaluate(async src=>{
      const image=new Image();image.src=src;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('2D screenshot analysis context unavailable');
      ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let trueBlue=0,violet=0,cyan=0,white=0,greenDominant=0,bright=0;
      for(let i=0;i<data.length;i+=16){const r=data[i],g=data[i+1],b=data[i+2],a=data[i+3];if(a<180||Math.max(r,g,b)<72)continue;bright++;
        if(r>205&&g>205&&b>205)white++;
        if(b>=145&&b-g>=45&&b-r>=45&&r<g+18)trueBlue++;
        if(b>=145&&b-g>=38&&r-g>=8)violet++;
        if(b>=145&&g>=120&&b>=g&&b-g<=38&&g-r>=38)cyan++;
        if(g>=120&&g-b>=18&&g-r>=28)greenDominant++;
      }
      return{width:canvas.width,height:canvas.height,trueBlue,violet,cyan,white,greenDominant,bright};
    },screenshotUrl);
    console.log('mobile scene visual pixels',visual);
    assert.ok(visual.bright>80,'mobile scene must contain enough visible non-background rendered pixels');
    assert.ok(visual.white>=8,'real WebGL screenshot must visibly contain the white structural/core light language');
    assert.ok(visual.trueBlue>=4,'real WebGL screenshot must visibly contain true-blue pixels, not only cyan/teal');
    assert.ok(visual.violet>=4,'real WebGL screenshot must visibly contain violet outer-layer pixels');
    assert.ok(visual.trueBlue+visual.violet>visual.greenDominant,'blue/violet visual signal must outweigh green-dominant contamination in the actual scene screenshot');

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
  console.log('Mobile viewport, real scene pixels, exit navigation, raycast and UI click checks passed');
}finally{server.kill('SIGKILL');server.unref();}
