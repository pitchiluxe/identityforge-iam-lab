const guid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateConfig(config={}) {
  if(!guid.test(config.tenantId??''))throw new Error('Set tenantId to your isolated lab tenant GUID.');
  if(!guid.test(config.clientId??''))throw new Error('Set clientId to your registered application GUID.');
  if(config.redirectUri!=='http://localhost:5173/')throw new Error('The redirectUri must be http://localhost:5173/.');
  return {tenantId:config.tenantId.toLowerCase(),clientId:config.clientId.toLowerCase(),redirectUri:config.redirectUri};
}
// This is an application claim-contract check AFTER MSAL authentication, not a JWT verifier.
// A backend API must separately validate its own access tokens and enforce authorization.
export function evaluateClaims(claims={},config={},mode='healthy') {
  const reject=code=>({ok:false,code,retryAuthentication:false});
  if(!['healthy','broken'].includes(mode))return reject('INVALID_EXERCISE_MODE');
  if(!guid.test(claims.tid??'')||claims.tid.toLowerCase()!==config.tenantId?.toLowerCase())return reject('TENANT_MISMATCH');
  if(!guid.test(claims.oid??''))return reject('SUBJECT_MISSING');
  if(claims.aud?.toLowerCase()!==config.clientId?.toLowerCase())return reject('AUDIENCE_MISMATCH');
  if(!Number.isFinite(claims.exp)||claims.exp<=Date.now()/1000)return reject('TOKEN_EXPIRED');
  if(mode==='broken'&&!claims.legacy_employee_number)return reject('MAPPING_CLAIM_MISSING');
  return {ok:true,code:'CLAIM_CONTRACT_PASSED',subjectKey:`${claims.tid}:${claims.oid}`,retryAuthentication:false};
}
export function safeEvent(event,detail={},originalUtc) {
  const events=['AppReady','LoginStarted','AuthenticationSucceeded','AuthenticationFailed','MappingAccepted','MappingRejected','ModeChanged','LogoutStarted'];
  const code=typeof detail.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(detail.code)?detail.code:'NO_CODE';
  const utc=typeof originalUtc==='string'&&Number.isFinite(Date.parse(originalUtc))?new Date(originalUtc).toISOString():new Date().toISOString();
  return {utc,event:events.includes(event)?event:'AuthenticationFailed',code};
}
