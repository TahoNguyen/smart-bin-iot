const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'wokwi-online');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'sketch.ino'),'// Generated from src/main.cpp. Edit the PlatformIO source and rerun exporter.\n#include "firmware.h"\n');
fs.copyFileSync(path.join(root,'src/main.cpp'),path.join(out,'firmware.h'));
for(const file of ['config.h','bin_logic.h','supervision.h','controller.h'])fs.copyFileSync(path.join(root,'include',file),path.join(out,file));
fs.copyFileSync(path.join(root,'diagram.json'),path.join(out,'diagram.json'));
const localWokwi=path.join(root,'wokwi-local');
if(fs.existsSync(path.join(localWokwi,'wokwi.toml'))) {
  fs.copyFileSync(path.join(root,'diagram.json'),path.join(localWokwi,'diagram.json'));
}
fs.writeFileSync(path.join(out,'libraries.txt'),'PubSubClient@2.8\nArduinoJson@6.21.5\nBlynk@1.3.2\n');
console.log('Exported wokwi-online. Credentials are not copied.');
