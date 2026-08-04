// Throwaway: run the shipped LUT transfer on the authored dirt ramp.
const s2l = (v) => v <= 0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
const lin = (hex) => [16,8,0].map(sh => s2l(((hex>>sh)&255)/255));
const GRADE = { lift:[0.012,0.006,0.028], gamma:[0.98,1.0,1.04], gain:[1.06,1.0,0.94],
  saturation:1.14, shadowTint:lin(0x5b4a86), highlightTint:lin(0xffd9a0), splitStrength:0.22,
  contrast:1.12, contrastPivot:0.46 };
const TRIM = { gainR:0.965, gainG:1.0, gainB:1.035, split:0.68, saturation:0.93, highlightSat:0.85, chromaCeiling:0.985 };
const ss=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
function grade(c, trim) {
  const gain = trim ? [GRADE.gain[0]*TRIM.gainR, GRADE.gain[1], GRADE.gain[2]*TRIM.gainB] : GRADE.gain;
  const split = trim ? GRADE.splitStrength*TRIM.split : GRADE.splitStrength;
  const satB = trim ? GRADE.saturation*TRIM.saturation : GRADE.saturation;
  let v = c.map((x,i)=>Math.pow(Math.max(x*gain[i]+GRADE.lift[i],0), 1/GRADE.gamma[i]));
  v = v.map(x=>(x-GRADE.contrastPivot)*GRADE.contrast+GRADE.contrastPivot);
  const L=(a)=>0.2126*a[0]+0.7152*a[1]+0.0722*a[2];
  const l=L(v), sw=Math.max(0,1-l*1.6), hw=Math.max(0,(l-0.55)*2.2);
  v = v.map((x,i)=>x+(GRADE.shadowTint[i]-0.5)*sw*split+(GRADE.highlightTint[i]-0.5)*hw*split);
  const l2=L(v);
  const sat = trim ? satB*(1-(1-TRIM.highlightSat)*ss(0.55,0.95,l2)) : satB;
  v = v.map(x=>l2+(x-l2)*sat);
  if (trim) { const m=Math.max(...v), lc=L(v);
    if (m>TRIM.chromaCeiling && m-lc>1e-5) { const k=Math.max(0,(TRIM.chromaCeiling-lc)/(m-lc)); v=v.map(x=>lc+(x-lc)*k); } }
  return v.map(x=>Math.round(Math.min(Math.max(x,0),1)*255));
}
for (const [name,hex] of [['dirt shadow',0x54385a],['dirt mid-dark',0x8a5a4a],['dirt mid',0xb8825a],['dirt lit',0xd9a878]]) {
  const c=[16,8,0].map(sh=>((hex>>sh)&255)/255);
  const a=grade(c,false), b=grade(c,true);
  const ch=(v)=>Math.max(...v)-Math.min(...v);
  console.log(`${name.padEnd(14)} authored ${[16,8,0].map(sh=>(hex>>sh)&255).join(',').padEnd(12)} chroma ${String(ch([16,8,0].map(sh=>(hex>>sh)&255))).padStart(3)}  |  was ${a.join(',').padEnd(12)} chroma ${String(ch(a)).padStart(3)}  |  now ${b.join(',').padEnd(12)} chroma ${String(ch(b)).padStart(3)}`);
}
