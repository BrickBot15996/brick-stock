const fs = require('fs');
const path = require('path');

const logsDirectory = path.join(__dirname, 'logs');
const logFile = path.join(logsDirectory, 'a.log');
fs.mkdirSync(logsDirectory, { recursive: true });
if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, '');

function logChange(action, details = {}) {
  fs.mkdirSync(logsDirectory, { recursive: true });
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    ...details,
  };
  fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
}

module.exports = { logChange };