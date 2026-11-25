// Regenerate flows.json after editing the dashboard or functions in this file.
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),tab='bin-flow',broker='bin-broker';
const prefix='iot/nhom6/bin-a7f39c';
const nodes=[];
function add(id,type,name,x,y,props={},wires=[]){nodes.push({id,type,z:tab,name,x,y,...props,wires});}
nodes.push({id:tab,type:'tab',label:'Nhóm 6 · Smart Bin',disabled:false,info:'Open http://127.0.0.1:1880/bin . Core nodes only. Change broker in MQTT config node. Change BIN_TOPIC_PREFIX in this tab environment to match firmware.'});
nodes.push({id:broker,type:'mqtt-broker',name:'Smart Bin MQTT',broker:'broker.hivemq.com',port:'1883',clientid:'',autoConnect:true,usetls:false,protocolVersion:'4',keepalive:'30',cleansession:true,autoUnsubscribe:true,birthTopic:'',birthQos:'0',birthPayload:'',birthMsg:{},closeTopic:'',closeQos:'0',closePayload:'',closeMsg:{},willTopic:'',willQos:'0',willPayload:'',willMsg:{}});
nodes[0].env=[{name:'BIN_TOPIC_PREFIX',value:prefix,type:'str'},
 {name:'BIN_TELEMETRY_TOPIC',value:'${BIN_TOPIC_PREFIX}/telemetry',type:'env'},
 {name:'BIN_AVAILABILITY_TOPIC',value:'${BIN_TOPIC_PREFIX}/availability',type:'env'}];
add('telemetry','mqtt in','Dữ liệu ESP32',120,100,{topic:'${BIN_TELEMETRY_TOPIC}',qos:'0',datatype:'json',broker,nl:false,rap:true,rh:0,inputs:0},[['ingest']]);
add('availability','mqtt in','LWT online/offline',130,200,{topic:'${BIN_AVAILABILITY_TOPIC}',qos:'1',datatype:'utf8',broker,nl:false,rap:true,rh:0,inputs:0},[['save-availability']]);
add('save-availability','function','Lưu kết nối',370,200,{func:`flow.set('availability',String(msg.payload)); return null;`,outputs:0},[]);
add('ingest','function','Kiểm tra + lưu + cảnh báo',450,110,{outputs:2,func:fs.readFileSync(path.join(root,'node-red/functions/ingest.js'),'utf8')},[['telemetry-debug','watch-ack'],['alert-debug','telegram']]);
add('telemetry-debug','debug','1 · ESP32 → Node-RED: dữ liệu',730,65,{active:true,tosidebar:true,console:false,tostatus:false,complete:'payload',targetType:'msg'},[]);
add('watch-ack','function','Đọc xác nhận từ ESP32',750,140,{outputs:1,func:`const p=msg.payload,id=p.last_command_id,key=p.boot_id+':'+id;if(!id||key===context.get('lastKey'))return null;context.set('lastKey',key);return {payload:{request_id:id,result:p.last_command_result,lid:p.lid,muted:p.muted,level_state:p.level_state,service_mode:p.service_mode}};`},[['ack-debug']]);
add('ack-debug','debug','3 · ESP32 trả kết quả lệnh',1050,140,{active:true,tosidebar:true,console:false,tostatus:false,complete:'payload',targetType:'msg'},[]);
add('alert-debug','debug','Cảnh báo (luôn xem được)',740,120,{active:true,tosidebar:true,console:false,tostatus:false,complete:'payload',targetType:'msg'},[]);
add('telegram','function','Telegram: chỉ bật bằng biến môi trường',760,200,{outputs:1,func:`
if(env.get('TELEGRAM_ENABLED')!=='true') return null;
const token=env.get('TELEGRAM_BOT_TOKEN'), chat=env.get('TELEGRAM_CHAT_ID');
if(!token||!chat){node.warn('Thiếu TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID');return null;}
msg.method='POST';
msg.url='https://api.telegram.org/bot'+token+'/sendMessage';
msg.headers={'content-type':'application/json'};
msg.payload={chat_id:chat,text:msg.payload.text};
return msg;`.trim()},[['telegram-http']]);
add('telegram-http','http request','Gửi Telegram',1030,200,{method:'use',ret:'obj',paytoqs:'ignore',url:'',tls:'',persist:false,proxy:'',insecureHTTPParser:false,senderr:false,headers:[]},[['telegram-result']]);
add('telegram-result','function','Kiểm tra phản hồi Telegram',1280,200,{outputs:1,func:`if(msg.statusCode!==200||!msg.payload||msg.payload.ok!==true){node.warn('Telegram gửi thất bại; kiểm tra token/chat/network (không ghi token vào log).');} return {payload:{statusCode:msg.statusCode,ok:!!(msg.payload&&msg.payload.ok)}};`},[['telegram-debug']]);
add('telegram-debug','debug','Kết quả Telegram',1520,200,{active:true,tosidebar:true,complete:'payload',targetType:'msg'},[]);
add('dashboard-in','http in','GET /bin',110,340,{url:'/bin',method:'get',upload:false,swaggerDoc:''},[['dashboard']]);
add('dashboard','template','Bảng giám sát tiếng Việt',390,340,{field:'payload',fieldType:'msg',format:'html',syntax:'plain',template:fs.readFileSync(path.join(root,'node-red/dashboard.html'),'utf8'),output:'str'},[['html-headers']]);
add('html-headers','function','HTML UTF-8',650,340,{outputs:1,func:`msg.headers={'content-type':'text/html; charset=utf-8','cache-control':'no-store'};return msg;`},[['http-response']]);
add('api-in','http in','GET /bin/api',120,420,{url:'/bin/api',method:'get',upload:false,swaggerDoc:''},[['api']]);
add('api','function','Dữ liệu + kiểm tra quá hạn',400,420,{outputs:1,func:`const s=flow.get('latest')||{},age=s.received_at?Date.now()-s.received_at:-1;msg.headers={'content-type':'application/json','cache-control':'no-store'};msg.payload={...s,online:age>=0&&age<6000&&flow.get('availability')!=='offline'};return msg;`},[['http-response']]);
add('command-in','http in','POST /bin/api/command',160,510,{url:'/bin/api/command',method:'post',upload:false,swaggerDoc:''},[['command']]);
add('command','function','Kiểm tra lệnh + hạn dùng',500,750,{outputs:2,func:fs.readFileSync(path.join(root,'node-red/functions/command.js'),'utf8')},[['mqtt-command','command-debug'],['http-response']]);
add('command-debug','debug','2 · Node-RED → ESP32: lệnh',800,570,{active:true,tosidebar:true,console:false,tostatus:false,complete:'payload',targetType:'msg'},[]);
add('mqtt-command','mqtt out','Lệnh ESP32 · KHÔNG retain',770,500,{topic:'',qos:'0',retain:'false',respTopic:'',contentType:'',userProps:'',correl:'',expiry:'',broker},[]);
add('http-response','http response','HTTP response',1000,380,{statusCode:'',headers:{}},[]);
add('catch','catch','Bắt lỗi flow',160,620,{scope:null,uncaught:false},[['error-debug']]);
add('error-debug','debug','Lỗi flow',410,620,{active:true,tosidebar:true,complete:'error.message',targetType:'msg'},[]);
add('note-uplink','comment','① DỮ LIỆU: ESP32 → MQTT → kiểm tra / cảnh báo',390,40,{info:'Mở Debug sidebar. Node 1 hiển thị telemetry schema 4. Phân loại mức rác thực hiện trong firmware; Node-RED kiểm tra/lưu/cảnh báo. Node 3 đọc last_command_id mà ESP32 báo lại.'},[]);
add('note-dashboard','comment','② GIAO DIỆN: trình duyệt đọc dữ liệu đã lưu',390,450,{info:'GET /bin phục vụ giao diện. GET /bin/api trả trạng thái mới nhất và kiểm tra quá hạn 6 giây. Đây không phải một broker MQTT khác.'},[]);
add('note-command','comment','③ ĐIỀU KHIỂN: nút bấm → MQTT → ESP32',430,690,{info:'POST /bin/api/command kiểm tra lệnh và sinh request_id. Node 2 cho thấy lệnh gửi đi. last_command_id trong telemetry là xác nhận ESP32 đã áp dụng, không xác nhận vị trí servo thực.'},[]);
const positions={
 'telemetry':[140,110],'ingest':[450,110],'telemetry-debug':[800,70],
 'watch-ack':[800,140],'ack-debug':[1120,140],'alert-debug':[810,210],
 'telegram':[820,280],'telegram-http':[1120,280],'telegram-result':[1380,280],'telegram-debug':[1630,280],
 'availability':[150,370],'save-availability':[440,370],
 'dashboard-in':[150,500],'dashboard':[450,500],'html-headers':[760,500],
 'api-in':[150,580],'api':[470,580],'http-response':[1110,580],
 'command-in':[180,750],'command':[500,750],'mqtt-command':[860,750],'command-debug':[880,820],
 'catch':[160,910],'error-debug':[450,910]
};
for(const n of nodes)if(positions[n.id])[n.x,n.y]=positions[n.id];
fs.writeFileSync(path.join(root,'node-red/flows.json'),JSON.stringify(nodes,null,2)+'\n');
console.log('Generated node-red/flows.json ('+nodes.length+' nodes)');
