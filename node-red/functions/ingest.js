const p=msg.payload;
const states=['warming','settling','sensor_fault','normal','checking','obstruction_suspected','high_unverified','full','inspection_required','service','empty_check','bag_check_failed'];
const modes=['operating','servicing','verifying_empty','service_failed'];
const uint=v=>Number.isInteger(v)&&v>=0&&v<=4294967295;
const percent=v=>Number.isFinite(v)&&v>=0&&v<=100;
if(!p||p.schema!==4||typeof p.boot_id!=='string'||!/^[0-9a-f]{16}$/.test(p.boot_id)||!uint(p.uptime_ms)||
 !['esp32','desktop_simulator'].includes(p.source)||p.mouth_sensor_available!==false||p.mouth_blocked!==null||p.lid_position_confirmed!==false||
 !['paused_open','settling','warming','ready','fault'].includes(p.measurement_status)||
 !states.includes(p.level_state)||!modes.includes(p.service_mode)||![1,2].includes(p.sensor_count)||
 !['sensor_ok','sensor_a_ok','sensor_b_ok','hand_held','empty_verified','full','hand_detected','muted','remote_control'].every(k=>typeof p[k]==='boolean')||
 !['open','closed'].includes(p.lid)||!uint(p.open_count)||typeof p.last_command_id!=='string'||
 !['none','applied','accepted','rejected','expired'].includes(p.last_command_result))return null;
if(p.sensor_ok&&(!percent(p.fill_percent)||!Number.isFinite(p.distance_cm)||!uint(p.sample_age_ms)||p.sample_age_ms>6500))return null;
if(p.sensor_ok&&(!p.sensor_a_ok||!percent(p.fill_a_percent)))return null;
if(p.sensor_ok&&p.sensor_count===2&&(!p.sensor_b_ok||!percent(p.fill_b_percent)))return null;
if(p.full!==(p.level_state==='full'))return null;
if(['paused_open','settling'].includes(p.measurement_status)&&(p.sensor_ok||p.sensor_a_ok||p.sensor_b_ok))return null;
if(p.sensor_ok&&p.measurement_status!=='ready')return null;
if(p.lid==='open'&&p.measurement_status!=='paused_open')return null;
if(p.full&&(!p.sensor_ok||p.sensor_count!==2||!p.empty_verified||p.lid!=='closed'||p.service_mode!=='operating'||p.fill_a_percent<85||p.fill_b_percent<85))return null;
const old=flow.get('latest');
if(old&&old.telemetry.boot_id===p.boot_id){
 const advance=(p.uptime_ms-old.telemetry.uptime_ms)>>>0;
 if(advance===0||advance>=2147483648)return null; // Duplicates do not refresh online state.
}
const now=Date.now();
flow.set('latest',{telemetry:p,received_at:now});flow.set('availability','online');
const newBoot=!old||old.telemetry.boot_id!==p.boot_id;
const times=newBoot?{}:(flow.get('alertTimes')||{});
if(newBoot)flow.set('alertTimes',times);
const lastMilestone=flow.get('fillMilestone')||0;
if(p.service_mode==='operating'&&p.sensor_count===2&&p.sensor_ok&&p.empty_verified&&
 ['normal','checking','full'].includes(p.level_state)){
 const level=Math.min(p.fill_a_percent,p.fill_b_percent);
 if(lastMilestone&&Math.max(p.fill_a_percent,p.fill_b_percent)<=15){
  flow.set('fillMilestone',0);
 }
 // At 100%, wait for the firmware's full confirmation before notifying.
 const milestone=level>=100?(p.full?100:0):level>=90?90:level>=80?80:0;
 if(milestone>lastMilestone){
  const text={
   80:'Thùng rác đã đạt 80%. Thùng sắp đầy.',
   90:'Thùng rác đã đạt 90%. Vui lòng thu gom sớm.',
   100:'Thùng rác đã đầy 100%. Vui lòng thu gom ngay.'
  };
  flow.set('fillMilestone',milestone);
  return [msg,{payload:{boot_id:p.boot_id,level_state:p.level_state,fill_milestone:milestone,text:text[milestone]}}];
 }
}
const messages={
 obstruction_suspected:'Hai cảm biến đo chênh lệch. Vui lòng kiểm tra rác dồn lệch hoặc vật che.',
 inspection_required:'Mức rác tăng đột ngột. Vui lòng kiểm tra giấy hoặc túi có che cảm biến không.',
 high_unverified:'Mức rác đang cao. Vui lòng kiểm tra bên trong thùng.',
 bag_check_failed:'Kiểm tra túi mới chưa đạt. Hãy chỉnh lại mép túi rồi kiểm tra lại.',
 sensor_fault:'Không đo được mức rác. Vui lòng kiểm tra hai cảm biến.',
 hand_held:'Cảm biến tay bị che quá 30 giây. Vui lòng kiểm tra phía trước thùng.'
};
const key=messages[p.level_state]?p.level_state:(p.hand_held&&p.service_mode==='operating'?'hand_held':'');
if(!key)return [msg,null];
if(times[key]!==undefined&&now-times[key]<60000)return [msg,null];
times[key]=now;flow.set('alertTimes',times);
return [msg,{payload:{level_state:key,text:messages[key]}}];
