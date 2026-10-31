const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../participant-login.js'),'utf8');
function harness({enabled=true,blocked=false}={}) {
 const values={},calls=[],responses=[];
 const context={window:{SEQUENCE_CONFIG:{participantLoginEnabled:enabled}},sessionStorage:{getItem:k=>values[k],setItem(k,v){if(blocked)throw Error('blocked');values[k]=v;},removeItem:k=>delete values[k]}};
 vm.runInNewContext(source,context);
 const api=context.window.SequenceParticipant;
 api.setup({rpc:async(name,args)=>{calls.push({name,args});return responses.shift()||{data:{ok:false}};}});
 return {api,values,calls,responses};
}
const person={ok:true,token:'a'.repeat(64),participant_id:'person-1',display_name:'Test Person'};
test('participant login uses only the dedicated RPC and retains no phone/name credentials',async()=>{
 const h=harness();h.responses.push({data:person});await h.api.login(' Test Person ',' +123456789 ');
 assert.equal(h.calls[0].name,'sequence_participant_login');assert.equal(h.calls[0].args.p_name,'Test Person');
 assert.deepEqual(Object.values(h.values),[person.token]);
 h.responses.push({data:{...person,token:undefined}});assert.equal((await h.api.restore()).participant_id,'person-1');
});
test('invalid credentials do not create a local login; disabled feature makes no requests',async()=>{
 const h=harness();await assert.rejects(h.api.login('Test','12345678'),/not recognized/);assert.deepEqual(h.values,{});
 const disabled=harness({enabled:false});await assert.rejects(disabled.api.login('Test','12345678'),/not enabled/);assert.equal(await disabled.api.restore(),null);assert.equal(disabled.calls.length,0);
});
test('expired sessions are cleared; network errors do not masquerade as valid login',async()=>{
 const h=harness();h.values['sequence-participant-session-v1']=person.token;
 assert.equal(await h.api.restore(),null);assert.deepEqual(h.values,{});
 h.values['sequence-participant-session-v1']=person.token;h.responses.push({error:{message:'offline'}});
 await assert.rejects(h.api.restore(),/Unable to verify/);
});
test('logout revokes on server and clears local session; failed revocation can be retried',async()=>{
 const h=harness();h.values['sequence-participant-session-v1']=person.token;h.responses.push({error:Error('offline')});
 await assert.rejects(h.api.logout());assert.equal(h.values['sequence-participant-session-v1'],person.token);
 h.responses.push({data:null});await h.api.logout();assert.deepEqual(h.values,{});assert.equal(h.calls[1].name,'sequence_participant_logout');
});
test('blocked session storage revokes the newly issued session',async()=>{
 const h=harness({blocked:true});h.responses.push({data:person});await assert.rejects(h.api.login('Test','12345678'),/browser storage/);
 assert.equal(h.calls[1].name,'sequence_participant_logout');assert.deepEqual(h.values,{});
});
