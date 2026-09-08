import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeBusinessOutcomes } from '../lib/business-outcomes.ts';
const start=new Date('2026-08-10'),end=new Date('2026-09-08');
test('keeps contacts, booking people, and refunded client receipts distinct',()=>{
 const contacts=[{id:'a',dateAdded:'2026-08-11',tags:['contacted'],attributionSource:{utmSource:'fb'},email:'private@example.com'}];
 const events=[{id:'1',contactId:'a',startTime:'2026-08-12',appointmentStatus:'confirmed'},{id:'2',contactId:'a',startTime:'2026-08-13',appointmentStatus:'noshow'}];
 const p={liveMode:true,paymentProviderType:'stripe',status:'succeeded',createdAt:'2026-08-15',currency:'gbp',amount:197,amountRefunded:0};
 const result=summarizeBusinessOutcomes(contacts,events,[p,{...p,status:'refunded',amountRefunded:197},{...p,status:'failed'},{...p,liveMode:false}],start,end);
 assert.equal(result.appointments,2);assert.equal(result.uniqueBookers,1);assert.equal(result.metaContactsBooked,1);
 assert.equal(result.payments,2);assert.equal(result.currencyGroups.GBP.net,197);assert.equal(result.currencyGroups.GBP.refunded,197);
 assert.equal(JSON.stringify(result).includes('private@example.com'),false);
 assert.equal('attended' in result,false);
});
test('does not invent zero refunds for missing payment data',()=>{
 assert.throws(()=>summarizeBusinessOutcomes([],[],[{liveMode:true,paymentProviderType:'stripe',status:'succeeded',createdAt:'2026-08-15',currency:'gbp',amount:197}],start,end));
});

test('excludes tagged tracking tests from contacts and bookings',()=>{
 const r=summarizeBusinessOutcomes([{id:'test',dateAdded:'2026-08-11',tags:['uktl-tracking-test']}],[{id:'event',contactId:'test',startTime:'2026-08-12'}],[],start,end);
 assert.equal(r.contactsCreated,0);assert.equal(r.appointments,0);
});
