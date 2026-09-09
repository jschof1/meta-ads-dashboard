import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileLeads, mergeRegister, summarizeLeadRegisterOutcomes } from '../lib/lead-register.ts';
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
 const fresh=reconcileLeads([{id:'b',dateAdded:'2026-09-10'}],[sub('new','a','2026-09-10')],[],start,new Date('2026-09-11'),end);
 const merged=mergeRegister(old,fresh);assert.equal(merged.entries.length,2);assert.equal(merged.entries.find(e=>e.contactId==='a').submissions.length,2);assert.deepEqual(mergeRegister(merged,old),merged);
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
