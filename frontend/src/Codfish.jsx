import React from 'react';
import {CODFISH_SPRITES} from './codfishSprites';

export default function Codfish({className='',species='cod'}){
  const shapes=CODFISH_SPRITES[species]||CODFISH_SPRITES.cod;
  return <svg className={`codfish ${className}`} width="160" height="96" viewBox="0 0 160 96" shapeRendering="crispEdges" aria-hidden="true">
    {shapes.map(([kind,...a],i)=>kind==='path'?<path key={i} d={a[0]} fill={a[1]}/>
      :kind==='rect'?<rect key={i} x={a[0]} y={a[1]} width={a[2]} height={a[3]} fill={a[4]}/>
      :<rect key={i} x={a[0]} y={a[1]} width={a[2]} height={a[2]} fill="none" stroke={a[3]} strokeWidth="2"/>)}
  </svg>;
}
