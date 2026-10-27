import test from 'node:test';
import assert from 'node:assert/strict';
import {mapCompletion} from '../src/completion-mapping.js';
const map={receiverId:'taskKey',patientId:'person.patientKey',memberId:'person.memberKey',completed:'result.done',visits:'result.visitCount',updatedAt:'result.changedAt'};
const input={taskKey:1,person:{patientKey:'DEMO',memberKey:'MEMBER'},result:{done:true,visitCount:1,changedAt:1793059200000}};
test('Completion repair requires identity and actual boolean completion',()=>{assert.equal(mapCompletion(map,input).completed,true);assert.throws(()=>mapCompletion(map,{...input,result:{...input.result,done:'true'}}));assert.throws(()=>mapCompletion(map,{...input,person:{memberKey:'MEMBER'}}));assert.throws(()=>mapCompletion(map,{...input,result:{...input.result,visitCount:0}}));});
test('Completion mapping rejects executable and unsafe paths and wrong wrapper',()=>{assert.throws(()=>mapCompletion({...map,patientId:'constructor.name'},input));assert.throws(()=>mapCompletion({...map,receiverId:'syntheticExample.taskKey'},input));});
