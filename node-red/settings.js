const path = require('path');
module.exports = {
  uiPort: process.env.PORT || 1880,
  uiHost: '127.0.0.1',
  flowFile: path.join(__dirname, 'flows.json'),
  flowFilePretty: true,
  contextStorage: { default: { module: 'memory' } },
  functionExternalModules: false,
  editorTheme: { projects: { enabled: false } },
  logging: { console: { level: 'info', metrics: false, audit: false } }
};
