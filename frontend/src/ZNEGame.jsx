import React, {useEffect, useRef, useState} from 'react';
import './zne.css';

async function api(path, body) {
  const response = await fetch('/api/zne'+path, body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : undefined);
  const value = await response.json();
  if (!response.ok) {const error=new Error(typeof value.detail==='string'?value.detail:'Please check your experiment settings.');error.status=response.status;throw error;}
  return value;
}
function Chart({points,guess,setGuess,result,zoom}) {
  const ref=useRef(null); const [width,setWidth]=useState(640);
  useEffect(()=>{const observer=new ResizeObserver(([entry])=>setWidth(entry.contentRect.width));observer.observe(ref.current);return ()=>observer.disconnect();},[]);
  const height=350, left=64, right=Math.max(100,width-20), top=24, bottom=height-52;
  const values=[guess,...points.flatMap(p=>[p.mean-2*p.standard_error,p.mean+2*p.standard_error]),...(result?[result.reference,...result.curve.flatMap(p=>[p.y-2*(p.standard_error||0),p.y+2*(p.standard_error||0)])]:[])];
  const span=Math.max(.15,Math.max(...values)-Math.min(...values));
  const low=zoom?Math.min(...values)-span*.15:Math.min(-1,...values)-.08;
  const high=zoom?Math.max(...values)+span*.15:Math.max(1,...values)+.08;
  const x=t=>left+12+t/5*(right-left-24), y=v=>bottom-(v-low)/(high-low)*(bottom-top);
  const ticks=zoom?[.15,.5,.85].map(f=>low+f*(high-low)):[-1,-.5,0,.5,1];
  function drag(event){if(!ref.current)return;const svg=ref.current.querySelector('svg');const box=svg.getBoundingClientRect();const localY=(event.clientY-box.top)*height/box.height;setGuess(Math.max(-1,Math.min(1,high-(localY-top)/(bottom-top)*(high-low))));}
  const curvePath=result?.curve.map((p,i)=>(i?'L':'M')+x(p.x)+','+y(p.y)).join(' ');
  const band=result?result.curve.map((p,i)=>(i?'L':'M')+x(p.x)+','+y(p.y+2*(p.standard_error||0))).join(' ')+' '+[...result.curve].reverse().map(p=>'L'+x(p.x)+','+y(p.y-2*(p.standard_error||0))).join(' ')+' Z':null;
  return <div ref={ref} className="chart zne-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Noise factors one, three and five with measurement uncertainty; revealed fits show approximate two-standard-error sampling bands.">
      {ticks.map(t=><g key={t}><line x1={left} x2={right} y1={y(t)} y2={y(t)} className="grid"/><text x={left-10} y={y(t)+4} textAnchor="end">{t.toFixed(zoom?2:1)}</text></g>)}
      <line x1={left} x2={left} y1={top} y2={bottom} className="axis"/><line x1={left} x2={right} y1={bottom} y2={bottom} className="axis"/>
      {[0,1,3,5].map(t=><text key={t} x={x(t)} y={bottom+20} textAnchor="middle">{t}×</text>)}
      <text x={(left+right)/2} y={height-9} textAnchor="middle">Noise factor</text><text x={left} y={14}>Mean ⟨Z⟩</text>
      {result&&<><path d={band} className="zne-fit-band"/><path d={curvePath} className="fit"/><line x1={left} x2={right} y1={y(result.reference)} y2={y(result.reference)} className="reference"/><line x1={x(0)} x2={x(0)} y1={y(result.estimate-2*result.estimate_standard_error)} y2={y(result.estimate+2*result.estimate_standard_error)} className="fit"/><circle cx={x(0)} cy={y(result.estimate)} r="5" className="estimate"/></>}
      {points.map(p=><g key={p.factor}><title>{`${p.factor}×: ${p.mean.toFixed(3)} ± ${(2*p.standard_error).toFixed(3)} (2 SE)`}</title><line x1={x(p.factor)} x2={x(p.factor)} y1={y(p.mean-2*p.standard_error)} y2={y(p.mean+2*p.standard_error)} className="uncertainty"/>{[-1,1].map(sign=><line key={sign} x1={x(p.factor)-5} x2={x(p.factor)+5} y1={y(p.mean+sign*2*p.standard_error)} y2={y(p.mean+sign*2*p.standard_error)} className="uncertainty"/>)}<circle cx={x(p.factor)} cy={y(p.mean)} r="6" className="measurement"/></g>)}
      <circle cx={x(0)} cy={y(guess)} r="20" className="drag-target" onPointerDown={e=>{if(result)return;e.currentTarget.setPointerCapture(e.pointerId);drag(e);}} onPointerMove={e=>{if(!result&&e.currentTarget.hasPointerCapture(e.pointerId))drag(e);}}/>
      <text x={x(0)} y={y(guess)+6} textAnchor="middle" className="star">★</text>
    </svg>
    <div className="legend"><span>● Measurements ±2 SE</span><span>★ Your guess</span>{result&&<><span>┄ Fit with ±2 SE band</span><span>— Ideal reference</span></>}</div>
  </div>;
}

function QuantumNetwork(){
  const rings=[{radius:60,count:6},{radius:112,count:12},{radius:163,count:24}];
  const nodes=rings.map((ring,index)=>Array.from({length:ring.count},(_,i)=>{
    const angle=2*Math.PI*i/ring.count+(index%2)*.13;
    return {x:260+Math.cos(angle)*ring.radius,y:180+Math.sin(angle)*ring.radius*.86};
  }));
  return <svg className="quantum-network" viewBox="0 0 520 360" aria-hidden="true">
    <defs><radialGradient id="quantum-halo"><stop stopColor="#05b9f4" stopOpacity=".17"/><stop offset="1" stopColor="#05b9f4" stopOpacity="0"/></radialGradient></defs>
    <ellipse cx="260" cy="180" rx="230" ry="177" fill="url(#quantum-halo)"/>
    {rings.map((ring,index)=><ellipse key={index} cx="260" cy="180" rx={ring.radius} ry={ring.radius*.86} className="network-orbit"/>)}
    {nodes.flatMap((ring,index)=>ring.flatMap((node,i)=>{
      const next=ring[(i+1)%ring.length];
      const links=[<line key={`${index}-${i}-ring`} x1={node.x} y1={node.y} x2={next.x} y2={next.y}/>];
      if(index<nodes.length-1){const outer=nodes[index+1][i*2];links.push(<line key={`${index}-${i}-out`} x1={node.x} y1={node.y} x2={outer.x} y2={outer.y}/>);}
      return links;
    }))}
    {nodes.flatMap((ring,index)=>ring.map((node,i)=><circle key={`${index}-${i}`} cx={node.x} cy={node.y} r={index===0?5:3} className="network-node"/>))}
  </svg>;
}
export default function ZNEGame(){
  const [mode,setMode]=useState('aer'),[level,setLevel]=useState('exponential'),[shots,setShots]=useState(4000);
  const [zoom,setZoom]=useState(true);
  const [run,setRun]=useState(null),[shown,setShown]=useState(0),[model,setModel]=useState('exponential'),[guess,setGuess]=useState(.9),[result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[ibmEnabled,setIBMEnabled]=useState(false);
  function resume(active){setRun(active);setMode('ibm');setLevel(active.level||'exponential');setShots(active.shots||4000);setShown(0);setResult(null);setError(active.poll_error||'');}
  useEffect(()=>{let stopped=false;setBusy(true);(async()=>{try{const h=await api('/health');if(stopped)return;setIBMEnabled(h.ibm_enabled);if(h.ibm_enabled){const active=await api('/runs/active');if(!stopped&&active)resume(active);}}catch(e){if(!stopped)setError(e.message);}finally{if(!stopped)setBusy(false);}})();return()=>{stopped=true;};},[]);
  const pending=run&& !['completed','failed'].includes(run.status);
  useEffect(()=>{if(!pending)return;let stopped=false;let timer;const poll=async()=>{try{const latest=await api('/runs/'+run.id);if(!stopped){setRun(latest);if(latest.poll_error)setError(latest.poll_error);}}catch(e){if(!stopped)setError(e.message);}if(!stopped)timer=setTimeout(poll,5000);};timer=setTimeout(poll,1000);return ()=>{stopped=true;clearTimeout(timer);};},[run?.id,pending]);
  async function start(){setBusy(true);setError('');setResult(null);setShown(0);setRun(null);try{setRun(await api('/runs',{mode,level,shots:Number(shots),seed:Math.floor(Math.random()*2147483648)}));}catch(e){if(e.status===409&&mode==='ibm'){try{const active=await api('/runs/active');if(active)resume(active);else setError('The previous experiment finished. Start a new experiment when ready.');}catch(refreshError){setError(refreshError.message);}}else setError(e.message);}finally{setBusy(false);}}
  async function reveal(){setBusy(true);setError('');try{setResult(await api('/runs/'+run.id+'/reveal',{model,guess}));}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <main><header><QuantumNetwork/><div className="header-copy"><div className="eyebrow"><span className="signal-dot"/> QUANTUM LEARNING LAB <span className="header-tag">INTERACTIVE MISSION</span></div><h1>ZNE Noise Detective</h1><div className="header-rule"/><p>Read the signal.<br/>Uncover the noise-free answer.</p></div></header>
    <section className="controls" aria-label="Experiment settings">
      <label>Data source<select value={mode} disabled={busy||pending} onChange={e=>setMode(e.target.value)}><option value="aer">Aer simulator</option><option value="ibm" disabled={!ibmEnabled}>IBM hardware{!ibmEnabled?' (not enabled)':''}</option></select></label>
      <label>Aer noise profile<select value={level} disabled={busy||pending||mode==='ibm'} onChange={e=>{setLevel(e.target.value);setModel(e.target.value);}}><option value="linear">Low gate noise</option><option value="exponential">Moderate gate noise</option></select></label>
      <label>Shots per noise factor<select value={shots} disabled={busy||pending} onChange={e=>setShots(e.target.value)}>{[100,1000,2000,4000,10000].map(n=><option key={n} value={n}>{n.toLocaleString('en-US')}</option>)}</select></label>
      <button onClick={start} disabled={busy||pending}>{busy?'Working…':pending?'IBM job in progress…':'Start experiment'}</button>
    </section>
    <p>Requested measurement budget: {Number(shots)*3} shots across 1×, 3× and 5×.</p><p className="notice">{mode==='aer'?'Aer executes the quantum circuits locally with a specified depolarizing noise model. These are not IBM measurements.':'IBM mode submits three folded circuits and uses your QPU allocation. Results may not follow a linear or exponential model.'}</p>
    {error&&<p role="alert" className="error">{error}</p>}
    {run&&<p className="status" aria-live="polite">Source: {run.source} · Status: {run.status}{run.job_id&&` · IBM job: ${run.job_id}`}{run.status==='failed'&&` · ${run.error}`}</p>}
    <section className="mission-brief" aria-label="Current mission"><span className="mission-index">MISSION<br/><strong>{level==='linear'?'01':'02'}</strong></span><div><span className="eyebrow">ZERO-NOISE EXTRAPOLATION</span><h2>What would the mean be without noise?</h2><p>Observe the measurements at 1×, 3× and 5× noise. Choose a model, then place your prediction at 0×.</p></div><span className="mission-step">{result?'RESULT REVEALED':`${shown} / 3 SIGNALS`}</span></section>
    <section className="experiment"><div className="signal-panel"><div className="panel-heading"><span>SIGNAL ANALYSIS</span><label className="zne-zoom"><input type="checkbox" checked={zoom} onChange={e=>setZoom(e.target.checked)}/> Signal zoom</label></div><Chart points={(run?.points||[]).slice(0,shown)} guess={guess} setGuess={setGuess} result={result} zoom={zoom}/>
      <button className="secondary" disabled={run?.status!=='completed'||shown>=3||!!result||busy} onClick={()=>setShown(n=>n+1)}>{shown===0?'Show 1× measurement':shown===1?'Show 3× measurement':shown===2?'Show 5× measurement':'All three points revealed'}</button>
      <p className="hint">{shown<3?'Reveal measurements one at a time. Noise factors are not shot counts.':'Look for differences or ratios. Drag the star vertically at 0× on the left.'}</p></div>
      <aside><div className="panel-heading"><span>CONTROL MODULE</span><span>ZNE</span></div><h2>Your prediction</h2><label>Extrapolation model<select value={model} disabled={!!result||busy} onChange={e=>setModel(e.target.value)}><option value="linear">Linear: fixed difference</option><option value="exponential">Exponential: fixed ratio</option></select></label>
      <label>Zero-noise mean: <strong>{guess.toFixed(2)}</strong><input aria-label="Zero-noise guess" type="range" min="-1" max="1" step="0.01" value={guess} disabled={!!result||busy} onChange={e=>setGuess(Number(e.target.value))}/></label>
      <button disabled={shown<3||busy||!!result} onClick={reveal}>Submit guess and reveal</button>
      {result&&<div aria-live="polite" className="results"><p>Reference value <strong>{result.reference.toFixed(3)}</strong></p><p>Model estimate <strong>{result.estimate.toFixed(3)}</strong></p><p>0× estimate ±2 SE: {(result.estimate-2*result.estimate_standard_error).toFixed(3)} to {(result.estimate+2*result.estimate_standard_error).toFixed(3)}</p><p>Total measurement budget: {run.points.reduce((total,point)=>total+point.shots,0)} shots</p><p>Your error <strong>{result.player_error.toFixed(3)}</strong></p><p>Raw error {result.raw_error.toFixed(3)} → Extrapolation error {result.fitted_error.toFixed(3)}</p><p>{result.fitted_error<result.raw_error?'This estimate is closer to the reference value.':'Extrapolation did not improve this result. A model can be wrong.'}</p>{result.outside_physical_range&&<p className="error">The estimate is outside −1 to 1. It is shown unchanged to flag an unreliable fit.</p>}<ul>{(result.warnings||[]).map(message=><li key={message}>{message}</li>)}</ul><small>Fit uncertainty ≈ {result.estimate_standard_error.toFixed(3)} (1 standard error). Model bias is not included.</small></div>}
      </aside></section>
    <details><summary>What does a mean of 0.8 mean?</summary><p>Assign +1 to outcome 0 and −1 to outcome 1. With 90 zeros and 10 ones, the mean is (90−10)/100 = 0.8. This is not 80% accuracy.</p>{(run?.points||[]).slice(0,shown).map(p=><p key={p.factor}>{p.factor}×: {p.zeros} zeros, {p.ones} ones → mean {p.mean.toFixed(3)} ± {(2*p.standard_error).toFixed(3)} (2 SE)</p>)}</details>
  </main>;
}


