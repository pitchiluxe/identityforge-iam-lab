import { createServer } from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:5174,strictPort:true},logLevel:'error'});
try{
  await server.listen();
  const page=await fetch('http://127.0.0.1:5174/');
  if(!page.ok||!(await page.text()).includes('Trace a real sign-in'))throw new Error('SSO document was not served');
  const entry=await fetch('http://127.0.0.1:5174/main.mjs');
  if(!entry.ok||!(await entry.text()).includes('PublicClientApplication'))throw new Error('MSAL entry was not served');
  console.log('PASS: SSO page and transformed MSAL entry served locally; no tenant sign-in attempted');
}finally{await server.close();}
