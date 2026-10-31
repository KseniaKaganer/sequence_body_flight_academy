const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../auth.js'),'utf8');
function setup(){
 const controls={participantCategoryFilter:{value:''},participantActivityFilter:{value:''},participantMissingPhone:{checked:false},participantMissingSurname:{checked:true}};
 const context=vm.createContext({el:id=>controls[id],participantFields:{surname:'editSurname'},participantRecords:[],participantActivityIndex:new Map(),normalizedParticipantPhone:v=>String(v||'').replace(/\D/g,'')});
 vm.runInContext(source.slice(source.indexOf('  function participantInfo('),source.indexOf('  function deriveParticipantProfile(')),context);
 vm.runInContext(source.slice(source.indexOf('  function participantMatchesActivityFilters('),source.indexOf('  function renderParticipantActivityOptions(')),context);
 return {context,controls,matches:p=>context.participantMatchesActivityFilters(p)};
}
test('missing surname filter includes empty fields, including full names in display name',()=>{
 const h=setup();for(const surname of [null,undefined,'','   '])assert.equal(h.matches({id:'a',surname,display_name:'Full Name'}),true);
 assert.equal(h.matches({id:'a',surname:'Cohen'}),false);
 h.controls.participantMissingSurname.checked=false;assert.equal(h.matches({id:'a',surname:'Cohen'}),true);
});
test('surname filter uses the same shared profile as Info and combines with other filters',()=>{
 const h=setup();h.context.participantRecords=[{id:'alias',surname:'Cohen'}];
 assert.equal(h.matches({id:'a',recordIds:['a','alias'],surname:null}),false);
 h.controls.participantMissingSurname.checked=false;h.controls.participantMissingPhone.checked=true;
 assert.equal(h.matches({id:'a',phone:'0501234567'}),false);
 h.controls.participantMissingPhone.checked=false;h.controls.participantMissingSurname.checked=true;
 h.controls.participantCategoryFilter.value='theory';h.context.participantActivityIndex.set('activity',{category:'theory',participants:new Set(['a'])});
 assert.equal(h.matches({id:'a',recordIds:['a'],surname:null}),true);
 assert.equal(h.matches({id:'b',recordIds:['b'],surname:null}),false);
});
