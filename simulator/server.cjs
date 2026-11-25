// Local simulation only. Publishes to an isolated loopback broker/topic, never
// to the real ESP32's public demo command topic.
const fs=require('fs'),path=require('path'),http=require('http'),net=require('net');
const {spawn}=require('child_process'),{randomBytes,randomUUID}=require('crypto');
const {createInterface}=require('readline');
const root=path.resolve(__dirname,'..'),deps=path.join(root,'node-red/node_modules');
const webPort=Number(process.env.SIM_WEB_PORT||8765),mqttPort=Number(process.env.SIM_MQTT_PORT||18885),redPort=Number(process.env.SIM_NODE_RED_PORT||1882);
const fromWokwi=process.argv.includes('--wokwi');
const telegramEnabled=process.argv.includes('--send-telegram')&&process.env.TELEGRAM_ENABLED==='true'&&
  !!process.env.TELEGRAM_BOT_TOKEN&&!!process.env.TELEGRAM_CHAT_ID;
const prefix=fromWokwi?'sim/nhom6/bin-wokwi':'sim/nhom6/bin-desktop';
const commands={open:1,auto:2,mute:3,unmute:4,begin_service:5,finish_service:6,recheck:7};
const demoStages=[
  {distance:40,speed:5,duration:12000,label:'Xác minh thùng gần rỗng'},
  {distance:22,speed:5,duration:10000,label:'Mức rác tăng lên khoảng 50%'},
  {distance:11,speed:5,duration:10000,label:'Thử thông báo mốc 80%'},
  {distance:7,speed:1,duration:16000,label:'Thử mốc 90% và ba tiếng còi'},
  {distance:3,speed:5,duration:10000,label:'Thử thông báo mốc 100%'},
];
let aedes,client,broker,web,engine,red,timer,stopping=false,lastNativeAt=0,redReady=false;
let model=null,boot=randomBytes(8).toString('hex'),uptime=0,inflight=null;
let lastAck={last_command_id:'',last_command_result:'none'},pending=[],seen=[];
let input={hand:false,a:40,b:40,speed:1,scene:'normal'};
let demo=null,notifications=[];
const children=[],logs=[];
function log(s){logs.push(String(s));if(logs.length>100)logs.shift();console.log(s);}
async function unused(port){await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>reject(Error('Cong '+port+' dang duoc su dung. Dung phien cu hoac doi SIM_*_PORT.')));s.listen(port,'127.0.0.1',()=>s.close(resolve));});}
function state(){return {online:!!model&&Date.now()-lastNativeAt<(fromWokwi?6000:1500),telemetry:model,input,demo,notifications,
  mode:fromWokwi?'wokwi':'desktop',telegram_enabled:telegramEnabled,
  node_red_ready:redReady,links:{editor:'http://127.0.0.1:'+redPort+'/',dashboard:'http://127.0.0.1:'+redPort+'/bin'},
  mqtt:{host:'127.0.0.1',port:mqttPort,prefix},logs:logs.slice(-12)};}
function launch(exe,args,options={}) {
  const c=spawn(exe,args,{cwd:root,windowsHide:true,...options});children.push(c);
  c.on('error',e=>{log(e.message);shutdown(1);});return c;
}
function queue(command,id=randomUUID(),deadline=null){pending.push({action:commands[command],id,deadline,command});}
function json(res,code,value){res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));}
function reset(){
  boot=randomBytes(8).toString('hex');uptime=0;input={hand:false,a:40,b:40,speed:1,scene:'normal'};
  lastAck={last_command_id:'',last_command_result:'none'};pending=[{action:8,id:'',command:'reset'}];seen=[];
  notifications=[];demo=null;
}
function startStage(index){
  const stage=demoStages[index];
  demo={status:'running',index,label:stage.label,startedAt:uptime};
  Object.assign(input,{a:stage.distance,b:stage.distance,speed:stage.speed});
}
function finishDemo(status){
  demo={status};
  input.speed=1;
}
function advanceDemo(){
  if(demo?.status!=='running'||uptime-demo.startedAt<demoStages[demo.index].duration)return;
  if(demo.index+1<demoStages.length)startStage(demo.index+1);
  else finishDemo('complete');
}
function control(body){
  if(!body||Array.isArray(body)||typeof body!=='object')throw Error('Yeu cau khong hop le');
  if(body.demo!==undefined){
    if(body.demo==='start'&&demo?.status!=='running'){reset();startStage(0);}
    else if(body.demo==='stop'&&demo?.status==='running')finishDemo('stopped');
    else if(!['start','stop'].includes(body.demo))throw Error('Lenh demo khong hop le');
    return;
  }
  if(body.hand!==undefined&&typeof body.hand!=='boolean')throw Error('hand phai la boolean');
  for(const key of ['a','b'])if(body[key]!==undefined&&body[key]!==null&&(!Number.isFinite(body[key])||body[key]<0||body[key]>400))throw Error('Khoang cach tu 0 den 400 cm hoac null de gia lap mat Echo');
  if(body.speed!==undefined&&![1,5,10].includes(body.speed))throw Error('Toc do: 1, 5 hoac 10');
  if(body.command!==undefined&&!Object.hasOwn(commands,body.command)&&body.command!=='reset')throw Error('Lenh khong hop le');
  if(body.scene!==undefined&&!['normal','paper_a','paper_both','bag','hidden_paper'].includes(body.scene))throw Error('Canh khong hop le');
  if(pending.length>=16)throw Error('Dang co nhieu lenh cho xu ly');
  if(demo?.status==='running')finishDemo('stopped');
  for(const k of ['hand','a','b','speed','scene'])if(body[k]!==undefined)input[k]=body[k];
  if(body.command==='reset')reset();
  else if(body.command)queue(body.command);
}
async function handle(req,res) {
  const url=new URL(req.url,'http://127.0.0.1:'+webPort);
  if(req.method==='POST'&&url.pathname==='/api/shutdown') {
    const origin=req.headers.origin;
    if(origin&&![`http://127.0.0.1:${webPort}`,`http://localhost:${webPort}`].includes(origin))return json(res,403,{error:'Chi nhan thao tac cuc bo'});
    json(res,202,{stopping:true});setTimeout(()=>shutdown(),50);return;
  }
  if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,state());
  if(req.method==='POST'&&url.pathname==='/api/control') {
    if(fromWokwi)return json(res,409,{error:'Chế độ Wokwi nhận dữ liệu từ mạch. Hãy thao tác cảm biến trong Wokwi.'});
    const origin=req.headers.origin;
    if(origin&&![`http://127.0.0.1:${webPort}`,`http://localhost:${webPort}`].includes(origin))return json(res,403,{error:'Chi nhan thao tac tu giao dien cuc bo'});
    let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)return json(res,413,{error:'Du lieu qua dai'});}
    try{control(JSON.parse(body));return json(res,202,{accepted:true});}catch(e){return json(res,400,{error:e.message});}
  }
  if(req.method==='GET'&&url.pathname==='/') {
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(fs.readFileSync(path.join(__dirname,'index.html')));
  }
  json(res,404,{error:'Khong tim thay'});
}
async function main(){
  const exe=path.join(__dirname,'bin/smartbin-sim.exe');
  if(!fromWokwi&&!fs.existsSync(exe))throw Error('Thieu simulator/bin/smartbin-sim.exe. Chay scripts/build_native.ps1 de build lai.');
  for(const p of [webPort,mqttPort,redPort])await unused(p);
  aedes=require(path.join(deps,'aedes'))();const mqtt=require(path.join(deps,'mqtt'));
  broker=net.createServer(aedes.handle);await new Promise((r,j)=>{broker.once('error',j);broker.listen(mqttPort,'127.0.0.1',r);});
  const clientOptions=fromWokwi?{clientId:'smartbin-wokwi-view'}:
    {clientId:'smartbin-desktop',will:{topic:prefix+'/availability',payload:'offline',retain:true}};
  client=mqtt.connect('mqtt://127.0.0.1:'+mqttPort,clientOptions);
  await new Promise((r,j)=>{client.once('connect',r);client.once('error',j);});
  await client.subscribeAsync([prefix+(fromWokwi?'/display':'/command'),prefix+'/alert']);
  if(!fromWokwi)client.publish(prefix+'/availability','online',{retain:true});
  client.on('error',e=>log('MQTT: '+e.message));
  client.on('message',(topic,payload)=>{
    try{
      const p=JSON.parse(payload);
      if(fromWokwi&&topic===prefix+'/display'&&p.source==='esp32'){
        if(p.boot_id!==boot)notifications=[];
        boot=p.boot_id;
        model=p;lastNativeAt=Date.now();
        input.hand=p.hand_detected;
        if(p.sensor_a_ok)input.a=p.distance_a_cm;
        if(p.sensor_b_ok)input.b=p.distance_b_cm;
        return;
      }
      if(p.boot_id!==boot)return;
      if(topic===prefix+'/alert'){
        if([80,90,100].includes(p.fill_milestone)&&typeof p.text==='string'){
          notifications.push({level:p.fill_milestone,text:p.text});
          if(notifications.length>6)notifications.shift();
        }
        return;
      }
      if(fromWokwi)return;
      if(!Object.hasOwn(commands,p.command)||typeof p.request_id!=='string'||p.request_id.length>48||!p.request_id.length||seen.includes(p.request_id)||!Number.isInteger(p.expires_at_uptime_ms)||pending.length>=16)return;
      const left=(p.expires_at_uptime_ms-uptime)|0;if(left<=0||left>10000)return;
      if(demo?.status==='running')finishDemo('stopped');
      seen.push(p.request_id);if(seen.length>24)seen.shift();queue(p.command,p.request_id,p.expires_at_uptime_ms);
    }catch{}
  });
  if(!fromWokwi){
    engine=launch(exe,[]);
    engine.stderr.on('data',d=>log(String(d)));
    engine.on('exit',code=>{if(!stopping){log('Bo dieu khien dung: '+code);shutdown(1);}});
    createInterface({input:engine.stdout}).on('line',line=>{
      try {
        const p=JSON.parse(line),job=inflight;if(!job)return;
        if(job.id)lastAck={last_command_id:job.id,last_command_result:job.expired?'expired':!p.command_applied?'rejected':['begin_service','finish_service'].includes(job.command)?'accepted':'applied'};
        model={...p,boot_id:job.boot,...lastAck};inflight=null;lastNativeAt=Date.now();
        if(!model.sensor_ok)model.fill_percent=model.distance_cm=null;
      } catch(e){log('Core: '+e.message);shutdown(1);}
    });
  }
  const runtime=path.join(root,'node-red/.sim-runtime-'+webPort);fs.mkdirSync(runtime,{recursive:true});
  const flows=JSON.parse(fs.readFileSync(path.join(root,'node-red/flows.json')));
  Object.assign(flows.find(n=>n.id==='bin-broker'),{broker:'127.0.0.1',port:String(mqttPort),name:'LOCAL SIMULATION ONLY'});
  flows.find(n=>n.type==='tab').label=fromWokwi?'WOKWI CỤC BỘ · Hai HC-SR04':'MÔ PHỎNG V4 · Hai HC-SR04';
  flows.find(n=>n.type==='tab').env.find(e=>e.name==='BIN_TOPIC_PREFIX').value=prefix;
  const ingest=flows.find(n=>n.id==='ingest');
  ingest.wires[1].push('desktop-alert-out');
  flows.push({id:'desktop-alert-out',type:'mqtt out',z:ingest.z,name:'Cảnh báo tới trang mô phỏng',
    broker:'bin-broker',topic:prefix+'/alert',qos:'0',retain:'false',x:1110,y:225,wires:[]});
  if(fromWokwi){
    ingest.wires[0].push('wokwi-display-out');
    flows.push({id:'wokwi-display-out',type:'mqtt out',z:ingest.z,name:'Dữ liệu tới trang mô phỏng',
      broker:'bin-broker',topic:prefix+'/display',qos:'0',retain:'false',x:1110,y:98,wires:[]});
  }
  fs.writeFileSync(path.join(runtime,'flows.json'),JSON.stringify(flows,null,2));
  fs.writeFileSync(path.join(runtime,'settings.cjs'),`module.exports={uiHost:'127.0.0.1',uiPort:${redPort},contextStorage:{default:{module:'memory'}},logging:{console:{level:'info'}}};`);
  red=launch(process.execPath,[path.join(deps,'node-red/red.js'),'--userDir',runtime,'--settings',path.join(runtime,'settings.cjs'),path.join(runtime,'flows.json')],{env:{...process.env,TELEGRAM_ENABLED:String(telegramEnabled)}});
  red.stdout.on('data',d=>{const t=String(d);if(t.includes('Started flows'))redReady=true;log(t.trim());});
  red.stderr.on('data',d=>log(String(d).trim()));
  red.on('exit',code=>{redReady=false;if(!stopping){log('Node-RED dung: '+code);shutdown(1);}});
  web=http.createServer((req,res)=>handle(req,res).catch(e=>json(res,500,{error:e.message})));
  await new Promise((r,j)=>{web.once('error',j);web.listen(webPort,'127.0.0.1',r);});
  let publishedAt=0;
  if(!fromWokwi)timer=setInterval(()=>{
    if(inflight){if(Date.now()-inflight.at>3000){log('Core khong phan hoi');shutdown(1);}return;}
    advanceDemo();
    uptime=(uptime+50*input.speed)>>>0;
    const job=pending.shift()||{action:0,id:''};
    if(job.deadline!==null&&job.deadline!==undefined&&((job.deadline-uptime)|0)<=0){job.expired=true;job.action=0;}
    inflight={...job,at:Date.now(),boot};
    engine.stdin.write([uptime,input.hand?1:0,input.a===null?'nan':input.a,input.b===null?'nan':input.b,job.action].join(' ')+'\n');
    if(model&&Date.now()-publishedAt>=500&&Date.now()-lastNativeAt<1500){
      client.publish(prefix+'/telemetry',JSON.stringify(model));publishedAt=Date.now();
    }
  },50);
  log('MO PHONG: http://127.0.0.1:'+webPort+'/');
  log('NODE-RED: http://127.0.0.1:'+redPort+'/ | Dashboard: /bin');
  log(`MQTT noi bo: 127.0.0.1:${mqttPort}. Telegram: ${telegramEnabled?'bat':'tat'}. Ctrl+C de dung.`);
  if(fromWokwi)log('Cho Wokwi Local gui du lieu qua Private Gateway.');
}
async function shutdown(code=0){
  if(stopping)return;stopping=true;clearInterval(timer);
  const forced=setTimeout(()=>process.exit(code),2500);forced.unref();
  if(client){try{if(client.connected){if(!fromWokwi)await client.publishAsync(prefix+'/availability','offline',{retain:true});await client.endAsync();}else client.end(true);}catch{client.end(true);}}
  for(const c of children)if(c.exitCode===null)c.kill();
  if(web)web.close();if(broker)broker.close();if(aedes)aedes.close();
  setTimeout(()=>process.exit(code),300).unref();
}
process.on('SIGINT',()=>shutdown());process.on('SIGTERM',()=>shutdown());
module.exports={shutdown};
main().catch(e=>{console.error(e.message);console.error('Neu thieu thu vien: chay npm ci --prefix node-red --include=dev tu thu muc du an');shutdown(1);});
