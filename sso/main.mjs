import { PublicClientApplication } from '@azure/msal-browser';
import { validateConfig, evaluateClaims, safeEvent } from './policy.mjs';
import './style.css';
const el=id=>document.getElementById(id);
let config,auth,account=null;
let events=[];
try{events=JSON.parse(sessionStorage.getItem('identityforge-events')??'[]').slice(-100).map(e=>safeEvent(e.event,{code:e.code},e.utc));}catch{events=[];}
const render=()=>{el('events').replaceChildren(...events.map(e=>{const li=document.createElement('li');li.textContent=`${e.utc} | ${e.event} | ${e.code}`;return li;}));};
function record(event,code){events.push(safeEvent(event,{code}));events=events.slice(-100);sessionStorage.setItem('identityforge-events',JSON.stringify(events));render();}
const mode=()=>el('mode').value;
el('mode').value=sessionStorage.getItem('identityforge-mode')==='broken'?'broken':'healthy';
function check(){
  if(!account){el('status').textContent='Not signed in';return;}
  const result=evaluateClaims(account.idTokenClaims,config,mode());
  el('status').textContent=result.ok?'Signed in: application claim contract passed':`Signed in, application mapping rejected: ${result.code}`;
  el('help').textContent=result.ok?'Stable identity uses tenant + object ID; identifying values are hidden.':'Inspect the application contract. Signing in again will not supply an unconfigured legacy claim. Restore Healthy mode and recheck.';
  record(result.ok?'MappingAccepted':'MappingRejected',result.code);
}
el('mode').addEventListener('change',()=>{sessionStorage.setItem('identityforge-mode',mode());record('ModeChanged',mode()==='broken'?'BROKEN_MAPPING':'HEALTHY_MAPPING');if(account)check();});
el('recheck').addEventListener('click',check);
el('export').addEventListener('click',()=>{
  const data={lab:'IdentityForge',scope:'Browser SSO event evidence; does not prove backend authorization or cloud MFA enforcement',liveVerification:'Require matching lab-tenant sign-in logs and reviewer evidence',exportedUtc:new Date().toISOString(),events:events.map(e=>({utc:e.utc,event:e.event,code:e.code}))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='identityforge-sso-events.json';a.click();URL.revokeObjectURL(url);
});
el('login').addEventListener('click',async()=>{
  el('login').disabled=true;record('LoginStarted','USER_INITIATED');
  try{await auth.loginRedirect({scopes:['openid','profile'],prompt:'select_account'});}catch{
    record('AuthenticationFailed','INTERACTIVE_LOGIN_FAILED');el('status').textContent='Sign-in did not start. Check registration and browser settings; inspect tenant logs for details.';el('login').disabled=false;
  }
});
el('logout').addEventListener('click',async()=>{
  record('LogoutStarted','USER_INITIATED');
  try{await auth.logoutRedirect({account,postLogoutRedirectUri:config.redirectUri});}catch{el('status').textContent='Sign-out failed. Close this tab and use the lab tenant sign-out controls.';}
});
render();
try{
  const response=await fetch('/config.local.json',{cache:'no-store'});
  if(!response.ok)throw new Error('Local configuration is missing.');
  config=validateConfig(await response.json());
  if(window.location.origin!=='http://localhost:5173')throw new Error('Open http://localhost:5173/ to match the registration.');
  auth=new PublicClientApplication({auth:{clientId:config.clientId,authority:`https://login.microsoftonline.com/${config.tenantId}`,redirectUri:config.redirectUri,postLogoutRedirectUri:config.redirectUri},cache:{cacheLocation:'sessionStorage'}});
  await auth.initialize();
  const result=await auth.handleRedirectPromise();
  const accounts=auth.getAllAccounts();
  // Never arbitrarily choose among cached accounts.
  account=result?.account??(accounts.length===1?accounts[0]:null);
  if(account){auth.setActiveAccount(account);if(result)record('AuthenticationSucceeded','MSAL_RESPONSE_RECEIVED');}
  el('login').disabled=false;el('logout').disabled=!account;el('recheck').disabled=!account;
  record('AppReady','CONFIGURED');check();
}catch{
  el('status').textContent='Setup or authentication needs attention';
  el('help').textContent='First verify public/config.local.json, the SPA redirect URI and the registration steps in sso/README.md. If setup is correct, investigate the matching sign-in failure in your lab tenant logs. No automatic retry is performed.';
  record('AuthenticationFailed','SETUP_OR_CALLBACK_FAILED');
}
