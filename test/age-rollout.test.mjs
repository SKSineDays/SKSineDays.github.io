import test from 'node:test';
import assert from 'node:assert/strict';
import { mailerAgeEnabled } from '../api/_lib/age-rollout.js';
test('mailer readiness requires exact DB/application agreement; missing and both mismatches fail closed',async()=>{
  for (const enabled of [false,true]) {
    const env={AGE_MAILER_ENFORCEMENT_READY:enabled?'true':'false'};
    assert.equal(await mailerAgeEnabled({rpc:async()=>({data:enabled})},env),enabled);
    for (const result of [{data:!enabled},{data:null},{data:undefined},{data:enabled,error:{message:'secret'}}]) {
      await assert.rejects(mailerAgeEnabled({rpc:async()=>result},env),e=>e.code==='AGE_ROLLOUT_UNAVAILABLE');
    }
  }
});
