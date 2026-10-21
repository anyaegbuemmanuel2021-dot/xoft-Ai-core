import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { JsonStore } from '../persistence/JsonStore.js';
import { EventType } from '../events/EventBus.js';
import { redactSensitive } from '../operations/IncidentManager.js';

const MAX_JOB_RETRIES = 3;
const BASE_BACKOFF_MS = 5_000;
const DEFAULT_JOB_TIMEOUT_MS = 120_000;
const MIN_JOB_TIMEOUT_MS = 100;
const MAX_JOB_TIMEOUT_MS = 600_000;

function normalizeBudget(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_JOB_TIMEOUT_MS;
  return Math.max(MIN_JOB_TIMEOUT_MS, Math.min(MAX_JOB_TIMEOUT_MS, Math.floor(number)));
}

/** Persistent scheduler for tools AND autonomous XOFT tasks. */
export class BackgroundJobManager {
  constructor({ toolRegistry, taskPlanner, activityLog, eventBus, memory, incidentManager = null, dataDir = './data', sqliteStore = null }) {
    this.toolRegistry = toolRegistry;
    this.taskPlanner = taskPlanner ?? null;
    this.activityLog = activityLog;
    this.eventBus = eventBus;
    this.memory = memory;
    this.incidentManager = incidentManager;
    this._store = new JsonStore({ dataDir, fileName: 'background_jobs.json', kvKey: 'background_jobs', defaultValue: { jobs: [] }, sqliteStore });
    this._timers = new Map();
  }
  _load() { return this._store.load(); }
  _save(data) { this._store.save(data); }
  _patch(jobId, mutator) { const data=this._load(); const job=data.jobs.find(j=>j.id===jobId); if(job) mutator(job); this._save(data); return job; }

  scheduleOnce({ toolName, input, delayMs = 0, executeAt, maxRunMs = DEFAULT_JOB_TIMEOUT_MS }) {
    if (!this.toolRegistry.has(toolName)) throw new Error(`BackgroundJobManager: no tool named '${toolName}'`);
    return this._schedule({ toolName, input, kind:'once', maxRunMs, runAt: executeAt ? new Date(executeAt).toISOString() : new Date(Date.now()+Math.max(0,delayMs)).toISOString() });
  }
  scheduleRecurring({ toolName, input, intervalMs, maxRunMs = DEFAULT_JOB_TIMEOUT_MS }) {
    if (!this.toolRegistry.has(toolName)) throw new Error(`BackgroundJobManager: no tool named '${toolName}'`);
    return this._schedule({ toolName, input, kind:'recurring', intervalMs, maxRunMs, runAt:new Date(Date.now()+intervalMs).toISOString() });
  }
  /** Create a task now and schedule its autonomous execution for later. */
  async scheduleTask({ goal, executeAt, delayMs = 0, autonomyLevel }) {
    if (!this.taskPlanner) throw new Error('Task scheduling is not configured');
    const task = await this.taskPlanner.plan(goal);
    const runAt = executeAt ? new Date(executeAt) : new Date(Date.now()+Math.max(0,delayMs));
    if (Number.isNaN(runAt.getTime())) throw new Error('Invalid executeAt date');
    const job = this._schedule({ kind:'task', taskId:task.id, goal, maxRunMs: this.taskPlanner.maxDurationMs ?? DEFAULT_JOB_TIMEOUT_MS, runAt:runAt.toISOString() });
    return { task, job };
  }
  _schedule({ toolName=null,input={},kind,intervalMs=null,taskId=null,goal=null,runAt,maxRunMs=DEFAULT_JOB_TIMEOUT_MS }) {
    const job={id:crypto.randomUUID(),correlationId:crypto.randomUUID(),kind,toolName,input,intervalMs,taskId,goal,maxRunMs:normalizeBudget(maxRunMs),runAt,status:'scheduled',attempts:0,lastRunAt:null,lastResult:null,lastError:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    const data=this._load(); data.jobs.push(job); this._save(data); this.activityLog.log({type:'background_job_created',detail:{jobId:job.id,kind,toolName,taskId,runAt}}); this._arm(job); return job;
  }
  _arm(job) {
    if (!['scheduled','retry_wait'].includes(job.status)) return;
    this._clearTimer(job.id);
    const delay=Math.max(0,new Date(job.runAt).getTime()-Date.now());
    const timer=setTimeout(()=>this._run(job.id).catch(()=>{}),delay);
    this._timers.set(job.id,timer);
  }
  _clearTimer(id){const t=this._timers.get(id);if(t){clearTimeout(t);this._timers.delete(id);}}
  async _run(jobId){
    const job=this._load().jobs.find(j=>j.id===jobId);
    if(!job||job.status==='cancelled'||job.status==='paused')return;
    // Stable across retries/recovery of one scheduled execution, unique for each recurring run.
    const executionIdempotencyKey = job.executionIdempotencyKey || `${job.id}:${job.runAt ?? job.createdAt}`;
    this._patch(jobId,j=>{j.status='running';j.executionIdempotencyKey=executionIdempotencyKey;j.startedAt=new Date().toISOString();j.updatedAt=j.startedAt;});
    try {
      let result;
      if(job.kind==='task') {
        // TaskPlanner already enforces its own bounded duration and per-step idempotency keys.
        if(!this.taskPlanner) throw new Error('Task planner unavailable');
        result=await this.taskPlanner.execute(job.taskId);
      } else {
        const controller = new AbortController();
        const maxRunMs = normalizeBudget(job.maxRunMs);
        const deadlineAt = new Date(Date.now() + maxRunMs).toISOString();
        let timeoutHandle;
        let timedOut = false;
        let timeoutError = null;
        const work = this.toolRegistry.execute(job.toolName, job.input, {
          memory: this.memory, taskId: job.taskId, source: 'background_job',
          signal: controller.signal, idempotencyKey: executionIdempotencyKey, correlationId: job.correlationId, deadlineAt,
        });
        const timeout = new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            timeoutError = new Error(`BackgroundJobManager: job '${job.id}' exceeded its ${maxRunMs}ms execution budget; external side effects may be uncertain.`);
            timeoutError.code = 'BACKGROUND_JOB_TIMEOUT';
            reject(timeoutError);
            controller.abort(timeoutError);
          }, maxRunMs);
        });
        try {
          result = await Promise.race([work, timeout]);
        } catch (error) {
          if (timedOut) throw timeoutError;
          throw error;
        } finally {
          clearTimeout(timeoutHandle);
        }
      }
      const failed=job.kind==='task' && result?.status==='failed';
      if(failed) throw new Error(`Scheduled task failed: ${result.steps?.find(s=>s.status==='failed')?.error || 'unknown task failure'}`);
      const nextRun=job.kind==='recurring'?new Date(Date.now()+job.intervalMs).toISOString():null;
      this._patch(jobId,j=>{j.status=job.kind==='recurring'?'scheduled':'completed';j.lastRunAt=new Date().toISOString();j.finishedAt=j.lastRunAt;j.updatedAt=j.lastRunAt;j.lastResult=result;j.lastError=null;j.attempts=0;j.executionIdempotencyKey=job.kind==='recurring'?null:executionIdempotencyKey;j.runAt=nextRun;});
      this.activityLog.log({type:'background_job_ran',detail:{jobId,kind:job.kind,toolName:job.toolName,taskId:job.taskId,result}});
      if(job.kind==='recurring') this._arm(this.get(jobId)); else {this._clearTimer(jobId);this.eventBus?.emitEvent(EventType.TASK_COMPLETED,{jobId,toolName:job.toolName,taskId:job.taskId});}
    } catch(err) {
      const attempts=(job.attempts||0)+1;
      const timedOut = err?.code === 'BACKGROUND_JOB_TIMEOUT' || job.kind === 'task' && String(err?.message ?? '').includes('exceeded the maximum duration');
      const safeError = redactSensitive(err?.message ?? err);
      let incident = null;
      try {
        incident = this.incidentManager?.capture(err, {
          source: timedOut ? 'background_job_timeout' : 'background_job',
          severity: timedOut || attempts > MAX_JOB_RETRIES ? 'error' : 'warning',
          correlationId: job.correlationId,
          context: { jobId, kind: job.kind, toolName: job.toolName, taskId: job.taskId, attempt: attempts, maxRunMs: job.kind === 'task' ? this.taskPlanner?.maxDurationMs ?? null : job.maxRunMs, idempotencyKey: executionIdempotencyKey },
        }) ?? null;
      } catch { /* a telemetry failure must not stop bounded retry handling */ }
      this.activityLog.log({type:timedOut?'background_job_timed_out':'background_job_failed',detail:{jobId,toolName:job.toolName,taskId:job.taskId,attempt:attempts,error:safeError,incidentId:incident?.id ?? null,correlationId:job.correlationId}});
      if (timedOut) {
        // A timeout leaves the external side-effect outcome uncertain. Do not retry blindly.
        this._patch(jobId,j=>{j.status='timed_out';j.attempts=attempts;j.lastError=safeError;j.timeoutMs=job.kind === 'task' ? this.taskPlanner?.maxDurationMs ?? job.maxRunMs : job.maxRunMs;j.runAt=null;j.finishedAt=new Date().toISOString();j.updatedAt=j.finishedAt;});
        this._clearTimer(jobId);
        this.eventBus?.emitEvent(EventType.TASK_FAILED,{jobId,toolName:job.toolName,taskId:job.taskId,error:safeError,reason:'timeout',incidentId:incident?.id ?? null,correlationId:job.correlationId});
      } else if(attempts<=MAX_JOB_RETRIES){
        const backoff=BASE_BACKOFF_MS*2**(attempts-1);
        this._patch(jobId,j=>{j.status='retry_wait';j.attempts=attempts;j.lastError=safeError;j.updatedAt=new Date().toISOString();j.runAt=new Date(Date.now()+backoff).toISOString();});
        this._arm(this.get(jobId));
      } else {
        this._patch(jobId,j=>{j.status='failed';j.attempts=attempts;j.lastError=safeError;j.finishedAt=new Date().toISOString();j.updatedAt=j.finishedAt;});
        this._clearTimer(jobId);this.eventBus?.emitEvent(EventType.TASK_FAILED,{jobId,toolName:job.toolName,taskId:job.taskId,error:safeError,incidentId:incident?.id ?? null,correlationId:job.correlationId});
      }
    }
  }
  pause(id){this._clearTimer(id);return this._patch(id,j=>{j.status='paused';});}
  resume(id){const j=this._patch(id,j=>{j.status='scheduled';j.runAt=j.runAt||new Date().toISOString();});if(j)this._arm(j);return j;}
  cancel(id){this._clearTimer(id);const j=this._patch(id,j=>{j.status='cancelled';});this.activityLog.log({type:'background_job_cancelled',detail:{jobId:id}});return j;}
  loadAndSchedule(){
    const data = this._load();
    let recovered = 0;
    let interrupted = 0;
    const now = new Date().toISOString();
    for (const job of data.jobs) {
      if (job.status === 'running') {
        // A running job may have completed an external side effect just before a crash.
        // Never replay it automatically without an idempotency contract; make the uncertainty visible.
        job.status = 'interrupted';
        job.lastError = 'XOFT restarted while this job was running. Automatic replay was withheld to avoid duplicate side effects; inspect the result and explicitly resume if safe.';
        job.updatedAt = now;
        job.interruptedAt = now;
        interrupted += 1;
        try {
          this.incidentManager?.capture(new Error(job.lastError), {
            source: 'background_job_restart',
            severity: 'warning',
            correlationId: job.correlationId,
            context: { jobId: job.id, kind: job.kind, toolName: job.toolName, taskId: job.taskId, priorStatus: 'running' },
          });
        } catch { /* restart recovery must continue for other jobs */ }
      } else if (['scheduled','retry_wait'].includes(job.status)) {
        this._arm(job);
        recovered += 1;
      }
    }
    if (interrupted) this._save(data);
    return { recovered, interrupted };
  }
  list(){return this._load().jobs;}
  get(id){return this._load().jobs.find(j=>j.id===id)??null;}
}
