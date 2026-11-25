// Exercises the real launcher and stack without opening test browser tabs.
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:18766';
const red = 'http://127.0.0.1:18883';
const env = { ...process.env, SIM_WEB_PORT: '18766', SIM_NODE_RED_PORT: '18883', SIM_MQTT_PORT: '18887', SIM_STARTUP_TIMEOUT_MS: '20000' };
const children = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let foreign;
function launch(overrides = {}, args = []) {
  const child = spawn(process.execPath, [path.join(root, 'scripts/start_project.cjs'), '--no-browser', ...args],
    { cwd: root, windowsHide: true, env: { ...env, ...overrides } });
  child.logs = '';
  child.stdout.on('data', b => child.logs += b);
  child.stderr.on('data', b => child.logs += b);
  child.finished = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  children.push(child);
  return child;
}
async function until(check, label, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const result = await check(); if (result) return result; } catch {}
    await pause(100);
  }
  throw Error(label + '\n' + children.map(c => c.logs).join('\n'));
}
async function waitExit(child) {
  let deadline;
  try {
    const code = await Promise.race([child.finished, new Promise((_resolve, reject) => {
      deadline = setTimeout(() => reject(Error('Launcher did not exit: ' + child.logs)), 25000);
    })]);
    assert.equal(code, 0, child.logs);
  } finally { clearTimeout(deadline); }
}
async function portFree(port) {
  return new Promise(resolve => { const server = net.createServer(); server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => server.close(() => resolve(true))); });
}
async function run() {
  for (const port of [18766, 18883, 18887, 18767, 18884, 18888]) assert(await portFree(port), 'Test port busy: ' + port);
  const first = launch();
  await until(() => first.logs.includes('Đang bật'), 'first launcher started');
  const concurrent = launch();
  await until(async () => {
    const s = await fetch(base + '/api/state').then(r => r.json());
    const d = await fetch(red + '/bin/api').then(r => r.json());
    return s.online && s.node_red_ready && d.online && s.telemetry.boot_id === d.telemetry.boot_id;
  }, 'all services connected');
  await waitExit(concurrent);
  assert(concurrent.logs.includes('cửa sổ khác') || concurrent.logs.includes('dùng lại'), concurrent.logs);
  const before = await fetch(base + '/api/state').then(r => r.json());
  const repeated = launch();
  await waitExit(repeated);
  assert(repeated.logs.includes('dùng lại'), repeated.logs);
  assert.equal((await fetch(base + '/api/state').then(r => r.json())).telemetry.boot_id, before.telemetry.boot_id);
  const response = await fetch(red + '/bin/api/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command: 'open' }) });
  assert.equal(response.status, 202);
  const command = await response.json();
  await until(async () => {
    const d = await fetch(red + '/bin/api').then(r => r.json());
    return d.telemetry.last_command_id === command.request_id && d.telemetry.last_command_result === 'applied' && d.telemetry.lid === 'open';
  }, 'MQTT command/ACK after launcher startup');
  foreign = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  await new Promise(resolve => foreign.listen(18767, '127.0.0.1', resolve));
  const conflict = launch({ SIM_WEB_PORT: '18767', SIM_NODE_RED_PORT: '18884', SIM_MQTT_PORT: '18888' });
  assert.equal(await conflict.finished, 1, conflict.logs);
  assert(conflict.logs.includes('Cổng 18767'), conflict.logs);
  assert.equal((await fetch('http://127.0.0.1:18767/')).status, 200, 'unrelated server was not stopped');
  assert(await portFree(18884));assert(await portFree(18888));
  await fetch(base + '/api/shutdown', { method: 'POST' });
  await waitExit(first);
  await until(async () => (await Promise.all([18766, 18883, 18887].map(portFree))).every(Boolean), 'all project ports released');
  const telegram = launch({TELEGRAM_ENABLED:'true',TELEGRAM_BOT_TOKEN:'1:fake',TELEGRAM_CHAT_ID:'123'},['--wokwi','--send-telegram']);
  await until(async () => {
    const s=await fetch(base+'/api/state').then(r=>r.json());
    return s.mode==='wokwi'&&s.telegram_enabled&&s.node_red_ready&&!s.online;
  },'Telegram opt-in in Wokwi mode while waiting for telemetry');
  await fetch(base+'/api/shutdown',{method:'POST'});
  await waitExit(telegram);
  await until(async () => (await Promise.all([18766,18883,18887].map(portFree))).every(Boolean),'Telegram fixture ports released');

  const wokwi=launch({},['--wokwi']);
  await until(async () => {
    const s=await fetch(base+'/api/state').then(r=>r.json());
    return s.mode==='wokwi'&&!s.telegram_enabled&&s.node_red_ready&&!s.online;
  },'Wokwi view starts before Wokwi sends data');
  const mqtt=require('../node-red/node_modules/mqtt');
  const client=mqtt.connect('mqtt://127.0.0.1:18887',{reconnectPeriod:0,connectTimeout:3000});
  try {
    await new Promise((resolve,reject)=>{client.once('connect',resolve);client.once('error',reject);});
    const sample={schema:4,source:'esp32',boot_id:'abcdef0123456789',uptime_ms:1000,
      mouth_sensor_available:false,mouth_blocked:null,lid_position_confirmed:false,measurement_status:'ready',
      level_state:'normal',service_mode:'operating',sensor_count:2,empty_verified:true,hand_held:false,
      sensor_ok:true,sensor_a_ok:true,sensor_b_ok:true,fill_percent:80,fill_a_percent:80,fill_b_percent:80,
      distance_cm:11.2,distance_a_cm:11.2,distance_b_cm:11.2,sample_age_ms:0,lid:'closed',full:false,
      hand_detected:false,muted:false,remote_control:true,open_count:0,last_command_id:'',last_command_result:'none'};
    const state=await until(async () => {
      sample.uptime_ms+=1000;
      await client.publishAsync('sim/nhom6/bin-wokwi/telemetry',JSON.stringify(sample));
      const s=await fetch(base+'/api/state').then(r=>r.json());
      return s.online&&s.telemetry.source==='esp32'&&s.notifications.length&&s;
    },'ESP32 telemetry and Node-RED alert appear on the simulator page');
    assert.deepEqual(state.notifications.map(n=>n.level),[80]);
    const invalid=await fetch(base+'/api/control',{method:'POST',headers:{'content-type':'application/json'},body:'{"demo":"start"}'});
    assert.equal(invalid.status,409);
  } finally { await client.endAsync(); }
  await fetch(base+'/api/shutdown',{method:'POST'});
  await waitExit(wokwi);
  console.log('PASS: desktop startup, concurrent clicks, reuse, MQTT command/ACK, port conflict, Wokwi telemetry and alerts, Telegram opt-in, shutdown.');
}
run().catch(e => { console.error(e);process.exitCode = 1; }).finally(async () => {
  try { await fetch(base + '/api/shutdown', { method: 'POST' }); } catch {}
  if (foreign) await new Promise(resolve => foreign.close(resolve));
  for (const c of children) if (c.exitCode === null) await Promise.race([c.finished, pause(4000)]);
  for (const c of children) if (c.exitCode === null) c.kill();
});
