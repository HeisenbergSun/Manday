/**
 * e2e 临时 profile 自动清理 + 测试数据兜底 purge
 * 用法：require('./e2e-profile-cleanup')('manday-batch10');
 * 注册进程退出钩子（exit/SIGINT/SIGTERM/uncaughtException），按前缀删除 Temp 下的 userDataDir；
 * require 时同步 purge 上次残留的测试 board/folder/dashboard（前缀 B/P/F/D 数字 + 明确测试名）
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

module.exports = function cleanupProfiles(prefixes) {
  const list = Array.isArray(prefixes) ? prefixes : [prefixes];
  // 同步 purge 测试残留数据（测试开始时执行，串行测试场景安全）
  try {
    spawnSync(process.execPath, [path.join(__dirname, 'purge-test-data.js')], { stdio: 'ignore', timeout: 15000 });
  } catch {}
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
