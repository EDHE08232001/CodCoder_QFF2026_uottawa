import React, {useState} from 'react';
import {CATEGORY_INFO, COUNTER_FOR, EFFECTIVE_MULT, ENEMIES, ENEMY_ORDER, ERROR_TYPES, RESISTED_MULT, SPECIAL_RULES, TECHNIQUES, TYPE_ORDER, UNITS, UNIT_ORDER, formatMult, matchup} from './data.js';
import {BONUS_QUIZ, LEVELS} from './levels.js';
import {CategoryBadge, Quiz, SpriteIcon, StrongVs, TypeBadge} from './parts';

const TABS=[['techniques','Techniques'],['errors','Errors'],['matchups','Matchups'],['quiz','Practice quiz']];

function TechniqueEntry({id}){
  const unit=UNITS[id];
  return <article className="qn-entry">
    <span className="qn-frame"><SpriteIcon kind="unit" type={id} size={72}/></span>
    <div>
      <h3>{unit.name} <CategoryBadge category={unit.category}/></h3>
      <p className="qn-meta">Cost <b>{unit.cost}</b> Shots · Recharge {unit.recharge}s · Integrity {unit.hp}</p>
      {unit.strongVs&&<p><StrongVs unit={id}/></p>}
      <p>{unit.lesson}</p>
      <p className="qn-role"><b>In the game:</b> {unit.role}</p>
    </div>
  </article>;
}

function ErrorEntry({id}){
  const error=ENEMIES[id];
  return <article className="qn-entry">
    <span className="qn-frame"><SpriteIcon kind="enemy" type={id} size={72}/></span>
    <div>
      <h3>{error.name} <TypeBadge type={error.errorType}/> <span className="qn-kind">{error.kind}</span></h3>
      <p className="qn-meta">Strength {error.hp}{error.armor?` + ${error.armor} coherent armor`:''} · Fidelity damage {error.fidelityDmg}% · Best counter: <b>{UNITS[COUNTER_FOR[error.errorType]].short}</b>{error.decaysTo&&<> (then <b>{UNITS[COUNTER_FOR[error.decaysTo]].short}</b> once its armor breaks)</>}</p>
      <p>{error.lesson}</p>
      <p className="qn-role"><b>Tip:</b> {error.tip}</p>
    </div>
  </article>;
}

function Matchups(){
  return <div className="qn-matchups">
    <p className="qn-note">Every error has a <b>type</b>, shown by the coloured badge above it on the battlefield. Every technique is built for one type: it deals <b>{formatMult(EFFECTIVE_MULT)} damage</b> to errors of that type and only <b>{formatMult(RESISTED_MULT)}</b> to everything else.</p>
    <div className="tw-table-wrap"><table className="tw-table qn-table">
      <thead><tr><th/>{TYPE_ORDER.map(type=><th key={type}><TypeBadge type={type}/><div className="qn-members">{ENEMY_ORDER.filter(id=>ENEMIES[id].errorType===type).map(id=><SpriteIcon key={id} kind="enemy" type={id} size={34}/>)}</div></th>)}</tr></thead>
      <tbody>{TECHNIQUES.map(id=><tr key={id}><th><SpriteIcon kind="unit" type={id} size={40}/><div>{UNITS[id].short}</div></th>{TYPE_ORDER.map(type=>{const good=matchup(id,type)==='effective';return <td key={type} className={good?'good':'bad'}>{good?`${formatMult(EFFECTIVE_MULT)} Strong`:`${formatMult(RESISTED_MULT)} Weak`}</td>;})}</tr>)}</tbody>
    </table></div>
    <h3>Special rules</h3>
    <ul className="qn-rules">{SPECIAL_RULES.map(rule=><li key={rule.unit}><b>{UNITS[rule.unit].short}:</b> {rule.text}</li>)}</ul>
    <p className="qn-note">The big idea: no single technique handles every error. Real experiments stack them, with <b>suppression</b> (DD, twirling) shaping the noise while the circuit runs and <b>mitigation</b> (TREX, ZNE) cleaning up the results afterwards.</p>
  </div>;
}

function PracticeQuiz(){
  const all=[...LEVELS.map(level=>level.quiz),...BONUS_QUIZ];
  const [index,setIndex]=useState(0),[score,setScore]=useState(0),[answered,setAnswered]=useState(0);
  if(index>=all.length)return <div className="qn-practice-done"><h3>You scored {score} / {all.length}</h3><button className="secondary" onClick={()=>{setIndex(0);setScore(0);setAnswered(0);}}>Try again</button></div>;
  return <div>
    <p className="qn-meta">Question {index+1} of {all.length} · Score {score}/{answered}</p>
    <Quiz key={index} quiz={all[index]} onAnswer={ok=>{setAnswered(a=>a+1);if(ok)setScore(s=>s+1);}}/>
    {answered>index&&<div className="result-actions"><button onClick={()=>setIndex(index+1)}>{index+1<all.length?'Next question →':'See score →'}</button></div>}
  </div>;
}

export default function Almanac({onClose,embedded=false}){
  const [tab,setTab]=useState('techniques');
  return <section className={`qn-almanac ${embedded?'embedded':'mini-game qn-page'}`} aria-label="Quantum Almanac">
    <div className="mission-title-row"><div className="eyebrow">QUBITS VS NOISE · FIELD GUIDE</div><button className="secondary qn-small" onClick={onClose}>{embedded?'← Back to pause menu':'← Back to the game'}</button></div>
    <h1>Quantum Almanac</h1>
    <nav className="tw-tabs qn-tabs" aria-label="Almanac sections">{TABS.map(([id,label])=><button key={id} className={tab===id?'':'secondary'} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    <div className="qn-almanac-body">
      {tab==='techniques'&&<>
        <div className="qn-callout"><p><CategoryBadge category="suppression"/> {CATEGORY_INFO.suppression.text}</p><p><CategoryBadge category="mitigation"/> {CATEGORY_INFO.mitigation.text}</p></div>
        {UNIT_ORDER.map(id=><TechniqueEntry key={id} id={id}/>)}
      </>}
      {tab==='errors'&&TYPE_ORDER.map(type=><section key={type} className="qn-type-group"><h3><TypeBadge type={type}/> <span>{ERROR_TYPES[type].text}</span></h3>{ENEMY_ORDER.filter(id=>ENEMIES[id].errorType===type).map(id=><ErrorEntry key={id} id={id}/>)}</section>)}
      {tab==='matchups'&&<Matchups/>}
      {tab==='quiz'&&<PracticeQuiz/>}
    </div>
  </section>;
}
