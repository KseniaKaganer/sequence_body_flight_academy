const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','auth.js'),'utf8');
const context=vm.createContext({personName:p=>[p.display_name,p.surname].filter(Boolean).join(' ')});
vm.runInContext(source.slice(source.indexOf('  function normalizedParticipantPhone('),source.indexOf('  let selectedParticipantId')),context);
vm.runInContext(source.slice(source.indexOf('  function buildStatistics('),source.indexOf('  function statisticsTable(')),context);
const data={
 participants:[
  {id:'a',display_name:'Anna',phone:'050111'}, {id:'a-copy',display_name:'Anna',phone:'50-111'},
  {id:'b',display_name:'Boris',phone:'052222'}, {id:'admin',display_name:'Coach',phone:'054333',is_admin_participant:true},
  {id:'cancelled-only',display_name:'Other',phone:'055444'}
 ],
 events:[
  {id:'old',name:'Previous Camp',start_date:'2025-12-01',end_date:'2025-12-05',status:'published'},
  {id:'camp',name:'Camp',start_date:'2026-01-02',end_date:'2026-01-06',status:'draft'},
  {id:'cancelled',name:'Cancelled',start_date:'2026-01-04',end_date:'2026-01-05',status:'cancelled'},
  {id:'current',name:'Current',start_date:'2026-06-15',end_date:'2026-06-25',status:'published'},
  {id:'future',name:'Future',start_date:'2026-11-01',end_date:'2026-11-07',status:'draft'}
 ],
 activities:[
  {id:'theory',title:'Packing',category:'theory',start_date:'2026-01-10',end_date:'2026-01-10',coach:'Ilya',coach_user_id:'ilya'},
  {id:'tunnel',title:'Tunnel',category:'flybox',start_date:'2026-02-01',end_date:'2026-02-01',coach:'Ksenia',coach_user_id:'ksenia'},
  {id:'social',title:'Sailing',category:'social',start_date:'2026-02-02',end_date:'2026-02-02'}
 ],
 travelMemberships:[
  {event_id:'old',participant_id:'a',participant_status:'active'},
  {event_id:'camp',participant_id:'a',participant_status:'active'},
  {event_id:'camp',participant_id:'a-copy',participant_status:'completed'},
  {event_id:'camp',participant_id:'b',participant_status:'active'},
  {event_id:'camp',participant_id:'admin',participant_status:'active'},
  {event_id:'camp',participant_id:'cancelled-only',participant_status:'cancelled'},
  {event_id:'cancelled',participant_id:'cancelled-only',participant_status:'active'},
  {event_id:'current',participant_id:'a',participant_status:'active'},
  {event_id:'future',participant_id:'b',participant_status:'active'}
 ],
 localMemberships:[
  {activity_id:'theory',participant_id:'a-copy'},{activity_id:'theory',participant_id:'b'},
  {activity_id:'tunnel',participant_id:'b'}
 ],
 requests:[
  {id:'request',request_type:'gear',status:'new',created_at:'2025-12-31T22:30:00Z'},
  {id:'nextyear',request_type:'other',status:'done',created_at:'2026-12-31T22:30:00Z'}
 ]
};
const options={start:'2026-01-01',end:'2026-12-31',today:'2026-06-20',scope:'past'};
const calculate=(overrides={})=>context.buildStatistics(data,{...options,...overrides});
test('statistics deduplicate phones per activity and exclude admins and cancellations',()=>{
 const r=calculate();assert.equal(r.totals.count,4);assert.equal(r.totals.people,2);assert.equal(r.totals.attendances,5);
 assert.equal(r.returning,1);assert.equal(r.people[0].name,'Boris');assert.equal(r.people[0].count,3);
 assert.equal(r.types.find(row=>row.category==='travel').attendances,2);
});
test('past, current and upcoming activities stay separate',()=>{
 const r=calculate();assert.deepEqual(JSON.parse(JSON.stringify(r.states)),{past:4,current:1,upcoming:1});
 assert.equal(calculate({scope:'current'}).totals.attendances,1);
 assert.equal(calculate({scope:'upcoming'}).totals.count,1);
 assert.equal(calculate({scope:'all'}).totals.count,6);
});
test('custom range includes boundary dates and uses earlier history for returning people',()=>{
 const r=calculate({start:'2026-01-10',end:'2026-01-10'});
 assert.equal(r.totals.count,1);assert.equal(r.totals.attendances,2);assert.equal(r.returning,2);
});
test('coach and monthly summaries use the same selected records',()=>{
 const r=calculate();assert.equal(r.coaches.length,2);assert.equal(r.unassigned,1);
 const ilya=r.coaches.find(row=>row.name==='Ilya');assert.equal(ilya.people,2);assert.equal(ilya.attendances,2);
 assert.equal(r.months[0].month,'2026-01');assert.equal(r.months[0].attendances,4);
 assert.equal(r.months[1].people,1);
});
test('request date filters use Israel time at the year boundary',()=>{
 const r=calculate();assert.equal(r.requests.length,1);assert.equal(r.requests[0].id,'request');
});
test('empty ranges produce zero totals',()=>{
 const r=calculate({start:'2024-01-01',end:'2024-12-31'});
 assert.equal(r.totals.count,0);assert.equal(r.totals.people,0);assert.equal(r.people.length,0);
});
