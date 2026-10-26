import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { browserArguments, browserCommand } from './environment.mjs';
import { createStressFixture, STRESS_SCALES } from './fixtures.mjs';
// Requires an already-running production docs server and agent-browser.
const flags = new Set(
  process.argv.slice(2).filter((arg) => arg.startsWith('--'))
);
for (const flag of flags)
  if (
    !['--no-trace', '--no-fade', '--no-highlight', '--sample-dom'].includes(
      flag
    )
  )
    throw new RangeError(`Unknown flag: ${flag}`);
const [
  url = 'http://localhost:3690/words',
  label = 'profile',
  output = fileURLToPath(
    new URL('../../../.agents/ignore/profiles/words/', import.meta.url)
  ),
  scaleText = '1',
  runsText,
] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const traced = !flags.has('--no-trace');
const scale = Number(scaleText);
if (!STRESS_SCALES.includes(scale) || scale === 1000)
  throw new RangeError(
    'The docs playground supports scale 1 or 100; use bench-render-compare for 1000x capacity diagnostics.'
  );
const runCount = Number(runsText ?? (scale === 1 ? 3 : 1));
if (!Number.isInteger(runCount) || runCount < 1 || runCount > 10)
  throw new RangeError('runs must be an integer from 1 to 10');
mkdirSync(output, { recursive: true });
let browserSession;
let browserOpen = false;
const browser = (...args) =>
  execFileSync(browserCommand(), browserArguments(browserSession, args), {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30000,
  });
// A new session name per run avoids racing the previous daemon's socket teardown.
const closeBrowser = () => {
  if (!browserOpen) return;
  browserOpen = false;
  browser('close');
};
const fixture = createStressFixture(scale);
writeFileSync(output + '/fixture.md', fixture);
// Install before page scripts so hydration failures retain their original error.
const initPath = output + '/' + label + '-init.js';
writeFileSync(
  initPath,
  `(() => {
 window.mdRuntimeErrors = [];
 const record = (type, error, message) => window.mdRuntimeErrors.push({type,name:error?.name ?? null,message:message ?? error?.message ?? String(error),stack:error?.stack ?? null,time:performance.now()});
 addEventListener('error', event => record('error',event.error,event.message));
 addEventListener('unhandledrejection', event => record('unhandledrejection',event.reason));
})();\n`
);
const setup = `(() => {
 const native = JSON.stringify; window.mdNativeStringify = native;
 const state = window.mdProfile = {serializedNodes:0,serializedChars:0,stringifyMs:0,frames:[],longTasks:[],longTaskEntries:[],phaseEvents:[],started:null,done:false,peakRetainedFadeSpansSampled:0};
 const playground = document.querySelector('[aria-label="Markdown playground"]');
 const fadeDuration = Number(playground.dataset.fadeDuration);
 const settleMs = Math.max(500,fadeDuration+100);
 let pendingPhase;
 // Toolbar changes identify React's pause/resume commit without observing every token.
 const toolbarObserver = new MutationObserver(() => {
  if(!pendingPhase || pendingPhase.commitAt!==null)return;
  pendingPhase.commitAt=performance.now();performance.mark('words:'+pendingPhase.name+':commit');
 });
 toolbarObserver.observe(playground.querySelector('[data-words-toolbar]'),{childList:true,subtree:true,characterData:true});
 const markPhase = (name,committed=false) => {
  const at=performance.now();
  const phase={name,at,commitAt:committed?at:null,twoFramesAt:null,cursor:Number(playground.dataset.streamCursor)};
  state.phaseEvents.push(phase);pendingPhase=committed?null:phase;
  performance.mark('words:'+name);
  if(committed)performance.mark('words:'+name+':commit');
  requestAnimationFrame(() => requestAnimationFrame(() => {
   phase.twoFramesAt=performance.now();performance.mark('words:'+name+':two-frames');
   if(pendingPhase===phase)pendingPhase=null;
  }));
  return phase;
 };
 JSON.stringify = function(value,...args) {
  const tracked = state.started !== null && !state.done && value && typeof value === 'object' && (value.type === 'element' || value.type === 'text');
  const start = tracked ? performance.now() : 0;
  const result = native.call(this,value,...args);
  if(tracked) {state.serializedNodes++;state.serializedChars+=result.length;state.stringifyMs+=performance.now()-start;}
  return result;
 };
 let previous;
 const frame = now => {if(state.done)return;if(previous!==undefined)state.frames.push(now-previous);previous=now;requestAnimationFrame(frame);};
 const recordTasks = entries => {for(const entry of entries)if(state.started!==null && entry.startTime+entry.duration>=state.started){state.longTasks.push(entry.duration);state.longTaskEntries.push({start:entry.startTime,end:entry.startTime+entry.duration,duration:entry.duration});}};
 const observer = new PerformanceObserver(list => recordTasks(list.getEntries()));
 observer.observe({type:'longtask'});
 window.mdStopProfile = () => {
   state.done=true;state.elapsed=(state.completed ?? performance.now())-state.started;state.settledElapsed=performance.now()-state.started;
   recordTasks(observer.takeRecords());JSON.stringify=native;observer.disconnect();completion.disconnect();toolbarObserver.disconnect();
 };
 // Observe only the playback cursor; no per-token observer or frame-time DOM scans.
 const completion = new MutationObserver(() => {
  if(state.started===null || state.completed!==undefined)return;
  const cursor=Number(playground.dataset.streamCursor);const length=Number(playground.dataset.streamLength);
  if(cursor!==length)return;
  if(!playground.querySelector('[data-markdown="root"]')?.textContent?.trimEnd().endsWith('Done.'))return;
  state.completed=markPhase('completion',true).at;
  setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(window.mdStopProfile)),settleMs);
 });
 completion.observe(playground,{attributes:true,attributeFilter:['data-stream-cursor']});
 document.addEventListener('click',event => {
  const button=event.target.closest('button');
  const name=button?.textContent.trim();
  if(state.started!==null)return;
  if(!playground.contains(button) || button.dataset.action!=='replay')return;
  state.started=performance.now();previous=state.started;markPhase('replay');requestAnimationFrame(frame);
 },{capture:true});
 return {characters:document.querySelector('#markdown-source').value.length,scale:${scale},speed:String(Number(playground.dataset.streamStep)/${scale}),charactersPerStep:Number(playground.dataset.streamStep),highlight:playground.dataset.highlight==='true',animated:fadeDuration>0,fadeDuration,settleMs,traced:${traced},sampleDom:${flags.has('--sample-dom')},pauseAt:null,pauseMs:null,freshBrowser:true};
})()`;
const runs = [];
let profiling = false;
try {
  for (let run = 0; run < runCount; run++) {
    browserSession = `words-profile-${process.pid}-${run}`;
    browser('--init-script', initPath, 'open', url);
    browserOpen = true;
    browser('click', 'button[aria-label="Markdown example"]');
    browser('click', `[data-example-value="stress-${scale}"]`);
    const loadDeadline = Date.now() + 10000;
    while (
      !JSON.parse(
        browser(
          'eval',
          `document.querySelector('[aria-label="Markdown playground"]').dataset.streamLength === '${fixture.length}'`
        )
      )
    ) {
      if (Date.now() > loadDeadline)
        throw new Error('Generated fixture did not load');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const settings = JSON.parse(browser('eval', setup));
    if (traced) {
      browser(
        'profiler',
        'start',
        '--categories',
        'devtools.timeline,toplevel,v8.execute,blink.user_timing'
      );
      profiling = true;
    }
    browser('click', '[aria-label="Markdown playground"] [data-action=replay]');
    const deadline =
      Date.now() + (scale === 1 ? 45000 : scale === 100 ? 180000 : 300000);
    let nextDomSample = Date.now();
    while (true) {
      const sampleDom =
        flags.has('--sample-dom') && Date.now() >= nextDomSample;
      if (sampleDom) nextDomSample = Date.now() + 1000;
      const status = JSON.parse(
        browser(
          'eval',
          `(() => {
       const state=window.mdProfile;
       if(!state)return {missing:true,errors:window.mdRuntimeErrors ?? []};
       if(${sampleDom} && !state.done)state.peakRetainedFadeSpansSampled=Math.max(state.peakRetainedFadeSpansSampled,document.querySelector('[aria-label="Markdown playground"]').querySelectorAll('[data-markdown="token"]').length);
       return {done:state.done,pauseError:state.pauseError,missing:!document.querySelector('[aria-label="Markdown playground"]'),errors:window.mdRuntimeErrors ?? []};
      })()`
        )
      );
      if (status.missing)
        throw new Error(
          `Playground disappeared: ${JSON.stringify(status.errors)}`
        );
      if (status.pauseError) throw new Error(status.pauseError);
      if (status.done) break;
      if (Date.now() > deadline) throw new Error('Playback timed out');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    browser('eval', 'JSON.stringify=window.mdNativeStringify;true');
    const metrics = JSON.parse(
      browser(
        'eval',
        `(() => {
         const s=window.mdProfile;const f=s.frames.slice().sort((a,b)=>a-b);
         const root=document.querySelector('[aria-label="Markdown playground"] [data-markdown="root"]');
         const phaseEvents=s.phaseEvents.map(p=>({name:p.name,start:p.at-s.started,commit:p.commitAt===null?null:p.commitAt-s.started,twoFrames:p.twoFramesAt===null?null:p.twoFramesAt-s.started,commitMs:p.commitAt===null?null:p.commitAt-p.at,twoFramesMs:p.twoFramesAt===null?null:p.twoFramesAt-p.at,commitToTwoFramesMs:p.commitAt===null || p.twoFramesAt===null?null:p.twoFramesAt-p.commitAt,cursor:p.cursor}));
         const longTaskEntries=s.longTaskEntries.map(task=>{
          const marks=s.phaseEvents.filter(p=>p.at>=task.start && p.at<=task.end+1).map(p=>p.name);
          const previous=s.phaseEvents.findLast(p=>p.at<task.start)?.name;
          const phase=marks.length?marks.join('+'):previous==='completion'?'completion-settle':previous==='pause'?'paused':'append';
          return {start:task.start-s.started,end:task.end-s.started,duration:task.duration,phase};
         });
         return {serializedNodes:s.serializedNodes,serializedChars:s.serializedChars,stringifyMs:s.stringifyMs,elapsed:s.elapsed,settledElapsed:s.settledElapsed,frames:f.length,frameP95:f[Math.floor(f.length*.95)],frameP99:f[Math.floor(f.length*.99)],maxFrame:f.at(-1),longTasks:s.longTasks,longTaskCount:s.longTasks.length,longTaskTotal:s.longTasks.reduce((total,duration)=>total+duration,0),maxLongTask:s.longTasks.length?Math.max(...s.longTasks):0,longTaskEntries,phaseEvents,retainedFadeSpans:root?.querySelectorAll('[data-markdown="token"]').length ?? 0,peakRetainedFadeSpansSampled:${flags.has('--sample-dom')}?s.peakRetainedFadeSpansSampled:null,finalElements:root?.querySelectorAll('*').length ?? 0,finalTextCharacters:root?.textContent.length ?? 0,runtimeErrors:window.mdRuntimeErrors ?? []};
        })()`
      )
    );
    const sums = {};
    if (traced) {
      const trace = output + '/' + label + '-' + run + '.json';
      browser('profiler', 'stop', trace);
      profiling = false;
      const data = JSON.parse(readFileSync(trace, 'utf8'));
      const main = data.traceEvents.filter(
        (e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain'
      );
      for (const e of data.traceEvents) {
        if (
          e.ph === 'X' &&
          main.some((t) => t.pid === e.pid && t.tid === e.tid) &&
          [
            'RunTask',
            'FunctionCall',
            'Layout',
            'Paint',
            'PrePaint',
            'UpdateLayoutTree',
          ].includes(e.name)
        ) {
          sums[e.name] = (sums[e.name] ?? 0) + e.dur / 1000;
        }
      }
    }
    runs.push({ settings, ...metrics, traceMs: traced ? sums : null });
    writeFileSync(
      output + '/' + label + '-summary.json',
      JSON.stringify(runs, null, 2) + '\n'
    );
    console.log(JSON.stringify({ label, run, ...runs.at(-1) }));
    // Reusing a browser carries cached runtime/module state into the next replay.
    closeBrowser();
  }
} catch (error) {
  let runtimeErrors;
  try {
    runtimeErrors = browserOpen
      ? JSON.parse(browser('eval', 'window.mdRuntimeErrors ?? []'))
      : null;
  } catch {
    runtimeErrors = null;
  }
  writeFileSync(
    output + '/' + label + '-failure.json',
    JSON.stringify(
      { scale, completedRuns: runs, error: String(error), runtimeErrors },
      null,
      2
    ) + '\n'
  );
  throw error;
} finally {
  if (profiling) {
    try {
      browser('eval', 'if(window.mdStopProfile)window.mdStopProfile();true');
    } catch {
      /* A stalled page may not accept further script. */
    }
    try {
      browser('profiler', 'stop', output + '/' + label + '-interrupted.json');
    } catch {
      /* Preserve the failure record even if Chrome stopped responding. */
    }
  }
  closeBrowser();
}
