const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','admin-session-bridge.js'),'utf8');
const SEQUENCE='https://sequence-body-flight-academy.pages.dev',TRAVEL='https://shakshuka-travel.pages.dev';
const nonce='12345678-1234-1234-1234-123456789abc';
function setup({admin=true,popup=true}={}){
 const timers=new Map();let next=0;const sent=[],received=[],signouts=[];
 function surface(url){const listeners=new Map();return{location:new URL(url),opener:null,
  addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
  removeEventListener(name,fn){listeners.get(name)?.delete(fn);},
  async emit(event){await Promise.all([...(listeners.get('message')||[])].map(fn=>fn(event)));},
  history:{replaceState(_state,_title,url){this.owner.location=new URL(url,this.owner.location);}},listeners};}
 const parent=surface(SEQUENCE+'/index.html'),child=surface(TRAVEL+'/admin.html');parent.history.owner=parent;child.history.owner=child;
 parent.open=(url)=>{parent.opened=url;child.location=new URL(url);child.opener=parent;return popup?child:null;};
 parent.postMessage=(data,target)=>{sent.push({direction:'ready',data,target});void parent.emit({data,origin:TRAVEL,source:child});};
 child.postMessage=(data,target)=>{sent.push({direction:'session',data,target});void child.emit({data,origin:SEQUENCE,source:parent});};
 const sourceClient={auth:{getSession:async()=>({data:{session:{access_token:'access-sample',refresh_token:'refresh-sample'}}})}};
 const destinationClient={auth:{setSession:async data=>{received.push(data);return{error:null};},getUser:async()=>({data:{user:{id:'user'}}}),signOut:async args=>{signouts.push(args);return{};}},rpc:async()=>({data:admin,error:null})};
 const globals=window=>({window,URL,URLSearchParams,crypto:{randomUUID:()=>nonce},setTimeout:fn=>{const id=++next;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
 vm.runInNewContext(source,globals(parent));vm.runInNewContext(source,globals(child));
 return{parent,child,sent,received,signouts,timers,sourceClient,destinationClient};
}
test('trusted window handoff keeps event links, excludes URL credentials and persists via Supabase',async()=>{
 const t=setup();t.parent.SequenceAdminSession.openTravel(t.sourceClient,()=>true,TRAVEL+'/admin.html?event=camp');
 const url=new URL(t.parent.opened);assert.equal(url.searchParams.get('event'),'camp');assert.equal(url.hash,'#sequence-admin-handoff='+nonce);
 assert.ok(!t.parent.opened.includes('access-sample'));assert.ok(!t.parent.opened.includes('refresh-sample'));
 assert.equal(await t.child.SequenceAdminSession.receive(t.destinationClient),true);assert.equal(t.received.length,1);
 assert.equal(t.received[0].access_token,'access-sample');assert.equal(t.child.location.hash,'');assert.equal(t.child.location.search,'?event=camp');assert.equal(t.child.opener,null);
 assert.equal(t.sent.find(x=>x.direction==='session').target,TRAVEL);
 await t.parent.emit({origin:TRAVEL,source:t.child,data:{protocol:'sequence-admin-session-v1',action:'ready',nonce}});
 assert.equal(t.sent.filter(x=>x.direction==='session').length,1,'nonce cannot be replayed');
});
test('parent refuses untrusted origins, sources and unknown nonces',async()=>{
 const t=setup();t.parent.SequenceAdminSession.openTravel(t.sourceClient,()=>true,TRAVEL+'/');
 const data={protocol:'sequence-admin-session-v1',action:'ready',nonce};
 await t.parent.emit({origin:'https://evil.test',source:t.child,data});
 await t.parent.emit({origin:TRAVEL,source:{},data});
 await t.parent.emit({origin:TRAVEL,source:t.child,data:{...data,nonce:'unknown'}});
 assert.equal(t.sent.length,0);
});
test('only verified admins and allowed destinations can start handoffs',()=>{
 const t=setup();assert.equal(t.parent.SequenceAdminSession.openTravel(t.sourceClient,()=>false,TRAVEL+'/'),null);
 assert.equal(t.parent.SequenceAdminSession.openTravel(t.sourceClient,()=>true,'https://evil.test/'),null);
 assert.equal(t.parent.SequenceAdminSession.openTravel(t.sourceClient,()=>true,TRAVEL+'/event.html'),null);
 assert.equal(setup({popup:false}).parent.SequenceAdminSession.openTravel(t.sourceClient,()=>true,TRAVEL+'/'),null);
});
test('Travel independently rejects non-admin sessions',async()=>{
 const t=setup({admin:false});t.parent.SequenceAdminSession.openTravel(t.sourceClient,()=>true,TRAVEL+'/');
 assert.equal(await t.child.SequenceAdminSession.receive(t.destinationClient),false);assert.equal(t.signouts[0].scope,'local');
});
test('an expired handoff falls back to the usual login',async()=>{
 const t=setup();t.parent.SequenceAdminSession.openTravel(t.sourceClient,()=>true,TRAVEL+'/');
 t.parent.postMessage=()=>{};
 const result=t.child.SequenceAdminSession.receive(t.destinationClient);
 for(const fn of [...t.timers.values()])fn();
 assert.equal(await result,false);assert.equal(t.received.length,0);
});
test('receiver ignores spoofed messages before accepting the exact trusted parent',async()=>{
 const t=setup();t.parent.SequenceAdminSession.openTravel(t.sourceClient,()=>true,TRAVEL+'/');
 t.parent.postMessage=()=>{};const result=t.child.SequenceAdminSession.receive(t.destinationClient);
 const data={protocol:'sequence-admin-session-v1',action:'session',nonce,access_token:'access-sample',refresh_token:'refresh-sample'};
 await t.child.emit({origin:'https://evil.test',source:t.parent,data});
 await t.child.emit({origin:SEQUENCE,source:{},data});
 await t.child.emit({origin:SEQUENCE,source:t.parent,data:{...data,nonce:'wrong'}});
 assert.equal(t.received.length,0);
 await t.child.emit({origin:SEQUENCE,source:t.parent,data});assert.equal(await result,true);
});
