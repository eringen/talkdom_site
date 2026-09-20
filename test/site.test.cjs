const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function waitFor(check) { for(let i=0;i<40;i++) { if(check()) return; await flush(); } assert.ok(check(), 'condition completed'); }
function setup(t, page='browser.html') {
 const errors=[];
 const dom = new JSDOM(read(page), {url:'https://site.test/'+page, runScripts:'outside-only', virtualConsole:new VirtualConsole().on('jsdomError', e=>errors.push(e))});
 const w=dom.window, calls=[], delays=new Map(), failures=new Set();
 w.fetch = async (url, options={}) => {
  const pathname=new URL(url,w.location.href).pathname;
  calls.push(pathname);
  const text = read(pathname.slice(1));
  const hold=delays.get(pathname); if(hold) await hold.promise;
  // Deliberately ignore AbortSignal to exercise stale-response guards too.
  return {ok:!failures.has(pathname),status:failures.has(pathname)?500:200,headers:{get:()=>null},text:()=>Promise.resolve(text)};
 };
 w.eval(read('talkdom.js')); w.eval(read('site.js'));
 t.after(async()=>{w.document.replaceChildren();await flush();w.close();assert.deepEqual(errors,[]);});
 const button=(selector,text)=>[...w.document.querySelectorAll(selector)].find(el=>el.textContent.trim()===text);
 const title=()=>w.document.querySelector('[data-api-detail] h2')?.textContent;
 const active=selector=>[...w.document.querySelectorAll(selector+'[aria-pressed="true"]')].map(el=>el.textContent.trim());
 const hold=pathname=>{let release;const promise=new Promise(resolve=>release=resolve);delays.set(pathname,{promise});return ()=>{delays.delete(pathname);release();};};
 return {w,calls,button,title,active,hold,failures};
}

test('standalone initializes once and highlights exactly the displayed entry',async t=>{
 const e=setup(t);await waitFor(()=>e.title()==='get:');
 assert.deepEqual(e.active('[data-category]'),['HTTP Methods']);assert.deepEqual(e.active('[data-item]'),['get:']);
 e.button('[data-item]','put:').click();await waitFor(()=>e.title()==='put:');
 assert.deepEqual(e.active('[data-item]'),['put:']);
 assert.equal(e.calls.filter(url=>url.includes('categories/http-methods')).length,1);
});

test('fragment entry initializes without executing scripts in the fragment',async t=>{
 const e=setup(t,'docs.html');
 const nav=e.w.document.querySelector('a[href="/browser.html"]');nav.click();
 await waitFor(()=>e.title()==='get:');
 assert.equal(e.w.document.querySelectorAll('[data-api-browser]').length,1);
 assert.deepEqual(e.active('[data-item]'),['get:']);
});

test('rapid category changes ignore the older category response',async t=>{
 const e=setup(t);await waitFor(()=>e.title()==='get:');
 const release=e.hold('/partials/browser/categories/combined-methods.html');
 e.button('[data-category]','Combined').click();e.button('[data-category]','API').click();
 await waitFor(()=>e.title()==='talkDOM.send()');release();await flush();await flush();
 assert.equal(e.title(),'talkDOM.send()');assert.deepEqual(e.active('[data-category]'),['API']);assert.deepEqual(e.active('[data-item]'),['talkDOM.send()']);
});

test('rapid item clicks ignore older detail responses',async t=>{
 const e=setup(t);await waitFor(()=>e.title()==='get:');
 const release=e.hold('/partials/browser/details/post.html');
 e.button('[data-item]','post:').click();e.button('[data-item]','delete:').click();
 await waitFor(()=>e.title()==='delete:');release();await flush();await flush();
 assert.equal(e.title(),'delete:');assert.deepEqual(e.active('[data-item]'),['delete:']);
});

test('changing category cancels its old pending default detail',async t=>{
 const e=setup(t);await waitFor(()=>e.title()==='get:');
 const release=e.hold('/partials/browser/details/get-apply.html');
 e.button('[data-category]','Combined').click();await waitFor(()=>e.w.document.querySelector('[data-item]')?.textContent==='get:apply:');
 e.button('[data-category]','DOM').click();await waitFor(()=>e.title()==='apply:');
 release();await flush();await flush();assert.equal(e.title(),'apply:');assert.deepEqual(e.active('[data-item]'),['apply:']);
});

test('failure clears old detail and clicking again retries successfully',async t=>{
 const e=setup(t);await waitFor(()=>e.title()==='get:');
 const url='/partials/browser/details/post.html';e.failures.add(url);
 e.button('[data-item]','post:').click();await waitFor(()=>e.w.document.querySelector('[data-api-detail] [role="alert"]'));
 assert.equal(e.title(),undefined);assert.deepEqual(e.active('[data-item]'),['post:']);
 e.failures.delete(url);e.button('[data-item]','post:').click();await waitFor(()=>e.title()==='post:');
});

test('Back restores the category and selected item without duplicate initialization',async t=>{
 const e=setup(t,'docs.html');e.w.document.querySelector('a[href="/browser.html"]').click();await waitFor(()=>e.title()==='get:');
 e.button('[data-category]','API').click();await waitFor(()=>e.title()==='talkDOM.send()');
 e.button('[data-item]','talkDOM.config').click();await waitFor(()=>e.title()==='talkDOM.config');
 e.w.document.querySelector('a[href="/docs.html"]').click();await waitFor(()=>!e.w.document.querySelector('[data-api-browser]'));
 await new Promise(resolve=>{e.w.addEventListener('popstate',resolve,{once:true});e.w.history.back();});
 await waitFor(()=>e.title()==='talkDOM.config');assert.deepEqual(e.active('[data-category]'),['API']);assert.deepEqual(e.active('[data-item]'),['talkDOM.config']);
 const before=e.calls.length;e.button('[data-item]','talkDOM.deliver()').click();await waitFor(()=>e.title()==='talkDOM.deliver()');assert.equal(e.calls.length-before,1);
});

test('every category and item resolves to a matching reference with one highlight',async t=>{
 const e=setup(t);await waitFor(()=>e.title()==='get:');
 for(const category of [...e.w.document.querySelectorAll('[data-category]')]) {
  category.click();await waitFor(()=>e.w.document.querySelector('[data-api-items]').getAttribute('aria-busy')==='false' && e.w.document.querySelector('[data-api-detail]').getAttribute('aria-busy')==='false');
  for(const item of [...e.w.document.querySelectorAll('[data-item]')]) {
   item.click();await waitFor(()=>e.w.document.querySelector('[data-api-detail]').getAttribute('aria-busy')==='false');
   const expected=new JSDOM(read(item.dataset.item.slice(1))).window.document.querySelector('h2').textContent;
   assert.equal(e.title(),expected);assert.equal(e.active('[data-item]').length,1);
  }
 }
});

test('standalone docs, examples and browser bodies match their fragments',()=>{
 for(const page of ['browser','docs','examples']) {
  const full=new JSDOM(read(page+'.html'));const fragment=read('partials/'+page+'-content.html');
  assert.equal(full.window.document.querySelector('main').innerHTML.trim(),new JSDOM(fragment).window.document.body.innerHTML.trim());
  assert.equal(full.window.document.querySelector('script[src="/talkdom.js"]')!==null,true);
  assert.equal(full.window.document.querySelector('script[src="/site.js"]')!==null,true);
  full.window.close();
 }
});

test('loading demo is registered for fetched examples and cleans up on completion',async t=>{
 const e=setup(t,'docs.html');e.w.document.querySelector('a[href="/examples.html"]').click();await waitFor(()=>e.w.document.querySelector('[receiver="demo6a"]'));
 const box=e.w.document.querySelector('[receiver="demo6a"]'),release=e.hold('/partials/demos/hello.html');
 const pending=e.w.talkDOM.send('demo6a get: /partials/demos/hello.html apply: inner loading: demo-loading');
 assert.equal(box.classList.contains('demo-loading'),true);release();await pending;assert.equal(box.classList.contains('demo-loading'),false);assert.ok(box.textContent.includes('Hello'));
});
