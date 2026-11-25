// Full desktop C++ -> MQTT -> real Node-RED path, on isolated test ports.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),url='http://127.0.0.1:18765',redUrl='http://127.0.0.1:18882';
const child=spawn(process.execPath,[path.join(root,'simulator/server.cjs')],{cwd:root,windowsHide:true,env:{...process.env,SIM_WEB_PORT:'18765',SIM_NODE_RED_PORT:'18882',SIM_MQTT_PORT:'18886'}});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,limit=200){for(let i=0;i<limit;i++){try{const x=await fn();if(x)return x;}catch{}await pause(100);}throw Error(label+'\n'+logs);}
const state=()=>fetch(url+'/api/state').then(r=>r.json());
async function control(p){const r=await fetch(url+'/api/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)});assert.equal(r.status,202);}
async function run(){
 await until(async()=>{const s=await state();return s.online&&s.node_red_ready;},'startup');
 await control({speed:10});
 await until(async()=>{const s=await state();return s.telemetry.empty_verified;},'fresh empty reference');
 let t=(await state()).telemetry;assert.equal(t.schema,4);assert.equal(t.mouth_blocked,null);assert.equal(t.lid_position_confirmed,false);
 await control({hand:true});await until(async()=>{t=(await state()).telemetry;return t.lid==='open';},'hand open');
 const pairs=t.sample_pairs;await pause(350);t=(await state()).telemetry;
 assert.equal(t.sample_pairs,pairs);assert.equal(t.measurement_status,'paused_open');assert.equal(t.distance_a_cm,null);
 await control({hand:false});await until(async()=>{const s=await state();return s.telemetry.sensor_ok;},'close and rebuild median');
 await control({a:7,b:7,scene:'paper_both'});
 await until(async()=>{t=(await state()).telemetry;return t.level_state==='inspection_required';},'paper not full');assert.equal(t.full,false);
 await control({command:'begin_service'});await until(async()=>{t=(await state()).telemetry;return t.service_mode==='servicing';},'begin service');
 await control({a:4,b:4,scene:'bag',command:'finish_service'});
 await until(async()=>{t=(await state()).telemetry;return t.service_mode==='service_failed';},'covered bag rejected');assert.equal(t.full,false);
 await control({command:'begin_service'});await pause(100);await control({a:40,b:40,scene:'normal',command:'finish_service'});
 await until(async()=>{t=(await state()).telemetry;return t.service_mode==='operating'&&t.empty_verified;},'bag recovery');
 await control({scene:'hidden_paper'});await pause(300);t=(await state()).telemetry;assert.equal(t.lid,'closed');assert.equal(t.full,false);
 await control({speed:1});
 const nd=await until(async()=>{const d=await fetch(redUrl+'/bin/api').then(r=>r.json());return d.online&&d.telemetry.source==='desktop_simulator'&&d.telemetry.sensor_ok&&d.telemetry.distance_a_cm===40&&d.telemetry.distance_b_cm===40&&d;},'native telemetry reaches Node-RED');
 assert.equal(nd.telemetry.mouth_blocked,null);assert.equal(nd.telemetry.schema,4);
 const response=await fetch(redUrl+'/bin/api/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command:'open'})});
 assert.equal(response.status,202);const queued=await response.json();
 await until(async()=>{const d=await state();return d.telemetry.last_command_id===queued.request_id&&d.telemetry.lid==='open';},'Node-RED command reaches native C++');
 assert.equal((await state()).telemetry.last_command_result,'applied');
 // Also observe the ACK after its return trip through MQTT to Node-RED.
 const ack=await until(async()=>{const d=await fetch(redUrl+'/bin/api').then(r=>r.json());return d.online&&d.telemetry.last_command_id===queued.request_id&&d.telemetry.last_command_result==='applied'&&d;},'ACK returns through MQTT to Node-RED');
 await control({demo:'start'});
 const complete=await until(async()=>{
   const s=await state();
   return s.demo?.status==='complete'&&s.notifications.length===3&&s;
 },'one-click demo, including the three Node-RED milestones',400);
 assert.deepEqual(complete.notifications.map(n=>n.level),[80,90,100]);
 assert.ok(complete.notifications.every(n=>n.text.includes(n.level+'%')));
 assert.equal(complete.telemetry.full,true);
 assert.equal(complete.telemetry.full_buzzer_pulses,3);
 await control({demo:'start'});
 const fresh=await until(async()=>{const s=await state();return s.demo?.status==='running'&&s.telemetry.boot_id!==complete.telemetry.boot_id&&s;},'demo restarts a fresh cycle');
 assert.deepEqual(fresh.notifications,[]);
 await control({demo:'stop'});
 assert.equal((await state()).demo.status,'stopped');
 const evidence={checked_at:new Date().toISOString(),scope:'Desktop simulator + real local MQTT broker + real Node-RED. No physical ESP32 or servo.',
  test_ports:{simulator:18765,node_red:18882,mqtt:18886},
  uplink:{source:nd.telemetry.source,schema:nd.telemetry.schema,boot_id:nd.telemetry.boot_id,uptime_ms:nd.telemetry.uptime_ms,distance_a_cm:nd.telemetry.distance_a_cm,distance_b_cm:nd.telemetry.distance_b_cm,sensor_ok:nd.telemetry.sensor_ok,node_red_online:nd.online},
  downlink:{http_status:response.status,command:'open',request_id:queued.request_id},
  returned_ack:{last_command_id:ack.telemetry.last_command_id,last_command_result:ack.telemetry.last_command_result,lid_command:ack.telemetry.lid,lid_position_confirmed:ack.telemetry.lid_position_confirmed},
  matched_request_and_ack:queued.request_id===ack.telemetry.last_command_id,
  assertions_passed:['no measurement while lid open','fresh samples after close','abrupt high paper not full','covered bag failed','bag recovery','blind spot can be missed','native telemetry -> MQTT -> Node-RED','Node-RED -> MQTT -> native controller','ACK -> MQTT -> Node-RED']};
 if(process.env.BIN_PROOF_FILE){fs.writeFileSync(path.resolve(process.env.BIN_PROOF_FILE),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));}
 console.log('PASS: desktop native C++, lid and sensor scenarios, Node-RED command/ACK, and one-click demo with 80/90/100 alerts and three buzzer pulses.');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 try{await fetch(url+'/api/shutdown',{method:'POST'});}catch{}
 await Promise.race([new Promise(r=>child.once('exit',r)),pause(4000)]);
 if(child.exitCode===null)child.kill();
});
