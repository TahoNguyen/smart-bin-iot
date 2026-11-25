const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.resolve(__dirname,'..');
const flows=JSON.parse(fs.readFileSync(path.join(root,'node-red/flows.json')));
function harness(id,initial={},environment={}){
 const state=initial instanceof Map?initial:new Map(Object.entries(initial)),local=new Map();let now=100000;
 const context={flow:{get:k=>state.get(k),set:(k,v)=>state.set(k,v)},context:{get:k=>local.get(k),set:(k,v)=>local.set(k,v)},env:{get:k=>environment[k]},node:{warn(){}},Date:{now:()=>now},Math,JSON,Number,String};
 return {state,time:n=>now=n,run:input=>vm.runInNewContext('(function(msg){'+flows.find(n=>n.id===id).func+'})({payload:input})',{...context,input})};
}
const valid={schema:4,source:'esp32',mouth_sensor_available:false,lid_position_confirmed:false,measurement_status:'ready',remote_control:true,boot_id:'abcdef0123456789',uptime_ms:20000,sensor_count:2,level_state:'normal',service_mode:'operating',mouth_blocked:null,hand_held:false,empty_verified:true,sensor_ok:true,sensor_a_ok:true,sensor_b_ok:true,fill_a_percent:50,fill_b_percent:50,full:false,lid:'closed',hand_detected:false,muted:false,open_count:0,fill_percent:50,distance_cm:22,sample_age_ms:200,last_command_id:'',last_command_result:'none'};
let tick=20000;
const sample=(extra={})=>({...valid,uptime_ms:tick+=1000,...extra});
const high=()=>sample({level_state:'full',full:true,fill_percent:92,fill_a_percent:92,fill_b_percent:92});
test('flow references and generated dashboard match source',()=>{
 const ids=new Set(flows.map(n=>n.id));assert.equal(ids.size,flows.length);
 for(const n of flows){for(const target of(n.wires||[]).flat())assert.ok(ids.has(target));if(n.broker&&n.type!=='mqtt-broker')assert.ok(ids.has(n.broker));}
 assert.equal(flows.find(n=>n.id==='dashboard').template,fs.readFileSync(path.join(root,'node-red/dashboard.html'),'utf8'));
});
test('full requires empty evidence, two good points and operating mode',()=>{
 for(const extra of [{empty_verified:false},{sensor_count:1},{mouth_blocked:true},{lid:'open'},{service_mode:'servicing'},{fill_b_percent:20}]){
  assert.equal(harness('ingest').run({...high(),...extra}),null);
 }
 const h=harness('ingest');
 assert.equal(h.run(sample({fill_percent:95,fill_a_percent:95,fill_b_percent:95,level_state:'checking'}))[1].payload.fill_milestone,90);
 assert.equal(h.run(high())[1],null); // Full confirmation does not repeat the 90% milestone.
});
test('alert cooldown persists across transient settling / normal states',()=>{
 const h=harness('ingest'),fault=()=>sample({level_state:'sensor_fault',sensor_ok:false});
 assert.ok(h.run(fault())[1]);h.time(110000);h.run(sample({level_state:'settling'}));
 h.time(120000);assert.equal(h.run(fault())[1],null);h.time(160000);assert.ok(h.run(fault())[1]);
});
test('paper, covered bag and inspection get distinct alerts, never a full claim',()=>{
 const h=harness('ingest');
 for(const state of ['bag_check_failed','inspection_required','high_unverified','obstruction_suspected']){
  const p=sample({level_state:state,full:false,empty_verified:false});
  
  if(state==='bag_check_failed')p.service_mode='service_failed';
  const r=h.run(p);assert.equal(r[1].payload.level_state,state);assert.ok(r[1].payload.text.length>20);
 }
});
test('sensor fault and held hand have actionable warnings',()=>{
 assert.equal(harness('ingest').run(sample({level_state:'sensor_fault',sensor_ok:false,fill_percent:null}))[1].payload.level_state,'sensor_fault');
 assert.equal(harness('ingest').run(sample({level_state:'settling',hand_held:true,lid:'open',measurement_status:'paused_open',sensor_ok:false,sensor_a_ok:false,sensor_b_ok:false}))[1].payload.level_state,'hand_held');
});
test('duplicates and out of order data cannot keep device online',()=>{
 const h=harness('ingest'),p=sample();h.run(p);const received=h.state.get('latest').received_at;
 h.time(120000);assert.equal(h.run(p),null);assert.equal(h.state.get('latest').received_at,received);
 assert.equal(h.run({...p,uptime_ms:p.uptime_ms-1000}),null);
 assert.ok(h.run({...p,boot_id:'1111111111111111',uptime_ms:10}));
 const wrap=harness('ingest');wrap.run(sample({uptime_ms:4294967280}));assert.ok(wrap.run(sample({uptime_ms:32})));
});
test('bad schema, stale readings, contradictory state and invalid boot are rejected',()=>{
 for(const p of [{},sample({schema:2}),sample({fill_percent:'99'}),sample({sample_age_ms:9000}),sample({boot_id:'bad'}),{...high(),level_state:'checking'}])assert.equal(harness('ingest').run(p),null);
});
test('API marks receipt older than 6s and explicit offline status offline',()=>{
 const h=harness('api',{latest:{received_at:99000,telemetry:valid},availability:'online'});
 assert.equal(h.run(null).payload.online,true);h.time(105000);assert.equal(h.run(null).payload.online,false);
 h.time(98000);assert.equal(h.run(null).payload.online,false);
 h.time(100000);h.state.set('availability','offline');assert.equal(h.run(null).payload.online,false);
});
function commandHarness(mode='operating') {return harness('command',{latest:{received_at:99000,telemetry:{...valid,service_mode:mode}},availability:'online'},{BIN_TOPIC_PREFIX:'test/bin'});}
test('commands carry boot epoch, short uptime expiry and no retain',()=>{
 const h=commandHarness();assert.equal(h.run({command:'close'})[1].statusCode,400);
 const r=h.run({command:'open'}),out=JSON.parse(r[0].payload);
 assert.equal(r[1].statusCode,202);assert.equal(out.boot_id,valid.boot_id);assert.equal(out.expires_at_uptime_ms,26000);
 assert.equal(out.request_id,r[1].payload.request_id);assert.equal(r[0].retain,false);assert.equal(r[0].topic,'test/bin/command');
 assert.equal(h.run({command:'mute'})[1].statusCode,429);h.time(105000);assert.equal(h.run({command:'open'})[1].statusCode,409);
});
test('bag replacement commands follow the service lifecycle',()=>{
 assert.equal(commandHarness().run({command:'begin_service'})[1].statusCode,202);
 assert.equal(commandHarness().run({command:'finish_service'})[1].statusCode,409);
 assert.equal(commandHarness('servicing').run({command:'finish_service'})[1].statusCode,202);
 assert.equal(commandHarness('service_failed').run({command:'finish_service'})[1].statusCode,202);
 assert.equal(commandHarness('verifying_empty').run({command:'recheck'})[1].statusCode,409);
});
test('real device can disable all remote commands while keeping telemetry',()=>{
 const h=commandHarness();h.state.get('latest').telemetry.remote_control=false;
 assert.equal(h.run({command:'begin_service'})[1].statusCode,403);
 assert.ok(harness('ingest').run(sample({remote_control:false})));
});
test('ack Debug preserves rejected or expired result instead of claiming applied',()=>{
 const h=harness('watch-ack');let r=h.run({...valid,last_command_id:'test',last_command_result:'rejected'});
 assert.equal(r.payload.result,'rejected');assert.equal(h.run({...valid,last_command_id:'test'}),null);
 assert.ok(h.run({...valid,boot_id:'1111111111111111',last_command_id:'test'}));
});
test('dashboard script compiles and describes paper and bag failure',()=>{
 const html=fs.readFileSync(path.join(root,'node-red/dashboard.html'),'utf8'),js=html.match(/<script>([\s\S]*?)<\/script>/)[1];new vm.Script(js);
 const fn=js.slice(js.indexOf('function levelMessage'),js.indexOf('let currentBoot'));
 assert.ok(html.includes('Không trang bị — không xác nhận thông thoáng'));
 assert.match(vm.runInNewContext(fn+";levelMessage({level_state:'bag_check_failed'})"),/KHÔNG ĐẠT/);
});
test('Telegram stays disabled unless explicitly enabled with credentials',()=>{
 assert.equal(harness('telegram').run({text:'test'}),null);
 assert.equal(harness('telegram',{}, {TELEGRAM_ENABLED:'true'}).run({text:'test'}),null);
 const h=harness('telegram',{}, {TELEGRAM_ENABLED:'true',TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_CHAT_ID:'123'});
 const request=h.run({text:'Thùng rác đã đạt 90%. Vui lòng thu gom sớm.'});
 assert.equal(request.url,'https://api.telegram.org/botfake/sendMessage');
 assert.equal(request.method,'POST');
 assert.equal(request.payload.chat_id,'123');
 assert.equal(request.payload.text,'Thùng rác đã đạt 90%. Vui lòng thu gom sớm.');
});

test('Telegram sends plain text once at 80, 90 and 100 percent for each filling cycle',()=>{
 const ingest=harness('ingest');
 const telegram=harness('telegram',ingest.state,{
  TELEGRAM_ENABLED:'true',TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_CHAT_ID:'123'
 });
 const forward=(reading,now)=>{
  ingest.time(now);
  const alert=ingest.run(reading)[1];
  return alert?telegram.run(alert.payload):null;
 };
 assert.equal(forward(sample({fill_a_percent:79.9,fill_b_percent:90}),100000),null);
 assert.equal(forward(sample({fill_a_percent:80,fill_b_percent:82,empty_verified:false}),100001),null);
 const first=forward(sample({fill_a_percent:80,fill_b_percent:82}),100002);
 assert.match(first.payload.text,/80%/);
 assert.equal(first.payload.parse_mode,undefined);
 assert.equal(forward(sample({fill_a_percent:89.9,fill_b_percent:91}),101000),null);
 assert.match(forward(sample({fill_a_percent:90,fill_b_percent:90}),102000).payload.text,/90%/);
 assert.equal(forward(sample({fill_a_percent:100,fill_b_percent:100,level_state:'checking'}),103000),null);
 assert.match(forward(sample({fill_a_percent:100,fill_b_percent:100,level_state:'full',full:true}),104000).payload.text,/100%/);
 assert.equal(forward(sample({fill_a_percent:100,fill_b_percent:100,level_state:'full',full:true}),280000),null);

 forward(sample({fill_a_percent:5,fill_b_percent:50}),290000);
 forward(sample({lid:'open',measurement_status:'paused_open',level_state:'settling',
  sensor_ok:false,sensor_a_ok:false,sensor_b_ok:false}),300000);
 assert.equal(forward(high(),340000),null);
 assert.ok(forward(sample({level_state:'sensor_fault',sensor_ok:false}),350000));
 forward(sample({fill_a_percent:5,fill_b_percent:5,empty_verified:false}),400000);
 assert.equal(forward(high(),400001),null);
 forward(sample({fill_a_percent:5,fill_b_percent:5}),401000);
 assert.match(forward(sample({fill_a_percent:80,fill_b_percent:80}),402000).payload.text,/80%/);
});

test('v4 never describes an absent mouth sensor as clear or a servo command as feedback',()=>{
 for(const extra of [{schema:3},{mouth_blocked:false},{mouth_blocked:true},{mouth_sensor_available:true},{lid_position_confirmed:true},{source:'unknown'}])
  assert.equal(harness('ingest').run(sample(extra)),null);
 assert.ok(harness('ingest').run(sample({source:'desktop_simulator'})));
});
test('v4 rejects valid readings while lid is open or settling',()=>{
 assert.equal(harness('ingest').run(sample({lid:'open',measurement_status:'paused_open'})),null);
 assert.equal(harness('ingest').run(sample({measurement_status:'settling'})),null);
 assert.ok(harness('ingest').run(sample({lid:'open',measurement_status:'paused_open',level_state:'settling',sensor_ok:false,sensor_a_ok:false,sensor_b_ok:false,fill_percent:null,distance_cm:null})));
});
