const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../license-progression.js'), 'utf8');
async function run({id='admin-a', admin=true, saved={}, blocked=false, participant=null}={}) {
  const tasks=['a-membership','b-exam','il-a-jumps-freefall','il-a-jump-count','a-check-dive','a-written','a-oral'].map(id=>({dataset:{licenseTask:id},checked:false,addEventListener(type,fn){this[type]=fn;}}));
  const handlers={};const dataset={};let authHandler;const values={...saved};let activeId=id;
  const client={auth:{getUser:async()=>({data:{user:activeId?{id:activeId}:null}}),onAuthStateChange(fn){authHandler=fn;}},rpc:async()=>({data:admin})};
  vm.runInNewContext(source,{document:{documentElement:{dataset},querySelectorAll:()=>tasks},window:{SEQUENCE_CONFIG:{},SequenceParticipant:participant?{setup(){},restore:async()=>participant}:undefined,supabase:{createClient:()=>client},addEventListener:(type,fn)=>handlers[type]=fn},setTimeout:fn=>fn(),localStorage:{getItem(key){if(blocked)throw Error();return values[key];},setItem(key,data){if(blocked)throw Error();values[key]=data;}}});
  await new Promise(resolve=>setImmediate(resolve));
  return {tasks,handlers,dataset,values,auth:event=>authHandler(event),setId:id=>{activeId=id;}};
}
test('guests and non-admin accounts see no checkboxes or saved progress',async()=>{
  for(const options of [{id:null},{admin:false}]){const h=await run(options);assert.equal(h.tasks[0].hidden,true);assert.equal(h.tasks[0].disabled,true);assert.equal(h.dataset.licenseTracking,'false');h.tasks[0].checked=true;h.tasks[0].change();assert.equal(h.tasks[0].checked,false);assert.deepEqual(h.values,{});}
});
test('verified account restores and updates its own progress; sign-out hides and clears controls',async()=>{
  const key='sequence-license-checklist-v1:admin-a';const h=await run({saved:{[key]:'{"a-membership":true,"b-exam":true}'}});
  assert.equal(h.tasks[0].hidden,false);assert.equal(h.tasks[0].checked,true);
  h.tasks[0].checked=false;h.tasks[0].change();assert.deepEqual(JSON.parse(h.values[key]),{'a-membership':false,'b-exam':true});
  h.auth('SIGNED_OUT');assert.equal(h.tasks[1].checked,false);assert.equal(h.tasks[1].hidden,true);
  h.setId('admin-b');h.auth('SIGNED_IN');await new Promise(resolve=>setImmediate(resolve));assert.equal(h.tasks[1].checked,false);assert.equal(h.tasks[1].hidden,false);
});
test('corrupt or blocked storage does not break signed-in checkbox interaction',async()=>{
  for(const value of ['invalid','null','[]','{"a-membership":"true"}'])assert.equal((await run({saved:{'sequence-license-checklist-v1:admin-a':value}})).tasks[0].checked,false);
  const h=await run({blocked:true});h.tasks[0].checked=true;assert.doesNotThrow(()=>h.tasks[0].change());assert.equal(h.tasks[0].checked,true);
});
test('cross-tab progress changes apply only to the current user',async()=>{
  const h=await run();h.handlers.storage({key:'sequence-license-checklist-v1:admin-b',newValue:'{"b-exam":true}'});assert.equal(h.tasks[1].checked,false);
  h.handlers.storage({key:'sequence-license-checklist-v1:admin-a',newValue:'{"b-exam":true}'});assert.equal(h.tasks[1].checked,true);
  h.handlers.storage({key:null});assert.equal(h.tasks[1].checked,false);
});

test('merged jump/freefall completion requires both old tasks and respects new values',async()=>{
  const key='sequence-license-checklist-v1:admin-a';
  for (const [progress,expected] of [
    [{'il-a-jumps':true,'il-a-freefall':true},true],
    [{'il-a-jumps':true,'il-a-freefall':false},false],
    [{'il-a-jumps':true},false],
    [{'il-a-jumps':true,'il-a-freefall':true,'il-a-jumps-freefall':false},false]
  ]) {
    const h=await run({saved:{[key]:JSON.stringify(progress)}});
    assert.equal(h.tasks[2].checked,expected);
  }
});

test('Israeli A jump count keeps prior completion without marking new skills',async()=>{
  const key='sequence-license-checklist-v1:admin-a';
  for(const [data,expected] of [
    [{'il-a-jumps':true},true],
    [{'il-a-jumps-freefall':true},true],
    [{'il-a-jumps':true,'il-a-jump-count':false},false]
  ]){
    const h=await run({saved:{[key]:JSON.stringify(data)}});assert.equal(h.tasks[3].checked,expected);
  }
});

test('USPA combined exam progress migrates without overriding explicit updates',async()=>{
  const key='sequence-license-checklist-v1:admin-a';
  const h=await run({saved:{[key]:JSON.stringify({'a-exams':true,'a-written':false})}});
  assert.equal(h.tasks[4].checked,true);
  assert.equal(h.tasks[5].checked,false);
  assert.equal(h.tasks[6].checked,true);
  const fresh=await run({saved:{[key]:JSON.stringify({'a-exams':false})}});
  assert.equal(fresh.tasks[4].checked,false);
});

test('verified participant can track licenses under a separate identity key',async()=>{
  const key='sequence-license-checklist-v1:participant:person-1';
  const h=await run({id:null,participant:{participant_id:'person-1'},saved:{[key]:'{"b-exam":true}'}});
  assert.equal(h.dataset.licenseTracking,'true');
  assert.equal(h.tasks[1].checked,true);
  h.tasks[0].checked=true;h.tasks[0].change();
  assert.equal(JSON.parse(h.values[key])['a-membership'],true);
  h.auth('SIGNED_OUT');assert.equal(h.tasks[1].hidden,true);
});
