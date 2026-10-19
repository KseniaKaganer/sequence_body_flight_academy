const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','auth.js'),'utf8');
const context=vm.createContext({localActivityLabels:{theory:'Theory',social:'Social',skydive:'Skydive Coaching',flybox:'Flybox'}});
vm.runInContext(source.slice(source.indexOf('  function deriveParticipantProfile('),source.indexOf('  function renderParticipantProfile(')),context);
const event=(id,date,status='completed')=>({id,name:id,start_date:date,end_date:date,status,event_type:'skydive'});
const travel=[
 {id:'older',participant_status:'active',events:event('Older Camp','2025-01-01'),number_of_jumps:1000,canopy_size:150,reserve_date:'2024-12-01',reserve_rental:false,license_text:'D'},
 {id:'latest',participant_status:'active',events:event('Latest Camp','2026-01-01'),number_of_jumps:1500,canopy_size:null,reserve_date:'2025-12-01',reserve_rental:false,tunnel_minutes_total:125},
 {id:'cancelled',participant_status:'active',events:event('Cancelled Camp','2026-09-01','cancelled'),number_of_jumps:9999},
 {id:'cancelled-registration',participant_status:'cancelled',events:event('Cancelled Registration','2026-09-02'),canopy_size:90}
];
const local={id:'packing',title:'Packing Lesson',category:'theory',start_date:'2026-02-01',end_date:'2026-02-01',coach:'Ilya'};
const derive=(gear=[])=>context.deriveParticipantProfile(travel,[{sequence_activities:local},{sequence_activities:local}],gear,['person','alias'],'2026-10-19');
test('profile combines Travel and local participation once, excluding cancelled records',()=>{
 const r=derive();assert.equal(r.activities.length,3);assert.equal(r.activities[0].name,'Packing Lesson');assert.equal(r.activities[0].state,'Past');
});
test('experience and gear choose the latest available nonempty Travel value for each field',()=>{
 const r=derive();assert.equal(r.experience.number_of_jumps.value,1500);assert.equal(r.experience.number_of_jumps.source.text,'Latest Camp');
 assert.equal(r.experience.license_text.value,'D');assert.equal(r.equipment.canopy_size.value,150);assert.equal(r.equipment.canopy_size.source.text,'Older Camp');
 assert.equal(r.equipment.reserve_date.value,'2025-12-01');assert.equal(r.equipment.reserve_rental.value,false);
});
test('manual gear overrides supplement Travel without changing snapshots and can come from a shared profile',()=>{
 const r=derive([{participant_id:'alias',canopy_size:135,reserve_size:108,reserve_date:null,reserve_rental:true,notes:'My rig',updated_at:'2026-10-01T00:00:00Z'}]);
 assert.equal(r.equipment.canopy_size.value,135);assert.equal(r.equipment.reserve_size.value,108);assert.equal(r.equipment.reserve_rental.value,true);
 assert.equal(r.equipment.reserve_date.value,'2025-12-01');assert.equal(r.equipment.canopy_size.source.text,'Saved gear profile');assert.equal(travel[0].canopy_size,150);
});
