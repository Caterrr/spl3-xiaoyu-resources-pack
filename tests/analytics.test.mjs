import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import worker, {sanitizeEvent} from '../analytics/collector.mjs';
const sdk = readFileSync(new URL('../src/site-events.js', import.meta.url), 'utf8');
function browser(ua, touches=0, options={}) {
  const sent=[], tasks=[], window={addEventListener(){}}, document={addEventListener(){},visibilityState:'visible'};
  let sequence=0, clock=0;
  const context={window,document,URL,location:{protocol:'https:',hostname:'caterrr.github.io',pathname:'/spl3-xiaoyu-resources-pack/',href:'https://caterrr.github.io/spl3-xiaoyu-resources-pack/',...options.location},navigator:{userAgent:ua,maxTouchPoints:touches},crypto:{randomUUID:()=>`preview-${++sequence}`},performance:{now:()=>clock},setTimeout:fn=>{tasks.push(fn);return tasks.length;},clearTimeout(){},fetch:(_url,request)=>{sent.push(JSON.parse(request.body));return options.failFetch?Promise.reject(Error('offline')):Promise.resolve({status:204});}};
  vm.runInNewContext(sdk,context);
  return {metrics:window.Spl3Metrics,sent,flush:()=>{while(tasks.length)tasks.shift()();},tick:ms=>clock+=ms};
}
test('device classification includes iPad desktop-mode and Android tablets',()=>{
  for(const [ua,touches,device,os] of [
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/17.0 Safari/605.1',5,'tablet','iOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari/604.1',5,'mobile','iOS'],
    ['Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit Chrome/123',5,'tablet','Android'],
    ['Mozilla/5.0 (Linux; Android 14) Chrome/123 Mobile Safari/537',5,'mobile','Android'],
    ['Mozilla/5.0 (Windows NT 10.0) Chrome/123 Edg/123',0,'desktop','Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605',0,'desktop','macOS'],
  ]){const b=browser(ua,touches);b.flush();assert.equal(b.sent[0].events[0].device_type,device);assert.equal(b.sent[0].events[0].os,os);}
});
test('a ready preview is counted once, cancellation is not a failure, and downloads retain association',()=>{
  const b=browser('Windows NT Chrome/123');
  const item={id:'test-model',glbBytes:1000};
  const first=b.metrics.previewStart(item,'new');b.tick(100);first.cancel();first.ready();
  const second=b.metrics.previewStart(item,'new');b.tick(400);second.ready();second.ready();second.error();
  const download=b.metrics.downloadClick(item,'glb',second);download.ready();download.ready();download.error();b.flush();
  const events=b.sent.flatMap(batch=>batch.events);
  assert.equal(events.filter(e=>e.event==='preview_start').length,2);
  assert.equal(events.filter(e=>e.event==='preview_cancel').length,1);
  assert.equal(events.filter(e=>e.event==='preview_ready').length,1);
  assert.equal(events.filter(e=>e.event==='preview_error').length,0);
  assert.equal(events.find(e=>e.event==='preview_ready').duration_ms,400);
  assert.equal(events.find(e=>e.event==='download_click').preview_id,second.preview_id);
  assert.equal(events.filter(e=>e.event==='download_file_ready').length,1);
});
test('measurement stays disabled in local previews and does not block offline interactions',async()=>{
  assert.equal(browser('Chrome',0,{location:{hostname:'localhost',protocol:'http:'}}).metrics,undefined);
  const b=browser('Chrome',0,{failFetch:true});const attempt=b.metrics.previewStart({id:'demo'},'new');attempt.ready();b.flush();await Promise.resolve();
});
test('collector discards sensitive and arbitrary fields and rejects unsupported event types',()=>{
  const row=sanitizeEvent({event:'page_open',device_type:'mobile',os:'iOS',browser:'Safari',email:'do-not-keep',userAgent:'raw',ip:'private',model_id:'https://not-allowed/'},'/spl3-xiaoyu-resources-pack/');
  assert.equal(row.email,undefined);assert.equal(row.userAgent,undefined);assert.equal(row.ip,undefined);assert.equal(row.model_id,undefined);
  assert.equal(sanitizeEvent({event:'arbitrary'},'/spl3-xiaoyu-resources-pack/'),null);
});
test('collector accepts only the website origin, bounded batches, and exposes no report endpoint',async()=>{
  const send=(body,origin='https://caterrr.github.io')=>worker.fetch(new Request('https://example.test/events',{method:'POST',headers:{Origin:origin,'Content-Type':'text/plain'},body:JSON.stringify(body)}));
  assert.equal((await send({path:'/spl3-xiaoyu-resources-pack/',events:[{event:'page_open'}]},'https://unrelated.test')).status,403);
  assert.equal((await send({path:'/unrelated/',events:[{event:'page_open'}]})).status,400);
  assert.equal((await send({path:'/spl3-xiaoyu-resources-pack/',events:Array(9).fill({event:'page_open'})})).status,400);
  assert.equal((await send({path:'/spl3-xiaoyu-resources-pack/',events:[{event:'page_open',extra:'a'.repeat(17000)}]})).status,400);
  assert.equal((await worker.fetch(new Request('https://example.test/stats'))).status,404);
  const original=console.log,rows=[];console.log=row=>rows.push(row);
  try{assert.equal((await send({path:'/spl3-xiaoyu-resources-pack/',test:true,events:[{event:'page_open',device_type:'tablet',email:'discard'}]})).status,204);}finally{console.log=original;}
  assert.equal(rows.length,1);assert.equal(rows[0].mode,'test');assert.equal(rows[0].device_type,'tablet');assert.equal(rows[0].email,undefined);
});
