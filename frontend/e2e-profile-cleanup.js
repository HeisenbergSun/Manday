/**
 * e2e 临时 profile 自动清理
 * 用法：require('./e2e-profile-cleanup')('manday-batch10');
 * 注册进程退出钩子（exit/SIGINT/SIGTERM/uncaughtException），按前缀删除 Temp 下的 userDataDir
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = function cleanupProfiles(prefixes) {
  const list = Array.isArray(prefixes) ? prefixes : [prefixes];
  const clean = () => {
    try {
      for (const name of fs.readdirSync(os.tmpdir())) {
        if (list.some((p) => name.startsWith(p))) {
          try { fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true }); } catch {}
        }
      }
    } catch {}
  };
  process.on('exit', clean);
  for (const sig of ['SIGINT', 'SIGTERM', 'uncaughtException']) {
    process.on(sig, () => process.exit(sig === 'uncaughtException' ? 1 : 2));
  }
};
