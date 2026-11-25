// Real Node-RED + local MQTT and a local stub for the Telegram Bot API.
const fs=require('fs'),path=require('path'),net=require('net'),http=require('node:http'),assert=require('assert/strict');
const {spawn}=require('child_process');
const base=path.resolve(__dirname,'../node-red');
const aedes=require(path.join(base,'node_modules/aedes'))();
const mqtt=require(path.join(base,'node_modules/mqtt'));
const runtime=path.join(base,'.test-runtime');fs.mkdirSync(runtime,{recursive:true});
let child,client,server,telegramStub,logs='';
aedes.on('subscribe',(subscriptions)=>{logs+='SUB '+JSON.stringify(subscriptions)+'\n';});
aedes.on('clientError',(_,e)=>{logs+='MQTT ERROR '+e.message+'\n';});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<300;i++){try{const r=await fn();if(r)return r;}catch{}await pause(100);}throw Error('Timeout: '+label+'\n'+logs);}
async function main(){
 server=net.createServer(aedes.handle);await new Promise(r=>server.listen(18884,'127.0.0.1',r));
 const sent=[];
 telegramStub=http.createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/sendMessage'){res.writeHead(404);res.end();return;}
  let body='';for await(const chunk of req)body+=chunk;
  sent.push(JSON.parse(body));
  res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');
 });
 await new Promise(r=>telegramStub.listen(0,'127.0.0.1',r));
 const flow=JSON.parse(fs.readFileSync(path.join(base,'flows.json')));
 Object.assign(flow.find(n=>n.id==='bin-broker'),{broker:'127.0.0.1',port:'18884'});
 flow.find(n=>n.type==='tab').env.find(e=>e.name==='BIN_TOPIC_PREFIX').value='test/smartbin';
 const telegram=flow.find(n=>n.id==='telegram');
 const realUrl="msg.url='https://api.telegram.org/bot'+token+'/sendMessage';";
 assert.ok(telegram.func.includes(realUrl),'must replace the Telegram URL before starting Node-RED');
 telegram.func=telegram.func.replace(realUrl,`msg.url='http://127.0.0.1:${telegramStub.address().port}/sendMessage';`);
 fs.writeFileSync(path.join(runtime,'flows.json'),JSON.stringify(flow));
 fs.writeFileSync(path.join(runtime,'settings.cjs'),"module.exports={uiHost:'127.0.0.1',uiPort:18881,contextStorage:{default:{module:'memory'}},logging:{console:{level:'info'}}};");
 child=spawn(process.execPath,[path.join(base,'node_modules/node-red/red.js'),'--userDir',runtime,'--settings',path.join(runtime,'settings.cjs'),path.join(runtime,'flows.json')],{cwd:base,env:{...process.env,TELEGRAM_ENABLED:'true',TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_CHAT_ID:'123'},windowsHide:true});
 child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 const url='http://127.0.0.1:18881';
 await until(async()=>{const r=await fetch(url+'/bin');return r.ok},'Node-RED HTTP');
 assert.match(await (await fetch(url+'/bin')).text(),/Thùng rác thông minh/);
 assert.equal((await (await fetch(url+'/bin/api')).json()).online,false);
 let r=await fetch(url+'/bin/api/command',{method:'POST',headers:{'content-type':'application/json'},body:'{"command":"open"}'});assert.equal(r.status,409);
 client=mqtt.connect('mqtt://127.0.0.1:18884');await new Promise((resolve,reject)=>{client.once('connect',resolve);client.once('error',reject)});
 const commands=[];client.on('message',(topic,p,packet)=>commands.push({topic,payload:JSON.parse(p.toString()),retained:packet.retain}));
 await new Promise((resolve,reject)=>client.subscribe('test/smartbin/command',e=>e?reject(e):resolve()));
 const sample={schema:4,source:'esp32',mouth_sensor_available:false,lid_position_confirmed:false,measurement_status:'ready',remote_control:true,boot_id:'abcdef0123456789',uptime_ms:10000,sensor_count:2,level_state:'full',service_mode:'operating',mouth_blocked:null,hand_held:false,empty_verified:true,sensor_ok:true,sensor_a_ok:true,sensor_b_ok:true,fill_a_percent:91.7,fill_b_percent:91.7,full:true,lid:'closed',hand_detected:false,muted:false,open_count:2,fill_percent:91.7,distance_cm:7,sample_age_ms:0,last_command_id:'',last_command_result:'none'};
 // Wait for the Node-RED MQTT subscriptions, then keep publishing as a device would.
 const publish=()=>{sample.uptime_ms+=300;client.publish('test/smartbin/telemetry',JSON.stringify(sample));};
 publish();const interval=setInterval(publish,300);
 try{
  await until(async()=>{const d=await(await fetch(url+'/bin/api')).json();return d.online&&d.telemetry.fill_percent===91.7},'MQTT telemetry to HTTP');
  await until(()=>sent.length,'MQTT milestone sent to Telegram HTTP stub');
  assert.deepEqual(sent[0],{chat_id:'123',text:'Thùng rác đã đạt 90%. Vui lòng thu gom sớm.'});
  r=await fetch(url+'/bin/api/command',{method:'POST',headers:{'content-type':'application/json'},body:'{"command":"open"}'});assert.equal(r.status,202);const accepted=await r.json();
  await until(()=>commands.length,'HTTP command to MQTT');assert.equal(commands[0].payload.command,'open');assert.equal(commands[0].payload.request_id,accepted.request_id);assert.equal(commands[0].retained,false);
  assert.equal(commands[0].payload.boot_id,sample.boot_id);assert.ok(commands[0].payload.expires_at_uptime_ms>sample.uptime_ms);
  sample.last_command_id=accepted.request_id;sample.last_command_result='applied';
  await until(async()=>{const d=await(await fetch(url+'/bin/api')).json();return d.telemetry.last_command_id===accepted.request_id},'command acknowledgment');
  await pause(550);
  r=await fetch(url+'/bin/api/command',{method:'POST',headers:{'content-type':'application/json'},body:'{"command":"begin_service"}'});assert.equal(r.status,202);
  await until(()=>commands.length>=2,'service command to MQTT');assert.equal(commands[1].payload.command,'begin_service');
  Object.assign(sample,{level_state:'service',service_mode:'servicing',full:false,empty_verified:false,lid:'open',measurement_status:'paused_open',sensor_ok:false,sensor_a_ok:false,sensor_b_ok:false});
  await until(async()=>{const d=await(await fetch(url+'/bin/api')).json();return d.telemetry.service_mode==='servicing'},'service status to dashboard');
  await pause(550);
  r=await fetch(url+'/bin/api/command',{method:'POST',headers:{'content-type':'application/json'},body:'{"command":"finish_service"}'});assert.equal(r.status,202);
  Object.assign(sample,{level_state:'bag_check_failed',service_mode:'service_failed',lid:'closed',measurement_status:'ready',sensor_ok:true,sensor_a_ok:true,sensor_b_ok:true,fill_a_percent:95,fill_b_percent:95});
  await until(async()=>{const d=await(await fetch(url+'/bin/api')).json();return d.telemetry.level_state==='bag_check_failed'&&!d.telemetry.full},'covered bag must not become full');
  client.publish('test/smartbin/availability','offline');
 }finally{clearInterval(interval);}
 await until(async()=>!(await(await fetch(url+'/bin/api')).json()).online,'offline status');
 console.log('PASS: Node-RED HTTP/MQTT, local Telegram delivery stub, commands, service, bag failure and offline.');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{
 if(client)await client.endAsync();
 if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
 if(server)await new Promise(r=>server.close(r));
 if(telegramStub)await new Promise(r=>telegramStub.close(r));
 await new Promise(r=>aedes.close(r));
});
