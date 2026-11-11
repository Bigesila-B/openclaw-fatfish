import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { jsonStore } from './state-store.js';
import { currentMediaRoute } from './media-delivery.js';
import { sameOwner } from './context.js';

const labels = { queued: '排队中', submitting: '正在提交', polling: '生成中', waiting: '等待恢复查询', ready: '生成完成', sending: '发送中', completed: '已完成', unknown: '提交结果不确定', 'delivery-unknown': '发送结果待确认', failed: '生成失败', cancelled: '本地已取消' };
const idPattern = /^[0-9a-f-]{36}$/;
const activeStates = new Set(['queued', 'submitting', 'polling', 'ready', 'sending', 'waiting', 'unknown', 'delivery-unknown']);
const context = owner => ({ channel: owner.channel, senderId: owner.senderId, accountId: owner.accountId, from: owner.to, messageThreadId: owner.threadId, deliveryContext: { channel: owner.channel, to: owner.to, accountId: owner.accountId, threadId: owner.threadId } });

export function createTaskManager({ stateDir, config = {}, optionsFor, authorize, delivery, generate, resume, onHealth = async () => {} }) {
  const store = jsonStore(join(stateDir, 'fatfish', 'tasks.json'), { version: 1, jobs: [] }, state => {
    if (state?.version !== 1 || !Array.isArray(state.jobs) || state.jobs.length > 500) throw new Error('任务记录格式无效。');
    return state;
  });
  const running = new Map(), manual = new Set();
  let started = false, pumping = false;
  const patch = (id, update) => store.update(state => {
    const job = state.jobs.find(item => item.id === id);
    if (!job) throw new Error('任务不存在。');
    Object.assign(job, typeof update === 'function' ? update(job) : update, { updatedAt: Date.now() });
    return structuredClone(job);
  });
  const readJob = async id => (await store.read()).jobs.find(job => job.id === id);
  const check = async job => {
    if (!await authorize(context(job.owner), job.kind)) throw new Error('任务权限已撤销。');
    const options = optionsFor(job.kind);
    if (!options.enabled || (options.provider ?? 'comfy') !== job.provider) throw new Error('供应商配置已更改或功能已关闭。');
    return options;
  };
  async function work(id, controller) {
    let job = await readJob(id);
    let phase = 'preflight';
    try {
      if (!job || job.state !== 'queued' || controller.signal.aborted || !started) return;
      const options = await check(job);
      let result = job.result;
      if (!result) {
        const controls = { signal: controller.signal, onSubmitted: async submitted => {
          // 收到服务端 ID 后立即落盘；后续恢复只能 GET，不能重发 POST。
          job = await patch(id, current => ({ providerTaskId: submitted.taskId, model: submitted.model, state: current.state === 'cancelled' ? 'cancelled' : 'polling' }));
        } };
        if (job.providerTaskId) result = await resume(job.kind, job.providerTaskId, { ...options, model: job.model }, controls);
        else {
          job = await patch(id, current => ({ state: current.state === 'cancelled' ? 'cancelled' : 'submitting' }));
          if (job.state === 'cancelled' || controller.signal.aborted || !started) return;
          phase = 'submitting';
          result = await generate(job.kind, job.prompt, options, controls);
        }
        if (!started || controller.signal.aborted) return;
        if ((await readJob(id)).state === 'cancelled') return;
        job = await patch(id, { state: 'ready', lastError: null, result: { filePath: result.filePath, kind: job.kind, ...(result.taskId ? { taskId: result.taskId } : {}) } });
        await onHealth(job.kind, true).catch(() => {});
      }
      await check(job);
      if (!started || controller.signal.aborted || (await readJob(id)).state === 'cancelled') return;
      job = await patch(id, { state: 'sending' });
      const sent = job.deliveryId
        ? await delivery.resend(context(job.owner), job.deliveryId)
        : await delivery.deliver(context(job.owner), job.kind, [job.result.filePath], { onCreated: deliveryId => patch(id, { deliveryId }) });
      await patch(id, { state: sent.details.status === 'sent' ? 'completed' : 'delivery-unknown', lastError: null, deliveryId: sent.details.deliveryId });
    } catch (error) {
      if (!started || controller.signal.aborted || (await readJob(id))?.state === 'cancelled') return;
      const latest = await readJob(id);
      let state = latest.result ? 'delivery-unknown' : latest.providerTaskId && !error.terminal ? 'waiting' : latest.providerTaskId || phase === 'preflight' || (error.status >= 400 && error.status < 500) ? 'failed' : 'unknown';
      await patch(id, { state, lastError: state === 'unknown' ? '提交结果未知，未自动重试' : state === 'waiting' ? '查询未完成，可恢复查询' : state === 'delivery-unknown' ? '生成结果已保留，请检查 QQ 后再重发' : '任务未完成，请检查供应商与权限' });
      await onHealth(job.kind, false).catch(() => {});
      if (config.notifyFailures !== false) await delivery.notice?.(context(job.owner), job.kind, describe(await readJob(id))).catch(() => {});
    }
  }
  async function pump() {
    if (!started || pumping) return;
    pumping = true;
    try {
      while (started && running.size < (config.maxConcurrent ?? 2)) {
        const job = (await store.read()).jobs.find(item => item.state === 'queued' && !running.has(item.id) && !manual.has(item.id));
        if (!job) break;
        const controller = new AbortController();
        const promise = Promise.resolve().then(() => work(job.id, controller)).catch(() => {}).finally(() => { running.delete(job.id); void pump(); });
        running.set(job.id, { controller, promise });
      }
    } catch { started = false; }
    finally { pumping = false; }
  }
  async function owned(ctx, id) {
    if (!idPattern.test(id)) throw new Error('任务编号无效。');
    const job = await readJob(id);
    if (!job || !sameOwner(ctx, context(job.owner))) throw new Error('只能在原会话查看和操作自己的任务。');
    return job;
  }
  function describe(job) {
    return `${job.kind === 'video' ? '视频' : '图片'}任务 ${job.id}\n状态：${labels[job.state] ?? '未知'}${job.lastError ? `\n提示：${job.lastError}` : ''}${job.providerTaskId ? `\n供应商任务编号：${job.providerTaskId}` : ''}\n查询：/fish task ${job.id}${['waiting', 'cancelled'].includes(job.state) && job.providerTaskId ? `\n恢复查询：/fish task resume ${job.id}` : ''}${job.result && job.state !== 'completed' ? `\n确认未收到后重发：/fish task send ${job.id}` : ''}${job.state === 'unknown' ? '\n服务端可能仍在处理，请先核对供应商记录；本插件不会重复创建任务。' : ''}`;
  }
  return {
    async start() {
      if (started) return;
      await store.update(state => {
        for (const job of state.jobs) {
          if (job.state === 'submitting') job.state = job.providerTaskId ? 'queued' : 'unknown';
          else if (job.state === 'polling' || (job.state === 'waiting' && config.resumeOnStart !== false && job.providerTaskId) || job.state === 'ready') job.state = 'queued';
          else if (job.state === 'sending') job.state = 'delivery-unknown';
        }
      });
      started = true;
      await pump();
    },
    async stop() {
      started = false;
      for (const work of running.values()) work.controller.abort();
      await Promise.race([Promise.allSettled([...running.values()].map(item => item.promise)), new Promise(resolve => { const timer = setTimeout(resolve, 3000); timer.unref?.(); })]);
    },
    async submit(ctx, kind, prompt, requestId) {
      if (!['image', 'video'].includes(kind) || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) throw new Error('生成参数无效。');
      const options = optionsFor(kind);
      if (!options.enabled) throw new Error('此生成功能尚未启用。');
      await delivery.check(ctx, kind);
      if (!await authorize(ctx, kind)) throw new Error('没有使用此功能的权限。');
      const owner = currentMediaRoute(ctx);
      const dedup = createHash('sha256').update(JSON.stringify([owner, kind, requestId ?? prompt])).digest('hex');
      const job = await store.update(state => {
        const existing = state.jobs.find(item => item.dedup === dedup && (requestId || activeStates.has(item.state)));
        if (existing) return structuredClone(existing);
        if (state.jobs.filter(item => activeStates.has(item.state)).length >= (config.maxPending ?? 20)) throw new Error('任务队列已满，请稍后再试。');
        if (state.jobs.length >= 200) state.jobs = state.jobs.filter(item => activeStates.has(item.state)).concat(state.jobs.filter(item => !activeStates.has(item.state)).slice(-100));
        const item = { id: randomUUID(), owner, kind, prompt, provider: options.provider ?? 'comfy', state: 'queued', dedup, createdAt: Date.now(), updatedAt: Date.now() };
        state.jobs.push(item);
        return structuredClone(item);
      });
      void pump();
      return { text: `请求已记录，任务将在队列中处理，完成后发回当前会话。\n${describe(job)}`, details: { taskId: job.id, state: job.state } };
    },
    async command(ctx, args = '') {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      if (!parts.length || parts.length === 1 && parts[0] === 'list') {
        const jobs = (await store.read()).jobs.filter(job => sameOwner(ctx, context(job.owner))).slice(-10).reverse();
        return { text: jobs.length ? jobs.map(job => `${job.id} · ${job.kind} · ${labels[job.state]}`).join('\n') : '当前会话中没有你的生成任务。' };
      }
      const action = ['resume', 'cancel', 'send'].includes(parts[0]) ? parts[0] : 'status', id = parts[action === 'status' ? 0 : 1];
      if (parts.length !== (action === 'status' ? 1 : 2)) throw new Error('用法：/fish task 编号，或 /fish task resume|cancel|send 编号。');
      let job = await owned(ctx, id);
      if (action === 'status') return { text: describe(job) };
      if (action === 'cancel') {
        if (job.state === 'completed') return { text: '任务已完成，不能撤回已发送的媒体。' };
        await patch(id, { state: 'cancelled' });
        running.get(id)?.controller.abort();
        return { text: '本地任务已取消，不再自动查询或发送；供应商端可能继续生成，此操作不保证撤销服务端任务。' };
      }
      await check(job);
      if (running.has(id) || manual.has(id)) return { text: '任务正在处理，请勿重复操作。' };
      manual.add(id);
      try {
        job = await owned(ctx, id);
        if (action === 'resume') {
          if (!job.providerTaskId || job.result) return { text: '此任务没有可恢复查询的供应商编号；不会重新提交生成请求。' };
          await patch(id, { state: 'queued', lastError: null }); void pump();
          return { text: '已恢复对原任务的查询，不会重新创建生成任务。' };
        }
        if (!job.result) return { text: '尚无可发送的生成结果。' };
        if (job.state === 'completed') return { text: '此任务已取得发送回执，不会重复发送。' };
        await patch(id, { state: 'sending' });
        const sent = job.deliveryId ? await delivery.resend(context(job.owner), job.deliveryId) : await delivery.deliver(context(job.owner), job.kind, [job.result.filePath], { onCreated: deliveryId => patch(id, { deliveryId }) });
        await patch(id, { state: sent.details.status === 'sent' ? 'completed' : 'delivery-unknown', lastError: null, deliveryId: sent.details.deliveryId });
        return { text: sent.text };
      } catch {
        await patch(id, { state: 'delivery-unknown', lastError: '结果已保留，发送未能确认；请检查 QQ 后再重发' });
        return { text: '发送未能确认，结果已保留；请先检查 QQ，避免重复发送。' };
      } finally { manual.delete(id); void pump(); }
    },
    async counts(ctx) {
      const route = ctx ? currentMediaRoute(ctx) : null;
      const jobs = (await store.read()).jobs.filter(job => !route || job.owner.channel === route.channel && job.owner.accountId === route.accountId);
      return { queued: jobs.filter(job => job.state === 'queued').length, running: jobs.filter(job => ['submitting', 'polling', 'sending'].includes(job.state)).length, waiting: jobs.filter(job => ['waiting', 'unknown', 'delivery-unknown'].includes(job.state)).length, failed: jobs.filter(job => job.state === 'failed').length };
    },
    async waitForIdle() {
      while (pumping || running.size) { await Promise.allSettled([...running.values()].map(item => item.promise)); await new Promise(resolve => setTimeout(resolve, 2)); }
    }
  };
}
