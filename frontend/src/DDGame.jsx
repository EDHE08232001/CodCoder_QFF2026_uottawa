import React, {useCallback, useEffect, useRef, useState} from 'react';
import Codfish from './Codfish';

const REFERENCE_DATASET='hardware_ibm_quebec_20261005-231055';
// Colour follows the entity: the same hue marks "no DD", "CPMG/XX" etc. in every chart.
const SERIES_COLORS={free:'#e0b03a',none:'#e0b03a',cpmg:'#38bde0','runtime-XX':'#38bde0',hahn:'#f2775f','manual-XX':'#f2775f',udd:'#b08cff','runtime-XpXm':'#b08cff',xy4:'#5fd08f','runtime-XY4':'#5fd08f'};
const SEQUENCE_LABELS={free:'No pulses',hahn:'Hahn echo',cpmg:'CPMG',udd:'UDD',xy4:'XY4'};
const MODE_LABELS={none:'No DD','runtime-XX':'IBM runtime XX','runtime-XpXm':'IBM runtime XpXm','runtime-XY4':'IBM runtime XY4','manual-XX':'Manual XX pass'};
const HARDWARE_MODES=Object.keys(MODE_LABELS);
const LEVEL_IDS=['echo','drift','wobble','fast','hardware'];
const CHAPTERS=[
  {id:'learn',short:'Learn',name:'Learn: what is dynamical decoupling?'},
  {id:'echo',short:'01',name:'Level 1: The spin echo'},
  {id:'drift',short:'02',name:'Level 2: Drifting noise'},
  {id:'wobble',short:'03',name:'Level 3: Wobbly pulses'},
  {id:'fast',short:'04',name:'Level 4: Fast noise'},
  {id:'hardware',short:'05',name:'Level 5: Real IBM data'},
  {id:'lab',short:'IBM lab',name:'IBM hardware lab'},
  {id:'sandbox',short:'Sandbox',name:'Sequence sandbox'},
];
const LEVEL_COPY={
  echo:{number:1,title:'The spin echo',fish:'clown',crew:'CONSTANT DRIFT',
    brief:'Each fish on the reef ring is one run of the same experiment. Every run drifts at its own constant speed (a fixed frequency offset), so the formation spreads out during the 40 µs wait. You have one π pulse. When should you flip?',
    goal:'Keep a signal of at least 0.90 with one π pulse.',
    hint:'A π pulse mirrors every fish across the ring. The phase gained after the flip undoes the phase gained before it, but only if both waits are equally long.',
    success:'Perfect echo! With a constant offset, the phase gained in the first half is exactly reversed in the second half. This is the Hahn spin echo (1950), the simplest dynamical-decoupling sequence.'},
  drift:{number:2,title:'Drifting noise',fish:'tang',crew:'SLOW 1/f NOISE',
    brief:'Real qubit frequencies wander slowly (1/f noise). One echo only cancels the part of the drift that stays constant for the whole wait. You may use up to 10 pulses across 100 µs. Click the timeline to add a pulse; click a pulse to remove it.',
    goal:'Keep a signal of at least 0.50.',
    hint:'Shorter gaps between flips give the drift less time to change. Try more pulses with even spacing.',
    success:'You built a CPMG-style pulse train. Frequent flips act like a high-pass filter: slow noise averages out between pulses.'},
  wobble:{number:3,title:'Wobbly pulses',fish:'puffer',crew:'IMPERFECT PULSES',
    brief:'Real pulses are imperfect. Here every π pulse over-rotates by 5%, and the qubit starts in |+i⟩ (pointing along y). Pick how many evenly spaced pulses to use, then click each pulse to switch its rotation axis between X and Y. Fish that drift inside the ring have been tipped off the equator by pulse errors.',
    goal:'Keep a signal of at least 0.80.',
    hint:'Errors from pulses around the same axis pile up. Alternating X and Y lets consecutive errors cancel.',
    success:'That is XY4. Alternating axes cancels pulse errors to first order, which is why IBM offers XY4 as a built-in DD option.'},
  fast:{number:4,title:'Fast noise',fish:'angel',crew:'WHITE NOISE',
    brief:'This qubit sees fast, white noise that changes far quicker than any pulse spacing. Try any sequence you like. Can you get the signal above 0.70?',
    goal:'Find out whether any sequence helps, then answer the crew.',
    quiz:{question:'Why can’t dynamical decoupling rescue this qubit?',correct:0,options:[
      'The noise changes faster than the pulses, so flipping cannot reverse it.',
      'The pulses must alternate between X and Y.',
      'The idle time is too short for DD to work.']},
    success:'Right. DD cancels slow, correlated noise. Fast noise, energy loss (T1) and readout errors need other tools, such as better hardware or error mitigation.'},
};
const HARDWARE_QUIZ=[
  {id:'offset',question:'Without DD (No DD), P(0) falls to about 0.24 near 100 µs, then rises again. Random dephasing alone can only bring P(0) down to 0.5. What does the dip below 0.5 suggest?',correct:0,options:[
    'A steady frequency offset rotates the state coherently past the halfway point.',
    'The qubit lost its energy (T1 decay).',
    'The detector misreads more bits at long delays.']},
  {id:'ceiling',question:'Even the DD curves start near 0.95 rather than 1.0. Why?',correct:1,options:[
    'DD pulses always destroy 5% of the signal.',
    'Readout and gate errors set a ceiling that DD cannot remove.',
    'There were too few shots to reach 1.0.']},
];

async function api(path, body){
  let response;
  try{response=await fetch('/api/dd'+path, body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);}
  catch{throw new Error('Cannot reach the backend. Check that the local launcher is running.');}
  let value=null;
  try{value=await response.json();}catch{value=null;}
  if(!response.ok){
    const detail=value?.detail;
    if(typeof detail==='string')throw new Error(detail);
    if(Array.isArray(detail)&&detail[0]?.msg)throw new Error(detail[0].msg);
    throw new Error(value?'The backend could not process this request.':'Cannot reach the backend. Check that the local launcher is running.');
  }
  return value;
}
const fmt=(value,digits=2)=>value.toFixed(digits).replace('-','−');
const reducedMotion=()=>typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const evenPulses=(n,pattern='x')=>Array.from({length:n},(_,i)=>({position:Math.round((i+.5)/n*1e6)/1e6,axis:pattern[i%pattern.length]}));
const spinColor=(i,n)=>`hsl(${190-170*i/Math.max(1,n-1)} 85% 70%)`;
const nextChapter=id=>CHAPTERS[(CHAPTERS.findIndex(c=>c.id===id)+1)%CHAPTERS.length].id;

function RingView({spins,start,flash,caption,speedLegend}){
  const c=160,r=118;
  const mean=spins.length?[spins.reduce((a,s)=>a+s[0],0)/spins.length,spins.reduce((a,s)=>a+s[1],0)/spins.length]:start;
  return <figure className="dd-ring-figure">
    <svg className={`dd-ring ${flash?'flash':''}`} viewBox="0 0 320 320" shapeRendering="crispEdges" role="img" aria-label={`Reef ring: ${spins.length} sample runs. The arrow shows the surviving signal, length ${fmt(Math.hypot(...mean))}.`}>
      <circle cx={c} cy={c} r={r} className="ring"/>
      <line x1={c-r-12} x2={c+r+12} y1={c} y2={c} className="axis-line"/><line x1={c} x2={c} y1={c-r-12} y2={c+r+12} className="axis-line"/>
      <text x={c+r+4} y={c-8}>x</text><text x={c+8} y={c-r-4}>y</text>
      <rect x={c+start[0]*(r+20)-5} y={c-start[1]*(r+20)-5} width="10" height="10" className="start-mark"/>
      {spins.map(([x,y],i)=>{const px=c+x*r,py=c-y*r;return <g key={i} transform={`translate(${px-8} ${py-5})`}>
        <rect x="4" y="0" width="12" height="10" fill={spinColor(i,spins.length)}/><rect x="0" y="2" width="4" height="6" fill={spinColor(i,spins.length)}/><rect x="11" y="3" width="3" height="3" fill="#0b2a40"/></g>;})}
      <line x1={c} y1={c} x2={c+mean[0]*r} y2={c-mean[1]*r} className="arrow" shapeRendering="auto"/>
      <circle cx={c+mean[0]*r} cy={c-mean[1]*r} r="6" className="arrow-tip" shapeRendering="auto"/>
      {flash&&<text x={c} y={c+r/2} textAnchor="middle" className="bolt">⚡ π</text>}
    </svg>
    <figcaption>{caption}{speedLegend&&<span> Fish colour shows drift speed: cyan swims backwards, orange swims fastest forwards.</span>} The yellow arrow is the average direction: its length is the signal that survives. The green square marks the starting direction.</figcaption>
  </figure>;
}

function EchoPlayground(){
  const SPEEDS=Array.from({length:12},(_,i)=>-1+2*i/11), SECONDS=8, OMEGA=1.4;
  const [clock,setClock]=useState(0),[running,setRunning]=useState(false),[flip,setFlip]=useState(null);
  const clockRef=useRef(0);
  useEffect(()=>{
    if(!running)return undefined;
    let frame, last=performance.now();
    const step=now=>{clockRef.current=Math.min(SECONDS,clockRef.current+(now-last)/1000);last=now;setClock(clockRef.current);
      if(clockRef.current>=SECONDS){setRunning(false);return;}frame=requestAnimationFrame(step);};
    frame=requestAnimationFrame(step);
    return ()=>cancelAnimationFrame(frame);
  },[running]);
  function start(){clockRef.current=0;setClock(0);setFlip(null);setRunning(true);}
  const angles=SPEEDS.map(s=>flip===null||clock<flip?s*OMEGA*clock:s*OMEGA*(clock-2*flip));
  const spins=angles.map(a=>[Math.cos(a),Math.sin(a)]);
  const signal=Math.hypot(spins.reduce((a,s)=>a+s[0],0),spins.reduce((a,s)=>a+s[1],0))/spins.length;
  const finished=!running&&clock>=SECONDS;
  let status='Press start. The crew begins in formation, pointing along x.';
  if(running&&flip===null)status='The crew is spreading out… Press flip before the halfway mark.';
  if(running&&flip!==null)status=`Flipped at ${flip.toFixed(1)} s. Watch for the echo at ${(2*flip).toFixed(1)} s.`;
  if(finished)status=flip===null?'No flip: the formation stayed scrambled.':2*flip<=SECONDS?`Echo! The crew regrouped at ${(2*flip).toFixed(1)} s, exactly twice the flip time.`:'You flipped after the halfway mark, so the echo would arrive after the window ends. Try an earlier flip.';
  return <section className="dd-playground" aria-label="Flip it yourself">
    <div className="panel-heading"><span>FLIP IT YOURSELF</span><span>t = {clock.toFixed(1)} s / {SECONDS} s</span></div>
    <div className="dd-playground-body">
      <RingView spins={spins} start={[1,0]} flash={flip!==null&&clock-flip<.35&&clock>=flip} caption="Twelve runs with different constant drifts." speedLegend/>
      <div className="dd-playground-side">
        <p className="dd-big-number">Signal <strong>{fmt(signal)}</strong></p>
        <div className="signal-meter" aria-hidden="true"><span style={{width:`${signal*100}%`}}/></div>
        <p role="status">{status}</p>
        <div className="answer-buttons">
          <button onClick={start} disabled={running}>{finished||flip!==null?'↺ Run again':'▶ Start the clock'}</button>
          <button className="secondary" onClick={()=>setFlip(clockRef.current)} disabled={!running||flip!==null}>⚡ Flip now (π pulse)</button>
        </div>
      </div>
    </div>
  </section>;
}

function Learn({onStart}){
  return <div className="dd-learn">
    <h2>What is dynamical decoupling?</h2>
    <div className="dd-concepts">
      <article><span className="pixel-icon">◐</span><h3>Superposition is a direction</h3><p>A qubit in superposition points somewhere on the equator of the Bloch sphere. Here, each fish is one run of the experiment, swimming on that equator: the reef ring.</p></article>
      <article><span className="pixel-icon">↻</span><h3>Waiting qubits drift</h3><p>Stray fields and neighbouring qubits shift the frequency slightly. While a qubit waits, every run gains a different phase and the crew spreads out. This signal loss is called dephasing.</p></article>
      <article><span className="pixel-icon">⚡</span><h3>Flip to cancel</h3><p>A π pulse mirrors every fish across the ring. Fast swimmers end up behind and slow ones ahead, so they meet again: an echo. Pulse trains (CPMG, XY4, UDD) repeat the trick.</p></article>
    </div>
    <EchoPlayground/>
    <div className="lesson-feedback">
      <strong>Dynamical decoupling (DD)</strong> fills a qubit’s idle time with π pulses that reverse slowly varying noise before it scrambles the state. IBM calls it <em>error suppression</em>: it acts while the circuit runs, needs no extra qubits or shots, and can be combined with mitigation methods such as ZNE.
      <ul className="dd-list"><li>✓ Helps against slow, correlated noise: frequency drift, crosstalk from neighbours.</li><li>✗ Cannot fix energy loss (T1), readout errors or fast white noise.</li><li>⚠ Every pulse is imperfect, so the sequence design matters.</li></ul>
    </div>
    <div className="result-actions"><button onClick={onStart}>Start level 1 →</button></div>
  </div>;
}

function PulseTrack({pulses,totalTimeUs,mode,maxPulses,playhead,onChange,disabled}){
  const ref=useRef(null);
  function add(event){
    if(disabled||mode==='axes')return;
    const box=ref.current.getBoundingClientRect();
    const position=Math.min(.99,Math.max(.01,Math.round((event.clientX-box.left)/box.width*100)/100));
    if(maxPulses===1){onChange([{position,axis:'x'}]);return;}
    if(pulses.length>=maxPulses||pulses.some(p=>Math.abs(p.position-position)<.01))return;
    onChange([...pulses,{position,axis:'x'}].sort((a,b)=>a.position-b.position));
  }
  function press(index,event){
    event.stopPropagation();
    if(disabled)return;
    if(mode==='axes')onChange(pulses.map((p,i)=>i===index?{...p,axis:p.axis==='x'?'y':'x'}:p));
    else onChange(pulses.filter((_,i)=>i!==index));
  }
  return <div className="dd-track-wrap">
    <div ref={ref} className={`dd-track ${mode==='axes'||disabled?'locked':''}`} onClick={add} role="group" aria-label={`Idle window timeline, ${totalTimeUs} µs. ${mode==='axes'?'Click a pulse to switch its axis.':'Click to add a pulse; click a pulse to remove it.'}`}>
      <span className="dd-track-label">PREPARE</span><span className="dd-track-label end">MEASURE</span>
      {pulses.map((p,i)=><button key={`${p.position}-${i}`} type="button" className={`dd-pulse axis-${p.axis}`} style={{left:`${p.position*100}%`}} onClick={e=>press(i,e)} disabled={disabled}
        aria-label={`Pulse ${i+1} at ${Math.round(p.position*100)}% (${p.axis.toUpperCase()}). ${mode==='axes'?'Switch axis':'Remove'}`}>⚡<br/>{p.axis.toUpperCase()}</button>)}
      {playhead!==null&&<span className="playhead" style={{left:`${playhead*100}%`}}/>}
    </div>
    <div className="dd-ticks" aria-hidden="true">{[0,.25,.5,.75,1].map(f=><span key={f}>{Math.round(f*totalTimeUs)} µs</span>)}</div>
  </div>;
}

function SignalBars({rows,target,onLoad}){
  return <div className="dd-bars">
    {rows.map(row=><div key={row.key} className={`dd-bar-row ${row.you?'you':''}`}>
      <span className="dd-bar-label">{row.label}</span>
      <span className="dd-bar-track" aria-hidden="true">
        {target!=null&&<span className="dd-bar-target" style={{left:`${50+target*50}%`}}/>}
        <span className={`dd-bar-fill ${row.value<0?'negative':''}`} style={row.value>=0?{left:'50%',width:`${Math.min(1,row.value)*50}%`}:{right:'50%',width:`${Math.min(1,-row.value)*50}%`}}/>
      </span>
      <strong>{fmt(row.value)}</strong>
      {onLoad&&(row.pulses?.length?<button className="secondary" onClick={()=>onLoad(row)} aria-label={`Load ${row.label}`}>Load</button>:<span/>)}
    </div>)}
    <p className="hint">Bars start from 0 in the middle: right = signal kept, left = state rotated to the opposite side.{target!=null&&' The vertical mark is the level goal.'}</p>
  </div>;
}

const ANIMATION_MS=4500;
function useAnimation(length,key){
  const [frame,setFrame]=useState(0),[playing,setPlaying]=useState(false),[run,setRun]=useState(0);
  const frameRef=useRef(0);frameRef.current=frame;
  const play=useCallback(()=>{frameRef.current=0;setFrame(0);setPlaying(true);setRun(n=>n+1);},[]);
  useEffect(()=>{if(!length)return;if(reducedMotion()){setPlaying(false);setFrame(length-1);}else play();},[length,key,play]);
  useEffect(()=>{
    if(!playing||!length)return undefined;
    let raf;const from=frameRef.current,begin=performance.now();
    const step=now=>{const f=Math.min(length-1,from+Math.floor((now-begin)/ANIMATION_MS*(length-1)));setFrame(f);
      if(f>=length-1){setPlaying(false);return;}raf=requestAnimationFrame(step);};
    raf=requestAnimationFrame(step);return ()=>cancelAnimationFrame(raf);
  },[playing,length,run]);
  return {frame,setFrame,playing,setPlaying,play};
}

function initialPulses(level){
  if(level.id==='echo')return [{position:.25,axis:'x'}];
  if(level.edit==='axes')return evenPulses(Math.max(...level.slot_counts));
  return [];
}

function Level({level,copy,solved,onComplete,onNext}){
  const [pulses,setPulses]=useState(()=>initialPulses(level));
  const [result,setResult]=useState(null),[ranWith,setRanWith]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [spread,setSpread]=useState(level.max_pulses),[answer,setAnswer]=useState(null);
  const animation=result?.animation;
  const {frame,setFrame,playing,setPlaying,play}=useAnimation(animation?.times_us.length||0,result);
  const quizSolved=copy.quiz&&answer===copy.quiz.correct;
  async function run(){
    setBusy(true);setError('');
    try{
      const value=await api('/play',{level:level.id,pulses});
      setResult(value);setRanWith(JSON.stringify(pulses));
      if(value.passed)onComplete();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  function choose(index){setAnswer(index);if(index===copy.quiz.correct)onComplete();}
  const dirty=result&&ranWith!==JSON.stringify(pulses);
  const start=level.init==='y'?[0,1]:[1,0];
  const spins=animation?animation.spins.map(s=>s[frame]):Array.from({length:12},()=>start);
  const time=animation?animation.times_us[frame]:0;
  const previous=animation&&frame>0?animation.times_us[frame-1]:-1;
  const flash=!!result&&result.pulses.some(p=>p.time_us>previous&&p.time_us<=time);
  const coherence=animation?animation.coherence[frame]:1;
  const pattern=pulses.map(p=>p.axis.toUpperCase()).join(' ')||'none';
  const done=solved||quizSolved;
  let feedback=copy.hint;
  if(result&&level.id==='echo'){const p=result.pulses[0];feedback=p?`Your pulse sits at ${Math.round(p.position*100)}%: the qubit waits ${fmt(p.time_us,1)} µs before the flip and ${fmt(level.total_time_us-p.time_us,1)} µs after it. ${copy.hint}`:'With no pulse at all, nothing reverses the drift. Place the flip on the timeline.';}
  if(result&&level.id==='drift')feedback=`You used ${result.pulses.length} of ${level.max_pulses} pulses. ${copy.hint}`;
  if(result&&level.id==='wobble')feedback=`Your pattern: ${result.pulses.map(p=>p.axis.toUpperCase()).join('')||'no pulses'}. ${copy.hint}`;
  if(result&&level.id==='fast')feedback=`Best classic sequence: ${fmt(result.best.signal)} versus ${fmt(result.baseline)} with no pulses. No sequence gets close to 0.70.`;
  const rows=result?[{key:'you',label:'Your sequence',value:result.signal,you:true},...result.presets.map(p=>({key:p.name,label:`${p.label}${p.pulses.length>1?` (${p.pulses.length})`:''}`,value:p.signal,pulses:p.pulses}))]:[];
  return <div className="dd-level">
    <div className="fish-brief"><Codfish species={copy.fish}/><div><span className="crew-label">LEVEL {String(copy.number).padStart(2,'0')} · {copy.crew}</span><h2 className="dd-level-title">{copy.title}</h2></div></div>
    <p>{copy.brief}</p>
    <p className="dd-goal"><strong>Goal:</strong> {copy.goal}</p>
    <section className="experiment">
      <div className="signal-panel">
        <div className="panel-heading"><span>REEF RING · 12 SAMPLE RUNS</span><span>t = {fmt(time,1)} / {level.total_time_us} µs</span></div>
        <RingView spins={spins} start={start} flash={flash} caption={result?'Replay the idle window to watch each pulse.':'Press Run to send the qubit through the idle window.'} speedLegend={level.id==='echo'}/>
        <PulseTrack pulses={pulses} totalTimeUs={level.total_time_us} mode={level.edit} maxPulses={level.max_pulses} playhead={animation?time/level.total_time_us:null} onChange={setPulses} disabled={busy}/>
        {animation&&<div className="dd-replay"><button className="secondary" onClick={play} disabled={playing}>↺ Replay</button>
          <label>Animation time<input type="range" min="0" max={animation.times_us.length-1} value={frame} onChange={e=>{setPlaying(false);setFrame(Number(e.target.value));}}/></label></div>}
        <p className="hint">Formation right now: <strong>{fmt(coherence)}</strong>. This shows how tightly all {level.realizations} simulated runs stay together, in any direction. The final score also needs them to point back at the green square.</p>
        <div className="signal-meter" aria-hidden="true"><span style={{width:`${coherence*100}%`}}/></div>
      </div>
      <aside>
        <div className="panel-heading"><span>PULSE CONTROL</span><span>{pulses.length} / {level.edit==='axes'?pulses.length:level.max_pulses}</span></div>
        {level.id==='echo'&&<label>Pulse position: <strong>{Math.round((pulses[0]?.position||.5)*100)}%</strong><input aria-label="Pulse position" type="range" min="1" max="99" step="1" value={Math.round((pulses[0]?.position||.5)*100)} disabled={busy} onChange={e=>setPulses([{position:Number(e.target.value)/100,axis:'x'}])}/></label>}
        {level.edit==='place'&&level.max_pulses>1&&<>
          <label>Number of pulses<select value={spread} disabled={busy} onChange={e=>setSpread(Number(e.target.value))}>{Array.from({length:level.max_pulses},(_,i)=>i+1).map(n=><option key={n} value={n}>{n}</option>)}</select></label>
          <div className="dd-button-row"><button className="secondary" disabled={busy} onClick={()=>setPulses(evenPulses(spread))}>Spread evenly</button><button className="secondary" disabled={busy||!pulses.length} onClick={()=>setPulses([])}>Clear</button></div>
        </>}
        {level.edit==='axes'&&<>
          <label>Number of pulses<select value={pulses.length} disabled={busy} onChange={e=>setPulses(evenPulses(Number(e.target.value)))}>{level.slot_counts.map(n=><option key={n} value={n}>{n}</option>)}</select></label>
          <div className="dd-button-row"><button className="secondary" disabled={busy} onClick={()=>setPulses(evenPulses(pulses.length,'x'))}>All X</button><button className="secondary" disabled={busy} onClick={()=>setPulses(evenPulses(pulses.length,'xy'))}>Alternate X / Y</button></div>
        </>}
        <p className="dd-pattern">Axes: {pattern}</p>
        <button onClick={run} disabled={busy}>{busy?'Simulating…':result?'Run again':'Run the idle window'}</button>
        {error&&<p role="alert" className="error">{error}</p>}
        {result&&<div className="results" aria-live="polite">
          <p>Signal kept <strong>{fmt(result.signal)}</strong></p>
          <p>P(0) = (1 + signal) / 2 <strong>{fmt(result.p0,3)}</strong></p>
          <p>No pulses <strong>{fmt(result.baseline)}</strong></p>
          {result.target!=null&&<p>Goal <strong>≥ {fmt(result.target)}</strong></p>}
          {result.target!=null&&<p className="dd-stars" aria-label={`${result.stars} of 3 stars`}>{'★'.repeat(result.stars)}{'☆'.repeat(3-result.stars)}</p>}
          {dirty&&<small>You changed the pulses. Run again to update the score.</small>}
        </div>}
      </aside>
    </section>
    {result&&<div className={`answer-feedback ${result.passed?'feedback-correct':''}`} role="status">
      <strong>{result.passed?'✓ Level complete!':level.id==='fast'?'No sequence beats this noise.':'Not yet. Here is a clue.'}</strong>
      <p>{result.passed?copy.success:feedback}</p>
    </div>}
    {copy.quiz&&result&&<section className="dd-quiz" aria-label="Crew question">
      <h3>{copy.quiz.question}</h3>
      <div className="dd-quiz-options">{copy.quiz.options.map((option,i)=><button key={option} className={`answer-option ${answer===i&&i===copy.quiz.correct?'answer-correct':''} ${answer===i&&i!==copy.quiz.correct?'answer-wrong':''}`} disabled={quizSolved} onClick={()=>choose(i)}><span className="answer-letter">{answer===i&&i===copy.quiz.correct?'✓':String.fromCharCode(65+i)}</span><span>{option}</span></button>)}</div>
      {answer!==null&&<div className={`answer-feedback ${quizSolved?'feedback-correct':''}`} role="status"><strong>{quizSolved?'✓ Level complete!':'Not quite.'}</strong><p>{quizSolved?copy.success:'Compare the bars: every sequence, even no pulses at all, ends up in the same place. What would a pulse need to reverse?'}</p></div>}
    </section>}
    {result&&<section className="dd-compare"><h3>How do the classic sequences compare?</h3><SignalBars rows={rows} target={result.target} onLoad={row=>setPulses(row.pulses.map(p=>({position:p.position,axis:p.axis})))}/></section>}
    {done&&<div className="result-actions"><button onClick={onNext}>Next chapter →</button></div>}
  </div>;
}

function LineChart({xs,series,xLabel,yLabel,yDomain,baseline,description}){
  const ref=useRef(null);const [width,setWidth]=useState(640),[hover,setHover]=useState(null);
  useEffect(()=>{const observer=new ResizeObserver(([entry])=>setWidth(Math.max(260,entry.contentRect.width)));observer.observe(ref.current);return ()=>observer.disconnect();},[]);
  const direct=series.length<=4&&width>=480;
  const height=320,left=50,right=width-(direct?118:14),top=16,bottom=height-48;
  const all=series.flatMap(s=>s.values.flatMap((v,i)=>[v-(s.errors?.[i]||0),v+(s.errors?.[i]||0)]));
  const low=yDomain?yDomain[0]:Math.min(0,Math.floor(Math.min(...all)*4)/4), high=yDomain?yDomain[1]:Math.max(1,Math.ceil(Math.max(...all)*4)/4);
  const maxX=Math.max(...xs);
  const x=v=>left+v/maxX*(right-left), y=v=>bottom-(v-low)/(high-low)*(bottom-top);
  const yTicks=[];for(let t=low;t<=high+1e-9;t+=.25)yTicks.push(Math.round(t*100)/100);
  const xTicks=[0,.25,.5,.75,1].map(f=>Math.round(f*maxX));
  const labels=direct?series.map(s=>({key:s.key,label:s.label,color:s.color,y:y(s.values[s.values.length-1])})).sort((a,b)=>a.y-b.y):[];
  for(let i=1;i<labels.length;i++)labels[i].y=Math.max(labels[i].y,labels[i-1].y+15);
  function move(event){const box=ref.current.querySelector('svg').getBoundingClientRect();const px=(event.clientX-box.left)/box.width*width;let best=0;xs.forEach((v,i)=>{if(Math.abs(x(v)-px)<Math.abs(x(xs[best])-px))best=i;});setHover(best);}
  return <div ref={ref} className="chart dd-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={description}>
      {yTicks.map(t=><g key={t}><line x1={left} x2={right} y1={y(t)} y2={y(t)} className="grid"/><text x={left-8} y={y(t)+4} textAnchor="end">{fmt(t)}</text></g>)}
      <line x1={left} x2={left} y1={top} y2={bottom} className="axis"/><line x1={left} x2={right} y1={bottom} y2={bottom} className="axis"/>
      {xTicks.map(t=><text key={t} x={x(t)} y={bottom+18} textAnchor="middle">{t}</text>)}
      <text x={(left+right)/2} y={height-8} textAnchor="middle">{xLabel}</text><text x={left} y={10}>{yLabel}</text>
      {baseline&&<><line x1={left} x2={right} y1={y(baseline.value)} y2={y(baseline.value)} className="dd-baseline"/><text x={left+6} y={y(baseline.value)+(y(baseline.value)+18>bottom?-6:16)} className="dd-baseline-label">{baseline.label}</text></>}
      {hover!==null&&<line x1={x(xs[hover])} x2={x(xs[hover])} y1={top} y2={bottom} className="dd-crosshair"/>}
      {series.map(s=><g key={s.key}>
        <path d={s.values.map((v,i)=>`${i?'L':'M'}${x(xs[i])},${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="2"/>
        {s.errors&&s.values.map((v,i)=><line key={i} x1={x(xs[i])} x2={x(xs[i])} y1={y(v-s.errors[i])} y2={y(v+s.errors[i])} stroke={s.color} strokeWidth="1.5"/>)}
        {s.values.map((v,i)=><circle key={i} cx={x(xs[i])} cy={y(v)} r={hover===i?6:4} fill={s.color} className="dd-marker"/>)}
      </g>)}
      {labels.map(l=><g key={l.key}><rect x={right+8} y={l.y-5} width="9" height="9" fill={l.color}/><text x={right+22} y={l.y+4} className="dd-direct-label">{l.label}</text></g>)}
      <rect x={left} y={top} width={Math.max(0,right-left)} height={bottom-top} fill="transparent" onPointerMove={move} onPointerLeave={()=>setHover(null)}/>
    </svg>
    {hover!==null&&<div className="dd-tooltip" style={{left:`${Math.min(70,Math.max(5,x(xs[hover])/width*100))}%`}} role="tooltip">
      <strong>{xLabel.replace(/ \(.*/,'')} {fmt(xs[hover],1)}</strong>
      {series.map(s=><span key={s.key}><i style={{background:s.color}}/>{s.label}: {fmt(s.values[hover],3)}{s.errors?` ± ${fmt(s.errors[hover],3)}`:''}</span>)}
    </div>}
    <div className="legend">{series.map(s=><span key={s.key}><i className="dd-swatch" style={{background:s.color}}/>{s.label}</span>)}</div>
  </div>;
}

function HardwareChart({data}){
  const series=data.series.map(s=>({key:s.mode,label:MODE_LABELS[s.mode]||s.mode,color:SERIES_COLORS[s.mode]||'#d5eef4',values:s.p0,errors:s.standard_error.length===s.p0.length?s.standard_error.map(e=>2*e):undefined}));
  return <>
    <LineChart xs={data.delays_us} series={series} xLabel="Idle time (µs)" yLabel="P(0)" yDomain={[0,1]} baseline={{value:.5,label:'0.5 = scrambled'}}
      description={`P(0) versus idle time on ${data.backend}, qubit ${data.qubit}. ${series.map(s=>`${s.label} ends at ${fmt(s.values[s.values.length-1])}`).join('; ')}.`}/>
    <p className="hint">Error bars: ±2 binomial standard errors from the raw counts. Higher is better; 1.0 = state kept, 0.5 = coin flip.</p>
    <details><summary>Show the data table</summary>
      <div className="dd-table-wrap"><table className="dd-table"><thead><tr><th>Idle (µs)</th>{data.series.map(s=><th key={s.mode}>{MODE_LABELS[s.mode]||s.mode}</th>)}</tr></thead>
        <tbody>{data.delays_us.map((d,i)=><tr key={d}><td>{fmt(d,1)}</td>{data.series.map(s=><td key={s.mode}>{fmt(s.p0[i],3)}{s.shots[i]?` (${s.shots[i]} shots)`:''}</td>)}</tr>)}</tbody></table></div>
    </details>
  </>;
}

const describeDataset=d=>`${d.backend}${d.simulated?' (offline simulator)':''} · qubit ${d.qubit} · init ${d.init} · ${d.created?d.created.replace('T',' '):'unknown time'}`;

function HardwareLevel({solved,onComplete,onNext}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[answers,setAnswers]=useState({});
  useEffect(()=>{api('/hardware/'+REFERENCE_DATASET).then(setData).catch(e=>setError(e.message==='Dataset not found'?'The bundled ibm_quebec dataset is missing from backend/dd_demo/results/.':e.message));},[]);
  const allCorrect=HARDWARE_QUIZ.every(q=>answers[q.id]===q.correct);
  useEffect(()=>{if(allCorrect)onComplete();},[allCorrect]); // eslint-disable-line react-hooks/exhaustive-deps
  const shots=data?.series[0]?.shots[0];
  return <div className="dd-level">
    <div className="fish-brief"><Codfish species="butterfly"/><div><span className="crew-label">LEVEL 05 · REAL QUANTUM HARDWARE</span><h2 className="dd-level-title">Real IBM data</h2></div></div>
    {data&&<p>The same idle experiment ran on IBM’s <strong>{data.backend}</strong> processor, qubit {data.qubit}, starting in |{data.init==='y'?'+i':'+'}⟩, {shots} shots per point ({data.created?.slice(0,10)}). Each curve uses a different DD treatment. The y-axis is P(0), the fraction of shots that returned the starting state: P(0) = (1 + signal) / 2.</p>}
    <p className="notice">Measured on real hardware: one qubit, one day. The four modes ran as separate jobs, and device noise drifts between jobs.</p>
    {error&&<p role="alert" className="error">{error}</p>}
    {data&&<div className="signal-panel"><div className="panel-heading"><span>IBM QPU MEASUREMENTS</span><span>P(0) / IDLE TIME</span></div><HardwareChart data={data}/></div>}
    {data&&HARDWARE_QUIZ.map(q=>{const answer=answers[q.id];const right=answer===q.correct;return <section key={q.id} className="dd-quiz" aria-label="Crew question">
      <h3>{q.question}</h3>
      <div className="dd-quiz-options">{q.options.map((option,i)=><button key={option} className={`answer-option ${answer===i&&right?'answer-correct':''} ${answer===i&&!right?'answer-wrong':''}`} disabled={right} onClick={()=>setAnswers(a=>({...a,[q.id]:i}))}><span className="answer-letter">{answer===i&&right?'✓':String.fromCharCode(65+i)}</span><span>{option}</span></button>)}</div>
      {answer!==undefined&&!right&&<p className="hint">Not quite. Look at the chart again.</p>}
    </section>;})}
    {(allCorrect||solved)&&<div className="answer-feedback feedback-correct" role="status"><strong>✓ Level complete!</strong><p>DD removed the coherent rotation and kept the qubit near 0.75–0.85 at 100 µs, where the bare qubit had fallen to 0.24. The remaining gap to 1.0 comes from readout, gates and T1, which DD does not address. This is a single run on a single qubit, so repeat it before drawing firm conclusions.</p><div className="result-actions"><button onClick={onNext}>Open the IBM lab →</button></div></div>}
  </div>;
}

function HardwareLab(){
  const [listing,setListing]=useState(null),[selected,setSelected]=useState(''),[data,setData]=useState(null),[error,setError]=useState('');
  const [form,setForm]=useState({qubit:0,init:'y',points:6,max_delay_us:100,shots:1000,modes:['none','runtime-XX','runtime-XY4']});
  const [run,setRun]=useState(null),[busy,setBusy]=useState(false);
  const refresh=useCallback(async select=>{
    const value=await api('/hardware');setListing(value);
    setSelected(current=>select||current||value.datasets.find(d=>!d.simulated)?.id||value.datasets[0]?.id||'');
  },[]);
  useEffect(()=>{refresh().catch(e=>setError(e.message));},[refresh]);
  useEffect(()=>{if(!selected){setData(null);return;}api('/hardware/'+selected).then(setData).catch(e=>setError(e.message));},[selected]);
  const pending=run&&!['completed','failed'].includes(run.status);
  useEffect(()=>{
    if(!pending)return undefined;
    let stopped=false,timer;
    const poll=async()=>{try{const latest=await api('/hardware/runs/'+run.id);if(stopped)return;setRun(latest);
      if(latest.status==='completed'&&latest.dataset_id)await refresh(latest.dataset_id);}catch(e){if(!stopped)setError(e.message);}
      if(!stopped)timer=setTimeout(poll,5000);};
    timer=setTimeout(poll,1500);return ()=>{stopped=true;clearTimeout(timer);};
  },[run?.id,pending,refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  async function submit(){setBusy(true);setError('');try{setRun(await api('/hardware/runs',{...form,qubit:Number(form.qubit),points:Number(form.points),max_delay_us:Number(form.max_delay_us),shots:Number(form.shots)}));}catch(e){setError(e.message);}finally{setBusy(false);}}
  const set=(key,value)=>setForm(f=>({...f,[key]:value}));
  const toggleMode=mode=>setForm(f=>({...f,modes:f.modes.includes(mode)?f.modes.filter(m=>m!==mode):HARDWARE_MODES.filter(m=>m===mode||f.modes.includes(m))}));
  const enabled=listing?.ibm_enabled;
  return <div className="dd-level">
    <h2>IBM hardware lab</h2>
    <p>Browse every saved run in <code>backend/dd_demo/results/</code>, including runs you make with <code>python main.py hardware</code> or from this page.</p>
    {error&&<p role="alert" className="error">{error}</p>}
    {listing&&(listing.datasets.length?<label>Dataset<select value={selected} onChange={e=>setSelected(e.target.value)}>{listing.datasets.map(d=><option key={d.id} value={d.id}>{describeDataset(d)}</option>)}</select></label>:<p className="notice">No saved hardware runs yet.</p>)}
    {data&&<div className="signal-panel dd-lab-chart"><div className="panel-heading"><span>{data.simulated?'OFFLINE SIMULATOR':'IBM QPU MEASUREMENTS'}</span><span>{data.backend.toUpperCase()}</span></div>
      {data.simulated&&<p className="notice">Fake backends model only T1/T2 relaxation, which DD cannot fix, and ignore the runtime DD options. Use them to check the code path, not to judge DD.</p>}
      <HardwareChart data={data}/></div>}
    <section className="dd-run-panel" aria-label="Run on IBM hardware">
      <h3>Run your own experiment on IBM hardware</h3>
      {!enabled&&<p className="notice">IBM runs are disabled on this server. To enable them, set IBM_ENABLE=true, IBM_QUANTUM_TOKEN and IBM_BACKEND (IBM_QUANTUM_INSTANCE is optional) in backend/.env or the environment, then restart the backend (see README). Jobs use your QPU allocation.</p>}
      <div className="controls">
        <label>Qubit<input type="number" min="0" max="1000" value={form.qubit} disabled={!enabled||busy||pending} onChange={e=>set('qubit',e.target.value)}/></label>
        <label>Start state<select value={form.init} disabled={!enabled||busy||pending} onChange={e=>set('init',e.target.value)}><option value="x">|+⟩ (x)</option><option value="y">|+i⟩ (y)</option></select></label>
        <label>Idle times<select value={form.points} disabled={!enabled||busy||pending} onChange={e=>set('points',e.target.value)}>{[4,6,8,10].map(n=><option key={n} value={n}>{n} points</option>)}</select></label>
        <label>Longest idle<select value={form.max_delay_us} disabled={!enabled||busy||pending} onChange={e=>set('max_delay_us',e.target.value)}>{[50,100,150,200].map(n=><option key={n} value={n}>{n} µs</option>)}</select></label>
        <label>Shots per point<select value={form.shots} disabled={!enabled||busy||pending} onChange={e=>set('shots',e.target.value)}>{[500,1000,2000,4000].map(n=><option key={n} value={n}>{n.toLocaleString('en-US')}</option>)}</select></label>
      </div>
      <fieldset className="dd-checks" disabled={!enabled||busy||pending}><legend>DD modes (one job each)</legend>{HARDWARE_MODES.map(mode=><label key={mode}><input type="checkbox" checked={form.modes.includes(mode)} onChange={()=>toggleMode(mode)}/>{MODE_LABELS[mode]}</label>)}</fieldset>
      <button onClick={submit} disabled={!enabled||busy||pending||!form.modes.length}>{busy?'Submitting…':pending?'IBM jobs in progress…':'Submit to IBM'}</button>
      {run&&<p className="status" aria-live="polite">Status: {run.status}{run.backend&&` · ${run.backend}`}{run.job_ids&&` · jobs ${Object.values(run.job_ids).join(', ')}`}{run.error&&` · ${run.error}`}{run.poll_error&&` · ${run.poll_error}`}</p>}
    </section>
  </div>;
}

function Sandbox(){
  const [settings,setSettings]=useState({engine:'theory',noise:'1/f',sigma_khz:15,pulses:8,max_time_us:100,init:'y',pulse_error:.03,sequences:['free','hahn','cpmg','udd','xy4']});
  const [result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const run=useCallback(async current=>{setBusy(true);setError('');try{setResult(await api('/explore',{...current,points:20}));}catch(e){setError(e.message);}finally{setBusy(false);}},[]);
  useEffect(()=>{run(settings);},[]); // eslint-disable-line react-hooks/exhaustive-deps
  const set=(key,value)=>setSettings(s=>({...s,[key]:value}));
  const toggle=name=>setSettings(s=>({...s,sequences:s.sequences.includes(name)?s.sequences.filter(n=>n!==name):Object.keys(SEQUENCE_LABELS).filter(n=>n===name||s.sequences.includes(n))}));
  const circuit=settings.engine==='circuit';
  const series=result?result.curves.map(c=>({key:c.sequence,label:`${SEQUENCE_LABELS[c.sequence]}${c.pulses>1?` (${c.pulses})`:''}`,color:SERIES_COLORS[c.sequence],values:c.values})):[];
  return <div className="dd-level">
    <h2>Sequence sandbox</h2>
    <p>Compare the classic sequences under any noise. <strong>Theory</strong> uses the fast switching-function model (ideal pulses). <strong>Circuit</strong> runs the exact single-qubit simulation of <code>circuits.noisy_idle_circuit</code>, including pulse over-rotation and the start state.</p>
    <div className="controls">
      <label>Model<select value={settings.engine} onChange={e=>set('engine',e.target.value)}><option value="theory">Theory (ideal)</option><option value="circuit">Circuit (pulse errors)</option></select></label>
      <label>Noise type<select value={settings.noise} onChange={e=>set('noise',e.target.value)}><option value="1/f">1/f (slow drift)</option><option value="lorentzian">Lorentzian (20 µs memory)</option><option value="white">White (fast)</option><option value="static">Static offset</option></select></label>
      <label>Noise strength: <strong>{settings.sigma_khz} kHz</strong><input aria-label="Noise strength" type="range" min="1" max="60" value={settings.sigma_khz} onChange={e=>set('sigma_khz',Number(e.target.value))}/></label>
      <label>Pulses per sequence<select value={settings.pulses} onChange={e=>set('pulses',Number(e.target.value))}>{[1,2,4,8,16,32].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
      <label>Longest idle<select value={settings.max_time_us} onChange={e=>set('max_time_us',Number(e.target.value))}>{[50,100,150,200].map(n=><option key={n} value={n}>{n} µs</option>)}</select></label>
      {circuit&&<label>Start state<select value={settings.init} onChange={e=>set('init',e.target.value)}><option value="x">|+⟩ (x)</option><option value="y">|+i⟩ (y)</option></select></label>}
      {circuit&&<label>Pulse error: <strong>{Math.round(settings.pulse_error*100)}%</strong><input aria-label="Pulse error" type="range" min="0" max="0.2" step="0.01" value={settings.pulse_error} onChange={e=>set('pulse_error',Number(e.target.value))}/></label>}
    </div>
    <fieldset className="dd-checks"><legend>Sequences</legend>{Object.entries(SEQUENCE_LABELS).map(([name,label])=><label key={name}><input type="checkbox" checked={settings.sequences.includes(name)} onChange={()=>toggle(name)}/><i className="dd-swatch" style={{background:SERIES_COLORS[name]}}/>{label}</label>)}</fieldset>
    <button onClick={()=>run(settings)} disabled={busy||!settings.sequences.length}>{busy?'Simulating…':'Run simulation'}</button>
    {error&&<p role="alert" className="error">{error}</p>}
    {result&&<div className="signal-panel dd-lab-chart"><div className="panel-heading"><span>{result.engine==='theory'?'SWITCHING-FUNCTION MODEL':'EXACT CIRCUIT SIMULATION'}</span><span>SIGNAL / IDLE TIME</span></div>
      <LineChart xs={result.times_us} series={series} xLabel="Idle time (µs)" yLabel="Signal kept" baseline={{value:0,label:'0 = scrambled'}}
        description={`Signal versus idle time, ${result.noise} noise at ${result.sigma_khz} kHz. ${series.map(s=>`${s.label} ends at ${fmt(s.values[s.values.length-1])}`).join('; ')}.`}/>
      <p className="hint">Signal = 2·P(0) − 1, averaged over {result.engine==='theory'?1000:400} noise realizations. Try: white noise (no sequence helps), static offset (one echo is perfect), or the circuit model with |+i⟩ and 5% pulse error (CPMG collapses, XY4 survives).{result.engine==='theory'&&' In the theory model CPMG and XY4 coincide exactly (both simply reverse the phase), so one line hides the other.'}</p>
    </div>}
  </div>;
}

export default function DDGame(){
  const [chapter,setChapter]=useState('learn'),[levels,setLevels]=useState(null),[completed,setCompleted]=useState([]),[error,setError]=useState('');
  useEffect(()=>{api('/levels').then(value=>setLevels(Object.fromEntries(value.levels.map(level=>[level.id,level])))).catch(e=>setError(e.message));},[]);
  const complete=useCallback(id=>setCompleted(previous=>previous.includes(id)?previous:[...previous,id]),[]);
  const goNext=()=>setChapter(nextChapter(chapter));
  const finished=LEVEL_IDS.filter(id=>completed.includes(id)).length;
  return <main className="dd-lab">
    <section className="mini-game dd-shell">
      <div className="eyebrow">INTERACTIVE LAB · DYNAMICAL DECOUPLING</div>
      <h1>Pulse Patrol</h1>
      <p className="game-goal">Keep an idle qubit’s quantum state alive by flipping it at the right moments, then test the idea on real IBM hardware data.</p>
      <p className="notice">Levels 1–4 use a seeded noise simulation computed by the backend (Qiskit-verified physics). Level 5 and the IBM lab show measured hardware data.</p>
      <nav className="mission-progress dd-chapters" aria-label="Pulse Patrol chapters">
        {CHAPTERS.map(c=>{const done=completed.includes(c.id);return <button key={c.id} className={`${done?'finished':''} ${chapter===c.id?'current':''}`} aria-current={chapter===c.id?'step':undefined} aria-label={`${c.name}${done?', completed':''}`} onClick={()=>setChapter(c.id)}>{done?'✓':c.short}</button>;})}
        <span>{finished} / 5 levels complete</span>
      </nav>
      {error&&<p role="alert" className="error">{error}</p>}
      {chapter==='learn'&&<Learn onStart={()=>setChapter('echo')}/>}
      {LEVEL_COPY[chapter]&&levels?.[chapter]&&<Level key={chapter} level={levels[chapter]} copy={LEVEL_COPY[chapter]} solved={completed.includes(chapter)} onComplete={()=>complete(chapter)} onNext={goNext}/>}
      {LEVEL_COPY[chapter]&&!levels&&!error&&<p className="hint">Loading level…</p>}
      {chapter==='hardware'&&<HardwareLevel solved={completed.includes('hardware')} onComplete={()=>complete('hardware')} onNext={goNext}/>}
      {chapter==='lab'&&<HardwareLab/>}
      {chapter==='sandbox'&&<Sandbox/>}
      {finished===5&&<p className="all-complete">✓ All five levels complete! You now know what dynamical decoupling does, when it helps and where it stops.</p>}
    </section>
  </main>;
}
