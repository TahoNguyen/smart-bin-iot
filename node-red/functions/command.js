msg.headers={'content-type':'application/json'};
const command=msg.payload&&msg.payload.command;
if(!['open','auto','mute','unmute','begin_service','finish_service','recheck'].includes(command)){
 msg.statusCode=400;msg.payload={error:'Lệnh không hợp lệ'};return [null,msg];
}
const s=flow.get('latest'),now=Date.now();
if(!s||now-s.received_at<0||now-s.received_at>=6000||flow.get('availability')==='offline'){
 msg.statusCode=409;msg.payload={error:'ESP32 ngoại tuyến hoặc dữ liệu quá hạn'};return [null,msg];
}
if(!s.telemetry.remote_control){msg.statusCode=403;msg.payload={error:'Thiết bị đang tắt điều khiển từ xa; dùng cảm biến/nút tại thùng'};return [null,msg];}
if(now-(flow.get('lastCommandAt')||0)<500){msg.statusCode=429;msg.payload={error:'Vui lòng chờ trước khi gửi lệnh tiếp theo'};return [null,msg];}
if(command==='finish_service'&&!['servicing','service_failed'].includes(s.telemetry.service_mode)){
 msg.statusCode=409;msg.payload={error:'Hãy bắt đầu thay túi trước khi yêu cầu kiểm tra'};return [null,msg];
}
if(command==='recheck'&&s.telemetry.service_mode!=='operating'){
 msg.statusCode=409;msg.payload={error:'Đang trong quy trình thay túi; hãy hoàn tất hoặc bắt đầu lại'};return [null,msg];
}
flow.set('lastCommandAt',now);
const request_id=now.toString(36)+'-'+Math.random().toString(36).slice(2,10);
// Convert only the short server receipt age into the device uptime epoch.
const expires_at_uptime_ms=(s.telemetry.uptime_ms+(now-s.received_at)+5000)>>>0;
const outgoing={topic:env.get('BIN_TOPIC_PREFIX')+'/command',payload:JSON.stringify({command,request_id,
 boot_id:s.telemetry.boot_id,expires_at_uptime_ms}),qos:'0',retain:false};
msg.statusCode=202;msg.payload={status:'queued',request_id,boot_id:s.telemetry.boot_id};return [outgoing,msg];
