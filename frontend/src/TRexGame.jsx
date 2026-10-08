import React, {useCallback, useEffect, useState} from 'react';
import Codfish from './Codfish';

// Colour follows the entity: the same hue marks "ideal", "raw" and "corrected" everywhere.
const SERIES_COLORS={ideal:'#a5f7c9',raw:'#e0b03a',corrected:'#61d7f2',inverted:'#f2775f'};
const SERIES_LABELS={ideal:'Ideal (noiseless)',raw:'Raw (uncorrected)',corrected:'Corrected (nnls)',inverted:'Inverted (direct)'};
const LEVEL_IDS=['bias','crowd','crosstalk','ghz'];
const MODE_LABELS={tensored:'Tensored (2 circuits)',correlated:'Correlated (every basis state)'};
const CHAPTERS=[
  {id:'learn',short:'Learn',name:'Learn: what is readout mitigation?'},
  {id:'bias',short:'01',name:'Level 1: The biased detector'},
  {id:'crowd',short:'02',name:'Level 2: A crowd of honest detectors'},
  {id:'crosstalk',short:'03',name:'Level 3: Two detectors gossip'},
  {id:'ghz',short:'04',name:'Level 4: Correct the entangled state'},
  {id:'lab',short:'IBM lab',name:'IBM hardware lab'},
  {id:'sandbox',short:'Sandbox',name:'Calibration sandbox'},
];
const LEVEL_COPY={
  bias:{number:1,title:'The biased detector',fish:'clown',crew:'ONE QUBIT · ASYMMETRIC BIAS',
    brief:'This qubit’s detector misreads a true 0 as 1 about a quarter of the time, and a true 1 as 0 about 8% of the time. Calibrate the two rates by preparing |0⟩ and |1⟩ many times each, then use the resulting matrix to correct a measurement of an unknown, biased coin.',
    goal:'Get the corrected distribution within 0.02 total variation of the truth.',
    hint:'The 2×2 assignment matrix read off the calibration is exactly invertible for one qubit: tensored and correlated calibration are the same thing here.',
    success:'That is the whole idea of readout mitigation, in one qubit: calibrate with known inputs, invert, and the detector’s own bias comes back out of the corrected answer.'},
  crowd:{number:2,title:'A crowd of honest detectors',fish:'tang',crew:'FOUR INDEPENDENT DETECTORS',
    brief:'Four qubits, each with its own readout bias — but none of them talk to each other. Calibrate the cheap way, with just the two global |0000⟩ and |1111⟩ circuits, and correct a measurement of a GHZ state.',
    goal:'Get the corrected distribution within 0.03 of the ideal GHZ state, using only 2 calibration circuits.',
    hint:'Because every qubit misreads independently, each qubit’s own 2×2 matrix is all you need. Kronecker-multiply them together.',
    success:'Tensored calibration is exact here, and it only cost 2 circuits regardless of qubit count. This is the trick real calibration libraries (such as IBM’s mthree) lean on.'},
  crosstalk:{number:3,title:'Two detectors gossip',fish:'puffer',crew:'READOUT CROSSTALK',
    brief:'Same four qubits, same individual bias rates as before — but now two pairs of neighbouring qubits misread together: when one flips, so does its neighbour, more often than independent chance would predict. Try the cheap calibration first, then the expensive one.',
    goal:'Beat 0.04 total variation. The cheap (tensored) calibration cannot do it, no matter how many shots you give it — only the correlated calibration (16 circuits) can.',
    hint:'If the cheap calibration keeps failing, more shots will not help: the problem is the independence assumption itself, not noise.',
    quiz:{question:'Why does the tensored calibration keep failing here, even with far more shots?',correct:1,options:[
      'It just needs more calibration shots to average out the noise.',
      'It assumes every qubit misreads independently, and here they do not — more shots cannot fix a wrong model.',
      'The crosstalk only affects the target circuit, not the calibration circuits.']},
    success:'Right. The cheap calibration’s error here is systematic, not statistical: it keeps the wrong model no matter how many shots it gets. Only calibrating every correlated basis state captures the crosstalk — at 16× the circuit cost.'},
  ghz:{number:4,title:'Correct the entangled state',fish:'angel',crew:'INVERSION VS. REALITY',
    brief:'Back to a GHZ state, now scored by its parity ⟨Z⊗Z⊗Z⊗Z⟩ (ideal: +1) instead of raw counts. Correct it and compare two ways to use the same calibration: direct inversion, and a non-negative least-squares fit.',
    goal:'Get the corrected parity within 0.05 of +1.',
    hint:'Watch the "inverted" distribution below: if any entry goes negative, that is not a bug — it is a sign that the direct inverse of a valid matrix is not itself a valid probability distribution.',
    quiz:{question:'Direct inversion gives a negative "probability" for one outcome here. What does the nnls correction trade away to stay physical?',correct:0,options:[
      'It introduces a small bias, in exchange for every entry staying non-negative.',
      'It needs twice as many calibration shots to work.',
      'It only works when there is no readout error at all.']},
    success:'The nnls correction is a biased estimator — it cannot be exactly unbiased and guaranteed non-negative at the same time — but a physical, slightly biased distribution is far more useful than a technically unbiased one with negative "probabilities".'},
};

async function api(path, body){
  let response;
  try{response=await fetch('/api/trex'+path, body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);}
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
const fmt=(value,digits=3)=>Number(value).toFixed(digits).replace('-','−');
const nextChapter=id=>CHAPTERS[(CHAPTERS.findIndex(c=>c.id===id)+1)%CHAPTERS.length].id;

function Swatch({name}){return <i className="dd-swatch" style={{background:SERIES_COLORS[name]}}/>;}

function MatrixHeatmap({matrix}){
  const n=matrix.length;
  const width=Math.round(Math.log2(n));
  const bits=i=>i.toString(2).padStart(width,'0');
  return <div className="dd-table-wrap">
    <table className="dd-table" aria-label="Assignment matrix: rows are measured outcomes, columns are prepared states">
      <thead><tr><th>meas \\ prep</th>{matrix[0].map((_,j)=><th key={j}>{bits(j)}</th>)}</tr></thead>
      <tbody>{matrix.map((row,i)=><tr key={i}><th>{bits(i)}</th>
        {row.map((v,j)=><td key={j} style={{background:`rgba(97,215,242,${Math.max(0,Math.min(1,v))*.85})`,
          color:v>0.5?'#04131f':'#d5eef4'}}>{v.toFixed(2)}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

function DistributionBars({ideal,rows,footnote}){
  const keys=Object.keys(ideal);
  const all=[{key:'ideal',values:ideal},...rows];
  const peak=Math.max(...all.flatMap(row=>keys.map(bits=>row.values[bits]||0)),1e-9);
  return <div className="tw-dist-wrap">
    <div className="tw-dist" role="img" aria-label={`Outcome probabilities for ${keys.length} bitstrings, ideal against ${rows.map(r=>r.key).join(' and ')}.`}>
      {keys.map(bits=><div key={bits} className="tw-dist-col">
        <div className="tw-dist-bars">{all.map(row=><i key={row.key} style={{height:`${(row.values[bits]||0)/peak*100}%`,background:SERIES_COLORS[row.key]}}
          title={`${bits} · ${SERIES_LABELS[row.key]}: ${fmt(row.values[bits]||0)}`}/>)}</div>
        <span className="tw-dist-label">{bits}</span>
      </div>)}
    </div>
    <div className="legend">{all.map(row=><span key={row.key}><Swatch name={row.key}/>{SERIES_LABELS[row.key]}</span>)}</div>
    {footnote&&<p className="hint">{footnote}</p>}
  </div>;
}

function Learn({onStart}){
  const [p01,setP01]=useState(.25),[p10,setP10]=useState(.08),[trueBias,setTrueBias]=useState(.7);
  const [result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function calibrate(){
    setBusy(true);setError('');
    try{setResult(await api('/explore',{qubits:1,per_qubit_errors:[[p01,p10]],target_kind:'bias',target_bias:trueBias,shots:4000}));}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  useEffect(()=>{calibrate();},[]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="dd-learn">
    <h2>What is readout mitigation?</h2>
    <div className="dd-concepts">
      <article><span className="pixel-icon">▤</span><h3>Detectors lie a little</h3><p>A qubit truly in |0⟩ is still sometimes reported as 1, and vice versa, at some roughly-known rate. That mismatch is readout error, and it sets a ceiling other mitigation tools (DD, twirling) cannot touch.</p></article>
      <article><span className="pixel-icon">⊞</span><h3>Calibrate with known inputs</h3><p>Prepare states you already know — |0⟩, |1⟩, or every basis state — and record what the detector reports. That builds an <em>assignment matrix</em>: the probability of reading each outcome given each true state.</p></article>
      <article><span className="pixel-icon">↻</span><h3>Invert it</h3><p>A noisy measured distribution can be corrected back toward the truth by inverting that matrix. Direct inversion can go negative; a non-negative fit stays physical at the cost of a little bias.</p></article>
    </div>
    <section className="dd-playground" aria-label="Calibrate it yourself">
      <div className="panel-heading"><span>CALIBRATE IT YOURSELF</span><span>one qubit</span></div>
      <div className="controls">
        <label>P(read 1 | true 0): <strong>{Math.round(p01*100)}%</strong><input aria-label="P01" type="range" min="0" max="50" value={Math.round(p01*100)} onChange={e=>setP01(Number(e.target.value)/100)}/></label>
        <label>P(read 0 | true 1): <strong>{Math.round(p10*100)}%</strong><input aria-label="P10" type="range" min="0" max="50" value={Math.round(p10*100)} onChange={e=>setP10(Number(e.target.value)/100)}/></label>
        <label>True P(1) of the unknown coin: <strong>{Math.round(trueBias*100)}%</strong><input aria-label="True bias" type="range" min="0" max="100" value={Math.round(trueBias*100)} onChange={e=>setTrueBias(Number(e.target.value)/100)}/></label>
        <button onClick={calibrate} disabled={busy}>{busy?'Calibrating…':'Calibrate and correct'}</button>
      </div>
      {error&&<p role="alert" className="error">{error}</p>}
      {result&&<>
        <MatrixHeatmap matrix={result.assignment_matrix}/>
        <DistributionBars ideal={result.ideal_distribution} rows={[{key:'raw',values:result.raw_distribution},{key:'corrected',values:result.corrected_distribution}]}
          footnote={`Raw measured P(1) is pulled toward 50% by the detector's own bias; the corrected answer lands near the true ${Math.round(trueBias*100)}%. Total variation: raw ${fmt(result.raw_total_variation)}, corrected ${fmt(result.corrected_total_variation)}.`}/>
      </>}
    </section>
    <div className="lesson-feedback">
      <strong>Readout mitigation</strong> is a post-processing correction: it changes nothing about the circuit or the hardware, only how the resulting counts are interpreted. It combines with dynamical decoupling and Pauli twirling, which act on earlier stages of the same experiment.
      <ul className="dd-list"><li>✓ Corrects a known, roughly-stable detector bias, cheaply, if qubits misread independently.</li><li>✗ The cheap calibration is systematically wrong under readout crosstalk — more shots will not fix it.</li><li>⚠ Direct inversion can be unphysical; a non-negative fit trades a little bias to stay physical.</li></ul>
    </div>
    <div className="result-actions"><button onClick={onStart}>Start level 1 →</button></div>
  </div>;
}

function Level({level,copy,solved,onComplete,onNext}){
  const [mode,setMode]=useState(level.modes[0]);
  const [result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [answer,setAnswer]=useState(null);
  const quizSolved=copy.quiz&&answer===copy.quiz.correct;
  async function run(selectedMode){
    setBusy(true);setError('');
    try{
      const value=await api('/play',{level:level.id,calibration_mode:selectedMode});
      setResult(value);
      if(value.passed)onComplete();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  function choose(index){setAnswer(index);if(index===copy.quiz.correct)onComplete();}
  const done=solved||quizSolved;
  const scoreLine=result&&(result.metric==='parity'
    ?`Parity: raw ${fmt(result.parity_raw,3)}, corrected ${fmt(result.parity_corrected,3)} (ideal ${fmt(result.parity_ideal,0)})`
    :`Total variation from the ideal: raw ${fmt(result.raw_total_variation)}, corrected ${fmt(result.corrected_total_variation)}`);
  return <div className="dd-level">
    <div className="fish-brief"><Codfish species={copy.fish}/><div><span className="crew-label">LEVEL {String(copy.number).padStart(2,'0')} · {copy.crew}</span><h2 className="dd-level-title">{copy.title}</h2></div></div>
    <p>{copy.brief}</p>
    <p className="dd-goal"><strong>Goal:</strong> {copy.goal}</p>
    {level.modes.length>1&&<fieldset className="dd-checks" disabled={busy}><legend>Calibration strategy</legend>
      {level.modes.map(m=><label key={m}><input type="radio" name={`mode-${level.id}`} checked={mode===m} onChange={()=>setMode(m)}/>{MODE_LABELS[m]}</label>)}
    </fieldset>}
    <button onClick={()=>run(mode)} disabled={busy}>{busy?'Calibrating…':result?'Run again':'Calibrate and correct'}</button>
    {error&&<p role="alert" className="error">{error}</p>}
    {result&&<section className="experiment">
      <div className="signal-panel">
        <div className="panel-heading"><span>ASSIGNMENT MATRIX</span><span>{result.calibration_circuits_used} calibration circuits · condition {fmt(result.assignment_condition_number,2)}</span></div>
        <MatrixHeatmap matrix={result.assignment_matrix}/>
        <p className="hint">Rows are measured outcomes, columns are prepared (true) states. A large condition number means small calibration errors become large correction errors.</p>
        <DistributionBars ideal={result.ideal_distribution} rows={[{key:'raw',values:result.raw_distribution},{key:'corrected',values:result.corrected_distribution}]}/>
        {level.metric==='parity'&&<>
          <h3>Direct inversion vs. the physical (nnls) correction</h3>
          <DistributionBars ideal={result.ideal_distribution} rows={[{key:'inverted',values:result.inverted_distribution},{key:'corrected',values:result.corrected_distribution}]}
            footnote={result.inverted_negative_mass>0?`The direct inversion assigns ${fmt(result.inverted_negative_mass)} of total negative "probability" — unphysical, but mathematically exact. The nnls correction clips that away.`
              :'No negative mass this time — try the other calibration mode or the sandbox to see it appear.'}/>
        </>}
      </div>
      <aside>
        <div className="panel-heading"><span>SCORE</span><span>{result.calibration_mode}</span></div>
        <p>{scoreLine}</p>
        <p>Goal <strong>≤ {fmt(level.target)}</strong></p>
        <p className="dd-stars" aria-label={`${result.stars} of 3 stars`}>{'★'.repeat(result.stars)}{'☆'.repeat(3-result.stars)}</p>
      </aside>
    </section>}
    {result&&<div className={`answer-feedback ${result.passed?'feedback-correct':''}`} role="status">
      <strong>{result.passed?'✓ Level complete!':'Not yet.'}</strong>
      <p>{result.passed?copy.success:copy.hint}</p>
    </div>}
    {copy.quiz&&result&&<section className="dd-quiz" aria-label="Crew question">
      <h3>{copy.quiz.question}</h3>
      <div className="dd-quiz-options">{copy.quiz.options.map((option,i)=><button key={option} className={`answer-option ${answer===i&&i===copy.quiz.correct?'answer-correct':''} ${answer===i&&i!==copy.quiz.correct?'answer-wrong':''}`} disabled={quizSolved} onClick={()=>choose(i)}><span className="answer-letter">{answer===i&&i===copy.quiz.correct?'✓':String.fromCharCode(65+i)}</span><span>{option}</span></button>)}</div>
      {answer!==null&&<div className={`answer-feedback ${quizSolved?'feedback-correct':''}`} role="status"><strong>{quizSolved?'✓ Correct!':'Not quite.'}</strong><p>{quizSolved?copy.success:'Compare the two calibration modes’ scores again — what changed between them?'}</p></div>}
    </section>}
    {done&&<div className="result-actions"><button onClick={onNext}>Next chapter →</button></div>}
  </div>;
}

const describeDataset=d=>`${d.backend}${d.simulated?' (offline simulator)':''} · ${d.qubits} qubits · ${d.calibration_mode} · ${d.created?d.created.replace('T',' '):'unknown time'}`;

function HardwareLab(){
  const [listing,setListing]=useState(null),[selected,setSelected]=useState(''),[data,setData]=useState(null),[error,setError]=useState('');
  const [form,setForm]=useState({qubits:4,calibration_mode:'tensored',shots:2000});
  const [run,setRun]=useState(null),[busy,setBusy]=useState(false);
  const refresh=useCallback(async select=>{
    const value=await api('/hardware');setListing(value);
    setSelected(current=>select||current||value.datasets[0]?.id||'');
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
  async function submit(){setBusy(true);setError('');try{setRun(await api('/hardware/runs',{...form,qubits:Number(form.qubits),shots:Number(form.shots)}));}catch(e){setError(e.message);}finally{setBusy(false);}}
  const set=(key,value)=>setForm(f=>({...f,[key]:value}));
  const enabled=listing?.ibm_enabled;
  return <div className="dd-level">
    <h2>IBM hardware lab</h2>
    <p>Browse every saved run in <code>backend/trex_demo/results/</code>, including runs you make with <code>python main.py hardware</code> or from this page.</p>
    {error&&<p role="alert" className="error">{error}</p>}
    {listing&&(listing.datasets.length?<label>Dataset<select value={selected} onChange={e=>setSelected(e.target.value)}>{listing.datasets.map(d=><option key={d.id} value={d.id}>{describeDataset(d)}</option>)}</select></label>:<p className="notice">No saved hardware runs yet.</p>)}
    {data&&<div className="signal-panel dd-lab-chart"><div className="panel-heading"><span>{data.simulated?'OFFLINE SIMULATOR':'IBM QPU MEASUREMENTS'}</span><span>{data.backend.toUpperCase()}</span></div>
      {data.simulated&&<p className="notice">Fake backends model generic gate/T1/T2 noise, not the readout crosstalk the simulated levels teach. Use them to check the code path, not to judge the correction.</p>}
      <MatrixHeatmap matrix={data.assignment_matrix}/>
      <DistributionBars ideal={data.ideal_distribution} rows={[{key:'raw',values:data.raw_distribution},{key:'corrected',values:data.corrected_distribution}]}
        footnote={`Total variation: raw ${fmt(data.raw_total_variation)}, corrected ${fmt(data.corrected_total_variation)}.`}/>
    </div>}
    <section className="dd-run-panel" aria-label="Run on IBM hardware">
      <h3>Run your own experiment on IBM hardware</h3>
      {!enabled&&<p className="notice">IBM runs are disabled on this server. To enable them, set IBM_ENABLE=true, IBM_QUANTUM_TOKEN and IBM_BACKEND (IBM_QUANTUM_INSTANCE is optional) in backend/.env or the environment, then restart the backend. Jobs use your QPU allocation.</p>}
      <div className="controls">
        <label>Qubits<select value={form.qubits} disabled={!enabled||busy||pending} onChange={e=>set('qubits',e.target.value)}>{[2,3,4].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
        <label>Calibration<select value={form.calibration_mode} disabled={!enabled||busy||pending} onChange={e=>set('calibration_mode',e.target.value)}>{Object.entries(MODE_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
        <label>Shots per circuit<select value={form.shots} disabled={!enabled||busy||pending} onChange={e=>set('shots',e.target.value)}>{[500,1000,2000,4000].map(n=><option key={n} value={n}>{n.toLocaleString('en-US')}</option>)}</select></label>
      </div>
      <p className="hint">Correlated calibration on {form.qubits} qubits needs {2**Number(form.qubits)} calibration circuits plus 1 target circuit.</p>
      <button onClick={submit} disabled={!enabled||busy||pending}>{busy?'Submitting…':pending?'IBM job in progress…':'Submit to IBM'}</button>
      {run&&<p className="status" aria-live="polite">Status: {run.status}{run.backend&&` · ${run.backend}`}{run.job_id&&` · job ${run.job_id}`}{run.error&&` · ${run.error}`}{run.poll_error&&` · ${run.poll_error}`}</p>}
    </section>
  </div>;
}

function Sandbox(){
  const [settings,setSettings]=useState({qubits:3,perQubit:[[.1,.05],[.1,.05],[.1,.05]],crosstalk:[[0,1,0]],calibration_mode:'tensored',target_kind:'ghz',target_bias:.5,shots:4096});
  const [result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const run=useCallback(async current=>{
    setBusy(true);setError('');
    try{setResult(await api('/explore',{qubits:current.qubits,per_qubit_errors:current.perQubit,
      crosstalk_pairs:current.crosstalk.filter(([,,s])=>s>0),calibration_mode:current.calibration_mode,
      target_kind:current.target_kind,target_bias:current.target_bias,shots:current.shots}));}
    catch(e){setError(e.message);}finally{setBusy(false);}
  },[]);
  useEffect(()=>{run(settings);},[]); // eslint-disable-line react-hooks/exhaustive-deps
  function setQubits(n){
    setSettings(s=>({...s,qubits:n,
      perQubit:Array.from({length:n},(_,i)=>s.perQubit[i]||[.1,.05]),
      crosstalk:s.crosstalk.filter(([a,b])=>a<n&&b<n)}));
  }
  function setRate(i,which,value){setSettings(s=>({...s,perQubit:s.perQubit.map((pair,j)=>j===i?(which===0?[value,pair[1]]:[pair[0],value]):pair)}));}
  function setCrosstalk(index,strength){setSettings(s=>({...s,crosstalk:s.crosstalk.map((pair,j)=>j===index?[pair[0],pair[1],strength]:pair)}));}
  const pairs=Array.from({length:settings.qubits-1},(_,i)=>[i,i+1]);
  return <div className="dd-level">
    <h2>Calibration sandbox</h2>
    <p>Pick any qubit count, per-qubit bias rates and neighbour crosstalk, then compare tensored against correlated calibration on a GHZ state (or a single biased qubit).</p>
    <div className="controls">
      <label>Qubits<select value={settings.qubits} onChange={e=>setQubits(Number(e.target.value))}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
      <label>Target<select value={settings.target_kind} onChange={e=>setSettings(s=>({...s,target_kind:e.target.value}))}><option value="ghz">GHZ state</option><option value="bias" disabled={settings.qubits!==1}>Biased coin (1 qubit only)</option></select></label>
      {settings.target_kind==='bias'&&<label>True P(1): <strong>{Math.round(settings.target_bias*100)}%</strong><input type="range" min="0" max="100" value={Math.round(settings.target_bias*100)} onChange={e=>setSettings(s=>({...s,target_bias:Number(e.target.value)/100}))}/></label>}
      <label>Calibration<select value={settings.calibration_mode} onChange={e=>setSettings(s=>({...s,calibration_mode:e.target.value}))}>{Object.entries(MODE_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label>Shots<select value={settings.shots} onChange={e=>setSettings(s=>({...s,shots:Number(e.target.value)}))}>{[1024,4096,8192,16384].map(n=><option key={n} value={n}>{n.toLocaleString('en-US')}</option>)}</select></label>
    </div>
    <fieldset className="dd-checks"><legend>Per-qubit readout error</legend>
      {settings.perQubit.map((pair,i)=><React.Fragment key={i}>
        <label>q{i} P(1|0): <strong>{Math.round(pair[0]*100)}%</strong><input type="range" min="0" max="40" value={Math.round(pair[0]*100)} onChange={e=>setRate(i,0,Number(e.target.value)/100)}/></label>
        <label>q{i} P(0|1): <strong>{Math.round(pair[1]*100)}%</strong><input type="range" min="0" max="40" value={Math.round(pair[1]*100)} onChange={e=>setRate(i,1,Number(e.target.value)/100)}/></label>
      </React.Fragment>)}
    </fieldset>
    {pairs.length>0&&<fieldset className="dd-checks"><legend>Neighbour crosstalk</legend>
      {pairs.map(([a,b],i)=><label key={i}>q{a}–q{b}: <strong>{Math.round((settings.crosstalk[i]?.[2]||0)*100)}%</strong>
        <input type="range" min="0" max="100" value={Math.round((settings.crosstalk[i]?.[2]||0)*100)} onChange={e=>{
          setSettings(s=>{const next=pairs.map(([x,y],j)=>s.crosstalk[j]?[x,y,s.crosstalk[j][2]]:[x,y,0]);
            next[i]=[a,b,Number(e.target.value)/100];return {...s,crosstalk:next};});
        }}/></label>)}
    </fieldset>}
    <button onClick={()=>run(settings)} disabled={busy}>{busy?'Simulating…':'Run'}</button>
    {error&&<p role="alert" className="error">{error}</p>}
    {result&&<div className="signal-panel dd-lab-chart"><div className="panel-heading"><span>{result.calibration_mode.toUpperCase()} CALIBRATION</span><span>{result.calibration_circuits_used} circuits · condition {fmt(result.assignment_condition_number,2)}</span></div>
      <MatrixHeatmap matrix={result.assignment_matrix}/>
      <DistributionBars ideal={result.ideal_distribution} rows={[{key:'raw',values:result.raw_distribution},{key:'corrected',values:result.corrected_distribution}]}
        footnote={`Total variation: raw ${fmt(result.raw_total_variation)}, corrected ${fmt(result.corrected_total_variation)}.`}/>
    </div>}
  </div>;
}

export default function TRexGame(){
  const [chapter,setChapter]=useState('learn'),[levels,setLevels]=useState(null),[completed,setCompleted]=useState([]),[error,setError]=useState('');
  useEffect(()=>{api('/levels').then(value=>setLevels(Object.fromEntries(value.levels.map(level=>[level.id,level])))).catch(e=>setError(e.message));},[]);
  const complete=useCallback(id=>setCompleted(previous=>previous.includes(id)?previous:[...previous,id]),[]);
  const goNext=()=>setChapter(nextChapter(chapter));
  const finished=LEVEL_IDS.filter(id=>completed.includes(id)).length;
  return <main className="dd-lab">
    <section className="mini-game dd-shell">
      <div className="eyebrow">INTERACTIVE LAB · READOUT MITIGATION</div>
      <h1>Detector Decoder</h1>
      <p className="game-goal">Calibrate a biased detector with known inputs, then invert the calibration to correct an unknown measurement — and find out when the cheap calibration stops being enough.</p>
      <p className="notice">Levels 1–4 use a seeded readout-noise simulation computed by the backend. The IBM lab and sandbox can reach real hardware or any custom scenario.</p>
      <nav className="mission-progress dd-chapters" aria-label="Detector Decoder chapters">
        {CHAPTERS.map(c=>{const done=completed.includes(c.id);return <button key={c.id} className={`${done?'finished':''} ${chapter===c.id?'current':''}`} aria-current={chapter===c.id?'step':undefined} aria-label={`${c.name}${done?', completed':''}`} onClick={()=>setChapter(c.id)}>{done?'✓':c.short}</button>;})}
        <span>{finished} / 4 levels complete</span>
      </nav>
      {error&&<p role="alert" className="error">{error}</p>}
      {chapter==='learn'&&<Learn onStart={()=>setChapter('bias')}/>}
      {LEVEL_COPY[chapter]&&levels?.[chapter]&&<Level key={chapter} level={levels[chapter]} copy={LEVEL_COPY[chapter]} solved={completed.includes(chapter)} onComplete={()=>complete(chapter)} onNext={goNext}/>}
      {LEVEL_COPY[chapter]&&!levels&&!error&&<p className="hint">Loading level…</p>}
      {chapter==='lab'&&<HardwareLab/>}
      {chapter==='sandbox'&&<Sandbox/>}
      {finished===4&&<p className="all-complete">✓ All four levels complete! You now know how readout mitigation works, when the cheap calibration is enough, and when it isn’t.</p>}
    </section>
  </main>;
}
