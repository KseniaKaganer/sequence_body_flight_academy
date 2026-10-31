const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../auth.js'),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('  function parseShakshukaPoints('),source.indexOf('  let editingParticipant = null;')),context);
test('Shakshuka points accepts zero and nonnegative PostgreSQL integers',()=>{
 for(const [input,expected] of [['0',0],[' 25 ',25],['2147483647',2147483647]])assert.equal(context.parseShakshukaPoints(input),expected);
});
test('Shakshuka points rejects empty, fractional, negative and overflowing amounts',()=>{
 for(const input of ['', ' ', '-1','1.5','2147483648','1e3','NaN','Infinity'])assert.throws(()=>context.parseShakshukaPoints(input),/whole number/);
});
