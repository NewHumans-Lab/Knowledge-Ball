import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin='http://127.0.0.1:4173/Knowledge-Ball/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1'],{stdio:'ignore'});
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
    const targets=await page.evaluate(()=>{window.__debug.scene.stop();return window.__debug.renderNodes.filter(node=>!['n1','n2','n16'].includes(node.id)).map(node=>{const point=window.__debug.scene.screenPositionForNode(node.id);return point?{...point,title:node.title}:null;}).filter(Boolean).slice(0,8);});
    console.log(`mobile raycast targets: ${targets.length}`);
    assert.ok(targets.length,'mobile scene must expose finite raycast targets');
    assert.ok(targets.every(target=>Number.isFinite(target.x)&&Number.isFinite(target.y)),'mobile raycast targets must be finite');
    await page.locator('.ai-add').click();
    await page.locator('#modalOverlay.show').waitFor({state:'visible'});
    await page.locator('#modalCancel').click();
    assert.deepEqual(errors.filter(error=>/NaN|computeBoundingSphere|pageerror/i.test(error)),[]);
    await context.close();
  }finally{await browser.close();}
  console.log('Mobile viewport raycast and UI click checks passed');
}finally{server.kill('SIGKILL');server.unref();}
