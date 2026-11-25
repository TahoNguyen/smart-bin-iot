// One entry point for the desktop simulator, local MQTT, Node-RED and browser.
// Load the server in this process so its Ctrl+C/shutdown handler owns all children.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const noBrowser = process.argv.includes('--no-browser');
const fromWokwi = process.argv.includes('--wokwi');
const sendTelegram = process.argv.includes('--send-telegram');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const ports = {
  web: Number(process.env.SIM_WEB_PORT || 8765),
  red: Number(process.env.SIM_NODE_RED_PORT || 1882),
  mqtt: Number(process.env.SIM_MQTT_PORT || 18885)
};
const urls = {
  simulator: `http://127.0.0.1:${ports.web}/`,
  dashboard: `http://127.0.0.1:${ports.red}/bin`,
  editor: `http://127.0.0.1:${ports.red}/`
};
const timeout = Number(process.env.SIM_STARTUP_TIMEOUT_MS || 60000);
const lockPath = path.join(root, 'node-red', `.sim-launcher-${ports.web}.lock`);
let ownsLock = false;

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(1200), cache: 'no-store' });
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  return response.json();
}
function isProject(s) {
  return s && s.mode === (fromWokwi ? 'wokwi' : 'desktop') && s.telegram_enabled === sendTelegram
    && s.mqtt && s.mqtt.prefix === (fromWokwi ? 'sim/nhom6/bin-wokwi' : 'sim/nhom6/bin-desktop')
    && s.mqtt.host === '127.0.0.1' && s.mqtt.port === ports.mqtt
    && s.links && s.links.editor === urls.editor && s.links.dashboard === urls.dashboard;
}
async function ready() {
  const s = await getJson(urls.simulator + 'api/state');
  if (!isProject(s) || !s.node_red_ready) return false;
  const dashboard = await getJson(`http://127.0.0.1:${ports.red}/bin/api`);
  if (fromWokwi) return typeof dashboard.online === 'boolean';
  return s.online && s.telemetry?.schema === 4 && dashboard.online && dashboard.telemetry
    && dashboard.telemetry.source === 'desktop_simulator'
    && dashboard.telemetry.boot_id === s.telemetry.boot_id;
}
async function waitReady() {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await ready()) return; } catch {}
    await pause(250);
  }
  throw Error('Hết thời gian chờ mô phỏng và Node-RED. Xem thông báo khởi động ở trên.');
}
function releaseLock() {
  if (!ownsLock) return;
  try {
    if (fs.readFileSync(lockPath, 'utf8').trim() === String(process.pid)) fs.unlinkSync(lockPath);
  } catch {}
  ownsLock = false;
}
function lock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, String(process.pid));
      fs.closeSync(fd);
      ownsLock = true;
      process.once('exit', releaseLock);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(fs.readFileSync(lockPath, 'utf8').trim());
      if (!Number.isInteger(pid) || pid <= 0) return false;
      try { process.kill(pid, 0); return false; } catch (probe) {
        if (probe.code !== 'ESRCH') return false;
      }
      // Only remove a lock whose recorded owner has already exited.
      fs.unlinkSync(lockPath);
    }
  }
  return false;
}
async function assertFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(Error(
      `Cổng ${port} đang có chương trình khác sử dụng. Hãy đóng phiên đó rồi chạy lại. File này không tự tắt chương trình khác.`
    )));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
function run(exe, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(Error(`Tiến trình kết thúc với mã ${code}.`)));
  });
}
async function dependencies() {
  const deps = path.join(root, 'node-red', 'node_modules');
  const required = ['node-red/red.js', 'mqtt/package.json', 'aedes/package.json'];
  if (required.every(file => fs.existsSync(path.join(deps, file)))) return;
  if (fs.existsSync(path.join(root, 'PORTABLE.json'))) {
    throw Error('Gói portable thiếu thư viện. Hãy giải nén lại toàn bộ ZIP, giữ nguyên các thư mục đi kèm.');
  }
  console.log('Lần đầu chạy: đang cài thư viện dự án. Bước này cần Internet.');
  const npm = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(npm)) throw Error('Thiếu npm đi kèm Node.js. Hãy cài lại Node.js LTS rồi chạy lại.');
  await run(process.execPath, [npm, 'ci', '--include=dev', '--no-audit', '--no-fund'], path.join(root, 'node-red'));
}
function openUrl(url) {
  // URLs contain only a fixed loopback host, validated numeric port and fixed path.
  return run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '', url]);
}
async function showPages() {
  console.log('\nĐồ án đã sẵn sàng:');
  console.log(`  Mô phỏng: ${urls.simulator}`);
  console.log(`  Dashboard: ${urls.dashboard}`);
  console.log(`  Luồng Node-RED: ${urls.editor}`);
  if (fromWokwi) console.log('  Chọn wokwi-local/wokwi.toml trong VS Code và bật Private Gateway.');
  if (!noBrowser) {
    try {
      await openUrl(urls.simulator);
    } catch (e) {
      console.log('Không tự mở được trình duyệt. Mở các địa chỉ ở trên. ' + e.message);
    }
  }
  console.log('\nDừng toàn bộ bằng nút “Dừng mô phỏng” trên web hoặc Ctrl+C tại cửa sổ đang chạy.');
}
async function main() {
  if (Number(process.versions.node.split('.')[0]) < 18) throw Error('Cần Node.js 18 trở lên. Hãy cài Node.js LTS.');
  if (Object.values(ports).some(p => !Number.isInteger(p) || p < 1 || p > 65535)
    || new Set(Object.values(ports)).size !== 3) throw Error('Ba cổng SIM_*_PORT phải khác nhau và thuộc 1–65535.');
  if (!Number.isFinite(timeout) || timeout < 1000) throw Error('Thời gian chờ khởi động không hợp lệ.');
  if (sendTelegram && (process.env.TELEGRAM_ENABLED !== 'true' || !process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID)) {
    throw Error('Chạy CHAY-DO-AN-TELEGRAM.cmd để nhập thông tin bot.');
  }
  console.log('THÙNG RÁC THÔNG MINH IoT\n');
  try {
    if (await ready()) {
      console.log('Đang dùng lại phiên đồ án đã chạy.');
      await showPages();
      return;
    }
  } catch {}
  if (!lock()) {
    console.log('Một cửa sổ khác đang khởi động đồ án. Đang chờ...');
    await waitReady();
    console.log('Đồ án đã sẵn sàng. Cửa sổ đầu tiên sẽ mở trang mô phỏng.');
    return;
  }
  try {
    // Another launcher may have completed startup just before we took its lock.
    try { if (await ready()) { await showPages(); return; } } catch {}
    if (!fromWokwi && !fs.existsSync(path.join(root, 'simulator', 'bin', 'smartbin-sim.exe'))) {
      throw Error('Thiếu simulator/bin/smartbin-sim.exe. Hãy khôi phục file từ gói đồ án hoặc chạy scripts/build_native.ps1.');
    }
    await Promise.all(Object.values(ports).map(assertFree));
    await dependencies();
    console.log('Đang bật bộ điều khiển, MQTT và Node-RED...');
    require('../simulator/server.cjs');
    await waitReady();
    await showPages();
  } finally { releaseLock(); }
}
main().catch(async e => {
  releaseLock();
  console.error('\nKhông thể khởi động: ' + e.message);
  // If startup reached the server, ask its existing shutdown handler to clean up.
  // Never send a shutdown request to an unrelated service on the same port.
  try {
    const server = require.cache[require.resolve('../simulator/server.cjs')];
    if (server) await server.exports.shutdown(1);
  } catch {}
  process.exitCode = 1;
});
