/* Pure calculation and storage model; no dependencies. */
(function(root){
'use strict';
const FACTOR=4.55/2.71, KEY='running-correction.records.v1';
const optional=['averageHeartRate','maxHeartRate','cadence','calories','elevationGain'];
function fail(message){throw new Error(message)}
function dateValid(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||s<'0001-01-01')return false;const d=new Date(s+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s}
function number(v,name,min,max,integer=false){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||(integer&&!Number.isInteger(v)))fail(name+' 값이 올바르지 않습니다.');return v}
function calculate(distance,seconds,factor=FACTOR){number(distance,'거리',0.000001,100000);number(seconds,'시간',1,31536000,true);number(factor,'계수',0.000001,100000);return {correctedDistance:distance*factor,correctedPace:seconds/(distance*factor)}}
function record(input,factor=FACTOR){
 if(!dateValid(input.date))fail('날짜를 확인해 주세요.');
 if(typeof input.id!=='string'||!input.id.trim()||input.id.length>160)fail('기록 ID가 올바르지 않습니다.');
 const r={id:input.id,date:input.date,distance:input.distance,durationSeconds:input.durationSeconds,appliedFactor:factor,...calculate(input.distance,input.durationSeconds,factor)};
 for(const k of optional)r[k]=input[k]==null?null:number(input[k],k,(k==='calories'||k==='elevationGain')?0:1,(k==='calories'||k==='elevationGain')?100000:1000,k!=='elevationGain');
 if(r.averageHeartRate!==null&&r.maxHeartRate!==null&&r.maxHeartRate<r.averageHeartRate)fail('최대 심박수는 평균 심박수 이상이어야 합니다.');
 if(typeof (input.note??'')!=='string'||(input.note??'').length>2000)fail('메모는 2,000자 이하로 입력해 주세요.');
 r.note=input.note??'';return r;
}
function validateRecord(r){
 if(!r||typeof r!=='object')fail('기록 형식이 잘못되었습니다.');
 // Only absent fields in known legacy seed records are supplemented. Explicit null/zero is preserved.
 const elevation = !Object.prototype.hasOwnProperty.call(r,'elevationGain') ? ({'seed-2026-10-09':8,'seed-2026-10-11':7}[r.id] ?? null) : r.elevationGain;
 const checked=record({...r,elevationGain:elevation},r.appliedFactor);
 if(typeof r.appliedFactor!=='number')fail('적용 계수가 없습니다.');
 for(const key of ['correctedDistance','correctedPace'])if(typeof r[key]!=='number'||!Number.isFinite(r[key])||Math.abs(r[key]-checked[key])>Math.max(1e-9,Math.abs(checked[key])*1e-10))fail('보정 계산값이 일치하지 않습니다.');
 return {...checked,correctedDistance:r.correctedDistance,correctedPace:r.correctedPace};
}
function envelope(records){return {schemaVersion:1,initialized:true,records}}
function parse(text){let data;try{data=JSON.parse(text)}catch{fail('올바른 JSON 파일이 아닙니다.')}
 if(!data||data.schemaVersion!==1||data.initialized!==true||!Array.isArray(data.records)||data.records.length>10000)fail('지원하지 않는 백업 형식입니다.');
 const records=data.records.map(validateRecord),ids=new Set();for(const r of records){if(ids.has(r.id))fail('파일에 중복 ID가 있습니다.');ids.add(r.id)}return envelope(records);
}
// First launch holds only the 10/9 reference run; the 10/11 run is entered from its NRC capture.
function seeds(){return [record({id:'seed-2026-10-09',date:'2026-10-09',distance:2.71,durationSeconds:1704,averageHeartRate:149,maxHeartRate:163,cadence:163,calories:122,elevationGain:8})]}
function load(storage){const value=storage.getItem(KEY);if(value!==null)return parse(value);const data=envelope(seeds());storage.setItem(KEY,JSON.stringify(data));return data}
function persist(storage,data){const clean=parse(JSON.stringify(data));storage.setItem(KEY,JSON.stringify(clean));return clean}
function upsert(data,input){const previous=data.records.find(r=>r.id===input.id);const next=record(input,previous?previous.appliedFactor:FACTOR);return envelope([...data.records.filter(r=>r.id!==next.id),next])}
function remove(data,id){return envelope(data.records.filter(r=>r.id!==id))}
// Same date, NRC distance and duration to the second is almost certainly one run saved twice; two runs on one day differ.
function duplicate(data,input){return data.records.find(r=>r.id!==input.id&&r.date===input.date&&Math.abs(r.distance-input.distance)<1e-9&&r.durationSeconds===input.durationSeconds)??null}
function merge(data,incoming){const ids=new Set(data.records.map(r=>r.id));const added=incoming.records.filter(r=>!ids.has(r.id));if(data.records.length+added.length>10000)fail('최대 10,000개까지 저장할 수 있습니다.');return {data:envelope([...data.records,...added]),added:added.length,skipped:incoming.records.length-added.length}}
function stats(data,month){const rows=month?data.records.filter(r=>r.date.slice(0,7)===month):data.records;const s=rows.reduce((s,r)=>({count:s.count+1,distance:s.distance+r.distance,correctedDistance:s.correctedDistance+recordDistance(r),seconds:s.seconds+r.durationSeconds}),{count:0,distance:0,correctedDistance:0,seconds:0});const sum=k=>rows.reduce((n,r)=>n+(r[k]??0),0);
 const weighted=k=>{const valid=rows.filter(r=>r[k]!=null);const seconds=valid.reduce((n,r)=>n+r.durationSeconds,0);return seconds?valid.reduce((n,r)=>n+r[k]*r.durationSeconds,0)/seconds:null};
 return {...s,pace:s.correctedDistance?s.seconds/s.correctedDistance:null,calories:sum('calories'),elevationGain:sum('elevationGain'),averageHeartRate:weighted('averageHeartRate'),cadence:weighted('cadence')}}
function pace(n){if(n===null)return '—';const s=Math.round(n);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}
function distance(n){return n>0&&n<0.005?'0.01 미만':n.toFixed(2)}
function duration(s){return (s>=3600?Math.floor(s/3600)+'시간 ':'')+Math.floor(s%3600/60)+'분 '+s%60+'초'}

// Dates are ISO civil dates. UTC arithmetic avoids host timezone and DST shifts.
function koreaDate(now=new Date()) {const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);const get=t=>parts.find(p=>p.type===t).value;return get('year')+'-'+get('month')+'-'+get('day')}
function recordDistance(r){return r.distance*r.appliedFactor}
function shiftDays(date,days){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);if(d.getUTCFullYear()<1)return '0001-01-01';if(d.getUTCFullYear()>9999)return '9999-12-31';return d.toISOString().slice(0,10)}
function range(mode,anchor){
 if(mode==='all')return {start:'0001-01-01',end:'9999-12-31',label:'전체 기간'};
 if(!dateValid(anchor))fail('조회 날짜가 올바르지 않습니다.');
 const y=anchor.slice(0,4),m=anchor.slice(0,7);
 if(mode==='year')return {start:y+'-01-01',end:y+'-12-31',label:y+'년'};
 if(mode==='month'){let day=28;while(dateValid(m+'-'+(day+1)))day++;return {start:m+'-01',end:m+'-'+day,label:Number(y)+'년 '+Number(anchor.slice(5,7))+'월'}}
 if(mode==='week'){const offset=(new Date(anchor+'T12:00:00Z').getUTCDay()+6)%7;const start=shiftDays(anchor,-offset),end=shiftDays(start,6);return {start,end,label:start.replaceAll('-','.')+' – '+end.replaceAll('-','.')};}
 fail('지원하지 않는 조회 기간입니다.');
}
function shiftPeriod(mode,anchor,delta){
 if(mode==='week')return shiftDays(anchor,delta*7);
 const d=new Date(anchor.slice(0,7)+'-01T12:00:00Z');
 if(mode==='month')d.setUTCMonth(d.getUTCMonth()+delta);else if(mode==='year')d.setUTCFullYear(d.getUTCFullYear()+delta);else return anchor;
 return d.toISOString().slice(0,10);
}
function report(data,mode,anchor){const period=range(mode,anchor);const inside=data.records.filter(r=>r.date>=period.start&&r.date<=period.end);return {period,periodStats:stats(envelope(inside)),cumulative:stats(envelope(data.records.filter(r=>r.date<=period.end))),overall:stats(data),buckets:buckets(inside,mode,period)}}
const WEEKDAYS='월화수목금토일';
function buckets(rows,mode,period){
 const values=new Map();for(const r of rows){const key=mode==='all'?r.date.slice(0,4):mode==='year'?r.date.slice(0,7):r.date;values.set(key,(values.get(key)||0)+recordDistance(r))}
 let keys=[];
 if(mode==='all'){const years=[...values.keys()].sort();if(years.length)for(let y=Number(years[0]);y<=Number(years.at(-1));y++)keys.push(String(y).padStart(4,'0'));}
 else if(mode==='year'){for(let m=1;m<=12;m++)keys.push(period.start.slice(0,4)+'-'+String(m).padStart(2,'0'))}
 else {let date=period.start;while(date<=period.end){keys.push(date);if(date===period.end)break;date=shiftDays(date,1)}}
 return keys.map((key,i)=>({key,value:values.get(key)||0,label:mode==='all'?key:mode==='year'?Number(key.slice(5))+'월':mode==='week'?WEEKDAYS[i]:String(Number(key.slice(8)))}));
}
const LEVELS=Object.freeze([
 {name:'옐로우',start:0,color:'#f4ca21',ink:'#846900',tint:'#fff8d5'},
 {name:'오렌지',start:50,color:'#ff962e',ink:'#ae5100',tint:'#fff0df'},
 {name:'그린',start:250,color:'#31bd79',ink:'#157b48',tint:'#e4f6ec'},
 {name:'블루',start:1000,color:'#419edc',ink:'#216caa',tint:'#e9f4fc'},
 {name:'퍼플',start:2500,color:'#9c63da',ink:'#7843ac',tint:'#f2eafb'}].map(Object.freeze));
// The tolerance absorbs floating-point noise from summing records (e.g. 49.99999999999999 → 50km).
function level(total){const index=LEVELS.findLastIndex(l=>total>=l.start-1e-9),current=LEVELS[Math.max(0,index)],next=LEVELS[index+1]??null;return {current,next,total,remaining:next?Math.max(0,next.start-total):null,progress:next?Math.max(0,Math.min(1,(total-current.start)/(next.start-current.start))):1}}

const api={koreaDate,recordDistance,shiftDays,range,shiftPeriod,report,LEVELS,level,FACTOR,KEY,optional,dateValid,calculate,record,parse,envelope,seeds,load,persist,upsert,remove,duplicate,merge,stats,pace,distance,duration};
if(typeof module!=='undefined')module.exports=api;else root.Running=api;
})(globalThis);
