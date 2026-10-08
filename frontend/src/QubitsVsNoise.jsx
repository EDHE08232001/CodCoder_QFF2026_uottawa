import React, {useCallback, useEffect, useRef, useState} from 'react';
import Codfish from './Codfish';
import {FIELD_H, FIELD_W, TICK, cellAt} from './qvn/constants.js';
import {COUNTER_FOR, EFFECTIVE_MULT, ENEMIES, ENEMY_ORDER, ERROR_TYPES, RESISTED_MULT, TYPE_ORDER, UNITS, formatMult} from './qvn/data.js';
import {GameEngine} from './qvn/engine.js';
import {ENDLESS, LEVELS, getLevel} from './qvn/levels.js';
import {renderField} from './qvn/renderer.js';
import {play, setMuted} from './qvn/sound.js';
import {loadProgress, saveProgress} from './qvn/storage.js';
import Almanac from './qvn/Almanac';
import {CategoryBadge, Quiz, SpriteIcon, Stars, StrongVs, TypeBadge} from './qvn/parts';

const QUIZ_BONUS=50;
const LEVEL_FISH=['cod','clown','tang','puffer','angel','butterfly','cod'];
const pad=n=>String(n).padStart(2,'0');
const fishFor=level=>level.endless?'puffer':LEVEL_FISH[(level.id-1)%LEVEL_FISH.length];
const levelLabel=level=>level.endless?'ENDLESS MODE':`LEVEL ${pad(level.id)} / ${pad(LEVELS.length)}`;

function snapshot(engine){
  return {shots:engine.shots,cards:engine.cards.map(c=>({type:c.type,cooldown:c.cooldown})),progress:engine.progress(),fidelity:engine.averageFidelity()};
}
// Every error that can show up in a level, in Almanac order.
function levelErrors(level){
  if(level.endless)return ENEMY_ORDER;
  const seen=new Set(level.waves.flatMap(wave=>Object.keys(wave.spawn)));
  return ENEMY_ORDER.filter(id=>seen.has(id));
}

// ------------------------------------------------------------------ HUD

function Card({type,cooldown,shots,selected,hotkey,onPick}){
  const def=UNITS[type],affordable=shots>=def.cost,ready=cooldown<=0;
  return <button type="button" className={`qn-card ${selected?'selected':''} ${affordable&&ready?'':'unusable'}`} aria-pressed={selected} aria-label={`${def.name}, ${def.cost} shots`} onClick={()=>onPick(type)}>
    <span className="qn-card-key">{hotkey}</span>
    {def.strongVs&&<span className="qn-card-type"><TypeBadge type={def.strongVs} glyphOnly/></span>}
    <SpriteIcon kind="unit" type={type} size={48}/>
    <span className="qn-card-name">{def.short}</span>
    <span className={`qn-card-cost ${affordable?'':'short'}`}>⚡{def.cost}</span>
    {!ready&&<span className="qn-card-cooldown" style={{height:`${cooldown/def.recharge*100}%`}}/>}
    <span className="qn-tip" role="tooltip"><b>{def.name}</b><CategoryBadge category={def.category}/>{def.strongVs&&<StrongVs unit={type}/>}<span>{def.role}</span></span>
  </button>;
}

function WaveBar({progress}){
  if(progress.total===null)return <div className="qn-wave endless"><span>WAVE {progress.done}</span></div>;
  const pct=progress.done/progress.total*100;
  return <div className="qn-wave" role="progressbar" aria-label="Waves" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
    <i style={{width:`${pct}%`}}/>
    {progress.flags.map(f=><b key={f} className={pct>=f*100?'passed':''} style={{left:`${f*100}%`}} aria-hidden="true">⚑</b>)}
    <span>WAVE {progress.done}/{progress.total}</span>
  </div>;
}

// ------------------------------------------------------------------ overlays

// Briefings and results replace the battlefield, so the level chips above stay usable.
function MissionCard({label,children}){
  const ref=useRef(null);
  useEffect(()=>{const box=ref.current.getBoundingClientRect();if(box.top<0)ref.current.scrollIntoView({block:'start'});},[]);
  return <section ref={ref} className="qn-panel qn-mission" aria-label={label}>{children}</section>;
}
// The pause menu covers only the frozen battlefield.
function Overlay({label,size='',children}){
  return <div className="qn-overlay" role="dialog" aria-modal="true" aria-label={label}><div className={`qn-panel ${size}`}>{children}</div></div>;
}

function TypeRule(){
  return <section className="qn-rule">
    <span className="qn-tag">How damage works: error types</span>
    <p>Every error wears a coloured <b>type badge</b>. Each technique is built for one type: the right technique deals <b>{formatMult(EFFECTIVE_MULT)} damage</b>, and any other only <b>{formatMult(RESISTED_MULT)}</b>. Match the badge to the card with the same colour.</p>
    <div className="qn-rule-grid">{TYPE_ORDER.map(type=><div key={type}><TypeBadge type={type}/><span aria-hidden="true">→</span><SpriteIcon kind="unit" type={COUNTER_FOR[type]} size={34}/><b>{UNITS[COUNTER_FOR[type]].short}</b></div>)}</div>
  </section>;
}

function LabLink({unit,labs,onOpenLab}){
  if(!labs[unit])return null;
  return <button className="secondary qn-small qn-lab-link" onClick={()=>onOpenLab(unit)}>Open the {labs[unit]} lab →</button>;
}

function Briefing({level,bonus,labs,onOpenLab,onStart}){
  const {intro}=level;
  const startRef=useRef(null);
  useEffect(()=>{startRef.current?.focus({preventScroll:true});},[]);
  return <MissionCard label={`Mission briefing: ${level.name}`}>
    <div className="mission-title-row"><div className="eyebrow">QUBITS VS NOISE · {levelLabel(level)}</div><span className="mission-mode">MISSION BRIEFING</span></div>
    <div className="fish-brief"><Codfish species={fishFor(level)}/><div><span className="crew-label">CODFISH RESEARCH CREW · {level.subtitle.toUpperCase()}</span><h2>{level.name}</h2></div></div>
    <p className="qn-lead">{intro.text}</p>
    {intro.typeRule&&<TypeRule/>}
    {(intro.newErrors.length>0||intro.newUnits.length>0)&&<div className="qn-intel">
      {intro.newErrors.map(id=><article key={id} className="qn-intel-card error">
        <span className="qn-frame"><SpriteIcon kind="enemy" type={id} size={72}/></span>
        <div><span className="qn-tag">New error detected</span><h3>{ENEMIES[id].name} <TypeBadge type={ENEMIES[id].errorType}/></h3><p className="qn-kind">{ENEMIES[id].kind}</p><p>{ENEMIES[id].lesson}</p></div>
      </article>)}
      {intro.newUnits.map(id=><article key={id} className="qn-intel-card unit">
        <span className="qn-frame"><SpriteIcon kind="unit" type={id} size={72}/></span>
        <div><span className="qn-tag">New {id==='sampler'?'resource':'technique'} unlocked</span><h3>{UNITS[id].name} <CategoryBadge category={UNITS[id].category}/></h3><p>{UNITS[id].lesson}</p><p className="qn-role"><b>In the game:</b> {UNITS[id].role}</p><LabLink unit={id} labs={labs} onOpenLab={onOpenLab}/></div>
      </article>)}
    </div>}
    <div className="qn-lineup"><span className="qn-tag">Errors in this level</span><div>{levelErrors(level).map(id=><span key={id} className="qn-lineup-item" title={`${ENEMIES[id].name}: ${ERROR_TYPES[ENEMIES[id].errorType].label}`}><SpriteIcon kind="enemy" type={id} size={44}/><TypeBadge type={ENEMIES[id].errorType} glyphOnly/></span>)}</div></div>
    {bonus>0&&<p className="qn-bonus">Quiz bonus: you start with +{bonus} Shots.</p>}
    <div className="result-actions qn-center"><button ref={startRef} className="qn-start" onClick={onStart}>▶ Start defending!</button></div>
  </MissionCard>;
}

function MatchupScore({accuracy}){
  if(accuracy===null)return null;
  const pct=Math.round(accuracy*100),grade=pct>=75?'good':pct>=55?'meh':'bad';
  return <p className={`qn-matchup ${grade}`}>Damage dealt with the right technique <strong>{pct}%</strong>{grade!=='good'&&<small>Match each error’s type badge to the card of the same colour.</small>}</p>;
}

function Result({result,level,labs,onOpenLab,onRetry,onNext,onEndless,onQuiz}){
  const [quizDone,setQuizDone]=useState(false);
  if(result.won){
    const next=LEVELS.find(l=>l.id===level.id+1);
    return <MissionCard label="Circuit complete">
      <div className="mission-title-row"><div className="eyebrow">QUBITS VS NOISE · {levelLabel(level)}</div><span className="complete-badge" role="status">✓ Circuit complete</span></div>
      <div className="fish-brief"><Codfish species={fishFor(level)}/><div><span className="crew-label">CODFISH RESEARCH CREW · {level.name.toUpperCase()}</span><h2>The signal is safe!</h2></div></div>
      <Stars n={result.stars} size="big"/>
      <div className="qn-stats"><p>Average qubit fidelity <strong>{Math.round(result.fidelity)}%</strong>{result.stars<3&&<small>Finish with 90% or more for three stars.</small>}</p><MatchupScore accuracy={result.accuracy}/></div>
      {level.quiz&&<div className="dd-quiz qn-quiz"><span className="qn-tag">Checkpoint question · +{QUIZ_BONUS} Shots next level</span>
        <Quiz quiz={level.quiz} onAnswer={ok=>{setQuizDone(true);onQuiz(ok);}}/>
        {quizDone&&result.bonusEarned!==null&&<p className="qn-bonus">{result.bonusEarned?`+${QUIZ_BONUS} bonus Shots for your next level!`:'Check the Almanac to brush up.'}</p>}
      </div>}
      <div className="result-actions">{next?<button onClick={onNext}>Next: {next.name} →</button>:<button onClick={onEndless}>Campaign beaten! Try Endless mode →</button>}<button className="secondary" onClick={onRetry}>Replay level</button></div>
    </MissionCard>;
  }
  const enemy=ENEMIES[result.lostTo],counter=enemy&&COUNTER_FOR[enemy.errorType];
  return <MissionCard label="Decoherence">
    <div className="mission-title-row"><div className="eyebrow">QUBITS VS NOISE · {levelLabel(level)}</div><span className="qn-lost-badge" role="status">✖ Qubit lost</span></div>
    <h2 className="qn-lost-title">Decoherence!</h2>
    {level.endless&&<p className="qn-endless-score">You reached <strong>wave {result.wave}</strong>{result.best?` (best: ${result.best})`:''}</p>}
    {enemy&&<article className="qn-intel-card error">
      <span className="qn-frame"><SpriteIcon kind="enemy" type={result.lostTo} size={72}/></span>
      <div><span className="qn-tag">The final blow</span><h3>{enemy.name} <TypeBadge type={enemy.errorType}/></h3><p>{enemy.tip}</p>
        <p className="qn-counter">Right tool: <SpriteIcon kind="unit" type={counter} size={30}/> <b>{UNITS[counter].name}</b></p>
        <LabLink unit={counter} labs={labs} onOpenLab={onOpenLab}/></div>
    </article>}
    <MatchupScore accuracy={result.accuracy}/>
    <div className="result-actions"><button autoFocus onClick={onRetry}>↻ Try again</button></div>
  </MissionCard>;
}

function Pause({onResume,onRestart,onQuit,autoCollect,onToggleAuto}){
  const [almanac,setAlmanac]=useState(false);
  if(almanac)return <Overlay label="Quantum Almanac" size="wide"><Almanac embedded onClose={()=>setAlmanac(false)}/></Overlay>;
  return <Overlay label="Paused" size="narrow">
    <div className="eyebrow">QUBITS VS NOISE · PAUSED</div>
    <h2 className="qn-pause-title">Circuit on hold</h2>
    <div className="qn-pause-buttons">
      <button autoFocus onClick={onResume}>▶ Resume</button>
      <button className="secondary" onClick={()=>setAlmanac(true)}>Quantum Almanac</button>
      <button className="secondary" onClick={onRestart}>↻ Restart level</button>
      <button className="secondary" onClick={onQuit}>← Quit to main menu</button>
    </div>
    <label className="qn-toggle"><input type="checkbox" checked={autoCollect} onChange={e=>onToggleAuto(e.target.checked)}/> Auto-collect Shot tokens</label>
  </Overlay>;
}

// ------------------------------------------------------------------ battle

function newRun(level,progress){
  const bonus=progress.bonusShots||0;
  return {engine:new GameEngine(level,{bonusShots:bonus,autoCollect:progress.autoCollect}),bonus};
}

function GameScreen({level,progress,updateProgress,hidden,labs,onOpenLab,onPhase,onNext,onEndless,onQuit}){
  const canvasRef=useRef(null),playRef=useRef(null);
  const uiRef=useRef({hover:null,selected:null,shovel:false});
  const phaseRef=useRef('intro'),speedRef=useRef(1),hiddenRef=useRef(hidden);
  const [phase,setPhaseState]=useState('intro');
  const [selected,setSelected]=useState(null),[shovel,setShovel]=useState(false),[speed,setSpeed]=useState(1);
  const [toast,setToast]=useState(null),[result,setResult]=useState(null);
  const [run,setRun]=useState(()=>newRun(level,progress));
  const engine=run.engine;
  const [hud,setHud]=useState(null);
  const view=hud??snapshot(engine);

  const setPhase=useCallback(p=>{phaseRef.current=p;setPhaseState(p);},[]);
  useEffect(()=>{onPhase?.(phase);},[phase,onPhase]);
  useEffect(()=>{uiRef.current.selected=selected;uiRef.current.shovel=shovel;},[selected,shovel]);
  useEffect(()=>{speedRef.current=speed;},[speed]);
  useEffect(()=>{setMuted(progress.muted);},[progress.muted]);
  useEffect(()=>{engine.setAutoCollect(progress.autoCollect);},[engine,progress.autoCollect]);
  // Leaving for the Almanac or How to play pauses a running level.
  useEffect(()=>{hiddenRef.current=hidden;if(hidden&&phaseRef.current==='playing')setPhase('paused');},[hidden,setPhase]);

  const showToast=useCallback(text=>setToast({text,id:Math.random()}),[]);
  useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(null),1400);return ()=>clearTimeout(id);},[toast]);

  const finish=useCallback(won=>{
    if(won){
      const stars=engine.stars(),previous=progress.stars[level.id]||0;
      updateProgress({unlocked:Math.max(progress.unlocked,level.id+1),stars:{...progress.stars,[level.id]:Math.max(previous,stars)}});
      setResult({won:true,stars,fidelity:engine.averageFidelity(),accuracy:engine.matchupAccuracy(),bonusEarned:null});
      play('won');
    }else{
      const best=level.endless?Math.max(progress.bestEndless||0,engine.waveIndex):0;
      if(level.endless)updateProgress({bestEndless:best});
      setResult({won:false,lostTo:engine.lostTo,wave:engine.waveIndex,best,accuracy:engine.matchupAccuracy()});
      play('lost');
    }
    setPhase(won?'won':'lost');
  },[engine,level,progress,updateProgress,setPhase]);
  const finishRef=useRef(finish);
  useEffect(()=>{finishRef.current=finish;},[finish]);

  // Main loop: fixed-step simulation, render every animation frame.
  useEffect(()=>{
    const canvas=canvasRef.current,ctx=canvas.getContext('2d');
    let raf=0,last=performance.now(),acc=0,hudT=0,endTimer=null;
    const resize=()=>{const dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=FIELD_W*dpr;canvas.height=FIELD_H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);};
    resize();
    window.addEventListener('resize',resize);
    const loop=now=>{
      const dt=Math.min(0.1,(now-last)/1000);
      last=now;
      if(phaseRef.current==='playing'||(phaseRef.current==='ending'&&engine.state!=='playing')){
        acc+=dt*speedRef.current;
        while(acc>=TICK){engine.update(TICK);acc-=TICK;}
      }
      for(const ev of engine.drainEvents()){
        if(ev.type==='won'||ev.type==='lost'){phaseRef.current='ending';const won=ev.type==='won';endTimer=setTimeout(()=>finishRef.current(won),1800);}
        else play(ev.type);
      }
      if(!hiddenRef.current)renderField(ctx,engine,uiRef.current);
      hudT+=dt;
      if(hudT>0.1){hudT=0;setHud(snapshot(engine));}
      raf=requestAnimationFrame(loop);
    };
    raf=requestAnimationFrame(loop);
    return ()=>{cancelAnimationFrame(raf);clearTimeout(endTimer);window.removeEventListener('resize',resize);};
  },[engine]);

  const toField=ev=>{const rect=canvasRef.current.getBoundingClientRect();return {x:(ev.clientX-rect.left)*FIELD_W/rect.width,y:(ev.clientY-rect.top)*FIELD_H/rect.height};};
  function onPointerMove(ev){
    const {x,y}=toField(ev);
    uiRef.current.hover=cellAt(x,y);
    const overToken=engine.tokens.some(t=>!t.collected&&Math.hypot(t.x-x,t.y-y)<34);
    canvasRef.current.style.cursor=overToken||selected||shovel?'pointer':'default';
  }
  function onPointerDown(ev){
    if(phaseRef.current!=='playing'||ev.button===2)return;
    const {x,y}=toField(ev);
    if(engine.collectAt(x,y))return;
    const cell=cellAt(x,y);
    if(!cell)return;
    if(selected){
      const placed=engine.place(selected,cell.row,cell.col);
      if(placed.ok)setSelected(null);else{showToast(placed.reason);play('error');}
    }else if(shovel){
      if(engine.remove(cell.row,cell.col))setShovel(false);
    }
  }
  const cancelSelection=useCallback(()=>{setSelected(null);setShovel(false);},[]);
  const pickCard=useCallback(type=>{
    if(phaseRef.current!=='playing')return;
    const card=engine.cards.find(c=>c.type===type);
    if(!card)return;
    if(selected===type){setSelected(null);return;}
    if(card.cooldown>0){showToast('Recharging…');play('error');return;}
    if(engine.shots<UNITS[type].cost){showToast('Not enough Shots');play('error');return;}
    play('click');setShovel(false);setSelected(type);
  },[engine,selected,showToast]);
  const toggleShovel=useCallback(()=>{if(phaseRef.current!=='playing')return;setSelected(null);setShovel(s=>!s);},[]);
  const togglePause=useCallback(()=>{
    if(phaseRef.current==='playing')setPhase('paused');
    else if(phaseRef.current==='paused')setPhase('playing');
  },[setPhase]);

  useEffect(()=>{
    const onKey=ev=>{
      if(hiddenRef.current||ev.target instanceof HTMLInputElement||ev.target instanceof HTMLSelectElement)return;
      if(ev.key==='Escape'){if(selected||shovel)cancelSelection();else togglePause();}
      else if(ev.key==='p'||ev.key==='P')togglePause();
      else if(ev.key==='s'||ev.key==='S')toggleShovel();
      else if(/^[1-9]$/.test(ev.key)){const card=engine.cards[Number(ev.key)-1];if(card)pickCard(card.type);}
    };
    window.addEventListener('keydown',onKey);
    return ()=>window.removeEventListener('keydown',onKey);
  },[engine,selected,shovel,cancelSelection,togglePause,toggleShovel,pickCard]);

  function start(){if(run.bonus)updateProgress({bonusShots:0});setPhase('playing');play('click');}
  // After a long briefing, bring the battlefield back into view.
  useEffect(()=>{if(phase==='playing'&&playRef.current.getBoundingClientRect().top<0)playRef.current.scrollIntoView({block:'start'});},[phase]);
  function restart(){setRun(newRun(level,progress));setHud(null);setSelected(null);setShovel(false);setResult(null);setPhase('intro');}
  function onQuiz(ok){if(ok)updateProgress({bonusShots:QUIZ_BONUS});setResult(r=>({...r,bonusEarned:ok}));}

  const fidelity=Math.round(view.fidelity);
  const card=phase==='intro'?<Briefing level={level} bonus={run.bonus} labs={labs} onOpenLab={onOpenLab} onStart={start}/>
    :(phase==='won'||phase==='lost')&&result?<Result result={result} level={level} labs={labs} onOpenLab={onOpenLab} onRetry={restart} onNext={onNext} onEndless={onEndless} onQuiz={onQuiz}/>:null;
  return <section className="qn-board" hidden={hidden} aria-label={level.name}>
    {card}
    <div ref={playRef} className="qn-play" hidden={!!card}>
      <div className="qn-hud">
        <div className="qn-shots" title="Shots: your circuit-execution budget"><span aria-hidden="true">⚡</span><strong>{Math.floor(view.shots)}</strong><small>SHOTS</small></div>
        <div className="qn-cards">
          {view.cards.map((c,i)=><Card key={c.type} type={c.type} cooldown={c.cooldown} shots={view.shots} selected={selected===c.type} hotkey={i+1} onPick={pickCard}/>)}
          <button type="button" className={`qn-card remove ${shovel?'selected':''}`} aria-pressed={shovel} aria-label="Remove a defender" onClick={toggleShovel}>
            <span className="qn-card-key">S</span><span className="qn-remove-icon" aria-hidden="true">✖</span><span className="qn-card-name">Remove</span>
            <span className="qn-tip" role="tooltip"><b>Remove</b><span>Clear a tile to make room for a different technique. No refund.</span></span>
          </button>
        </div>
        <div className="qn-status">
          <div className="qn-status-row"><span className="qn-level-name">{level.endless?'∞':`L${level.id}`} · {level.name}</span><span className={`qn-fidelity ${fidelity>60?'':fidelity>30?'warn':'bad'}`}>AVG FIDELITY {fidelity}%</span></div>
          <WaveBar progress={view.progress}/>
          <div className="qn-hud-buttons">
            <button className="secondary" onClick={togglePause} disabled={phase!=='playing'&&phase!=='paused'} title="Pause (P)" aria-label={phase==='paused'?'Resume':'Pause'}>{phase==='paused'?'▶':'❚❚'}</button>
            <button className={speed>1?'':'secondary'} onClick={()=>setSpeed(s=>s===1?2:1)} title="Game speed" aria-label={`Game speed ${speed}×`}>{speed}×</button>
            <button className="secondary" onClick={()=>updateProgress({muted:!progress.muted})} title={progress.muted?'Unmute':'Mute'} aria-label={progress.muted?'Unmute':'Mute'}>{progress.muted?'🔇':'🔊'}</button>
          </div>
        </div>
      </div>
      <div className="qn-field-wrap">
        <canvas ref={canvasRef} className="qn-field" aria-label="Battlefield: five qubit wires, errors march in from the right" onPointerMove={onPointerMove} onPointerLeave={()=>{uiRef.current.hover=null;}} onPointerDown={onPointerDown} onContextMenu={e=>{e.preventDefault();cancelSelection();}}/>
        {toast&&<div key={toast.id} className="qn-toast" role="status">{toast.text}</div>}
      </div>
      <p className="hint qn-hint">Click a card (or press 1–{view.cards.length}), then a tile to deploy · Click ⚡ tokens to collect Shots · Right-click / Esc to cancel · P to pause</p>
      {phase==='paused'&&<Pause onResume={togglePause} onRestart={restart} onQuit={onQuit} autoCollect={progress.autoCollect} onToggleAuto={v=>updateProgress({autoCollect:v})}/>}
    </div>
  </section>;
}

// ------------------------------------------------------------------ how to play

function HowTo({onClose}){
  return <section className="mini-game qn-page" aria-label="How to play">
    <div className="mission-title-row"><div className="eyebrow">QUBITS VS NOISE · FIELD MANUAL</div><button className="secondary qn-small" onClick={onClose}>← Back to the game</button></div>
    <h1>How to play</h1>
    <div className="dd-concepts qn-howto">
      <article><span className="pixel-icon">◎</span><h3>The idea</h3><p>Each lane is a qubit’s wire in a quantum circuit. Your qubits sit on the left, guarded by the codfish crew, and their Bloch vectors show their <b>fidelity</b>. Errors march in from the right. Every error that reaches a qubit shrinks its fidelity, and if any qubit drops to 0% the computation is ruined.</p></article>
      <article><span className="pixel-icon">⚡</span><h3>Shots are your budget</h3><p>Every technique costs Shots, just as real error mitigation costs extra circuit runs. Place Samplers early and click the glowing ⚡ tokens to collect them. Tokens also drift down from the surface.</p></article>
      <article><span className="pixel-icon">↗</span><h3>Suppress and mitigate</h3><p>You can’t build a perfect quantum computer, but you can <b>suppress</b> errors while the circuit runs and <b>mitigate</b> them afterwards. Deploy the right technique against the right error.</p></article>
    </div>
    <div className="dd-playground qn-controls">
      <h3>Controls</h3>
      <ul className="dd-list">
        <li>▸ Click a <b>technique card</b> (or press <kbd>1</kbd>–<kbd>5</kbd>), then click a tile to deploy it.</li>
        <li>▸ Click the glowing <b>⚡ Shot tokens</b> to collect your budget.</li>
        <li>▸ <kbd>S</kbd> or the ✖ card removes a defender. Right-click or <kbd>Esc</kbd> cancels a selection.</li>
        <li>▸ <kbd>P</kbd> pauses; the pause menu has the Almanac and an auto-collect option.</li>
      </ul>
    </div>
    <h2>Error types: pick the right tool</h2>
    <p>Every error has a <b>type</b>, shown by the coloured badge above it. Each technique is built for one type and deals <b>{formatMult(EFFECTIVE_MULT)} damage</b> to it. Against any other type it only deals <b>{formatMult(RESISTED_MULT)}</b>. Watch for the {formatMult(EFFECTIVE_MULT)} and {formatMult(RESISTED_MULT)} pops when your shots land.</p>
    <div className="qn-counter-grid">{TYPE_ORDER.map(type=><div key={type} className="qn-counter-row">
      <div className="qn-counter-errors">{ENEMY_ORDER.filter(id=>ENEMIES[id].errorType===type&&!ENEMIES[id].boss).map(id=><SpriteIcon key={id} kind="enemy" type={id} size={48}/>)}</div>
      <span className="scene-arrow" aria-hidden="true">←</span>
      <SpriteIcon kind="unit" type={COUNTER_FOR[type]} size={56}/>
      <div><TypeBadge type={type}/><p>{ERROR_TYPES[type].text}</p><small>{formatMult(EFFECTIVE_MULT)} from <b>{UNITS[COUNTER_FOR[type]].name}</b></small></div>
    </div>)}</div>
    <h2>Scoring</h2>
    <p>Clear every wave to complete the level. Finish with an average fidelity of 90%+ for three stars. Answer the checkpoint question correctly for +{QUIZ_BONUS} Shots in your next level. Progress is saved in this browser.</p>
  </section>;
}

// ------------------------------------------------------------------ screen

export default function QubitsVsNoise({levelId,onLevel,onExit,labs={},onOpenLab}){
  const [progress,setProgress]=useState(loadProgress);
  // Without a chosen level, open the furthest unlocked one, fixed for this visit so a win doesn't jump ahead.
  const [firstLevel]=useState(()=>Math.min(progress.unlocked,LEVELS.length));
  const [view,setView]=useState('play'),[phase,setPhase]=useState('intro');
  const updateProgress=useCallback(patch=>setProgress(previous=>{const next={...previous,...patch};saveProgress(next);return next;}),[]);
  const campaignDone=progress.unlocked>LEVELS.length;
  const current=levelId??firstLevel;
  const level=getLevel(current)||LEVELS[0];
  const cleared=LEVELS.filter(l=>progress.stars[l.id]).length;
  const totalStars=LEVELS.reduce((sum,l)=>sum+(progress.stars[l.id]||0),0);
  const running=view==='play'&&phase==='playing';
  function pick(id){onLevel(id);setView('play');}
  return <main className="qn-game">
    <div className="quest-top"><button className="secondary" onClick={onExit}>← Main menu</button><span className="codfish-brand"><Codfish/> CODFISH<span className="qn-brand-game"> · QUBITS VS NOISE</span></span>
      <div className="qn-top-actions"><button className={view==='howto'?'':'secondary'} aria-pressed={view==='howto'} onClick={()=>setView(v=>v==='howto'?'play':'howto')}>How to play</button><button className={view==='almanac'?'':'secondary'} aria-pressed={view==='almanac'} onClick={()=>setView(v=>v==='almanac'?'play':'almanac')}>Almanac</button></div></div>
    <nav className="mission-progress qn-levels" aria-label="Qubits vs Noise levels">
      {LEVELS.map(l=>{const locked=l.id>progress.unlocked,stars=progress.stars[l.id]||0;
        return <button key={l.id} className={`${stars?'finished':''} ${current===l.id?'current':''}`} disabled={locked||running} aria-current={current===l.id?'step':undefined} aria-label={`Level ${l.id}: ${l.name}${locked?', locked':stars?`, completed, ${stars} of 3 stars`:''}`} title={`${l.name} · ${l.subtitle}`} onClick={()=>pick(l.id)}>{locked?'🔒':stars?'✓':pad(l.id)}</button>;})}
      <button className={`qn-endless-chip ${current==='endless'?'current':''}`} disabled={!campaignDone||running} aria-current={current==='endless'?'step':undefined} aria-label={`Endless mode: ${ENDLESS.name}${campaignDone?`, best wave ${progress.bestEndless||0}`:', locked'}`} title={campaignDone?`${ENDLESS.name} · best wave ${progress.bestEndless||0}`:`Beat level ${LEVELS.length} to unlock`} onClick={()=>pick('endless')}>∞</button>
      <span>{cleared} / {LEVELS.length} cleared · ★ {totalStars} / {LEVELS.length*3}</span>
    </nav>
    <GameScreen key={current} level={level} progress={progress} updateProgress={updateProgress} hidden={view!=='play'} labs={labs} onOpenLab={onOpenLab} onPhase={setPhase}
      onNext={()=>{const next=LEVELS.find(l=>l.id===level.id+1);pick(next?next.id:level.id);}} onEndless={()=>pick('endless')} onQuit={onExit}/>
    {view==='almanac'&&<Almanac onClose={()=>setView('play')}/>}
    {view==='howto'&&<HowTo onClose={()=>setView('play')}/>}
  </main>;
}
