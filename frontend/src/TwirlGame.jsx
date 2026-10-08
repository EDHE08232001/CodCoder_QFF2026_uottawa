import React, {useCallback, useEffect, useRef, useState} from 'react';
import Codfish from './Codfish';

// Colour follows the entity: the same hue marks "ideal", "no twirling" and "twirled" everywhere.
const SERIES_COLORS={ideal:'#a5f7c9',exact:'#8fbfd0',unmitigated:'#e0b03a',twirled:'#b08cff'};
const SERIES_LABELS={ideal:'Ideal (noiseless)',exact:'Continuous time',unmitigated:'No twirling',twirled:'Pauli twirled'};
const LEVEL_IDS=['circuit','coherent','stochastic','mixed'];
const CHAPTERS=[
  {id:'learn',short:'Learn',name:'Learn: what is Pauli twirling?'},
  {id:'circuit',short:'01',name:'Level 1: The same circuit twice'},
  {id:'coherent',short:'02',name:'Level 2: The drifting quench'},
  {id:'stochastic',short:'03',name:'Level 3: Noise that is already random'},
  {id:'mixed',short:'04',name:'Level 4: Both kinds at once'},
  {id:'lab',short:'Lab',name:'Twirl lab: Aer or IBM'},
];
const LEVEL_COPY={
  coherent:{number:2,title:'The drifting quench',fish:'clown',crew:'COHERENT ZZ CROSSTALK',
    brief:'Every two-qubit gate on this reef leaves behind the same small ZZ rotation. It is a unitary, so it repeats identically in every shot and the whole circuit drifts the same way every time. The crew measures the average magnetisation of the chain after the quench.',
    goal:'Bring the twirled magnetisation error below 0.04.',
    hint:'One Pauli frame is a lottery ticket, not a twirl. Raise the number of randomizations so the random signs have a chance to average out.',
    success:'That is twirling at work. A coherent kick repeated N times adds up like N; once each gate gets a random Pauli frame the kicks carry random signs and only grow like the square root of N. The error did not disappear, it became a small random Pauli error instead of a big systematic one.'},
  stochastic:{number:3,title:'Noise that is already random',fish:'puffer',crew:'DEPOLARIZING NOISE',
    brief:'Same quench, same gate count, same size of error, but this reef\u2019s gates fail by depolarizing: with some probability a random Pauli lands on the pair of qubits. Try to twirl it away.',
    goal:'Run both treatments, then answer the crew.',
    quiz:{question:'Why does twirling leave this result exactly where it was?',correct:1,options:[
      'There were too few randomizations to see the improvement.',
      'Depolarizing noise is already a random Pauli channel, so twirling it returns the same channel.',
      'Twirling only works on circuits with more than four qubits.']},
    hint:'Compare the two columns of dots. They scatter around the same wrong answer.',
    success:'Exactly. Twirling replaces a noise channel by its Pauli-twirled version. A channel that is already a Pauli channel is its own twirl, so there is nothing left to change. Shrinking this error needs a different tool: ZNE, PEC or better gates.'},
  mixed:{number:4,title:'Both kinds at once',fish:'angel',crew:'COHERENT + DEPOLARIZING',
    brief:'Real hardware makes both mistakes at the same time. This reef has the coherent ZZ kick of level 2 and the depolarizing noise of level 3 on every gate. Run it and watch which half of the error moves.',
    goal:'Run both treatments, then answer the crew.',
    quiz:{question:'Twirling improved the result but did not fix it. What is left over?',correct:0,options:[
      'The depolarizing part, which twirling cannot touch.',
      'The coherent part, which needs even more randomizations.',
      'Trotter error, which twirling converts into readout error.']},
    hint:'Compare the twirled error here with the twirled error in level 3.',
    success:'Right. Twirling peeled off the coherent half and left the stochastic half untouched, so this run lands almost exactly on level 3\u2019s twirled answer. That is the real role of twirling: it does not shrink the error, it makes the error behave like a simple random Pauli channel, which is what methods such as ZNE and PEC assume.'},
};
const CIRCUIT_QUIZ={question:'The Pauli frames added gates to the circuit. What did they change about the noiseless answer?',correct:2,options:[
  'They scramble it, which is why twirling needs many randomizations.',
  'They rotate it a little, and the error bars hide the difference.',
  'Nothing at all: every frame cancels itself, so the ideal outcome is identical.']};

async function api(path, body){
  let response;
  try{response=await fetch('/api/twirl'+path, body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);}
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
const RANDOMIZATION_CHOICES=[1,2,4,8,16,32,64];
const SHOT_CHOICES=[32,128,256,512,1024,2048,4096];

function useWidth(fallback=640){
  const ref=useRef(null),[width,setWidth]=useState(fallback);
  useEffect(()=>{
    if(!ref.current)return undefined;
    const observer=new ResizeObserver(([entry])=>setWidth(Math.max(260,entry.contentRect.width)));
    observer.observe(ref.current);
    return ()=>observer.disconnect();
  },[]);
  return [ref,width];
}

function Swatch({name}){
  return <i className="tw-swatch" style={{background:SERIES_COLORS[name]}}/>;
}

// ------------------------------------------------------------------ learn
const GATES=12, KICK=1;
const signed=value=>`${value>0?'+':value<0?'−':''}${Math.abs(value)}`;
// Each shot contributes one error vector; laying them head to tail from the
// origin gives the running total the player watches climb or stagger.
const walk=totals=>totals.reduce((path,total)=>[...path,path[path.length-1]+total],[0]);
// How far a random walk of n shots typically strays: sqrt(n) rather than n.
const typical=shots=>Math.sqrt(GATES*Math.max(shots,0))*KICK;
// Round axis steps to 1, 2, 2.5 or 5 times a power of ten.
const niceStep=span=>{
  const rough=Math.max(span,1)/4, power=10**Math.floor(Math.log10(rough));
  return power*[1,2,2.5,5,10].find(option=>option*power>=rough);
};

function ErrorWalk({runs}){
  const [ref,width]=useWidth(600);
  const series=[{key:'unmitigated',path:walk(runs.plain)},{key:'twirled',path:walk(runs.twirled)}];
  const shots=Math.max(6,...series.map(entry=>entry.path.length-1));
  const height=250,left=56,right=width-16,top=16,bottom=height-36;
  const high=Math.max(GATES*KICK,...series.flatMap(entry=>entry.path),typical(shots))*1.1;
  const low=Math.min(...series.flatMap(entry=>entry.path),-typical(shots))*1.35-1;
  const x=index=>left+index/shots*(right-left);
  const y=value=>bottom-(value-low)/(high-low)*(bottom-top);
  const steps=[...Array(shots+1).keys()];
  const band=steps.map(n=>`${x(n)},${y(typical(n))}`)
    .concat([...steps].reverse().map(n=>`${x(n)},${y(-typical(n))}`)).join(' ');
  const step=niceStep(high-low);
  const ticks=[];
  for(let tick=Math.ceil(low/step)*step;tick<=high;tick+=step)ticks.push(tick);
  const totals=series.map(entry=>entry.path[entry.path.length-1]);
  const description=`Accumulated error against shot number. Without twirling the running total has `
    +`reached ${totals[0]} after ${runs.plain.length} shots; with Pauli twirling it is at ${totals[1]} `
    +`after ${runs.twirled.length} shots, inside a typical random-walk reach of `
    +`${typical(runs.twirled.length).toFixed(1)}.`;
  return <div ref={ref} className="chart tw-chart tw-walk">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={description}>
      {ticks.map(tick=><g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="grid"/>
        <text x={left-8} y={y(tick)+4} textAnchor="end">{signed(Math.round(tick))}</text></g>)}
      <polygon className="tw-walk-band" points={band}/>
      <line x1={left} x2={right} y1={y(0)} y2={y(0)} className="axis"/>
      <line x1={left} x2={left} y1={top} y2={bottom} className="axis"/>
      <text x={(left+right)/2} y={height-6} textAnchor="middle">Shot</text>
      <text x={left} y={10}>Accumulated error</text>
      {series.map(entry=><g key={entry.key}>
        <polyline fill="none" stroke={SERIES_COLORS[entry.key]} strokeWidth="2.5"
          points={entry.path.map((value,index)=>`${x(index)},${y(value)}`).join(' ')}/>
        {entry.path.map((value,index)=><circle key={index} cx={x(index)} cy={y(value)} r={index?3:2.5}
          fill={SERIES_COLORS[entry.key]} className="tw-point"/>)}
      </g>)}
    </svg>
    <p className="hint">The shaded band is the typical reach of a coin-flipping walk of the same length, ±√(12·shots). That is one standard deviation, so a twirled run does stray outside it from time to time. What it never does is climb steadily: the untwirled total leaves the band after a single shot and then adds another {GATES} every time.</p>
  </div>;
}

function FrameShuffler(){
  const [twirled,setTwirled]=useState(false);
  // Both treatments keep their own history so the two curves can be compared.
  const [runs,setRuns]=useState({plain:[],twirled:[]});
  const [signs,setSigns]=useState(Array(GATES).fill(1));
  const treatment=twirled?'twirled':'plain';
  const shots=runs[treatment];
  function shoot(){
    const drawn=twirled?Array.from({length:GATES},()=>Math.random()<.5?-1:1):Array(GATES).fill(1);
    setSigns(drawn);
    setRuns(previous=>({...previous,
      [treatment]:[...previous[treatment],drawn.reduce((total,sign)=>total+sign*KICK,0)]}));
  }
  function switchMode(value){setTwirled(value);setSigns(Array(GATES).fill(1));}
  function reset(){setRuns({plain:[],twirled:[]});setSigns(Array(GATES).fill(1));}
  const total=signs.reduce((sum,sign)=>sum+sign*KICK,0);
  const accumulated=shots.reduce((sum,value)=>sum+value,0);
  const average=shots.length?accumulated/shots.length:0;
  const scale=GATES*KICK;
  return <section className="tw-playground" aria-label="Shuffle the frames yourself">
    <div className="panel-heading"><span>SHUFFLE IT YOURSELF</span><span>{shots.length} shot{shots.length===1?'':'s'}</span></div>
    <p className="hint">Twelve two-qubit gates, each leaving the same small error kick behind. A Pauli frame cannot remove a kick, but it can flip its sign.</p>
    <div className="tw-kicks" role="img" aria-label={`Twelve error kicks, total ${total} of a possible ${scale}.`}>
      {signs.map((sign,index)=><span key={index} className={sign>0?'up':'down'}>{sign>0?'↑':'↓'}</span>)}
    </div>
    <div className="tw-meters">
      <div><span>This shot</span><div className="tw-meter"><i className={total<0?'negative':''} style={{width:`${Math.abs(total)/scale*50}%`,[total<0?'right':'left']:'50%'}}/></div><strong>{total>0?'+':''}{total}</strong></div>
      <div><span>Average of {shots.length||0} shots</span><div className="tw-meter"><i className={average<0?'negative':''} style={{width:`${Math.abs(average)/scale*50}%`,[average<0?'right':'left']:'50%'}}/></div><strong>{average>0?'+':''}{fmt(average,1)}</strong></div>
    </div>
    <div className="answer-buttons">
      <button onClick={shoot}>▶ Take a shot</button>
      <button className={twirled?'secondary':''} onClick={()=>switchMode(false)} aria-pressed={!twirled}>No twirling</button>
      <button className={twirled?'':'secondary'} onClick={()=>switchMode(true)} aria-pressed={twirled}>Pauli twirling</button>
      <button className="secondary" disabled={!runs.plain.length&&!runs.twirled.length} onClick={reset}>↺ Clear both</button>
    </div>
    <h4 className="tw-walk-title">Error accumulated after every shot</h4>
    <div className="tw-walk-totals">
      {[{key:'unmitigated',name:'plain'},{key:'twirled',name:'twirled'}].map(entry=>{
        const history=runs[entry.name], sum=history.reduce((a,b)=>a+b,0);
        return <span key={entry.key} className={treatment===entry.name?'current':''}>
          <Swatch name={entry.key}/>{SERIES_LABELS[entry.key]}
          <strong style={{color:SERIES_COLORS[entry.key]}}>{signed(sum)}</strong>
          <small>{history.length?`after ${history.length} shot${history.length===1?'':'s'}, typically ±${typical(history.length).toFixed(1)} if random`:'no shots yet'}</small>
        </span>;
      })}
    </div>
    <ErrorWalk runs={runs}/>
    <p role="status" className="lesson-feedback">{twirled
      ?`Every frame flips a random subset of the kicks, so each shot pulls the running total a different way and it staggers around zero instead of climbing. A typical single shot is now about the square root of ${GATES}, roughly ${Math.sqrt(GATES).toFixed(1)} instead of ${GATES}${shots.length?`, and after ${shots.length} shot${shots.length===1?'':'s'} the total sits at ${signed(accumulated)} rather than ${signed(GATES*shots.length)}`:''}.`
      :`Without twirling every shot is identical: all ${GATES} kicks point the same way and add up to ${GATES}. Each new shot stacks another ${GATES} onto the total${shots.length?`, which is why ${shots.length} shot${shots.length===1?'':'s'} has reached ${signed(accumulated)}`:''}, so the line climbs straight up. Taking more shots cannot help, because the error is not random - it is the same mistake every time.`}</p>
  </section>;
}

function Learn({onStart}){
  return <div className="tw-learn">
    <h2>What is Pauli twirling?</h2>
    <div className="tw-concepts">
      <article><span className="pixel-icon">⟳</span><h3>A frame that cancels itself</h3><p>Put a random Pauli in front of a two-qubit gate and its partner behind it. For a Clifford gate the partner is always another Pauli, so the two cancel and the circuit still computes exactly the same thing.</p></article>
      <article><span className="pixel-icon">↯</span><h3>The noise does not cancel</h3><p>The error sitting on the gate gets caught between the two Paulis, so it comes out conjugated by a random Pauli. Average over many frames and the coherent, repeatable part of the error averages away.</p></article>
      <article><span className="pixel-icon">±</span><h3>Reshape, not remove</h3><p>What is left is a random Pauli error of the same strength. Errors that were already random Paulis do not change at all. Twirling buys predictability, not accuracy.</p></article>
    </div>
    <FrameShuffler/>
    <div className="lesson-feedback">
      <strong>Pauli twirling</strong> runs the same logical circuit many times, each with a different random Pauli frame around every two-qubit gate, and averages the results. IBM calls it <em>gate twirling</em>, and its Sampler and Estimator can do it for you. It costs no extra qubits, it needs the shots split over several randomizations, and it is the step that makes ZNE and PEC trustworthy, because both assume the noise is a Pauli channel.
      <ul className="tw-list"><li>✓ Turns coherent, repeatable gate errors into random Pauli errors, which usually brings an observable closer to the truth.</li><li>✗ Does nothing to noise that is already a Pauli channel, and nothing to readout error or Trotter error.</li><li>⚠ The frames are real gates: on hardware they add single-qubit gates, and too few randomizations just gives you one random answer.</li></ul>
    </div>
    <div className="result-actions"><button onClick={onStart}>Start level 1 →</button></div>
  </div>;
}

// ------------------------------------------------------------------ shared result views
function MagnetBars({result}){
  const rows=[
    {key:'ideal',value:result.ideal.magnetization},
    ...(result.exact?[{key:'exact',value:result.exact.magnetization}]:[]),
    {key:'unmitigated',value:result.unmitigated.magnetization,error:result.unmitigated.standard_error,miss:result.unmitigated.error},
    {key:'twirled',value:result.twirled.magnetization,error:result.twirled.standard_error,miss:result.twirled.error},
  ];
  const ideal=result.ideal.magnetization;
  return <div className="tw-bars">
    {rows.map(row=><div key={row.key} className={`tw-bar-row ${row.key}`}>
      <span className="tw-bar-label"><Swatch name={row.key}/>{SERIES_LABELS[row.key]}</span>
      <span className="tw-bar-track" aria-hidden="true">
        <i className="tw-bar-ideal" style={{left:`${50+ideal*50}%`}}/>
        <i className="tw-bar-fill" style={{background:SERIES_COLORS[row.key],...(row.value>=0
          ?{left:'50%',width:`${Math.min(1,row.value)*50}%`}
          :{right:'50%',width:`${Math.min(1,-row.value)*50}%`})}}/>
      </span>
      <strong>{fmt(row.value)}</strong>
      <small>{row.error!==undefined?`± ${fmt(row.error)}  ·  off by ${fmt(row.miss)}`:'reference'}</small>
    </div>)}
    <p className="hint">Average magnetisation of the chain, from −1 (all spins down) to +1 (all up). Bars start at 0 in the middle; the green mark is the ideal answer. “Off by” is the distance from the ideal answer, and ± is one standard error.</p>
  </div>;
}

function RunScatter({result}){
  const [ref,width]=useWidth();
  const [hover,setHover]=useState(null);
  const series=[
    {key:'unmitigated',values:result.unmitigated.values,mean:result.unmitigated.magnetization},
    {key:'twirled',values:result.twirled.values,mean:result.twirled.magnetization},
  ];
  const ideal=result.ideal.magnetization;
  const all=[...series.flatMap(entry=>entry.values),ideal];
  const padding=Math.max(.03,(Math.max(...all)-Math.min(...all))*.3);
  const low=Math.min(...all)-padding, high=Math.max(...all)+padding;
  const height=270,left=58,right=width-118,top=16,bottom=height-44;
  const count=Math.max(1,...series.map(entry=>entry.values.length));
  const x=index=>count<2?(left+right)/2:left+index/(count-1)*(right-left);
  const y=value=>bottom-(value-low)/(high-low)*(bottom-top);
  const ticks=Array.from({length:5},(_,i)=>low+(high-low)*i/4);
  const description=`Magnetisation of each randomization. Ideal ${fmt(ideal)}; without twirling the mean is `
    +`${fmt(series[0].mean)}; with Pauli twirling ${fmt(series[1].mean)}.`;
  // Keep the three right-hand labels from printing on top of each other.
  const labels=[{key:'ideal',text:'ideal',y:y(ideal)},
    ...series.map(entry=>({key:entry.key,text:SERIES_LABELS[entry.key].toLowerCase(),y:y(entry.mean)}))]
    .sort((first,second)=>first.y-second.y);
  labels.forEach((label,index)=>{if(index)label.y=Math.max(label.y,labels[index-1].y+14);});
  return <div ref={ref} className="chart tw-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={description}>
      {ticks.map(tick=><g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="grid"/><text x={left-8} y={y(tick)+4} textAnchor="end">{fmt(tick,2)}</text></g>)}
      <line x1={left} x2={left} y1={top} y2={bottom} className="axis"/><line x1={left} x2={right} y1={bottom} y2={bottom} className="axis"/>
      <text x={(left+right)/2} y={height-8} textAnchor="middle">Randomization</text><text x={left} y={10}>Magnetisation</text>
      <line x1={left} x2={right} y1={y(ideal)} y2={y(ideal)} className="tw-ideal-line"/>
      {series.map(entry=><g key={entry.key}>
        <line x1={left} x2={right} y1={y(entry.mean)} y2={y(entry.mean)} stroke={SERIES_COLORS[entry.key]} strokeWidth="1.5" strokeDasharray="5 4"/>
        {entry.values.map((value,index)=><circle key={index} cx={x(index)} cy={y(value)} r={hover===index?6:4}
          fill={SERIES_COLORS[entry.key]} className="tw-point"/>)}
      </g>)}
      {labels.map(label=><text key={label.key} x={right+8} y={label.y+4} className="tw-point-label" fill={SERIES_COLORS[label.key]}>{label.text}</text>)}
      <rect x={left} y={top} width={Math.max(0,right-left)} height={bottom-top} fill="transparent"
        onPointerMove={event=>{const box=event.currentTarget.ownerSVGElement.getBoundingClientRect();
          const position=(event.clientX-box.left)/box.width*width;
          let best=0;for(let i=0;i<count;i++)if(Math.abs(x(i)-position)<Math.abs(x(best)-position))best=i;
          setHover(best);}} onPointerLeave={()=>setHover(null)}/>
    </svg>
    {hover!==null&&<div className="tw-tooltip" style={{left:`${Math.min(72,Math.max(6,x(hover)/width*100))}%`}} role="tooltip">
      <strong>Randomization {hover+1}</strong>
      {series.map(entry=><span key={entry.key}><i style={{background:SERIES_COLORS[entry.key]}}/>{SERIES_LABELS[entry.key]}: {fmt(entry.values[hover]??0)}</span>)}
    </div>}
    <div className="legend">{['ideal','unmitigated','twirled'].map(name=><span key={name}><Swatch name={name}/>{SERIES_LABELS[name]}</span>)}</div>
    <p className="hint">Each dot is one circuit of {result.shots} shots. Without twirling the circuit is identical every time, so its dots only show shot noise around whatever answer the noise produced. The twirled dots scatter more, because each one uses a different Pauli frame: that extra spread is the price of the average being closer to the truth.</p>
  </div>;
}

function DistributionBars({result}){
  const keys=Object.keys(result.ideal.distribution);
  const rows=['ideal','unmitigated','twirled'].map(key=>({key,values:result[key].distribution}));
  const peak=Math.max(...rows.flatMap(row=>keys.map(bits=>row.values[bits]||0)),1e-9);
  return <div className="tw-dist-wrap">
    <div className="tw-dist" role="img" aria-label={`Outcome probabilities for ${keys.length} bitstrings, ideal against unmitigated and twirled.`}>
      {keys.map(bits=><div key={bits} className="tw-dist-col">
        <div className="tw-dist-bars">{rows.map(row=><i key={row.key} style={{height:`${(row.values[bits]||0)/peak*100}%`,background:SERIES_COLORS[row.key]}}
          title={`${bits} · ${SERIES_LABELS[row.key]}: ${fmt(row.values[bits]||0)}`}/>)}</div>
        <span className="tw-dist-label">{bits}</span>
      </div>)}
    </div>
    <div className="legend">{rows.map(row=><span key={row.key}><Swatch name={row.key}/>{SERIES_LABELS[row.key]}</span>)}</div>
    <p className="hint">Total variation distance from the ideal distribution: {fmt(result.unmitigated.total_variation)} without twirling, {fmt(result.twirled.total_variation)} twirled. Bar heights are scaled to the largest probability shown ({fmt(peak)}).</p>
  </div>;
}

function Verdict({result}){
  const {comparison}=result;
  const moved=comparison.significant;
  const closer=comparison.error_change>0;
  return <div className={`answer-feedback ${moved&&closer?'feedback-correct':''}`} role="status">
    <strong>{!moved?'Twirling changed nothing measurable.':closer?'✓ Twirling moved the answer towards the ideal value.':'Twirling moved the answer away from the ideal value.'}</strong>
    <p>
      The twirled mean sits {fmt(Math.abs(comparison.shift))} away from the unmitigated one, against a three-standard-error band of {fmt(comparison.uncertainty)}.
      {' '}The distance from the ideal answer went from {fmt(result.unmitigated.error)} to {fmt(result.twirled.error)}.
      {!moved&&' Anything inside that band is shot noise, not mitigation.'}
    </p>
  </div>;
}

function ResultTables({result}){
  return <details className="tw-details"><summary>Numbers behind this run</summary>
    <div className="tw-table-wrap"><table className="tw-table">
      <thead><tr><th>Quantity</th><th>Ideal</th><th>No twirling</th><th>Pauli twirled</th></tr></thead>
      <tbody>
        <tr><td>Magnetisation</td><td>{fmt(result.ideal.magnetization)}</td><td>{fmt(result.unmitigated.magnetization)}</td><td>{fmt(result.twirled.magnetization)}</td></tr>
        <tr><td>Standard error</td><td>—</td><td>{fmt(result.unmitigated.standard_error)}</td><td>{fmt(result.twirled.standard_error)}</td></tr>
        <tr><td>Spread between circuits</td><td>—</td><td>{fmt(result.unmitigated.spread)}</td><td>{fmt(result.twirled.spread)}</td></tr>
        <tr><td>Distance from ideal</td><td>0</td><td>{fmt(result.unmitigated.error)}</td><td>{fmt(result.twirled.error)}</td></tr>
        <tr><td>Total variation distance</td><td>0</td><td>{fmt(result.unmitigated.total_variation)}</td><td>{fmt(result.twirled.total_variation)}</td></tr>
        <tr><td>Shots used</td><td>—</td><td>{result.unmitigated.shots}</td><td>{result.twirled.shots}</td></tr>
      </tbody>
    </table></div>
    <div className="tw-table-wrap"><table className="tw-table">
      <thead><tr><th>⟨Z⟩ per qubit</th>{result.ideal.per_qubit.map((_,index)=><th key={index}>q{index}</th>)}</tr></thead>
      <tbody>
        <tr><td>Ideal</td>{result.ideal.per_qubit.map((value,index)=><td key={index}>{fmt(value)}</td>)}</tr>
        <tr><td>No twirling</td>{result.unmitigated.per_qubit.map((value,index)=><td key={index}>{fmt(value)}</td>)}</tr>
        <tr><td>Pauli twirled</td>{result.twirled.per_qubit.map((value,index)=><td key={index}>{fmt(value)}</td>)}</tr>
      </tbody>
    </table></div>
    <p className="hint">The quench is Trotterised, so even a perfect quantum computer would miss the continuous-time answer
      {result.exact?` by ${fmt(Math.abs(result.ideal.magnetization-result.exact.magnetization))}`:''}. Mitigation aims at the ideal column, not at continuous time.</p>
  </details>;
}

function ProblemSummary({result}){
  return <p className="tw-summary">
    <span>{result.qubits} qubits</span><span>{result.steps} Trotter steps</span><span>h = {result.field}</span>
    <span>t = {result.total_time}/J</span><span>{result.two_qubit_gates} CX gates</span>
    <span>{result.randomizations} × {result.shots} shots</span>
    {result.coherent_angle>0&&<span>ZZ kick {result.coherent_angle} rad</span>}
    {result.depolarizing>0&&<span>depolarizing {fmt(result.depolarizing*100,1)}%</span>}
  </p>;
}

const isIbmResult=result=>!!result&&result.backend&&result.backend!=='aer'&&!result.simulated;

function HardwareReadout({result}){
  const layout=Array.isArray(result.layout)&&result.layout.length===result.qubits?result.layout:null;
  const witness=result.experiment==='witness';
  const columns=[
    {key:'unmitigated',title:'No twirling',note:'bare ISA circuit'},
    {key:'twirled',title:'Pauli twirled',note:'same shots, new frames'},
    {key:'ideal',title:'Ideal (noiseless)',note:witness?'identity target ⟨Z⟩ = +1':'Trotter target, not hardware'},
  ];
  const stamp=result.created?result.created.replace('T',' ').slice(0,16):null;
  return <section className="tw-ibm" id="tw-ibm-readout" aria-label={`${result.backend} hardware readout`}>
    <div className="tw-ibm-banner">
      <span>IBM QPU READOUT</span>
      <strong>{result.backend}</strong>
      <span>{stamp||'just now'}</span>
    </div>
    <p className="tw-ibm-meta">
      {result.job_id&&<span>job {result.job_id}</span>}
      {layout&&<span>physical qubits {layout.join(' — ')}</span>}
      <span>{result.randomizations} × {result.shots} shots per treatment</span>
      {result.two_qubit_gates!=null&&<span>{result.two_qubit_gates} two-qubit gates</span>}
    </p>
    {layout&&<div className="tw-line" role="img" aria-label={`Logical chain mapped onto physical qubits ${layout.join(', ')}.`}>
      {layout.map((phys,index)=><span key={`${phys}-${index}`} className="tw-node-wrap">
        <span className="tw-node"><b>q{index}</b><small>P{phys}</small></span>
        {index<layout.length-1&&<i className="tw-bond" aria-hidden="true"/>}
      </span>)}
    </div>}
    <div className="tw-readout">
      {columns.map(column=>{
        const row=result[column.key];
        const value=row.magnetization;
        const error=row.standard_error;
        return <article key={column.key} className={column.key}>
          <span className="tw-readout-label"><Swatch name={column.key}/>{column.title}</span>
          <strong>{fmt(value)}</strong>
          <small>{error!==undefined?`± ${fmt(error)}  ·  off by ${fmt(row.error)}`:column.note}</small>
        </article>;
      })}
    </div>
    <div className="tw-device-z">
      <h3>⟨Z⟩ on each device qubit</h3>
      {result.ideal.per_qubit.map((_,index)=>{
        const phys=layout?layout[index]:index;
        const rows=[{key:'ideal',value:result.ideal.per_qubit[index]},
          {key:'unmitigated',value:result.unmitigated.per_qubit[index]},
          {key:'twirled',value:result.twirled.per_qubit[index]}];
        return <div key={index} className="tw-device-z-row">
          <span>q{index}{layout?` · P${phys}`:''}</span>
          <span className="tw-bar-track" aria-hidden="true">
            {rows.map(row=><i key={row.key} className="tw-device-z-mark" style={{left:`${50+row.value*50}%`,background:SERIES_COLORS[row.key]}}/>)}
          </span>
        </div>;
      })}
      <div className="legend">{['ideal','unmitigated','twirled'].map(name=><span key={name}><Swatch name={name}/>{SERIES_LABELS[name]}</span>)}</div>
      <p className="hint">Marks sit on −1 … +1. Green is the noiseless target. These are measurements from {result.backend}, not a simulation.</p>
    </div>
  </section>;
}

function BudgetControls({form,set,disabled}){
  return <>
    <label>Randomizations
      <select value={form.randomizations} disabled={disabled} onChange={event=>set('randomizations',Number(event.target.value))}>
        {RANDOMIZATION_CHOICES.map(value=><option key={value} value={value}>{value}</option>)}
      </select>
    </label>
    <label>Shots per randomization
      <select value={form.shots} disabled={disabled} onChange={event=>set('shots',Number(event.target.value))}>
        {SHOT_CHOICES.map(value=><option key={value} value={value}>{value.toLocaleString('en-US')}</option>)}
      </select>
    </label>
  </>;
}

// ------------------------------------------------------------------ level 1: the circuit
function CircuitLevel({solved,onComplete,onNext}){
  const [form,setForm]=useState({qubits:3,steps:2,field:0.6,seed:7});
  const [preview,setPreview]=useState(null),[view,setView]=useState('bare'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [answer,setAnswer]=useState(null);
  const load=useCallback(async settings=>{
    setBusy(true);setError('');
    try{setPreview(await api('/circuit',settings));}catch(problem){setError(problem.message);}finally{setBusy(false);}
  },[]);
  useEffect(()=>{load(form);},[]); // eslint-disable-line react-hooks/exhaustive-deps
  const set=(key,value)=>{const next={...form,[key]:value};setForm(next);load(next);};
  const correct=answer===CIRCUIT_QUIZ.correct;
  useEffect(()=>{if(correct)onComplete();},[correct]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown=preview?preview[view]:null;
  return <div className="tw-level">
    <div className="fish-brief"><Codfish species="tang"/><div><span className="crew-label">LEVEL 01 · THE SAME CIRCUIT TWICE</span><h2 className="tw-level-title">The same circuit twice</h2></div></div>
    <p>This is the problem the whole module runs: a transverse-field Ising chain starting in |0…0⟩, quenched by switching on the field, built from Trotter steps of CX · RZ · CX and RX rotations. Look at it without Pauli frames, then with them, before you run anything.</p>
    <p className="tw-goal"><strong>Goal:</strong> Confirm for yourself that the Pauli frames leave the ideal answer alone.</p>
    <div className="controls">
      <label>Qubits<select value={form.qubits} disabled={busy} onChange={event=>set('qubits',Number(event.target.value))}>{[2,3,4,5,6].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
      <label>Trotter steps<select value={form.steps} disabled={busy} onChange={event=>set('steps',Number(event.target.value))}>{[1,2,3,4,5,6,7,8].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
      <label>Transverse field h<select value={form.field} disabled={busy} onChange={event=>set('field',Number(event.target.value))}>{[0.2,0.4,0.6,0.8,1,1.5,2].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
    </div>
    {error&&<p role="alert" className="error">{error}</p>}
    {preview&&<div className="signal-panel">
      <div className="panel-heading"><span>QUANTUM CIRCUIT</span><span>{preview.two_qubit_gates} TWO-QUBIT GATES</span></div>
      <div className="tw-tabs" role="tablist" aria-label="Circuit view">
        <button role="tab" aria-selected={view==='bare'} className={view==='bare'?'':'secondary'} onClick={()=>setView('bare')}>Without Pauli twirling</button>
        <button role="tab" aria-selected={view==='twirled'} className={view==='twirled'?'':'secondary'} onClick={()=>setView('twirled')}>With Pauli twirling</button>
        <button className="secondary" disabled={busy} onClick={()=>set('seed',(form.seed+1)%1000)}>↺ Draw new frames</button>
      </div>
      <pre className="tw-circuit" tabIndex="0" aria-label={`${view==='bare'?'Bare':'Twirled'} circuit diagram`}>{shown.text}</pre>
      <p className="tw-summary"><span>{shown.gates} gates</span><span>depth {shown.depth}</span><span>{shown.two_qubit_gates} two-qubit gates</span>
        {view==='twirled'&&<span>{preview.frame_count} Pauli frames</span>}<span>frame seed {preview.seed}</span></p>
      {view==='twirled'&&<div className="tw-frames">
        <h3>The Pauli frame around each two-qubit gate</h3>
        <div className="tw-frame-list">{preview.frames.map((frame,index)=><span key={index} className="tw-frame">
          <b>{frame.before}</b>→<em>{frame.gate} q{frame.qubits.join('·')}</em>→<b>{frame.after}</b>
        </span>)}</div>
        <p className="hint">Each pair is chosen at random from the 16 two-qubit Paulis. The gate is a Clifford, so the Pauli coming out is fixed once the Pauli going in is drawn, and the two cancel.</p>
      </div>}
      <p className={`lesson-feedback ${preview.ideal_match?'':'error'}`}>
        {preview.ideal_match
          ?`Checked just now on the server: the two circuits give the same noiseless outcome, with a largest probability difference of ${preview.largest_difference.toExponential(1)}. Ideal magnetisation ${fmt(preview.ideal.magnetization)}.`
          :'The twirled circuit does not match the bare one. That is a bug; please report it.'}
      </p>
    </div>}
    {preview&&<section className="tw-quiz" aria-label="Crew question">
      <h3>{CIRCUIT_QUIZ.question}</h3>
      <div className="tw-quiz-options">{CIRCUIT_QUIZ.options.map((option,index)=><button key={option}
        className={`answer-option ${answer===index&&index===CIRCUIT_QUIZ.correct?'answer-correct':''} ${answer===index&&index!==CIRCUIT_QUIZ.correct?'answer-wrong':''}`}
        disabled={correct} onClick={()=>setAnswer(index)}>
        <span className="answer-letter">{answer===index&&index===CIRCUIT_QUIZ.correct?'✓':String.fromCharCode(65+index)}</span><span>{option}</span>
      </button>)}</div>
      {answer!==null&&<div className={`answer-feedback ${correct?'feedback-correct':''}`} role="status">
        <strong>{correct?'✓ Level complete!':'Not quite.'}</strong>
        <p>{correct
          ?'The frames are invisible to a perfect quantum computer: P before the gate and Q = C P C† after it multiply back to the identity. They are only visible to the noise, which is exactly the point. Now go and find some noise.'
          :'Look at the line under the circuit: the backend compares the two statevectors on every request.'}</p>
      </div>}
    </section>}
    {(solved||correct)&&<div className="result-actions"><button onClick={onNext}>Next chapter →</button></div>}
  </div>;
}

// ------------------------------------------------------------------ levels 2-4: run and compare
function Level({chapter,copy,solved,onComplete,onNext}){
  const [form,setForm]=useState({randomizations:16,shots:512});
  const [result,setResult]=useState(null),[ranWith,setRanWith]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [answer,setAnswer]=useState(null);
  const set=(key,value)=>setForm(current=>({...current,[key]:value}));
  const quizSolved=copy.quiz&&answer===copy.quiz.correct;
  const dirty=result&&ranWith!==JSON.stringify(form);
  async function run(){
    setBusy(true);setError('');
    try{
      const value=await api('/play',{scenario:chapter,...form});
      setResult(value);setRanWith(JSON.stringify(form));
      if(value.passed)onComplete();
    }catch(problem){setError(problem.message);}finally{setBusy(false);}
  }
  function choose(index){setAnswer(index);if(index===copy.quiz.correct)onComplete();}
  const done=solved||quizSolved;
  return <div className="tw-level">
    <div className="fish-brief"><Codfish species={copy.fish}/><div><span className="crew-label">LEVEL {String(copy.number).padStart(2,'0')} · {copy.crew}</span><h2 className="tw-level-title">{copy.title}</h2></div></div>
    <p>{copy.brief}</p>
    <p className="tw-goal"><strong>Goal:</strong> {copy.goal}</p>
    <section className="experiment">
      <div className="signal-panel">
        <div className="panel-heading"><span>MAGNETISATION AFTER THE QUENCH</span><span>{result?`${result.total_shots.toLocaleString('en-US')} SHOTS PER TREATMENT`:'NOT RUN YET'}</span></div>
        {result?<><MagnetBars result={result}/><RunScatter result={result}/></>
          :<p className="hint">Press “Run both treatments”. The backend runs the bare circuit and the twirled circuits on the Qiskit Aer simulator with this level’s noise, giving each treatment the same number of shots.</p>}
      </div>
      <aside>
        <div className="panel-heading"><span>TWIRL CONTROL</span><span>AER</span></div>
        <BudgetControls form={form} set={set} disabled={busy}/>
        <p className="hint">{(form.randomizations*form.shots).toLocaleString('en-US')} shots per treatment, {2*form.randomizations} circuits in total. The budget is split between the randomizations, so more frames means fewer shots each.</p>
        <button onClick={run} disabled={busy}>{busy?'Simulating…':result?'Run again':'Run both treatments'}</button>
        {error&&<p role="alert" className="error">{error}</p>}
        {result&&<div className="results" aria-live="polite">
          <p>Ideal <strong>{fmt(result.ideal.magnetization)}</strong></p>
          <p>No twirling <strong>{fmt(result.unmitigated.magnetization)}</strong></p>
          <p>Pauli twirled <strong>{fmt(result.twirled.magnetization)}</strong></p>
          <p>Error {fmt(result.unmitigated.error)} → <strong>{fmt(result.twirled.error)}</strong></p>
          {result.target!=null&&<p>Goal <strong>≤ {fmt(result.target,2)}</strong></p>}
          {result.target!=null&&<p className="tw-stars" aria-label={`${result.stars} of 3 stars`}>{'★'.repeat(result.stars)}{'☆'.repeat(3-result.stars)}</p>}
          {dirty&&<small>You changed the budget. Run again to update the result.</small>}
        </div>}
      </aside>
    </section>
    {result&&<ProblemSummary result={result}/>}
    {result&&<Verdict result={result}/>}
    {result&&result.target!=null&&<div className={`answer-feedback ${result.passed?'feedback-correct':''}`} role="status">
      <strong>{result.passed?'✓ Level complete!':'Not yet. Here is a clue.'}</strong>
      <p>{result.passed?copy.success:copy.hint}</p>
    </div>}
    {copy.quiz&&result&&<section className="tw-quiz" aria-label="Crew question">
      <h3>{copy.quiz.question}</h3>
      <div className="tw-quiz-options">{copy.quiz.options.map((option,index)=><button key={option}
        className={`answer-option ${answer===index&&index===copy.quiz.correct?'answer-correct':''} ${answer===index&&index!==copy.quiz.correct?'answer-wrong':''}`}
        disabled={quizSolved} onClick={()=>choose(index)}>
        <span className="answer-letter">{answer===index&&index===copy.quiz.correct?'✓':String.fromCharCode(65+index)}</span><span>{option}</span>
      </button>)}</div>
      {answer!==null&&<div className={`answer-feedback ${quizSolved?'feedback-correct':''}`} role="status">
        <strong>{quizSolved?'✓ Level complete!':'Not quite.'}</strong>
        <p>{quizSolved?copy.success:copy.hint}</p>
      </div>}
    </section>}
    {result&&<section className="tw-compare"><h3>Where did the shots land?</h3><DistributionBars result={result}/></section>}
    {result&&<ResultTables result={result}/>}
    {done&&<div className="result-actions"><button onClick={onNext}>Next chapter →</button></div>}
  </div>;
}

// ------------------------------------------------------------------ the lab
const describeDataset=dataset=>`${dataset.backend}${dataset.simulated?' (simulator)':''} · `
  +(dataset.experiment==='witness'?'coherent witness · ':'')
  +`${dataset.qubits}q · ${dataset.steps} steps · ${dataset.randomizations}×${dataset.shots}`
  +(dataset.job_id?` · job ${dataset.job_id}`:'')
  +` · ${dataset.created?dataset.created.replace('T',' '):'unknown time'}`;

function Lab({scenarios}){
  const [engine,setEngine]=useState('aer');
  const [form,setForm]=useState({scenario:'coherent',qubits:4,steps:4,field:0.6,randomizations:16,shots:512,
    coherent_angle:0.08,depolarizing:0.02,seed:7});
  const [result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [history,setHistory]=useState([]);
  const [listing,setListing]=useState(null),[selected,setSelected]=useState(''),[run,setRun]=useState(null);
  const readout=useRef(null);
  const set=(key,value)=>setForm(current=>({...current,[key]:value}));
  const refresh=useCallback(async select=>{
    const value=await api('/hardware');
    setListing(value);
    if(select)setSelected(select);
  },[]);
  const show=useCallback((value,source)=>{
    setResult(value);
    setHistory(previous=>{
      if(value.id&&previous.some(row=>row.datasetId===value.id))return previous;
      return [...previous,{key:`${source}-${value.id||previous.length}`,source,datasetId:value.id,
        label:value.scenario_label||value.scenario,backend:value.backend,
        qubits:value.qubits,steps:value.steps,randomizations:value.randomizations,shots:value.shots,
        raw:value.unmitigated.error,twirled:value.twirled.error,verdict:value.comparison}];
    });
  },[]);
  useEffect(()=>{refresh().catch(problem=>setError(problem.message));},[refresh]);
  useEffect(()=>{
    if(!isIbmResult(result))return;
    readout.current?.scrollIntoView({behavior:'smooth',block:'start'});
  },[result?.id,result?.job_id]);

  const pending=!!run&&!['completed','failed'].includes(run.status);
  useEffect(()=>{
    if(!pending)return undefined;
    let stopped=false,timer;
    const poll=async()=>{
      try{
        const latest=await api('/hardware/runs/'+run.id);
        if(stopped)return;
        setRun(latest);
        if(latest.poll_error)setError(latest.poll_error);
      }catch(problem){if(!stopped)setError(problem.message);}
      if(!stopped)timer=setTimeout(poll,5000);
    };
    timer=setTimeout(poll,1500);
    return ()=>{stopped=true;clearTimeout(timer);};
  },[run?.id,pending]);

  useEffect(()=>{
    if(run?.status!=='completed'||!run.dataset_id)return undefined;
    const datasetId=run.dataset_id;
    let cancelled=false;
    (async()=>{
      try{
        const data=await api('/hardware/'+datasetId);
        if(cancelled)return;
        show(data,'ibm');
      }catch(problem){if(!cancelled)setError(problem.message);}
      if(!cancelled)await refresh(datasetId).catch(()=>{});
    })();
    return ()=>{cancelled=true;};
  },[run?.status,run?.dataset_id,refresh,show]);

  async function runAer(){
    setBusy(true);setError('');
    try{show(await api('/play',form),'aer');}catch(problem){setError(problem.message);}finally{setBusy(false);}
  }
  async function submitIBM(){
    setBusy(true);setError('');setResult(null);
    try{setRun(await api('/hardware/runs',{
      randomizations:preset?.randomizations||16,shots:preset?.shots||512,seed:7}));}
    catch(problem){setError(problem.message);}finally{setBusy(false);}
  }
  async function openDataset(id){
    setSelected(id);
    if(!id)return;
    try{show(await api('/hardware/'+id),'saved');}catch(problem){setError(problem.message);}
  }
  const ibmEnabled=listing?.ibm_enabled??scenarios?.ibm_enabled;
  const aerReady=scenarios?.aer_available;
  const preset=scenarios?.ibm_preset;
  const scenario=scenarios?.scenarios?.find(item=>item.id===form.scenario);
  const locked=busy||pending;
  return <div className="tw-level">
    <h2>Twirl lab</h2>
    <p>On Aer you pick the quench and the noise. On IBM the lab sends a fixed coherent-witness circuit, so twirling has a known kick to cancel.</p>
    <fieldset className="tw-engine">
      <legend>Run on</legend>
      <label><input type="radio" name="twirl-engine" checked={engine==='aer'} disabled={locked} onChange={()=>setEngine('aer')}/>
        <span>Qiskit Aer simulator</span><small>You choose the noise. Answers in seconds.</small></label>
      <label><input type="radio" name="twirl-engine" checked={engine==='ibm'} disabled={locked} onChange={()=>setEngine('ibm')}/>
        <span>IBM quantum computer</span><small>{ibmEnabled?'Fixed coherent-witness preset. Uses your QPU allocation.':'Not enabled on this server.'}</small></label>
    </fieldset>
    {engine==='aer'&&!aerReady&&<p className="notice">Qiskit Aer is not installed on this server, so simulated runs are unavailable. Install <code>backend/requirements.txt</code> and restart the backend.</p>}
    {engine==='ibm'&&!ibmEnabled&&<p className="notice">IBM runs are disabled on this server. To enable them, set IBM_ENABLE=true, IBM_QUANTUM_TOKEN and IBM_BACKEND (IBM_QUANTUM_INSTANCE is optional) in backend/.env or the environment, then restart the backend (see README). Jobs use your QPU allocation.</p>}
    {engine==='ibm'&&preset&&<div className="dd-goal tw-preset" aria-label="IBM coherent-witness preset">
      <strong>{preset.label}</strong>
      <p>{preset.brief}</p>
      <p className="tw-summary">
        <span>{preset.qubits} qubits</span>
        <span>{preset.two_qubit_gates} two-qubit gates</span>
        <span>Z kick {preset.coherent_angle} rad</span>
        <span>{preset.randomizations} × {preset.shots} shots</span>
        <span>target ⟨Z⟩ = +1</span>
      </p>
    </div>}
    {engine==='ibm'&&ibmEnabled&&<p className="notice">Both treatments share one IBM job. The kick sits after every two-qubit gate and inside each Pauli frame, which is the hardware analogue of the Aer coherent lesson. Extra frame gates still add a little stochastic noise.</p>}
    {engine==='aer'&&<div className="controls">
      <label>Noise scenario<select value={form.scenario} disabled={locked} onChange={event=>{
        const next=scenarios?.scenarios?.find(item=>item.id===event.target.value);
        setForm(current=>({...current,scenario:event.target.value,
          coherent_angle:next?next.coherent_angle:current.coherent_angle,
          depolarizing:next?next.depolarizing:current.depolarizing}));
      }}>{(scenarios?.scenarios||[]).map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Qubits<select value={form.qubits} disabled={locked} onChange={event=>set('qubits',Number(event.target.value))}>{[2,3,4,5,6].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
      <label>Trotter steps<select value={form.steps} disabled={locked} onChange={event=>set('steps',Number(event.target.value))}>{[1,2,3,4,5,6,7,8].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
      <label>Transverse field h<select value={form.field} disabled={locked} onChange={event=>set('field',Number(event.target.value))}>{[0.2,0.4,0.6,0.8,1,1.5,2].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
      <BudgetControls form={form} set={set} disabled={locked}/>
      <label>Coherent ZZ kick: <strong>{form.coherent_angle} rad</strong>
        <input aria-label="Coherent ZZ kick" type="range" min="0" max="0.2" step="0.01" value={form.coherent_angle} disabled={locked}
          onChange={event=>set('coherent_angle',Number(event.target.value))}/></label>
      <label>Depolarizing per gate: <strong>{fmt(form.depolarizing*100,1)}%</strong>
        <input aria-label="Depolarizing per gate" type="range" min="0" max="0.1" step="0.005" value={form.depolarizing} disabled={locked}
          onChange={event=>set('depolarizing',Number(event.target.value))}/></label>
    </div>}
    {engine==='aer'
      ?<button onClick={runAer} disabled={locked||!aerReady}>{busy?'Simulating…':'Run on Aer'}</button>
      :<button onClick={submitIBM} disabled={locked||!ibmEnabled}>{busy?'Submitting…':pending?'IBM job in progress…':'Submit coherent witness to IBM'}</button>}
    {engine==='aer'&&scenario&&<p className="hint">{scenario.label}: coherent kick {scenario.coherent_angle} rad, depolarizing {fmt(scenario.depolarizing*100,1)}% per gate. Moving a slider overrides the preset. {scenario.twirl_helps?'Twirling is expected to help here.':'Twirling is not expected to change anything here.'}</p>}
    {error&&<p role="alert" className="error">{error}</p>}
    {run&&<p className="status" aria-live="polite">Status: {run.status}{run.backend&&` · ${run.backend}`}{run.job_id&&` · job ${run.job_id}`}{run.layout&&` · qubits ${run.layout.join(', ')}`}{run.error&&` · ${run.error}`}{run.poll_error&&` · ${run.poll_error}`}</p>}
    {listing&&(listing.datasets.length
      ?<label>Saved runs<select value={selected} onChange={event=>openDataset(event.target.value)}>
        <option value="">Choose a saved run…</option>
        {listing.datasets.map(dataset=><option key={dataset.id} value={dataset.id}>{describeDataset(dataset)}</option>)}
      </select></label>
      :<p className="hint">No saved runs yet. IBM runs are saved automatically to <code>backend/twirl_demo/results/</code>, and <code>python main.py aer --save</code> puts simulator runs there too.</p>)}
    {result&&<div ref={readout} className="signal-panel tw-lab-result">
      <div className="panel-heading"><span>{isIbmResult(result)?'IBM QPU MEASUREMENTS':'QISKIT AER SIMULATION'}</span><span>{String(result.backend).toUpperCase()}</span></div>
      {isIbmResult(result)&&<HardwareReadout result={result}/>}
      {!isIbmResult(result)&&<ProblemSummary result={result}/>}
      <MagnetBars result={result}/>
      <RunScatter result={result}/>
      <DistributionBars result={result}/>
    </div>}
    {result&&<Verdict result={result}/>}
    {result&&<ResultTables result={result}/>}
    {history.length>0&&<section className="tw-compare">
      <h3>Runs in this session</h3>
      <div className="tw-table-wrap"><table className="tw-table">
        <thead><tr><th>#</th><th>Where</th><th>Noise</th><th>Problem</th><th>Budget</th><th>Error, no twirling</th><th>Error, twirled</th><th>Verdict</th></tr></thead>
        <tbody>{history.map((row,index)=><tr key={row.key}>
          <td>{index+1}</td><td>{row.backend}</td><td>{row.label}</td><td>{row.qubits}q / {row.steps} steps</td>
          <td>{row.randomizations}×{row.shots}</td><td>{fmt(row.raw)}</td><td>{fmt(row.twirled)}</td>
          <td>{row.verdict.improved?'twirling helped':row.verdict.unchanged?'no change':'twirling hurt'}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="hint">Rows are the runs you made since opening this page, newest last. Compare like with like: the error depends on the problem size and the shot budget as well as on the noise.</p>
    </section>}
  </div>;
}

// ------------------------------------------------------------------ shell
export default function TwirlGame(){
  const [chapter,setChapter]=useState('learn');
  const [scenarios,setScenarios]=useState(null),[completed,setCompleted]=useState([]),[error,setError]=useState('');
  useEffect(()=>{api('/scenarios').then(setScenarios).catch(problem=>setError(problem.message));},[]);
  const complete=useCallback(id=>setCompleted(previous=>previous.includes(id)?previous:[...previous,id]),[]);
  const goNext=()=>setChapter(nextChapter(chapter));
  const finished=LEVEL_IDS.filter(id=>completed.includes(id)).length;
  return <main className="tw-lab">
    <section className="mini-game tw-shell">
      <div className="eyebrow">INTERACTIVE LAB · PAULI TWIRLING</div>
      <h1>Shuffle the Error</h1>
      <p className="game-goal">Add random Pauli frames to a transverse-field Ising quench, and find out when that turns a biased answer into an honest one — and when it does nothing at all.</p>
      <p className="notice">Levels run the real circuit on the Qiskit Aer simulator with a noise model you can see and change. The twirl lab can also submit the same comparison to a real IBM processor.</p>
      <nav className="mission-progress tw-chapters" aria-label="Shuffle the Error chapters">
        {CHAPTERS.map(entry=>{
          const done=completed.includes(entry.id);
          return <button key={entry.id} className={`${done?'finished':''} ${chapter===entry.id?'current':''}`}
            aria-current={chapter===entry.id?'step':undefined} aria-label={`${entry.name}${done?', completed':''}`}
            onClick={()=>setChapter(entry.id)}>{done?'✓':entry.short}</button>;
        })}
        <span>{finished} / {LEVEL_IDS.length} levels complete</span>
      </nav>
      {error&&<p role="alert" className="error">{error}</p>}
      {chapter==='learn'&&<Learn onStart={()=>setChapter('circuit')}/>}
      {chapter==='circuit'&&<CircuitLevel solved={completed.includes('circuit')} onComplete={()=>complete('circuit')} onNext={goNext}/>}
      {LEVEL_COPY[chapter]&&<Level key={chapter} chapter={chapter} copy={LEVEL_COPY[chapter]}
        solved={completed.includes(chapter)} onComplete={()=>complete(chapter)} onNext={goNext}/>}
      {chapter==='lab'&&<Lab scenarios={scenarios}/>}
      {finished===LEVEL_IDS.length&&<p className="all-complete">✓ All four levels complete! You can now tell a coherent error from a stochastic one, and you know which of them twirling is for.</p>}
    </section>
  </main>;
}
