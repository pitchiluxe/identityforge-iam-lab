import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, evaluateClaims, safeEvent } from '../policy.mjs';
const tenant='11111111-1111-4111-8111-111111111111';
const client='22222222-2222-4222-8222-222222222222';
test('reject missing tenant before starting authentication',()=>assert.throws(()=>validateConfig({clientId:client}),/tenant/i));
test('reject common authority and arbitrary redirect endpoints',()=>{
  assert.throws(()=>validateConfig({tenantId:'common',clientId:client}),/tenant/i);
  assert.throws(()=>validateConfig({tenantId:tenant,clientId:client,redirectUri:'https://attacker.invalid'}),/redirect/i);
});
test('accept only fixed localhost app redirect',()=>assert.equal(validateConfig({tenantId:tenant,clientId:client,redirectUri:'http://localhost:5173/'}).tenantId,tenant));
const cfg={tenantId:tenant,clientId:client};
const claims={tid:tenant,oid:'33333333-3333-4333-8333-333333333333',aud:client,exp:Math.floor(Date.now()/1000)+3600,preferred_username:'lab@example.invalid'};
test('healthy mapping uses oid and tid as key, not mutable username',()=>{
  const r=evaluateClaims(claims,cfg,'healthy');assert.equal(r.ok,true);assert.equal(r.subjectKey,`${tenant}:${claims.oid}`);
});
test('deliberately broken mapping requires absent legacy claim',()=>{
  const r=evaluateClaims(claims,cfg,'broken');assert.equal(r.ok,false);assert.equal(r.code,'MAPPING_CLAIM_MISSING');
});
test('stop repeated automated login attempts on mapping failure',()=>assert.equal(evaluateClaims(claims,cfg,'broken').retryAuthentication,false));
test('reject wrong tenant even if display identity matches',()=>assert.equal(evaluateClaims({...claims,tid:client},cfg,'healthy').ok,false));
test('reject missing immutable user identifier',()=>assert.equal(evaluateClaims({...claims,oid:null},cfg,'healthy').ok,false));
test('reject expired token context',()=>assert.equal(evaluateClaims({...claims,exp:1},cfg,'healthy').ok,false));
test('reject audience mismatch',()=>assert.equal(evaluateClaims({...claims,aud:tenant},cfg,'healthy').ok,false));
test('reject unknown fault modes',()=>assert.equal(evaluateClaims(claims,cfg,'other').ok,false));
test('evidence export excludes tokens and personal claims',()=>{
  const r=safeEvent('MappingRejected',{idToken:'SECRET',preferred_username:'PRIVATE',accessToken:'SECRET',code:'MAPPING_CLAIM_MISSING'});
  assert.equal(JSON.stringify(r).includes('SECRET'),false);assert.equal(JSON.stringify(r).includes('PRIVATE'),false);assert.equal(r.code,'MAPPING_CLAIM_MISSING');
});
test('restoring sanitized history preserves original event timestamps',()=>{
  const utc='2026-10-18T10:00:00.000Z';
  assert.equal(safeEvent('MappingRejected',{code:'MAPPING_CLAIM_MISSING'},utc).utc,utc);
});
