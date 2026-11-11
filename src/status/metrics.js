import { cpus, freemem, totalmem, uptime } from 'node:os';
import { statfs } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const sample = () => cpus().reduce((result, cpu) => {
  result.idle += cpu.times.idle;
  result.total += Object.values(cpu.times).reduce((sum, n) => sum + n, 0);
  return result;
}, { idle: 0, total: 0 });

export async function collectHost({ diskPath, gpu = true, cpuSampleMs = 150 } = {}) {
  const before = sample();
  await delay(cpuSampleMs);
  const after = sample(), delta = after.total - before.total;
  const memory = { total: totalmem(), used: totalmem() - freemem() };
  const host = { cpuPercent: delta > 0 ? Math.max(0, Math.min(100, (1 - (after.idle - before.idle) / delta) * 100)) : null, memory, disk: null, gpus: null, uptime: uptime(), processUptime: process.uptime(), scope: '当前进程所见系统；容器中不等同于物理宿主机' };
  try {
    const disk = await statfs(diskPath, { bigint: true });
    host.disk = { total: Number(disk.blocks * disk.bsize), used: Number((disk.blocks - disk.bfree) * disk.bsize), label: '状态目录所在磁盘' };
  } catch { /* 无权限或平台不支持时独立降级。 */ }
  if (gpu) {
    try {
      const { stdout } = await exec('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'], { timeout: 2500, maxBuffer: 65536, windowsHide: true });
      host.gpus = stdout.trim().split(/\r?\n/).slice(0, 8).map(line => {
        const [name, percent, used, total] = line.split(',').map(item => item.trim());
        return { name: name.replace(/[\x00-\x1f]/g, '').slice(0, 80), percent: /^\d+(\.\d+)?$/.test(percent) ? Number(percent) : null, used: /^\d+(\.\d+)?$/.test(used) ? Number(used) * 1024 ** 2 : null, total: /^\d+(\.\d+)?$/.test(total) ? Number(total) * 1024 ** 2 : null };
      });
    } catch { /* 没有 NVIDIA、工具或采集权限：保持未知。 */ }
  }
  return host;
}
