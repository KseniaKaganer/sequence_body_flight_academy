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
  const calls=[]; const phoneCalls=[];
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
      if(name==='admin_update_participant_phone') { phoneCalls.push(JSON.parse(JSON.stringify(args))); return options.phoneError ? {error:{message:'Phone save failed'}} : {data:null}; }
      calls.push(JSON.parse(JSON.stringify(args)));
      if(failSave){failSave=false;return {error:{message:'Temporary network failure'}};}
      return {data:args.p_event_id};
    },from(table){
      const query={select:()=>query,eq:()=>query,order:()=>query,
        range:async()=>({data:table === 'events' ? events : people}),maybeSingle:async()=>({data:{display_name:'Admin'}})};
      return query;
    }};
  const window={location:{hash:options.route || '#events'},history:{pushState(_state,_title,hash){window.location.hash=hash;}},addEventListener(){},
    SEQUENCE_CONFIG:{},supabase:{createClient:()=>client}};
  const context={window,document:{getElementById:id=>nodes.get(id),querySelectorAll:()=>[],createElement:()=>new Element()},crypto:{randomUUID},setTimeout,console};
  vm.runInNewContext(fs.readFileSync(path.join(root,'auth.js'),'utf8'),context);
  return {nodes,calls,phoneCalls};
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
  const checkbox=el('eventParticipantChoices').children[0].children[0].children[0]; checkbox.checked=true; await checkbox.fire('change');
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
  const table=nodes.get('upcomingEventsList').children[0].children[0];
  assert.deepEqual(table.children[1].children[0].children.map(cell=>cell.textContent),['Name','Dates','Status','Event Travel']);
  const upcoming=table.children[2].children[0];
  assert.equal(upcoming.children[0].textContent,'Future Camp');
  assert.equal(upcoming.children[3].children[0].href,'https://shakshuka-travel.pages.dev/admin.html?event=future');
});
test('phones for existing and new participants are included in the atomic save', async()=>{
  const {nodes,calls}=harness(); const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));
  for(const [id,value] of Object.entries({basicEventName:'Phones',basicEventType:'tunnel',basicEventStart:'2026-01-01',basicEventEnd:'2026-01-02'}))el(id).value=value;
  el('newEventParticipant').value='Denis'; await el('queueEventParticipant').fire('click');
  const result=el('eventParticipantChoices').children[0];
  await result.children[1].fire('click');
  const phone=result.children[2].children[0]; phone.value='050-999';
  await result.children[2].children[1].fire('click');
  el('newEventParticipant').value='New Person'; el('newEventParticipantPhone').value='052-777'; await el('queueEventParticipant').fire('click');
  await el('basicEventForm').fire('submit');
  assert.deepEqual(calls[0].p_participant_phones,[], 'existing phone was already saved separately');
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

test('pencil and checkmark save an existing phone immediately without selecting or creating an event', async()=>{
  const {nodes,calls,phoneCalls}=harness();
  await new Promise(resolve=>setImmediate(resolve));
  const row=nodes.get('eventParticipantChoices').children[0];
  const [label,edit,editor,message]=row.children;
  assert.equal(editor.hidden,true);
  await edit.fire('click'); assert.equal(editor.hidden,false);
  editor.children[0].value='052-1234567';
  await editor.children[1].fire('click');
  assert.deepEqual(phoneCalls,[{p_participant_id:'denis',p_original_phone:'050-123',p_phone:'052-1234567'}]);
  assert.equal(calls.length,0); assert.equal(editor.hidden,true); assert.equal(message.textContent,'Saved');
  assert.match(label.children[1].textContent,/052-1234567/);
});
test('phone errors preserve the inline editor and cancel does not save', async()=>{
  const {nodes,phoneCalls}=harness({phoneError:true});
  await new Promise(resolve=>setImmediate(resolve));
  const row=nodes.get('eventParticipantChoices').children[0];
  await row.children[1].fire('click');
  row.children[2].children[0].value='052-1234567';
  await row.children[2].children[1].fire('click');
  assert.equal(row.children[2].hidden,false);
  assert.equal(row.children[3].textContent,'Phone save failed');
  await row.children[2].children[2].fire('click');
  assert.equal(row.children[2].hidden,true); assert.equal(phoneCalls.length,1);
});
test('new participant name and surname are sent separately and displayed together', async()=>{
  const {nodes,calls}=harness(); const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));
  for(const [id,value] of Object.entries({basicEventName:'Names',basicEventType:'skydive',basicEventStart:'2026-01-01',basicEventEnd:'2026-01-02',newEventParticipant:'Anna Maria',newEventParticipantSurname:'De Silva'})) el(id).value=value;
  await el('queueEventParticipant').fire('click');
  assert.match(el('eventSelectedParticipants').children[0].children[1].textContent,/Anna Maria De Silva/);
  assert.equal(el('newEventParticipantSurname').value,'');
  await el('basicEventForm').fire('submit');
  assert.deepEqual(calls[0].p_new_names,['Anna Maria']);
  assert.deepEqual(calls[0].p_new_surnames,['De Silva']);
});
test('separate name and surname still match an existing full name', async()=>{
  const {nodes}=harness(); const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));
  el('newEventParticipant').value='Denis';
  await el('queueEventParticipant').fire('click');
  assert.doesNotMatch(el('eventSelectedParticipants').children[0].children[1].textContent,/new/);
});

test('selected participants have a left remove icon and an editable compact new-person row', async()=>{
  const {nodes}=harness(); const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));
  el('newEventParticipant').value='Anna'; el('newEventParticipantSurname').value='Smith';
  await el('queueEventParticipant').fire('click');
  let row=el('eventSelectedParticipants').children[0];
  assert.equal(row.children[0].textContent,'×');
  assert.equal(row.children[1].textContent,'Anna Smith (new)');
  assert.equal(row.children[3].hidden,true);
  await row.children[2].fire('click'); assert.equal(row.children[3].hidden,false);
  row.children[3].children[1].value='Jones'; await row.children[3].children[3].fire('click');
  row=el('eventSelectedParticipants').children[0];
  assert.equal(row.children[1].textContent,'Anna Jones (new)');
  await row.children[0].fire('click'); assert.equal(el('eventSelectedParticipants').children.length,0);
});

test('Activities restores the selected subtab and switches back to existing Travel tools', async()=>{
  const {nodes}=harness({route:'#activities/flybox'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(nodes.get('activitiesPage').hidden,false);
  assert.equal(nodes.get('activityFlyboxPanel').hidden,false);
  assert.equal(nodes.get('activityTravelPanel').hidden,true);
  assert.equal(nodes.get('activityFlyboxTab')['aria-selected'],'true');
  await nodes.get('activityTravelTab').fire('click');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(nodes.get('activityFlyboxPanel').hidden,true);
  assert.equal(nodes.get('activityTravelPanel').hidden,false);
  assert.equal(nodes.get('upcomingEventsTitle').textContent,'Upcoming (1)');
});
test('invalid category falls back to Travel', async()=>{
  const {nodes}=harness({route:'#activities/unknown'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(nodes.get('activityTravelPanel').hidden,false);
  assert.equal(nodes.get('activitySocialPanel').hidden,true);
});
