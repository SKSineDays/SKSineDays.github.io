import {getCurrentSession} from './supabase-client.js';
const form=document.getElementById('canary-form'), date=document.getElementById('canary-birthdate'),country=document.getElementById('canary-country');
const send=document.getElementById('canary-send'),status=document.getElementById('canary-status'),target=document.getElementById('canary-target');
let busy=false, stopped=false, generation=0;
async function request(body){
 const session=await getCurrentSession();
 if(!session?.access_token)throw new Error('Please sign in to the authorized operator account first.');
 const response=await fetch('/api/signup-canary',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(body)});
 const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Test unavailable.');return result;
}
async function initialize(){
 try{
  const result=await request({action:'status'});
  const response=await fetch('/api/eligibility-policy',{cache:'no-store'}),policy=await response.json();
  if(!response.ok||!policy.ok)throw new Error('Eligibility policy unavailable.');
  if(stopped)return;
  for(const entry of policy.countries){const option=document.createElement('option');option.value=entry.code;option.textContent=entry.name;country.append(option);}
  target.textContent=`Authorized email: ${result.targetEmail}`;form.hidden=false;status.textContent='Confirm eligibility before sending. Your birthdate is not saved by this check.';
 }catch(error){status.textContent=error.message;}
}
form.addEventListener('submit',async event=>{
 event.preventDefault();if(busy||stopped||!form.reportValidity())return;busy=true;const version=++generation;
 try{const result=await request({action:'begin',provider:'email',birthdate:date.value,country:country.value});if(stopped||version!==generation)return;
 target.textContent=`Authorized email: ${result.targetEmail}`;form.hidden=true;send.hidden=false;status.textContent='Eligible. The next button creates the real test account and sends its sign-in email.';
 }catch(error){status.textContent=error.message;}finally{date.value='';busy=false;}
});
send.addEventListener('click',async()=>{
 if(busy||stopped)return;busy=true;send.disabled=true;stopped=true;
 try{await request({action:'complete'});status.textContent='Sign-in email requested. The test account is retained. Open the link in a separate browser profile if you want to preserve this operator session.';}
 catch(error){status.textContent=error.message;}
 finally{date.value='';send.hidden=true;form.hidden=true;}
});
document.getElementById('canary-cancel').addEventListener('click',()=>{stopped=true;generation++;date.value='';form.hidden=true;send.hidden=true;request({action:'cancel'}).catch(()=>{});status.textContent=busy?'Stopped this page. A request already in progress may still finish; check its state before retrying.':'Test canceled.';});
window.addEventListener('pagehide',()=>{stopped=true;generation++;date.value='';});
initialize();
