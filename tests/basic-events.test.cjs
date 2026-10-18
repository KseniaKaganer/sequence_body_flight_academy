const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
function harness(options = {}) {
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
  const events = [
    {id:'future',name:'Future Camp',event_type:'tunnel',start_date:'2099-01-01',end_date:'2099-01-07',status:'draft'},
    {id:'past',name:'Old Camp',event_type:'skydive',start_date:'2020-01-01',end_date:'2020-01-07',status:'draft'},
    {id:'completed',name:'Completed Camp',event_type:'skydive',start_date:'2099-02-01',end_date:'2099-02-07',status:'completed'}
  ];
  const client={auth:{getSession:async()=>({data:{session:{}}}),getUser:async()=>({data:{user:{id:'admin'}}}),onAuthStateChange(){}},
    rpc:async(name,args)=>{
      if(name==='is_admin')return {data:true};
      calls.push(JSON.parse(JSON.stringify(args)));
      if(failSave){failSave=false;return {error:{message:'Temporary network failure'}};}
      return {data:args.p_event_id};
    },from(table){
      const query={select:()=>query,eq:()=>query,order:()=>query,
        range:async()=>({data:table === 'events' ? events : people}),maybeSingle:async()=>({data:{display_name:'Admin'}})};
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

test('Travel events include drafts and split completed/past events from upcoming events', async()=>{
  const {nodes}=harness();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(nodes.get('upcomingEventsTitle').textContent,'Upcoming (1)');
  assert.equal(nodes.get('pastEventsTitle').textContent,'Past (2)');
  const upcoming=nodes.get('upcomingEventsList').children[0];
  assert.equal(upcoming.children[0].children[0].textContent,'Future Camp');
  assert.equal(upcoming.children[1].href,'https://shakshuka-travel.pages.dev/admin.html?event=future');
});
test('phones for existing and new participants are included in the atomic save', async()=>{
  const {nodes,calls}=harness(); const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));
  for(const [id,value] of Object.entries({basicEventName:'Phones',basicEventType:'tunnel',basicEventStart:'2026-01-01',basicEventEnd:'2026-01-02'}))el(id).value=value;
  el('newEventParticipant').value='Denis'; await el('queueEventParticipant').fire('click');
  let phone=el('eventSelectedParticipants').children[0].children[0].children[0];
  phone.value='050-999'; await phone.fire('input');
  el('newEventParticipant').value='New Person'; el('newEventParticipantPhone').value='052-777'; await el('queueEventParticipant').fire('click');
  await el('basicEventForm').fire('submit');
  assert.deepEqual(calls[0].p_participant_phones,[{id:'denis',phone:'050-999',original_phone:'050-123'}]);
  assert.deepEqual(calls[0].p_new_phones,['052-777']);
});
test('a queued new name cannot reuse another participant phone', async()=>{
  const {nodes,calls}=harness(); const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));
  el('newEventParticipant').value='Someone Else'; el('newEventParticipantPhone').value='50-123';
  await el('queueEventParticipant').fire('click');
  assert.match(el('basicEventStatus').textContent,/phone belongs to an existing/);
  assert.equal(el('eventSelectedParticipants').children.length,0);
  assert.equal(calls.length,0);
});
