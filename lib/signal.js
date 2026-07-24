const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const JAVA_HOME = 'C:\\Users\\ggdra\\signal-cli\\jdk-25.0.3+9';
const SIGNAL_CLI = 'C:\\Users\\ggdra\\signal-cli\\signal-cli-0.14.6\\bin\\signal-cli.bat';

function run(args) {
  var env = Object.assign({}, process.env, { JAVA_HOME: JAVA_HOME, PATH: JAVA_HOME + '\\bin;' + process.env.PATH });
  try {
    var cmd = '"' + SIGNAL_CLI + '" ' + args;
    var out = execSync(cmd, { encoding: 'utf8', timeout: 30000, env: env });
    return { success: true, output: out.trim() };
  } catch (e) {
    return { success: false, error: e.message, output: e.stdout ? e.stdout.trim() : '' };
  }
}

function getDataDir() {
  return path.join(require('os').homedir(), '.local', 'share', 'signal-cli', 'data');
}

function isRegistered(number) {
  var dir = path.join(getDataDir(), number.replace(/\D/g, ''));
  return fs.existsSync(dir);
}

function sendMessage(number, message, groupId) {
  var args = '-u ' + number + ' send';
  if (groupId) args += ' -g ' + groupId;
  else args += ' "' + number.replace(/\D/g, '') + '"';
  args += ' -m ' + JSON.stringify(message);
  return run(args);
}

function listGroups(number) {
  return run('-u ' + number + ' listGroups');
}

function sendToGroup(number, groupId, message) {
  return sendMessage(number, message, groupId);
}

module.exports = { sendToGroup, listGroups, isRegistered, run };
