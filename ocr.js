/* NRC screenshot reader. scan()/finish()/parse() are pure (tested in Node); read() runs Tesseract.js in the browser. */
(function(root){
'use strict';
// Loaded only when a screenshot is chosen. Recognition runs on this device; the image is never uploaded.
const ENGINE='https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js',KM_PER_MILE=1.609344;
const NUMERIC=['distance','time','calories','elevationGain','averageHeartRate','maxHeartRate','cadence'];

// Tesseract TSV columns: level page block par line word left top width height conf text. Level 5 is a word.
function words(tsv){
 return String(tsv??'').split('\n').map(line=>line.split('\t')).filter(c=>c[0]==='5'&&c.length>=12&&c.slice(11).join(' ').trim())
  .map((c,id)=>{const x=+c[6],y=+c[7],w=+c[8],h=+c[9];return {id,text:c.slice(11).join(' ').trim(),x0:x,y0:y,x1:x+w,y1:y+h,h}});
}
function median(list){const s=[...list].sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:0}
function bounds(list){return {x0:Math.min(...list.map(w=>w.x0)),y0:Math.min(...list.map(w=>w.y0)),x1:Math.max(...list.map(w=>w.x1)),y1:Math.max(...list.map(w=>w.y1))}}
// Own line grouping (vertical overlap) so parsing does not depend on Tesseract's page segmentation.
function lines(list){
 const rows=[];
 for(const w of [...list].sort((a,b)=>(a.y0+a.y1)-(b.y0+b.y1))){
  const row=rows.find(r=>Math.min(r.y1,w.y1)-Math.max(r.y0,w.y0)>=Math.min(r.y1-r.y0,w.h)*.5);
  if(row){row.words.push(w);row.y0=Math.min(row.y0,w.y0);row.y1=Math.max(row.y1,w.y1)}else rows.push({y0:w.y0,y1:w.y1,words:[w]});
 }
 for(const r of rows)r.words.sort((a,b)=>a.x0-b.x0);
 return rows.sort((a,b)=>a.y0-b.y0);
}

// Korean and English NRC labels, matched against a whole word run with spaces and symbols removed.
// Pace, best pace, elapsed time and elevation loss are only claimed, so their values never fill another field.
const LABELS=[
 ['distance',/^(거리|킬로미터|kilometers?|distance|마일|miles?)$/,0],
 ['pace',/^(평균)?페이스$|^(avg)?pace$/,0],
 ['bestPace',/^최고페이스$|^(best|fastest)pace$/,0],
 ['time',/^(운동|러닝)?시간$|^(time|duration|movingtime|runningtime)$/,0],
 ['elapsed',/^(경과|총)시간$|^elapsed(time)?$|^totaltime$/,0],
 ['calories',/^(소모)?칼로리(근사치)?$|^(active)?calories$|^kcal$/,0],
 ['elevationGain',/^고도(상승)?$|^elev(ation)?(gain)?$/,0],
 ['elevationLoss',/^고도하강$|^elev(ation)?(loss|descent)$/,0],
 ['maxHeartRate',/^최대(심박수?)?$|^최고심박수?$|^max(imum)?(heartrate|hr)$/,.3],
 ['averageHeartRate',/^(평균)?심박수?$|^(avg|average)?(heartrate|hr)$/,0],
 ['averageHeartRate',/^평균$|^avg$/,1],
 ['cadence',/^(평균)?케이던스$|^cadence$/,0]];
// Fallback for labels Tesseract splits or misreads, e.g. "평 규 심박수" or "| 이 던스".
const LOOSE=[['distance',/킬로|로미터|마일/],['elapsed',/경과/],['elevationLoss',/하강/],['pace',/페이/],['calories',/칼로/],['cadence',/케이던|던스/],['elevationGain',/고도/],['maxHeartRate',/최대/],['averageHeartRate',/심박/]];
function key(text){return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')}
function labels(rows,unit){
 const found=[];
 for(const row of rows){
  // A label is a run of close, non-numeric words; a wide gap means the next grid column.
  const phrases=[];let run=[];
  for(const w of row.words){if(run.length&&(/\d/.test(w.text)||w.x0-run.at(-1).x1>unit*1.2)){phrases.push(run);run=[]}if(!/\d/.test(w.text))run.push(w)}
  if(run.length)phrases.push(run);
  for(const phrase of phrases){
   const box=bounds(phrase);
   for(let i=0;i<phrase.length;i++)for(let n=1;n<=4&&i+n<=phrase.length;n++){
    const part=phrase.slice(i,i+n),text=key(part.map(w=>w.text).join('')),ids=part.map(w=>w.id),exact=LABELS.filter(([,p])=>p.test(text));
    for(const [field,,penalty] of exact)found.push({field,penalty,ids,text,...box});
    if(!exact.length)for(const [field,p] of LOOSE)if(p.test(text))found.push({field,penalty:.5,ids,text,...box});
   }
  }
 }
 // Longer runs win: "평균 페이스" claims "평균" before the weak "평균" heart-rate label can.
 found.sort((a,b)=>b.ids.length-a.ids.length||a.penalty-b.penalty);
 const used=new Set();
 return found.filter(l=>{if(l.ids.some(id=>used.has(id)))return false;l.ids.forEach(id=>used.add(id));return true});
}

// Units, including ones cut short by OCR ("2.71k"), and a leading plus ("+8 m") are dropped.
const UNIT=/\/?(km?|kcal|kca|kc|bpm|bp|spm|sp|mi|m|미터|킬로미터)$/i,QUOTES=/['’′‘`´"”″]/;
function value(text){
 let t=String(text).replace(/\s+/g,'');
 // Paces (10'29", 10'28''/km) are matched to pace labels only, so they are never mistaken for another value.
 if(QUOTES.test(t)&&/\d/.test(t))return {kind:'pace'};
 t=t.replace(UNIT,'').replace(/^\+/,'');
 if(!/\d/.test(t)||!/^[\dOoIl|.,:;]+$/.test(t))return null;
 t=t.replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/;/g,':');
 let m;
 if((m=t.match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/)))return {kind:'clock',number:+m[1]*3600+ +m[2]*60+ +m[3]};
 if((m=t.match(/^(\d{1,3}):([0-5]\d)$/)))return {kind:'clock',number:+m[1]*60+ +m[2]};
 if(/^\d{1,3}(,\d{3})+$/.test(t))return {kind:'int',number:+t.replace(/,/g,'')};
 if((m=t.match(/^(\d{1,4})[.,](\d{1,3})$/)))return {kind:'decimal',number:+(m[1]+'.'+m[2]),places:m[2].length};
 if(/^\d{1,6}$/.test(t))return {kind:'int',number:+t};
 return null;
}
// NRC shows distance with two decimals; "2.711" is "2.71k" misread and gets re-read.
const FIELDS={
 distance:{kinds:['decimal'],ok:(n,v)=>n>0&&n<1000&&v.places<=2},
 pace:{claim:true},bestPace:{claim:true},elapsed:{claim:true},elevationLoss:{claim:true},
 time:{kinds:['clock'],ok:n=>n>0},
 calories:{kinds:['int'],ok:n=>n<=100000},
 elevationGain:{kinds:['int','decimal'],ok:n=>n<=100000},
 averageHeartRate:{kinds:['int'],ok:n=>n>=30&&n<=250},
 maxHeartRate:{kinds:['int'],ok:n=>n>=30&&n<=250},
 cadence:{kinds:['int'],ok:n=>n>=30&&n<=300}};
function accept(field,text){const v=value(text),f=FIELDS[field];return v&&f.kinds.includes(v.kind)&&f.ok(v.number,v)?v.number:null}
// Lower is better. The NRC summary grid stacks each value above its label; the detail list puts it at the far right of the label's row.
function score(label,v,unit){
 const gap=Math.max(0,v.y0-label.y1,label.y0-v.y1),aligned=Math.min(Math.abs(v.x0-label.x0),Math.abs((v.x0+v.x1)/2-(label.x0+label.x1)/2));
 let best=Infinity;
 if(gap<=unit*3&&aligned<=unit*2)best=gap/unit+aligned/unit*.5;
 const dy=Math.abs((v.y0+v.y1)/2-(label.y0+label.y1)/2),dx=v.x0-label.x1;
 if(dy<=unit*.6&&dx>=-unit*.2&&dx<=unit*40)best=Math.min(best,.5+dx/unit*.02);
 return best;
}
function validDate(y,m,d){const date=new Date(Date.UTC(2000,m-1,d));date.setUTCFullYear(y);return y>=1&&y<=9999&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'):null}
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function date(text,year){
 const t=String(text).replace(/\s+/g,' ');let m;
 if((m=t.match(/(\d{4}) ?[.\/-] ?(\d{1,2}) ?[.\/-] ?(\d{1,2})/)))return validDate(+m[1],+m[2],+m[3]);
 if((m=t.match(/(\d{4}) ?년 ?(\d{1,2}) ?월 ?(\d{1,2}) ?일/)))return validDate(+m[1],+m[2],+m[3]);
 if((m=t.match(/(?:^|\s)(\d{2})\. ?(\d{1,2})\. ?(\d{1,2})\./)))return validDate(2000+ +m[1],+m[2],+m[3]);
 if((m=t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/)))return validDate(m[3].length===2?2000+ +m[3]:+m[3],+m[1],+m[2]);
 if((m=t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2}),? (\d{4})\b/i)))return validDate(+m[3],MONTHS.indexOf(m[1].toLowerCase())+1,+m[2]);
 if(year&&(m=t.match(/(\d{1,2}) ?월 ?(\d{1,2}) ?일/)))return validDate(year,+m[1],+m[2]);
 return null;
}

// First pass: pair each label with its value box. picks[field] = {box, number|null}; null means "re-read this box".
function scan(tsv,{year}={}){
 const list=words(tsv),rows=lines(list),unit=median(list.map(w=>w.h))||20,found=labels(rows,unit),values=[];
 // Unreadable digit runs ("2./1") stay as raw candidates so the second pass can re-read them.
 for(const w of list){const v=value(w.text)??(/\d/.test(w.text)?{kind:'raw'}:null);if(v)values.push({...w,...v})}
 const pairs=[];
 for(const l of found)for(const v of values){
  // A misread value of the right shape ("2.711", "bpm" read as "600") stays a candidate for the second pass to re-read.
  const f=FIELDS[l.field],fits=f.claim||v.kind!=='raw'&&f.kinds.includes(v.kind)&&f.ok(v.number,v),raw=!fits&&(v.kind==='raw'||f.kinds.includes(v.kind));if(!fits&&!raw)continue;
  const s=score(l,v,unit)+l.penalty+(raw?.3:0);if(Number.isFinite(s))pairs.push({label:l,value:v,score:s,raw});
 }
 pairs.sort((a,b)=>a.score-b.score);
 const picked={},used=new Set();
 for(const p of pairs)if(!picked[p.label.field]&&!used.has(p.value.id)){picked[p.label.field]=p;used.add(p.value.id)}
 // Re-read crops keep clear of the row's neighbouring words: Tesseract's box for "+8" overlaps the "m" beside it,
 // and a neighbour's box can start a few pixels inside its first glyph, so a quarter of the text height is left as margin.
 const picks={};for(const field of NUMERIC)if(picked[field]){const v=picked[field].value,margin=(v.y1-v.y0)*.25,others=rows.find(r=>r.words.some(w=>w.id===v.id)).words.filter(w=>w.id!==v.id);
  const left=Math.max(0,...others.filter(w=>w.x0<v.x0).map(w=>w.x1+margin)),right=Math.min(Infinity,...others.filter(w=>w.x0>v.x0).map(w=>w.x0-margin));
  picks[field]={box:{...bounds([v]),x0:Math.max(v.x0,left),x1:Math.min(v.x1,right),left,right},number:picked[field].raw?null:v.number}}
 // The headline distance is the one large decimal on screen; used only when its label pairing fails.
 const big=values.filter(v=>v.kind==='decimal'&&!used.has(v.id)&&v.h>=unit*2&&FIELDS.distance.ok(v.number,v)).sort((a,b)=>b.h-a.h)[0];
 return {date:date(rows.map(r=>r.words.map(w=>w.text).join(' ')).join('\n'),year),unit:picked.distance&&/마일|mile/.test(picked.distance.label.text)?'mi':'km',picks,fallbackDistance:big?big.number:null};
}
// refined[field] is the text from re-reading that field's box; a valid re-read wins over the first pass.
function finish(s,refined={}){
 const n={};for(const field of NUMERIC){const pick=s.picks[field];n[field]=pick?(refined[field]!=null?accept(field,refined[field]):null)??pick.number:null}
 let distance=n.distance??s.fallbackDistance;if(distance!==null&&s.unit==='mi')distance=Math.round(distance*KM_PER_MILE*100)/100;
 const result={date:s.date,distance,unit:s.unit,seconds:n.time,averageHeartRate:n.averageHeartRate,maxHeartRate:n.maxHeartRate,cadence:n.cadence,calories:n.calories,elevationGain:n.elevationGain};
 if(result.maxHeartRate!==null&&result.averageHeartRate!==null&&result.maxHeartRate<result.averageHeartRate)result.maxHeartRate=null;
 return result;
}
function parse(tsv,options){return finish(scan(tsv,options))}

let engine=null,listener=null,queue=Promise.resolve();
function script(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.async=true;s.onload=resolve;s.onerror=()=>{s.remove();reject(new Error('OCR 엔진을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'))};document.head.append(s)})}
// Korean labels plus the English model, which reads unit letters ("8 m", "158 bpm") the Korean model turns into digits.
function start(){
 engine??=(async()=>{if(!root.Tesseract)await script(ENGINE);return root.Tesseract.createWorker(['kor','eng'],1,{logger:m=>listener?.(m)})})().catch(error=>{engine=null;throw error});
 return engine;
}
// Grayscale, and invert dark-mode screenshots so text is dark on light, which Tesseract reads best.
async function image(file){
 const url=URL.createObjectURL(file);
 try{
  const img=new Image();img.src=url;
  try{await img.decode()}catch{throw new Error('이미지를 열 수 없습니다. PNG·JPG 캡처를 선택해 주세요.')}
  const w=img.naturalWidth,h=img.naturalHeight,scale=Math.min(w<900?2:w>1800?1800/w:1,Math.sqrt(12e6/(w*h)));
  const canvas=document.createElement('canvas');canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),p=pixels.data;let sum=0;
  for(let i=0;i<p.length;i+=4){const g=p[i]*.299+p[i+1]*.587+p[i+2]*.114;p[i]=p[i+1]=p[i+2]=g;sum+=g}
  if(sum/(p.length/4)<128)for(let i=0;i<p.length;i+=4)p[i]=p[i+1]=p[i+2]=255-p[i];
  ctx.putImageData(pixels,0,0);return canvas;
 }finally{URL.revokeObjectURL(url)}
}
// Tesseract misreads very large or unit-attached numbers ("2.71" → "2./1", "8 m" → "807"),
// so each value box is cropped, scaled to ~40px text and re-read as one line of digits and units.
function crop(canvas,box){
 const h=Math.max(1,box.y1-box.y0),pad=Math.round(h*.25),x=Math.max(0,box.left??0,box.x0-pad),y=Math.max(0,box.y0-pad),w=Math.max(1,Math.min(canvas.width,box.right??Infinity,box.x1+pad)-x),hh=Math.min(canvas.height,box.y1+pad)-y,scale=40/h;
 const out=document.createElement('canvas');out.width=Math.max(1,Math.round(w*scale))+40;out.height=Math.max(1,Math.round(hh*scale))+40;
 const ctx=out.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(canvas,x,y,w,hh,20,20,out.width-40,out.height-40);return out;
}
// Reads run one at a time: each switches the shared worker between page and single-line modes.
function read(file,options){const job=queue.then(()=>recognize(file,options));queue=job.catch(()=>{});return job}
async function recognize(file,{year,onProgress}={}){
 listener=onProgress;
 try{
  const canvas=await image(file),worker=await start();
  await worker.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:''});
  const {data}=await worker.recognize(canvas,{},{tsv:true}),s=scan(data.tsv,{year}),refined={};
  listener=null;onProgress?.({status:'checking numbers'});
  await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789.,:+- kmbpcals'});
  for(const [field,pick] of Object.entries(s.picks))refined[field]=(await worker.recognize(crop(canvas,pick.box))).data.text.trim();
  return {...finish(s,refined),tsv:data.tsv,refined};
 }finally{listener=null}
}

const api={ENGINE,words,lines,labels,value,date,scan,finish,parse,read};
if(typeof module!=='undefined')module.exports=api;else root.NrcOcr=api;
})(globalThis);
