import React, {useState} from 'react';
import Codfish from './Codfish';
import DDGame from './DDGame';
import ZNEGame from './ZNEGame';
import TwirlGame from './TwirlGame';
import TRexGame from './TRexGame';
import QubitsVsNoise from './QubitsVsNoise';

const tools=[
  {id:'zne',name:'ZNE',icon:'↗',title:'Noise Detective',task:'Estimate the result at zero noise.',goal:'Compare measurements at several noise factors, then extrapolate to zero.',problem:'Noise changes my measured mean. How can I estimate its ideal value?'},
  {id:'dd',name:'Dynamical Decoupling',icon:'▥',title:'Pulse Patrol',task:'Protect an idle qubit.',goal:'Flip an idle qubit with pulse sequences to cancel slow phase drift, then compare with real IBM hardware data.',problem:'My qubit drifts while it waits. Which tool acts during the idle time?'},
  {id:'twirl',name:'Pauli Twirling',icon:'⟳',title:'Shuffle the Error',task:'Turn aligned errors into varied errors.',goal:'Add random Pauli frames to a transverse-field Ising quench, compare the unmitigated and twirled answers on the Qiskit Aer simulator or real IBM hardware, and find out when twirling does nothing.',problem:'My errors keep pointing the same way. Which tool can randomize them?'},
  {id:'trex',name:'Readout Mitigation',icon:'▦',title:'Detector Decoder',task:'Calibrate a biased detector.',goal:'Use known inputs to estimate readout errors and correct a measured distribution.',problem:'The circuit finishes, but my detector sometimes reads the wrong bit.'},
  {id:'pec',name:'PEC',icon:'±',title:'Signed Sample Lab',task:'Combine samples with signed weights.',goal:'Explore how inverse-noise weights can remove bias while increasing sampling cost.',problem:'I know a noise model. Can weighted noisy experiments estimate an ideal result?'},
  {id:'learn',name:'Noise Learning',icon:'⌕',title:'Calibration Scout',task:'Discover an unknown error rate.',goal:'Spend a measurement budget on calibration and estimate an error probability.',problem:'Before choosing a correction, I need to characterize my device noise.'},
];
const exploreTools=tools.filter(tool=>tool.id!=='pec'&&tool.id!=='learn');
// Qubits vs Noise techniques that have a hands-on lab here, keyed by the game's unit id.
const gameLabs=Object.fromEntries(exploreTools.map(tool=>[tool.id,tool.title]));
const backLabels={game:'← Qubits vs Noise',guide:'← Reef toolkit',hub:'← Tool quiz'};

function MiniGame({tool}){
  const [count,setCount]=useState(0),[samples,setSamples]=useState([]);
  const [answer,setAnswer]=useState('');
  const total=samples.reduce((a,b)=>a+b,0),shots=samples.length;
  return <section className="mini-game">
    <div className="eyebrow">INTERACTIVE CONCEPT DEMO · {tool.name.toUpperCase()}</div>
    <h1>{tool.title}</h1><p className="game-goal">{tool.goal}</p>
    <p className="notice">Simplified teaching model. This activity does not submit IBM jobs.</p>
    {tool.id==='pec'&&<>
      <h2>A known bit-flip channel has error probability p = 0.1.</h2>
      <p>Its inverse combines two noisy branches: +1.125 × original and −0.125 × flipped. Select a weight to inspect it.</p>
      <div className="answer-buttons"><button onClick={()=>setAnswer('positive')}>+1.125 original</button><button onClick={()=>setAnswer('negative')}>−0.125 flipped</button></div>
      {answer&&<p className="lesson-feedback">{answer==='negative'?'A negative weight subtracts a branch contribution; it is not a negative probability.':'The original branch receives a weight greater than one.'} The absolute weights sum to 1.25. For this toy inverse, the sampling-overhead scale is 1.25² ≈ 1.56.</p>}
      <label>Sampling budget<input type="range" min="100" max="5000" step="100" value={count||100} onChange={e=>setCount(Number(e.target.value))}/></label><p>{count||100} samples · illustrative uncertainty scale: {(1.25/Math.sqrt(count||100)).toFixed(3)}</p>
      <p className="hint">PEC depends on an accurate noise model. Signed weights can reduce bias but amplify sampling variance. The uncertainty scale shown is illustrative, not a confidence interval.</p>
    </>}
    {tool.id==='learn'&&<>
      <h2>Send known zeros through a hidden bit-flip channel.</h2>
      <p>You have a budget of 200 probes. Each probe returns 0 or 1.</p>
      <button disabled={shots>=200} onClick={()=>setSamples(s=>[...s,...Array.from({length:20},()=>Math.random()<.15?1:0)])}>Spend 20 probes</button>
      <p>Probes: {shots} / 200 · Unexpected ones: {total}</p><div className="probe-grid">{samples.map((v,i)=><span className={v?'flipped':''} key={i}>{v}</span>)}</div>
      {shots>0&&<p>Estimated flip probability: {(100*total/shots).toFixed(1)}%</p>}
      {shots>=200&&<div className="lesson-feedback">The teaching channel uses a 15% flip probability. Your finite-sample estimate can differ. More calibration reduces sampling uncertainty on average; it does not guarantee every new estimate is closer. IBM noise learning characterizes more complex circuit noise.</div>}
    </>}
  </section>;
}

function PixelLab(){
  return <svg className="cover-art" viewBox="0 0 800 440" shapeRendering="crispEdges" aria-hidden="true">
    <rect width="800" height="440" fill="#082c40"/>
    <path d="M0 0h110l70 300H80zM460 0h70l-60 310h-70z" fill="#76d8d3" opacity=".07"/>
    <rect x="40" y="35" width="720" height="280" fill="#153c50"/>
    {[[25,100],[770,150],[28,220],[745,18],[70,12]].map(([x,y],i)=><rect key={`bubble-${i}`} x={x} y={y} width="10" height="10" fill="none" stroke="#6eb9cb" strokeWidth="2"/>)}
    {Array.from({length:12},(_,i)=><rect key={i} x={60+i*60} y="35" width="2" height="280" fill="#254262"/>)}
    <rect x="80" y="68" width="190" height="135" fill="#091b30" stroke="#6dc9de" strokeWidth="6"/>
    {[0,1,2,3,4].map(i=><g key={i}><rect x={100+i*30} y={158-i*16} width="12" height="12" fill="#89f4e0"/><rect x={112+i*30} y={163-i*16} width="18" height="3" fill="#6b9ee1"/></g>)}
    <rect x="530" y="68" width="190" height="135" fill="#091b30" stroke="#857ce1" strokeWidth="6"/>
    {[0,1,2].map(i=><g key={i}><rect x="552" y={93+i*32} width={125-i*25} height="10" fill={i===1?'#bca1f4':'#72d4e6'}/><rect x="680" y={93+i*32} width="12" height="10" fill="#f4dc91"/></g>)}
    <rect x="320" y="45" width="160" height="195" fill="#294260"/>
    <rect x="340" y="60" width="120" height="165" fill="#10263e" stroke="#77e3df" strokeWidth="4"/>
    <path d="M370 90h60v20h20v60h-20v20h-60v-20h-20v-60h20z" fill="#87e4ed"/>
    <rect x="375" y="115" width="50" height="50" fill="#6170d8"/><rect x="387" y="127" width="26" height="26" fill="#d3fcf3"/>
    <rect x="70" y="255" width="660" height="26" fill="#7396ad"/><rect x="85" y="281" width="630" height="70" fill="#293957"/>
    <rect x="330" y="260" width="140" height="14" fill="#b4a0ee"/>
    <rect x="120" y="223" width="50" height="32" fill="#70e1d1"/><rect x="131" y="232" width="8" height="8" fill="#183652"/><rect x="151" y="232" width="8" height="8" fill="#183652"/>
    <rect x="610" y="228" width="38" height="27" fill="#d0a8ec"/><rect x="620" y="234" width="8" height="8" fill="#273554"/>
    <path d="M0 351h800v89H0z" fill="#0e1e35"/>
    {[0,1,2,3].map(i=><rect key={i} x="0" y={360+i*24} width="800" height="2" fill="#27405a"/>)}
    <path d="M0 420h800v20H0z" fill="#315666"/>
    <path d="M30 420v-70h10v30h10v-55h10v95zM720 420v-70h10v-25h10v60h10v-35h10v70z" fill="#4aaf9c"/>
    <path d="M80 420v-35H70v-10h20v20h10v-40h10v40h10v-15h10v25h-20v15zM660 420v-25h-20v-10h20v-20h10v30h20v-10h10v20h-30v15z" fill="#b69be0"/>
    <g transform="translate(320 300)"><Codfish className="cover-mascot"/></g>
    <g transform="translate(0 110)"><Codfish species="clown" className="cover-side-fish"/></g>
    <g transform="translate(650 180)"><Codfish species="tang" className="cover-side-fish"/></g>
  </svg>;
}

const scenes=[
  {title:'The signal keeps changing',caption:'The same circuit gives different means as noise is increased.',labels:['1× noise','3× noise','5× noise'],values:['0.80','0.60','0.40'],question:'Which technique could use this trend to estimate the ideal mean?',hint:'Look for a technique that compares several noise strengths.',options:[1,0,3]},
  {title:'Waiting changes the qubit',caption:'A qubit accumulates unwanted phase while the circuit is idle.',labels:['Ready','Idle interval','Phase drift'],values:['|ψ⟩','······','↻'],question:'Which technique acts during the waiting interval?',hint:'The problem happens before measurement, while the qubit waits.',options:[4,3,1]},
  {title:'The errors line up',caption:'Repeated circuits experience systematic, similarly oriented errors.',labels:['Run A','Run B','Run C'],values:['→','→','→'],question:'Which technique randomizes equivalent circuit frames?',hint:'Consider coordinated frame changes that preserve the ideal circuit.',options:[2,0,5]},
  {title:'The detector mixes up bits',caption:'Even known input states are sometimes reported as the opposite bit.',labels:['Known input','Detector','Reported'],values:['0','?','0 or 1'],question:'Which tool addresses this measurement bias?',hint:'Characterize the detector using known inputs.',options:[1,3,2]},
  {title:'We have a noise model',caption:'The team wants to estimate an ideal mean by weighting noisy experiments.',labels:['Branch A','Branch B','Combine'],values:['+ weight','− weight','Σ'],question:'Which technique uses signed inverse-noise weights?',hint:'The coefficients can be negative; they are not probabilities.',options:[5,4,0]},
  {title:'A new device, unknown errors',caption:'Before mitigation, the team needs to characterize the device noise.',labels:['Known probe','Device','Statistics'],values:['0','?','0 / 1'],question:'Which tool should the team investigate first?',hint:'Estimate the noise before trying to invert it.',options:[3,2,5]},
];
function MissionScene({scene}){
  return <figure className="mission-scene"><div className="scene-diagram">{scene.labels.map((label,i)=><React.Fragment key={label}>{i>0&&<span className="scene-arrow" aria-hidden="true">→</span>}<div className={`scene-node scene-node-${i}`}><span>{label}</span><strong>{scene.values[i]}</strong></div></React.Fragment>)}</div><figcaption>{scene.caption} <span>Illustrative teaching scenario.</span></figcaption></figure>;
}
export default function LearningHub(){
  const [screen,setScreen]=useState('cover');
  const [active,setActive]=useState(null),[mission,setMission]=useState(0),[feedback,setFeedback]=useState('');
  const [completed,setCompleted]=useState([]);
  const [selected,setSelected]=useState(null);
  const [gameLevel,setGameLevel]=useState(null);
  const current=tools[mission];
  const scene=scenes[mission];
  const solved=completed.includes(current.id);
  function changeMission(index){setMission(index);setFeedback('');setSelected(null);}
  function chooseTool(tool){
    setSelected(tool.id);
    if(tool.id===current.id){
      setCompleted(previous=>previous.includes(current.id)?previous:[...previous,current.id]);
      setFeedback(`Correct! ${tool.name} fits this mission. ${current.goal}`);
    }else{
      setFeedback(`Not quite. ${scene.hint}`);
    }
  }
  if(screen==='cover')return <main className="cover-screen"><div className="cover-frame"><div className="cover-brand"><span className="codfish-brand"><Codfish/> TEAM CODFISH</span><span>✦ SIX LEARNING MODULES</span></div><div className="cover-title"><div className="eyebrow">WELCOME TO THE CODFISH RESEARCH REEF</div><div className="team-wordmark">CODFISH</div><h1>QUANTUM<br/><span>REEF</span></h1><p>Dive into a sea of quantum mysteries.<br/>Join our codfish crew. Dive into the reef and rescue quantum signals.</p></div><PixelLab/><div className="cover-menu"><button onClick={()=>setScreen('game')}>▶ Start mission</button><button className="secondary" onClick={()=>setScreen('guide')}>▦ Explore tools</button><button className="secondary" onClick={()=>setScreen('hub')}>✦ Tool quiz</button></div><p className="cover-caption">DIVE IN · EXPERIMENT · SAVE THE SIGNAL</p></div></main>;
  if(active)return <><nav className="game-nav"><button className="secondary" onClick={()=>setActive(null)}>{backLabels[screen]||'← Back'}</button><span>CODFISH / {active.name.toUpperCase()}</span></nav>{active.id==='zne'?<ZNEGame/>:active.id==='dd'?<DDGame/>:active.id==='twirl'?<TwirlGame/>:active.id==='trex'?<TRexGame/>:<main><MiniGame key={active.id} tool={active}/></main>}</>;
  if(screen==='guide')return <main className="quest-hub"><button className="secondary" onClick={()=>setScreen('cover')}>← Main menu</button><h1>Your reef toolkit</h1><p>Each tool solves a different part of the noise puzzle.</p><section className="tool-grid">{exploreTools.map(tool=><article key={tool.id} className="tool-card"><span className="pixel-icon">{tool.icon}</span><h2>{tool.name}</h2><p>{tool.goal}</p><button onClick={()=>setActive(tool)}>Try this mini-game →</button></article>)}</section></main>;
  if(screen==='game')return <QubitsVsNoise levelId={gameLevel} onLevel={setGameLevel} onExit={()=>setScreen('cover')} labs={gameLabs} onOpenLab={id=>setActive(tools.find(tool=>tool.id===id))}/>;
  return <main className="quest-hub focused-mission">
    <div className="quest-top"><button className="secondary" onClick={()=>setScreen('cover')}>← Main menu</button><span className="codfish-brand"><Codfish/> CODFISH</span><button className="secondary" onClick={()=>setScreen('guide')}>Explore tools ↗</button></div>
    <div className="mission-progress focused-progress" aria-label={`${completed.length} of 6 missions completed`}>{tools.map((tool,i)=><button key={tool.id} className={`${completed.includes(tool.id)?'finished':''} ${mission===i?'current':''}`} aria-label={`Mission ${i+1}${completed.includes(tool.id)?', completed':''}`} aria-current={mission===i?'step':undefined} onClick={()=>changeMission(i)}>{completed.includes(tool.id)?'✓':String(i+1).padStart(2,'0')}</button>)}<span>{completed.length} / 6 completed</span></div>
    <section className={`hub-mission ${solved?'mission-solved':''}`} aria-label="Main question">
      <div className="mission-title-row"><div className="eyebrow">REEF MISSION {String(mission+1).padStart(2,'0')} / 06</div>{solved?<span className="complete-badge" role="status">✓ Mission complete</span>:<span className="mission-mode">CHOOSE ONE ANSWER</span>}</div>
      <div className="fish-brief"><Codfish species={["cod","clown","tang","puffer","angel","butterfly"][mission]}/><div><span className="crew-label">CODFISH RESEARCH CREW</span><h1>{scene.title}</h1></div></div>
      <MissionScene scene={scene}/>
      <h2 className="main-question">{scene.question}</h2>
      <div className="mission-answers">{scene.options.map((index,i)=>{const tool=tools[index];const correct=solved&&tool.id===current.id;const wrong=!solved&&selected===tool.id;return <button key={tool.id} className={`answer-option ${correct?'answer-correct':''} ${wrong?'answer-wrong':''}`} disabled={solved} onClick={()=>chooseTool(tool)}><span className="answer-letter">{correct?'✓':String.fromCharCode(65+i)}</span><span>{tool.name}</span>{wrong&&<small>Try another tool</small>}</button>;})}</div>
      {(feedback||solved)&&<div className={`answer-feedback ${solved?'feedback-correct':''}`} role="status"><strong>{solved?'✓ You found the right tool!':'Try again — here is a clue.'}</strong><p>{solved?current.goal:feedback}</p>{solved&&<div className="result-actions"><button onClick={()=>setActive(current)}>Try it yourself →</button><button className="secondary" onClick={()=>changeMission((mission+1)%tools.length)}>{mission===5?'Back to mission 1':'Next mission'} →</button></div>}</div>}
      {completed.length===tools.length&&<p className="all-complete">✓ All six missions complete! Keep exploring the reef toolkit.</p>}
    </section>
    <p className="hub-note">These are mitigation techniques and calibration tools, not interchangeable curve models. Each activity teaches a different mechanism. ZNE, Dynamical Decoupling, Pauli Twirling and Readout Mitigation run real backend experiments and can reach IBM hardware; the other modules are local concept demos.</p>
  </main>;
}
