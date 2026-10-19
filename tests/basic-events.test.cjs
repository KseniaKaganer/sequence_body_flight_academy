const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
function harness(options = {}) {
  const nodes = new Map(); const documentEvents = {}; const travelOpens = [];
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
  const addRequestCalls=[];const gearCalls=[];const gearProfiles=options.gearProfiles || [];const requestCalls=[];const requestRows=[];let failedAddition=false;const calls=[]; const phoneCalls=[]; const localCalls=[]; const localRows=options.activities || []; const localMemberships=options.localMemberships || []; const travelMemberships=options.travelMemberships || [];
  let failSave=true;
  const people=options.people || [{id:'denis',display_name:'Denis',surname:'',phone:'050-123',email:''},
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
      if(name==='admin_save_participant_gear') {
        gearCalls.push(JSON.parse(JSON.stringify(args)));if(options.gearError)return {error:{message:'Gear changed elsewhere'}};
        const current=gearProfiles.find(p=>p.participant_id===args.p_participant_id);
        const row={participant_id:args.p_participant_id,canopy_size:args.p_canopy_size,reserve_size:args.p_reserve_size,reserve_date:args.p_reserve_date,reserve_rental:args.p_reserve_rental,notes:args.p_notes,updated_at:'2026-10-19T10:00:00Z'};
        if(current)Object.assign(current,row);else gearProfiles.push(row);return {data:row.updated_at};
      }
      if(name==='admin_list_sequence_coaches')return {data:[{user_id:'admin-ilya',display_name:'Ilya'},{user_id:'admin-ksenia',display_name:'Ksenia'}]};
      if(name==='admin_add_sequence_request_participants') {
        addRequestCalls.push(JSON.parse(JSON.stringify(args)));
        if(options.failAddition && !failedAddition){failedAddition=true;return {error:{message:'Add failed'}};}
        const request=requestRows.find(row=>row.id===args.p_request_id);
        for(const id of args.p_participant_ids)if(!request.sequence_request_participants.some(link=>link.participant_id===id))request.sequence_request_participants.push({participant_id:id,participants:people.find(person=>person.id===id)});
        for(const person of args.p_new_participants)request.sequence_request_participants.push({participant_id:'new-added-person',participants:{display_name:person.name,surname:person.surname}});
        return {data:args.p_request_id};
      }
      if(name==='admin_create_sequence_request') {
        requestCalls.push(JSON.parse(JSON.stringify(args)));
        if(failSave){failSave=false;return {error:{message:'Temporary network failure'}};}
        const members=args.p_participant_ids.map(id=>({participant_id:id,participants:people.find(person=>person.id===id)}));
        for(const person of args.p_new_participants)members.push({participant_id:'new-request-person',participants:{display_name:person.name,surname:person.surname}});
        requestRows.push({id:args.p_request_id,request_type:args.p_type,notes:args.p_notes,status:'new',created_at:'2026-10-18T19:00:00Z',sequence_request_participants:members});
        return {data:args.p_request_id};
      }
      if(name==='admin_create_sequence_activity_v2') {
        localCalls.push(JSON.parse(JSON.stringify(args)));
        if(failSave){failSave=false;return {error:{message:'Temporary network failure'}};}
        localRows.push({id:args.p_activity_id,title:args.p_title,start_date:args.p_start_date,end_date:args.p_end_date,
          category:args.p_category,location:args.p_location,coach:args.p_coach_user_id === 'admin-ilya' ? 'Ilya' : null,notes:args.p_notes,sequence_activity_participants:[{count:args.p_participant_ids.length}]});
        for (const id of args.p_participant_ids) localMemberships.push({activity_id:args.p_activity_id,participant_id:id,sequence_activities:localRows[localRows.length-1]});
        return {data:args.p_activity_id};
      }
      if(name==='admin_update_participant_phone') { phoneCalls.push(JSON.parse(JSON.stringify(args))); return options.phoneError ? {error:{message:'Phone save failed'}} : {data:null}; }
      calls.push(JSON.parse(JSON.stringify(args)));
      if(failSave){failSave=false;return {error:{message:'Temporary network failure'}};}
      return {data:args.p_event_id};
    },from(table){
      let filter = null;
      const query={select:()=>query,eq:()=>query,order:()=>query,
        in:(field,values)=>{filter={field,values};return query;},
        range:async(start,end)=>{
          const rows = table === 'participant_gear_profiles' ? gearProfiles : table === 'sequence_requests' ? requestRows : table === 'events' ? events : table === 'sequence_activities' ? localRows
            : table === 'sequence_activity_participants' ? localMemberships
            : table === 'event_participants' ? travelMemberships : table === 'participant_manual_skills' ? [] : people;
          return {data:rows.filter(row=>!filter || filter.values.includes(row[filter.field])).slice(start,end+1)};
        },maybeSingle:async()=>({data:{display_name:'Admin'}})};
      return query;
    }};
  const window={location:{hash:options.route || '#events'},history:{pushState(_state,_title,hash){window.location.hash=hash;}},events:{},addEventListener(name,fn){this.events[name]=fn;},
    SEQUENCE_CONFIG:{},supabase:{createClient:()=>client}};
  window.SequenceAdminSession={openTravel:(_client,isAdmin,url)=>{travelOpens.push({admin:isAdmin(),url});return options.blockPopup ? null : {};}};
  const context={URL,window,document:{addEventListener:(name,fn)=>{documentEvents[name]=fn;},getElementById:id=>nodes.get(id),querySelectorAll:()=>[],createElement:()=>new Element()},crypto:{randomUUID},setTimeout,console};
  vm.runInNewContext(fs.readFileSync(path.join(root,'auth.js'),'utf8'),context);
  return {nodes,calls,phoneCalls,localCalls,requestCalls,addRequestCalls,gearCalls,travelOpens,clickTravel:href=>{let prevented=false;documentEvents.click({target:{closest:()=>({href})},button:0,preventDefault(){prevented=true;}});return prevented;},navigate:async hash=>{window.location.hash=hash;window.events.hashchange();await new Promise(resolve=>setImmediate(resolve));}};
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


for (const category of ['Skydive','Theory','Flybox','Social']) {
  test(`Add Activity opens the basic form for ${category}`, async()=>{
    const {nodes}=harness({route:'#activities/'+category.toLowerCase()});
    await new Promise(resolve=>setImmediate(resolve));
    await nodes.get('add'+category+'Activity').fire('click');
    assert.match(nodes.get('localActivityTitle').textContent,new RegExp(category==='Skydive'?'Skydive Coaching':category));
    assert.match(nodes.get('localActivityStart').value,/^\d{4}-\d{2}-\d{2}$/);
    assert.equal(nodes.get('localActivityPeople').children.length,2);
    assert.equal(nodes.get('saveLocalActivity').disabled,false);
  });
}
test('local activity save keeps the category, selected people and retry ID, then reloads its list', async()=>{
  const {nodes,localCalls}=harness({route:'#activities/theory'}); const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));
  await el('addTheoryActivity').fire('click');
  el('localActivityName').value='Packing lesson'; el('localActivityNotes').value='Bring a rig';
  el('localActivityCoach').value='admin-ilya';
  const check=el('localActivityPeople').children[0].children[0].children[0]; check.checked=true; await check.fire('change');
  await el('localActivityForm').fire('submit');
  assert.equal(el('localActivityStatus').textContent,'Temporary network failure');
  assert.equal(el('localActivityName').value,'Packing lesson');
  await el('localActivityForm').fire('submit');
  assert.deepEqual(localCalls[0],localCalls[1]);
  assert.equal(localCalls[1].p_category,'theory');
  assert.equal(localCalls[1].p_end_date,localCalls[1].p_start_date);
  assert.deepEqual(localCalls[1].p_participant_ids,['denis']);
  assert.equal(el('theoryActivitiesList').children[0].children[0].textContent,'Upcoming (1)');
});
test('local activity rejects reversed dates without writing', async()=>{
  const {nodes,localCalls}=harness({route:'#activities/social'}); const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve)); await el('addSocialActivity').fire('click');
  el('localActivityName').value='Sailing'; el('localActivityStart').value='2026-10-20'; el('localActivityEnd').value='2026-10-19';
  await el('localActivityForm').fire('submit'); assert.equal(localCalls.length,0);
  assert.match(el('localActivityStatus').textContent,/valid dates/);
});


test('local sections use tables and retain drafts when the add form is collapsed', async()=>{
  const {nodes}=harness({route:'#activities/theory'}); const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));
  await el('addTheoryActivity').fire('click');
  assert.equal(el('addTheorySection').open,true);
  assert.equal(el('localActivityDialog').hidden,false);
  el('localActivityName').value='Packing draft';
  await el('addTheoryActivity').fire('click');
  assert.equal(el('addTheorySection').open,false);
  await el('addTheoryActivity').fire('click');
  assert.equal(el('localActivityName').value,'Packing draft');
  await el('localActivityForm').fire('submit');
  await el('localActivityForm').fire('submit');
  assert.equal(el('theoryActivitiesCount').textContent,'Theory (1)');
  const table=el('theoryActivitiesList').children[0].children[1].children[0];
  assert.deepEqual(table.children[1].children[0].children.map(cell=>cell.textContent),['Name','Dates','Status','Participants']);
});


test('category and activity filters find grouped participants, whose Skills show assigned activities once', async()=>{
  const activity={id:'packing',title:'Packing Lesson',category:'theory',start_date:'2026-01-01',end_date:'2026-01-01',coach:'Ilya'};
  const {nodes}=harness({route:'#participants',localMemberships:[
    {activity_id:'packing',participant_id:'nadia-copy',sequence_activities:activity},
    {activity_id:'packing',participant_id:'nadia',sequence_activities:activity}
  ]}); const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));
  el('participantCategoryFilter').value='theory'; await el('participantCategoryFilter').fire('change');
  assert.equal(el('participantsListTitle').textContent,'Participants (1 / 2)');
  assert.equal(el('participantsList').children[0].children[0].textContent,'Nadia');
  el('participantActivityFilter').value='local:packing'; await el('participantActivityFilter').fire('change');
  await el('participantsList').children[0].fire('click');
  await new Promise(resolve=>setImmediate(resolve));
  const section=el('participationHistory').children[0];
  assert.equal(section.children[0].textContent,'Participation (1)');
  const row=section.children[1].children[1].children[0];
  assert.deepEqual(row.children.map(cell=>cell.textContent),['Packing Lesson','Theory','01/01/2026','Past','Ilya']);
  await el('clearParticipantFilters').fire('click');
  assert.equal(el('participantsListTitle').textContent,'Participants (2)');
});
test('Travel filter excludes cancelled memberships and combines with search', async()=>{
  const event={id:'camp',name:'Camp',start_date:'2026-01-01',status:'draft'};
  const {nodes}=harness({route:'#participants',travelMemberships:[
    {id:'one',participant_id:'denis',participant_status:'active',events:event},
    {id:'two',participant_id:'nadia',participant_status:'cancelled',events:event}
  ]});const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));
  el('participantCategoryFilter').value='travel'; await el('participantCategoryFilter').fire('change');
  assert.equal(el('participantsList').children[0].children[0].textContent,'Denis');
  el('participantSearch').value='Nadia';await el('participantSearch').fire('input');
  assert.equal(el('participantsListTitle').textContent,'Participants (0 / 2)');
});
test('saving an activity with a participant makes it appear in that participant Skills', async()=>{
  const {nodes,navigate}=harness({route:'#activities/flybox'}); const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));await el('addFlyboxActivity').fire('click');
  el('localActivityName').value='Tunnel coaching';
  const check=el('localActivityPeople').children[0].children[0].children[0];check.checked=true;await check.fire('change');
  await el('localActivityForm').fire('submit');await el('localActivityForm').fire('submit');
  await navigate('#participants/denis/skill');
  assert.equal(el('participationHistory').children[0].children[0].textContent,'Participation (1)');
  const row=el('participationHistory').children[0].children[1].children[1].children[0];
  assert.equal(row.children[0].textContent,'Tunnel coaching');assert.equal(row.children[1].textContent,'Flybox');
});


test('local activity coach dropdown loads all admins and sends selected admin identity', async()=>{
  const {nodes,localCalls}=harness({route:'#activities/theory'});const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));await el('addTheoryActivity').fire('click');
  assert.deepEqual(el('localActivityCoach').children.map(option=>option.textContent),['Select admin','Ilya','Ksenia']);
  el('localActivityCoach').value='admin-ilya';el('localActivityName').value='Exam studies';
  await el('localActivityForm').fire('submit');
  assert.equal(localCalls[0].p_coach_user_id,'admin-ilya');
});
test('new local participants use separate names, can be edited and removed, and are sent in the activity save', async()=>{
  const {nodes,localCalls}=harness({route:'#activities/social'});const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));await el('addSocialActivity').fire('click');
  el('localActivityName').value='Sailing';
  el('localNewParticipant').value='Anna';el('localNewParticipantSurname').value='Smith';el('localNewParticipantPhone').value='0521234567';
  await el('queueLocalActivityParticipant').fire('click');
  let row=el('localActivitySelectedPeople').children[0];
  assert.equal(row.children[0].textContent,'×');assert.equal(row.children[1].textContent,'Anna Smith (new)');
  await row.children[2].fire('click');row.children[3].children[1].value='Jones';await row.children[3].children[3].fire('click');
  await el('localActivityForm').fire('submit');
  assert.deepEqual(localCalls[0].p_new_participants,[{name:'Anna',surname:'Jones',phone:'0521234567'}]);
  row=el('localActivitySelectedPeople').children[0];await row.children[0].fire('click');
  assert.equal(el('localActivitySelectedPeople').children.length,0);
});
test('local participant search reuses existing people and offers immediate phone editing', async()=>{
  const {nodes,localCalls,phoneCalls}=harness({route:'#activities/flybox'});const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));await el('addFlyboxActivity').fire('click');
  el('localNewParticipant').value='Denis';await el('queueLocalActivityParticipant').fire('click');
  assert.doesNotMatch(el('localActivitySelectedPeople').children[0].children[1].textContent,/new/);
  const row=el('localActivityPeople').children[0];await row.children[1].fire('click');
  row.children[2].children[0].value='052-555';await row.children[2].children[1].fire('click');
  assert.equal(phoneCalls.length,1);assert.equal(phoneCalls[0].p_phone,'052-555');
  el('localActivityName').value='Coaching';await el('localActivityForm').fire('submit');
  assert.deepEqual(localCalls[0].p_participant_ids,['denis']);assert.deepEqual(localCalls[0].p_new_participants,[]);
});


test('a simple Gear request supports existing and new participants and safe retries',async()=>{
  const {nodes,requestCalls}=harness({route:'#requests'});const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));await el('newRequest').fire('click');
  el('newRequestType').value='gear';el('newRequestNotes').value='T-shirt size S';
  el('requestNewParticipant').value='Denis';await el('queueRequestParticipant').fire('click');
  el('requestNewParticipant').value='Anna';el('requestNewParticipantSurname').value='Smith';el('requestNewParticipantPhone').value='0521234567';
  await el('queueRequestParticipant').fire('click');
  assert.equal(el('requestSelectedParticipants').children.length,2);
  await el('newRequestForm').fire('submit');
  assert.equal(el('newRequestStatus').textContent,'Temporary network failure');assert.equal(el('newRequestNotes').value,'T-shirt size S');
  await el('newRequestForm').fire('submit');
  assert.deepEqual(requestCalls[0],requestCalls[1]);assert.equal(requestCalls[1].p_type,'gear');
  assert.deepEqual(requestCalls[1].p_participant_ids,['denis']);
  assert.deepEqual(requestCalls[1].p_new_participants,[{name:'Anna',surname:'Smith',phone:'0521234567'}]);
  assert.equal(el('requestsListTitle').textContent,'Requests (1)');
  const row=el('requestsList').children[0].children[0].children[2].children[0];
  assert.equal(row.children[0].textContent,'Gear');assert.equal(row.children[1].textContent,'Denis, Anna Smith');
});
test('requests need a type and reject unqueued new names',async()=>{
  const {nodes,requestCalls}=harness({route:'#requests'});const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));await el('newRequest').fire('click');
  await el('newRequestForm').fire('submit');assert.equal(requestCalls.length,0);assert.match(el('newRequestStatus').textContent,/Choose a request type/);
  el('newRequestType').value='other';
  el('requestNewParticipant').value='Denis';await el('queueRequestParticipant').fire('click');
  el('requestNewParticipant').value='Pending Person';await el('newRequestForm').fire('submit');assert.match(el('newRequestStatus').textContent,/Click Add participant/);assert.equal(requestCalls.length,0);
});
test('request participant search has quick phone editing and selection removal',async()=>{
  const {nodes,phoneCalls}=harness({route:'#requests'});const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));await el('newRequest').fire('click');
  const row=el('requestPeople').children[0];await row.children[1].fire('click');row.children[2].children[0].value='052123';await row.children[2].children[1].fire('click');
  assert.equal(phoneCalls[0].p_phone,'052123');
  el('requestNewParticipant').value='Denis';await el('queueRequestParticipant').fire('click');
  await el('requestSelectedParticipants').children[0].children[0].fire('click');assert.equal(el('requestSelectedParticipants').children.length,0);
});


test('save a request with no participants, then append people without creating a second request',async()=>{
  const {nodes,requestCalls,addRequestCalls}=harness({route:'#requests',failAddition:true});const el=id=>nodes.get(id);
  await new Promise(resolve=>setImmediate(resolve));await el('newRequest').fire('click');
  el('newRequestType').value='gear';el('newRequestNotes').value='Order shirts';
  await el('newRequestForm').fire('submit');await el('newRequestForm').fire('submit');
  assert.deepEqual(requestCalls[1].p_participant_ids,[]);assert.deepEqual(requestCalls[1].p_new_participants,[]);
  let row=el('requestsList').children[0].children[0].children[2].children[0];
  assert.equal(row.children[1].textContent,'No participants yet');
  await row.children[5].children[0].fire('click');
  assert.equal(el('newRequestType').disabled,true);assert.equal(el('newRequestNotes').readOnly,true);
  assert.equal(el('newRequestNotes').value,'Order shirts');
  el('requestNewParticipant').value='Denis';await el('queueRequestParticipant').fire('click');
  await el('newRequestForm').fire('submit');assert.equal(el('newRequestStatus').textContent,'Add failed');
  await el('newRequestForm').fire('submit');assert.deepEqual(addRequestCalls[0],addRequestCalls[1]);
  assert.equal(addRequestCalls[1].p_request_id,requestCalls[1].p_request_id);
  assert.equal(el('requestsListTitle').textContent,'Requests (1)');
  row=el('requestsList').children[0].children[0].children[2].children[0];
  assert.equal(row.children[1].textContent,'Denis');assert.equal(row.children[2].textContent,'Order shirts');
  await row.children[5].children[0].fire('click');
  assert.equal(el('requestPeople').children[0].children[0].children[0].disabled,true);
});

test('Statistics restores its view and validates custom dates',async()=>{
 const {nodes}=harness({route:'#statistics/types'});const el=id=>nodes.get(id);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(el('statisticsPage').hidden,false);assert.equal(el('statisticstypesPanel').hidden,false);
 assert.equal(el('statisticsoverviewPanel').hidden,true);assert.equal(el('statisticsContent').hidden,false);
 el('statisticsRange').value='custom';await el('statisticsRange').fire('change');
 assert.equal(el('statisticsCustomDates').hidden,false);assert.match(el('statisticsStatus').textContent,/valid From and To/);
 el('statisticsStart').value='2026-01-01';el('statisticsEnd').value='2026-12-31';await el('statisticsEnd').fire('change');
 assert.equal(el('statisticsContent').hidden,false);
});

test('Most active supports list limits and category filters while preserving the date scope',async()=>{
 const {nodes}=harness({route:'#statistics',activities:[{id:'lesson',title:'Theory lesson',category:'theory',start_date:'2020-01-01',end_date:'2020-01-01'}],
  travelMemberships:[{id:'t1',event_id:'future',participant_id:'denis',participant_status:'active'},{id:'t2',event_id:'completed',participant_id:'denis',participant_status:'active'}],
  localMemberships:[{activity_id:'lesson',participant_id:'nadia'}]});const el=id=>nodes.get(id);
 await new Promise(resolve=>setImmediate(resolve));
 el('statisticsRange').value='all';el('statisticsScope').value='all';await el('statisticsRange').fire('change');
 el('statisticsPeopleLimit').value='1';await el('statisticsPeopleLimit').fire('change');
 assert.match(el('statisticsPeopleCount').textContent,/Showing 1 of 2/);
 let row=el('statisticsOverviewPeople').children[0].children[0].children[2].children[0];assert.equal(row.children[1].textContent,'Denis');
 el('statisticsPeopleCategory').value='theory';await el('statisticsPeopleCategory').fire('change');
 assert.match(el('statisticsPeopleCount').textContent,/Showing 1 of 1/);
 row=el('statisticsOverviewPeople').children[0].children[0].children[2].children[0];assert.equal(row.children[1].textContent,'Nadia');
 el('statisticsPeopleCategory').value='';el('statisticsPeopleLimit').value='all';await el('statisticsPeopleLimit').fire('change');
 assert.match(el('statisticsPeopleCount').textContent,/Showing 2 of 2/);
});

test('missing-phone filter includes blank or unusable numbers and combines with search',async()=>{
 const {nodes}=harness({route:'#participants',people:[{id:'p1',display_name:'Anna',phone:null},{id:'p2',display_name:'Boris',phone:'--'},{id:'p3',display_name:'Dana',phone:'050123'}]});const el=id=>nodes.get(id);
 await new Promise(resolve=>setImmediate(resolve));el('participantMissingPhone').checked=true;await el('participantMissingPhone').fire('change');
 assert.equal(el('participantsListTitle').textContent,'Participants (2 / 3)');
 el('participantSearch').value='Anna';await el('participantSearch').fire('input');assert.equal(el('participantsListTitle').textContent,'Participants (1 / 3)');
 await el('clearParticipantFilters').fire('click');assert.equal(el('participantMissingPhone').checked,false);assert.equal(el('participantsListTitle').textContent,'Participants (3)');
});
test('profile Info reads passport from matching records and Skills/Gear show Travel data',async()=>{
 const {nodes}=harness({route:'#participants/nadia/gear',people:[{id:'nadia',display_name:'Nadia',phone:'050456'},{id:'nadia-copy',display_name:'Nadia',phone:'50-456',passport_number:'AB123'}],
 travelMemberships:[{id:'member',event_id:'camp',participant_id:'nadia-copy',participant_status:'active',number_of_jumps:1500,tunnel_minutes_total:125,canopy_size:135,reserve_date:'2026-01-01',reserve_rental:false,
 events:{id:'camp',name:'Travel Camp',start_date:'2026-02-01',end_date:'2026-02-07',status:'completed',event_type:'skydive'}}]});const el=id=>nodes.get(id);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(el('participantGearPanel').hidden,false);
 assert.equal(el('participantDetails').children.find(row=>row.children[0].textContent==='Passport number').children[1].textContent,'AB123');
 const experience=el('participantExperience').children[0].children[1].children[1].children;
 assert.equal(experience[0].children[1].textContent,'1500');assert.match(experience[0].children[2].textContent,/Travel Camp/);
 const gear=el('gearHistory').children[0].children[1].children[1].children;assert.equal(gear[0].children[1].textContent,'135');assert.equal(gear[2].children[1].textContent,'01/01/2026');
});
test('Gear saves current profile values without changing historical memberships',async()=>{
 const {nodes,gearCalls}=harness({route:'#participants/denis/gear'});const el=id=>nodes.get(id);
 await new Promise(resolve=>setImmediate(resolve));await el('editParticipantGear').fire('click');
 el('gearCanopySize').value='135';el('gearReserveSize').value='108';el('gearReserveDate').value='2026-08-01';el('gearRental').value='own';el('gearNotes').value='Main rig';
 await el('participantGearForm').fire('submit');assert.equal(gearCalls.length,1);assert.equal(gearCalls[0].p_participant_id,'denis');assert.equal(gearCalls[0].p_reserve_size,108);
 const gear=el('gearHistory').children[0].children[1].children[1].children;assert.equal(gear[0].children[1].textContent,'135');assert.match(gear[0].children[2].textContent,/Saved gear profile/);
});
test('concurrent gear edits keep entered values and show the conflict',async()=>{
 const {nodes}=harness({route:'#participants/denis/gear',gearError:true});const el=id=>nodes.get(id);
 await new Promise(resolve=>setImmediate(resolve));await el('editParticipantGear').fire('click');el('gearCanopySize').value='135';
 await el('participantGearForm').fire('submit');assert.equal(el('gearCanopySize').value,'135');assert.equal(el('participantGearFormStatus').textContent,'Gear changed elsewhere');
});


test('verified admin Travel links use the session handoff and preserve event destinations',async()=>{
 const {clickTravel,travelOpens}=harness();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(clickTravel('https://shakshuka-travel.pages.dev/admin.html?event=camp'),true);
 assert.equal(travelOpens[0].admin,true);assert.match(travelOpens[0].url,/event=camp/);
 assert.equal(clickTravel('https://evil.test/'),false);assert.equal(travelOpens.length,1);
});
test('blocked handoff windows leave normal link navigation available',async()=>{
 const {clickTravel}=harness({blockPopup:true});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(clickTravel('https://shakshuka-travel.pages.dev/'),false);
});
