import React, {useEffect, useRef, useState} from 'react';
import {CATEGORY_INFO, EFFECTIVE_MULT, ERROR_TYPES, RESISTED_MULT, UNITS, formatMult} from './data.js';
import {drawIcon} from './renderer.js';

// A unit or error drawn by the battlefield renderer, in the same pixel style.
export function SpriteIcon({kind,type,size=56,className=''}){
  const ref=useRef(null);
  useEffect(()=>{
    const canvas=ref.current,dpr=Math.min(2,window.devicePixelRatio||1);
    canvas.width=Math.round(size*dpr);canvas.height=Math.round(size*dpr);
    const ctx=canvas.getContext('2d'),scale=canvas.width/96;
    ctx.setTransform(scale,0,0,scale,0,0);
    drawIcon(ctx,kind,type);
  },[kind,type,size]);
  return <canvas ref={ref} className={`qn-sprite ${className}`} style={{width:size,height:size}} aria-hidden="true"/>;
}

export function CategoryBadge({category}){
  const info=CATEGORY_INFO[category];
  return <span className="qn-badge" style={{'--badge':info.color}}>{info.label}</span>;
}

// An error type, e.g. "G Gate noise", in the type's colour. `glyphOnly` drops the label.
export function TypeBadge({type,glyphOnly=false}){
  const info=ERROR_TYPES[type];
  return <span className={`qn-type ${glyphOnly?'glyph-only':''}`} style={{'--type':info.color}} title={info.label}><span className="qn-type-glyph">{info.glyph}</span>{!glyphOnly&&info.label}</span>;
}

// "×2 vs Gate noise · ×½ vs everything else" for a technique.
export function StrongVs({unit}){
  const type=UNITS[unit].strongVs;
  if(!type)return null;
  return <span className="qn-strong-vs"><b>{formatMult(EFFECTIVE_MULT)}</b> vs <TypeBadge type={type}/> · {formatMult(RESISTED_MULT)} vs everything else</span>;
}

export function Stars({n,size=''}){
  return <div className={`qn-stars ${size}`} aria-label={`${n} of 3 stars`}>{[1,2,3].map(i=><span key={i} className={i<=n?'on':''}>★</span>)}</div>;
}

// One multiple-choice question, styled like the CODFISH mission answers.
export function Quiz({quiz,onAnswer}){
  const [picked,setPicked]=useState(null);
  const answered=picked!==null,correct=picked===quiz.answer;
  function choose(i){if(answered)return;setPicked(i);onAnswer?.(i===quiz.answer);}
  return <div className="qn-quiz-body">
    <h3>{quiz.q}</h3>
    <div className="qn-answers">{quiz.options.map((option,i)=>{
      const right=answered&&i===quiz.answer,wrong=answered&&i===picked&&!correct;
      return <button key={i} type="button" className={`answer-option ${right?'answer-correct':''} ${wrong?'answer-wrong':''}`} disabled={answered} onClick={()=>choose(i)}><span className="answer-letter">{right?'✓':'ABCD'[i]}</span><span>{option}</span></button>;
    })}</div>
    {answered&&<div className={`answer-feedback ${correct?'feedback-correct':''}`} role="status"><strong>{correct?'✓ Correct!':'Not quite.'}</strong><p>{quiz.explain}</p></div>}
  </div>;
}
