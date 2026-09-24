import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileLeads, mergeRegister, summarizeLeadRegisterOutcomes, readLeadRegisterProvider, leadRegisterFailureDiagnostic } from '../lib/lead-register.ts';
import { leadEvidence, leadRegisterChanges } from '../lib/lead-register-view.ts';
const start=new Date('2026-08-10T23:00:00Z'), now=new Date('2026-09-09T12:00:00Z'), end=new Date('2026-12-08T12:00:00Z');
const sub=(id,contactId,at='2026-09-08T15:00:00Z')=>({id,contactId,createdAt:at,others:{funneEventData:{page_url:'/book-a-call'}}});
test('deduplicates form and calendar submissions by contact and includes returning enquiries',()=>{
 const r=reconcileLeads([{id:'a',contactName:'Returning',dateAdded:'2026-01-01',email:'secret@example.com',phone:'private'},{id:'b',contactName:'New SMS',dateAdded:'2026-09-01',source:'SMS Relay Gateway'}],[sub('s1','a'),sub('s2','a')],[{id:'e',contactId:'a',startTime:'2026-09-10T10:00:00Z',appointmentStatus:'confirmed'}],start,now,end);
 assert.equal(r.entries.length,2);assert.equal(r.entries[0].contactId,'b');const a=r.entries.find(e=>e.contactId==='a');assert.equal(a.submissions.length,2);assert.equal(a.appointments.length,1);assert.equal(JSON.stringify(r).includes('secret@example.com'),false);assert.equal(JSON.stringify(r).includes('private'),false);
});
test('retains orphan submissions and separates explicitly tagged tests; ignores deleted and out-of-range events',()=>{
 const r=reconcileLeads([{id:'test',dateAdded:'2026-09-01',tags:['uktl-tracking-test']}],[sub('s1','missing')],[{id:'e',contactId:'test',startTime:'2026-09-10',deleted:true},{id:'future',contactId:'test',startTime:'2027-01-01'}],start,now,end);
 assert.equal(r.entries.find(e=>e.contactId==='missing').contactFound,false);assert.equal(r.entries.find(e=>e.contactId==='test').test,true);assert.equal(r.entries.find(e=>e.contactId==='test').appointments.length,0);
});
test('does not accept inconsistent or repeated submission IDs',()=>{
 assert.throws(()=>reconcileLeads([], [sub('s','a'),sub('s','a')],[],start,now,end));
 assert.throws(()=>reconcileLeads([], [sub('s','a','bad')],[],start,now,end));
});
test('preserves older people and submissions as provider window advances and rejects late stale responses',()=>{
 const old=reconcileLeads([{id:'a',dateAdded:'2026-08-12'}],[sub('old','a')],[],start,now,end);
 old.entries[0].formOrigin=true;
 const fresh=reconcileLeads([{id:'b',dateAdded:'2026-09-10'}],[sub('new','a','2026-09-10')],[],start,new Date('2026-09-11'),end);
 const merged=mergeRegister(old,fresh);assert.equal(merged.entries.length,2);assert.equal(merged.entries.find(e=>e.contactId==='a').submissions.length,2);assert.equal(merged.entries.find(e=>e.contactId==='a').formOrigin,true);assert.deepEqual(mergeRegister(merged,old),merged);
});
test('applies precise timestamp boundaries rather than provider date-only filtering',()=>{
 const r=reconcileLeads([], [sub('before','a','2026-08-10T22:59:59Z'),sub('inside','b','2026-08-10T23:00:00Z'),sub('future','c','2026-09-09T12:00:01Z')],[],start,now,end);
 assert.deepEqual(r.entries.map(e=>e.contactId),['b']);
});
test('keeps recent messaging contacts even when their contact record is older than the import window',()=>{
 const r=reconcileLeads([{id:'sms',dateAdded:'2026-01-01',contactName:'Returning SMS'}],[],[],start,now,end,[{id:'conv',contactId:'sms',lastMessageDate:+new Date('2026-09-01'),lastMessageType:'TYPE_SMS',lastMessageBody:'private message'}]);
 assert.equal(r.entries.length,1);assert.equal(r.entries[0].lastMessageChannel,'SMS');assert.equal(JSON.stringify(r).includes('private message'),false);
});
test('derives contacted, booking and no-show outcomes from the saved register',()=>{
 const r=reconcileLeads([
  {id:'a',dateAdded:'2026-09-01',tags:['contacted'],attributionSource:{utmSource:'fb'}},
  {id:'b',dateAdded:'2026-09-02',tags:['uktl-tracking-test']},
 ],[sub('s1','a'),sub('s2','a'),sub('test','b')],[
  {id:'booked',contactId:'a',startTime:'2026-09-03T12:00:00Z',appointmentStatus:'confirmed'},
  {id:'no-show',contactId:'a',startTime:'2026-09-04T12:00:00Z',appointmentStatus:'no_show'},
 ],new Date('2026-08-10T12:00:00Z'),new Date('2026-09-09T12:00:00Z'),end);
 const outcomes=summarizeLeadRegisterOutcomes(r);
 assert.deepEqual({people:outcomes.peopleEnquiring,submissions:outcomes.formSubmissions,contacted:outcomes.contactedNewContacts,booked:outcomes.uniqueBookers,noShows:outcomes.noShows,metaBooked:outcomes.metaContactsBooked},{people:1,submissions:2,contacted:1,booked:1,noShows:1,metaBooked:1});
});
test('shows new CRM lead tags without form receipts separately from confirmed form enquiries',()=>{
 const old=reconcileLeads([{id:'form',dateAdded:'2026-09-01',tags:['new lead']}],[sub('s1','form')],[],start,now,end);
 const fresh=reconcileLeads([
  {id:'form',dateAdded:'2026-09-01',tags:['new lead']},
  {id:'crm',dateAdded:'2026-09-09T10:00:00Z',tags:['New Lead']},
  {id:'payment',dateAdded:'2026-09-09T11:00:00Z',source:'payment_link'},
  {id:'test',dateAdded:'2026-09-09T11:00:00Z',tags:['new lead','uktl-tracking-test']},
 ],[sub('s1','form'),sub('s2','form','2026-09-09T11:30:00Z')],[],start,now,end);
 const cutoff=+now-30*86400000;
 assert.equal(leadEvidence(fresh.entries.find(e=>e.contactId==='form'),cutoff),'form');
 assert.equal(leadEvidence(fresh.entries.find(e=>e.contactId==='crm'),cutoff),'crm-lead');
 assert.equal(leadEvidence(fresh.entries.find(e=>e.contactId==='payment'),cutoff),null);
 assert.equal(leadEvidence(fresh.entries.find(e=>e.contactId==='test'),cutoff),null);
 assert.deepEqual(leadRegisterChanges(old,fresh),{newFormSubmissions:1,newLeadContacts:1});
});
test('preserves configured form creation evidence when provider omits its submission receipt',()=>{
 const formId='configured-form';
 const register=reconcileLeads([
  {id:'form-attribution',dateAdded:'2026-09-09T09:00:00Z',source:'UK Trade Leads LEAD FORM',attributionSource:{medium:'form',mediumId:formId,url:'https://private.example/?token=secret'}},
  {id:'form-creator',dateAdded:'2026-09-09T10:00:00Z',source:'payment_link',tags:['currentclient'],createdBy:{source:'FORM',sourceId:formId}},
  {id:'other-form',dateAdded:'2026-09-09T11:00:00Z',attributionSource:{medium:'form',mediumId:'other-form'}},
 ],[],[],start,now,end,[],formId);
 const cutoff=+now-30*86400000;
 assert.equal(leadEvidence(register.entries.find(e=>e.contactId==='form-attribution'),cutoff),'form-origin');
 assert.equal(leadEvidence(register.entries.find(e=>e.contactId==='form-creator'),cutoff),'form-origin');
 assert.equal(leadEvidence(register.entries.find(e=>e.contactId==='other-form'),cutoff),null);
 assert.deepEqual({receipts:summarizeLeadRegisterOutcomes(register).formSubmissions,peopleWithReceipts:summarizeLeadRegisterOutcomes(register).peopleEnquiring,formOriginWithoutReceipt:summarizeLeadRegisterOutcomes(register).formOriginWithoutReceipt},{receipts:0,peopleWithReceipts:0,formOriginWithoutReceipt:2});
 assert.equal(JSON.stringify(register).includes('private.example'),false);
});
test('retries transient lead-register provider failures and reports only safe diagnostics',async()=>{
 let calls=0;const delays=[];
 const fetcher=async()=>{calls++;return calls<3?new Response('',{status:calls===1?429:503}):Response.json({events:[]});};
 const result=await readLeadRegisterProvider('/calendars/events','calendar','private-token','v3',fetcher,async ms=>delays.push(ms));
 assert.deepEqual(result,{events:[]});assert.equal(calls,3);assert.deepEqual(delays,[10000,500]);
 calls=0;
 await assert.rejects(()=>readLeadRegisterProvider('/forms/submissions','submissions','private-token','v3',async()=>{calls++;return new Response('',{status:401});}),error=>{
  assert.deepEqual(leadRegisterFailureDiagnostic(error),{stage:'submissions',status:401});
  assert.equal(JSON.stringify(error).includes('private-token'),false);return true;
 });
 assert.equal(calls,1);
});
