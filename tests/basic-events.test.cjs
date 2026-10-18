const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
function harness() {
  const nodes = new Map();
  class Element {
    constructor() { this.value=''; this.hidden=false; this.children=[]; this.listeners={}; this.dataset={}; }
    addEventListener(event, listener) { (this.listeners[event] ||= []).push(listener); }
    async fire(event) { for(const fn of this.listeners[event] || []) await fn({preventDefault(){},key:''}); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children=children; }
    setAttribute(name,value) { this[name]=value; }
    removeAttribute(name) { delete this[name]; }
    reportValidity() { return true; }
    reset() { for(const [id,node] of nodes) if(id.startsWith('basicEvent') || id==='newEventParticipant') node.value=''; nodes.get('basicEventType').value='skydive'; }
    close() {} showModal() {} focus() {}
  }
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const match of html.matchAll(/id="([^"]+)"/g)) nodes.set(match[1],new Element());
  const calls=[];
  let failSave=true;
  const people=[{id:'denis',display_name:'Denis',surname:'',phone:'050-123',email:''},
    {id:'nadia',display_name:'Nadia',surname:'',phone:'050-456',email:''},
    {id:'nadia-copy',display_name:'Nadia',surname:'',phone:'50-456',email:''}];
  const client={auth:{getSession:async()=>({data:{session:{}}}),getUser:async()=>({data:{user:{id:'admin'}}}),onAuthStateChange(){}},
    rpc:async(name,args)=>{
      if(name==='is_admin')return {data:true};
      calls.push(JSON.parse(JSON.stringify(args)));
      if(failSave){failSave=false;return {error:{message:'Temporary network failure'}};}
      return {data:args.p_event_id};
    },from(){
      const query={select:()=>query,eq:()=>query,order:()=>query,
        range:async()=>({data:people}),maybeSingle:async()=>({data:{display_name:'Admin'}})};
      return query;
    }};
  const window={location:{hash:'#events'},history:{pushState(){}},addEventListener(){},
    SEQUENCE_CONFIG:{},supabase:{createClient:()=>client}};
  const context={window,document:{getElementById:id=>nodes.get(id),querySelectorAll:()=>[],createElement:()=>new Element()},crypto:{randomUUID},setTimeout,console};
  vm.runInNewContext(fs.readFileSync(path.join(root,'auth.js'),'utf8'),context);
  return {nodes,calls};
}
test('basic events reuse existing people, group phones and retry the same atomic save', async()=>{
  const {nodes,calls}=harness();
  const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(el('eventParticipantChoices').children.length,2);
  for(const [id,value] of Object.entries({basicEventName:'Florida 26',basicEventType:'skydive',basicEventStart:'2026-04-07',basicEventEnd:'2026-04-11'}))el(id).value=value;
  el('newEventParticipant').value='Denis'; await el('queueEventParticipant').fire('click');
  el('newEventParticipant').value='New Person'; await el('queueEventParticipant').fire('click');
  el('eventParticipantSearch').value='Nadia'; await el('eventParticipantSearch').fire('input');
  const checkbox=el('eventParticipantChoices').children[0].children[0]; checkbox.checked=true; await checkbox.fire('change');
  await el('basicEventForm').fire('submit');
  assert.equal(el('basicEventStatus').textContent,'Temporary network failure');
  assert.equal(el('basicEventName').value,'Florida 26');
  await el('basicEventForm').fire('submit');
  assert.equal(calls.length,2);
  assert.deepEqual(calls[0],calls[1]);
  assert.deepEqual(calls[1].p_participant_ids,['denis','nadia']);
  assert.deepEqual(calls[1].p_new_names,['New Person']);
  assert.equal(el('basicEventTravelLink').href,'https://shakshuka-travel.pages.dev/admin.html?event='+calls[1].p_event_id);
  assert.equal(el('basicEventTravelLink').hidden,false);
  assert.equal(el('basicEventName').value,'');
});
test('invalid date range and unqueued names do not send a save', async()=>{
  const {nodes,calls}=harness(); const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));
  el('basicEventName').value='Test'; el('basicEventStart').value='2026-05-02'; el('basicEventEnd').value='2026-05-01';
  await el('basicEventForm').fire('submit'); assert.equal(calls.length,0);
  el('basicEventEnd').value='2026-05-03';
  el('newEventParticipant').value='Denis'; await el('queueEventParticipant').fire('click');
  el('newEventParticipant').value='Unsaved Person';
  await el('basicEventForm').fire('submit'); assert.equal(calls.length,0);
  assert.match(el('basicEventStatus').textContent,/Click Add participant/);
});
