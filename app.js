'use strict';
const M=Running,$=id=>document.getElementById(id);
const fields=['date','distance','minutes','seconds',...M.optional,'note'];
let data=M.envelope([]),blocked=false,editing=null,selected='';
const now=new Date(),today=M.koreaDate(now);let year=Number(today.slice(0,4)),month=Number(today.slice(5,7))-1;
let mode='month',anchor=today;
function monthKey(){return String(year).padStart(4,'0')+'-'+String(month+1).padStart(2,'0')}
// Inside the current month the anchor stays on today, so switching to week mode opens this week.
function monthAnchor(key){return key===today.slice(0,7)?today:key+'-01'}
function periodName(){return mode==='week'?'주간':mode==='month'?Number(anchor.slice(5,7))+'월':mode==='year'?Number(anchor.slice(0,4))+'년':'전체'}
function clock(t){const m=Math.floor(t%3600/60),s=String(t%60).padStart(2,'0');return t>=3600?Math.floor(t/3600)+':'+String(m).padStart(2,'0')+':'+s:m+':'+s}
function message(text){$('status').textContent=text;$('info-status').textContent=text}
function storageFailure(error){blocked=true;$('storage-error').hidden=false;$('storage-error').textContent='저장소를 읽거나 초기화할 수 없습니다. 기존 데이터는 덮어쓰지 않았습니다. 브라우저 저장소 접근을 확인한 뒤 새로고침하세요. '+error.message}
try{data=M.load(localStorage)}catch(error){storageFailure(error)}
function commit(next){if(blocked)throw new Error('저장소 오류를 먼저 해결해 주세요.');data=M.persist(localStorage,next);render()}
function element(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el}
function render(){
 const key=monthKey();if(mode==='month'&&anchor.slice(0,7)!==key)anchor=monthAnchor(key);
 // Hero and six stats: everything up to the period end. Period figures and chart: only inside the period.
 const view=M.report(data,mode,anchor),s=view.cumulative,p=view.periodStats,total=M.distance(s.correctedDistance);$('month-title').textContent=year+'년 '+(month+1)+'월';
 $('hero-month').textContent=view.period.label;$('total-distance').textContent=total;$('total-distance').className=total.length>6?'long':'';
 $('period-distance').textContent=M.distance(p.correctedDistance);$('period-distance-label').textContent=periodName()+' 거리';$('period-count').textContent=p.count+'회';
 $('original-distance').textContent=M.distance(s.distance)+' km';$('total-time').textContent=clock(s.seconds);
 $('total-pace').textContent=s.pace===null?'-':M.pace(s.pace).replace(':',"′")+'″ /km';
 $('total-calories').textContent=s.calories+' kcal';$('total-elevation').textContent=Number(s.elevationGain.toFixed(1))+' m';
 $('total-heart').textContent=s.averageHeartRate===null?'-':Math.round(s.averageHeartRate)+' bpm';$('total-cadence').textContent=s.cadence===null?'-':Math.round(s.cadence)+' spm';
 renderPeriod(view);renderLevel(view.overall.correctedDistance);
 $('previous').disabled=year===1&&month===0;$('next').disabled=year===9999&&month===11;
 const days=$('days');days.replaceChildren();const first=new Date(key+'-01T12:00:00');let count=28;while(M.dateValid(key+'-'+(count+1)))count++;
 for(let i=0;i<first.getDay();i++){const blank=element('div',undefined,'day empty');blank.setAttribute('aria-hidden','true');days.append(blank)}
 for(let n=1;n<=count;n++){
  const date=key+'-'+String(n).padStart(2,'0'),rows=data.records.filter(r=>r.date===date),sum=rows.reduce((s,r)=>s+M.recordDistance(r),0);
  const button=element('button',undefined,'day'+(rows.length?' ran':'')+(date===today?' current':'')+(date===selected?' selected':''));button.type='button';button.dataset.date=date;button.setAttribute('aria-pressed',String(date===selected));
  button.append(element('span',String(n)));if(rows.length){button.append(element('span',M.distance(sum),'km'));button.append(element('span',rows.length+'회','runs'))}
  button.setAttribute('aria-label',date+(date===today?' 오늘':'')+(rows.length?', 러닝 '+rows.length+'회, 보정 추정 거리 '+M.distance(sum)+'km':', 기록 없음, 기록 추가'));
  if(date===today)button.setAttribute('aria-current','date');button.addEventListener('click',()=>openDay(date));days.append(button);
 }
 $('export').disabled=blocked;$('import').disabled=blocked;
}
function openDay(date){selected=date;render();editing=null;$('record-form').hidden=true;renderDay();$('day-dialog').showModal();if(!data.records.some(r=>r.date===date))showForm()}
function renderDay(){
 $('day-title').textContent=selected+' 러닝';const list=$('record-list');list.replaceChildren();const rows=data.records.filter(r=>r.date===selected);
 rows.forEach(r=>{const card=element('article',undefined,'record');card.append(element('h3','보정 추정 거리 '+M.distance(M.recordDistance(r))+' km'));card.append(element('p','보정 추정 페이스 '+M.pace(r.durationSeconds/M.recordDistance(r))+' /km'));card.append(element('p','원본 '+M.distance(r.distance)+' km · '+M.duration(r.durationSeconds)));
 const labels={averageHeartRate:'평균 심박수',maxHeartRate:'최대 심박수',cadence:'평균 케이던스',calories:'소모 칼로리',elevationGain:'고도 상승'},units={averageHeartRate:'bpm',maxHeartRate:'bpm',cadence:'spm',calories:'kcal',elevationGain:'m'};
 const extras=M.optional.filter(k=>r[k]!==null).map(k=>labels[k]+' '+r[k]+units[k]);if(extras.length)card.append(element('p',extras.join(' · ')));if(r.note)card.append(element('p',r.note));
 const actions=element('div',undefined,'actions'),edit=element('button','수정'),del=element('button','삭제');edit.disabled=del.disabled=blocked;
 edit.addEventListener('click',()=>showForm(r));del.addEventListener('click',()=>{if(!confirm('이 러닝 기록을 삭제할까요? 백업이 없다면 복구할 수 없습니다.'))return;try{commit(M.remove(data,r.id));$('record-form').hidden=true;renderDay();message('기록을 삭제했습니다.')}catch(e){alert('삭제하지 못했습니다. '+e.message)}});actions.append(edit,del);card.append(actions);list.append(card)});
 $('add').disabled=blocked;
}
function showForm(r){editing=r?.id??null;$('record-form').reset();$('form-title').textContent=r?'러닝 기록 수정':'러닝 기록 추가';$('date').value=r?.date??selected;$('distance').value=r?.distance??'';$('minutes').value=r?Math.floor(r.durationSeconds/60):'';$('seconds').value=r?r.durationSeconds%60:'0';for(const k of M.optional)$ (k).value=r?.[k]??'';$('note').value=r?.note??'';resetOcr();$('form-error').textContent='';fields.forEach(k=>$(k).removeAttribute('aria-invalid'));$('record-form').hidden=false;preview();$('distance').focus()}
function formInput(){
 const input={id:editing??('run-'+crypto.randomUUID()),date:$('date').value,note:$('note').value};
 function read(key,decimal=false,optional=false){const text=$(key).value.trim();if(optional&&!text)return null;if(!(decimal?/^(?:\d+(?:\.\d*)?|\.\d+)$/:/^\d+$/).test(text)){const e=new Error('숫자를 확인해 주세요. 필수 항목은 비워둘 수 없습니다.');e.field=key;throw e}return Number(text)}
 input.distance=read('distance',true);const minutes=read('minutes'),seconds=read('seconds');if(seconds>59){const e=new Error('초는 0부터 59까지 입력해 주세요.');e.field='seconds';throw e}input.durationSeconds=minutes*60+seconds;
 for(const k of M.optional)input[k]=read(k,k==='elevationGain',true);return input;
}
function preview(){try{const r=M.record(formInput(),editing?data.records.find(r=>r.id===editing).appliedFactor:M.FACTOR);$('preview').textContent='보정 추정 거리 '+M.distance(r.correctedDistance)+' km · 보정 추정 페이스 '+M.pace(r.correctedPace)+' /km'}catch{$('preview').textContent='보정 추정 거리 — km'}}
$('record-form').addEventListener('input',event=>{fields.forEach(k=>$(k).removeAttribute('aria-invalid'));event.target.removeAttribute?.('data-ocr');preview()});
// Screenshot autofill only fills the form; the values are reviewed and saved by hand.
const OCR_LABELS={date:'날짜',distance:'거리',minutes:'시간',averageHeartRate:'평균 심박수',maxHeartRate:'최대 심박수',cadence:'케이던스',calories:'칼로리',elevationGain:'고도'};
let ocrRun=0;
function resetOcr(){ocrRun++;$('ocr-file').disabled=false;$('ocr-status').textContent='NRC 러닝 상세 화면 캡처를 고르면 아래 칸을 채워요.';fields.forEach(k=>$(k).removeAttribute('data-ocr'))}
function fillFromScreenshot(found){
 const filled=[],set=(k,v)=>{$(k).value=String(v);$(k).setAttribute('data-ocr','');filled.push(k)};
 if(found.date&&M.dateValid(found.date))set('date',found.date);
 if(found.distance!==null)set('distance',found.distance);
 if(found.seconds!==null){set('minutes',Math.floor(found.seconds/60));set('seconds',found.seconds%60)}
 for(const k of M.optional)if(found[k]!==null)set(k,found[k]);
 preview();
 const named=Object.keys(OCR_LABELS).filter(k=>filled.includes(k)).map(k=>OCR_LABELS[k]),missing=Object.keys(OCR_LABELS).filter(k=>k!=='date'&&!filled.includes(k)).map(k=>OCR_LABELS[k]);
 if(!named.length)return '캡처에서 기록을 찾지 못했습니다. NRC 러닝 상세 화면인지 확인해 주세요.';
 return named.join('·')+' 값을 채웠어요. 저장 전에 확인해 주세요.'+(missing.length?' 못 찾은 항목: '+missing.join(', ')+'.':'')+(found.date?'':' 캡처에 날짜가 없어 선택한 날짜('+$('date').value+')를 그대로 두었어요.')+(found.unit==='mi'?' 마일 거리를 km로 바꿨어요.':'');
}
$('ocr-file').addEventListener('change',async event=>{
 const file=event.target.files[0];if(!file)return;
 const run=++ocrRun,status=$('ocr-status'),year=Number(($('date').value||selected).slice(0,4));$('ocr-file').disabled=true;status.textContent='캡처를 읽는 중…';
 const progress=m=>{if(run===ocrRun)status.textContent=m.status==='recognizing text'?'글자 인식 중 '+Math.floor(m.progress*10)*10+'%':m.status==='checking numbers'?'숫자 확인 중…':'OCR 준비 중… 처음 한 번은 약 6MB를 내려받아요.'};
 try{const found=await NrcOcr.read(file,{year,onProgress:progress});if(run===ocrRun)status.textContent=fillFromScreenshot(found)}
 catch(e){if(run===ocrRun)status.textContent='캡처를 읽지 못했습니다. '+e.message}
 finally{if(run===ocrRun)$('ocr-file').disabled=false;event.target.value=''}
});
$('record-form').addEventListener('submit',event=>{event.preventDefault();try{const input=formInput(),twin=M.duplicate(data,M.record(input));
 // Only warns: saving anyway is one tap, so a second run on the same day is never blocked.
 if(twin&&!confirm('이 날짜에 거리('+M.distance(twin.distance)+' km)와 시간('+M.duration(twin.durationSeconds)+')이 같은 기록이 이미 있어요. 같은 캡처를 두 번 올렸을 수 있어요.\n그래도 저장할까요?')){$('form-error').textContent='같은 기록이 있어 저장하지 않았습니다.';return}
 commit(M.upsert(data,input));selected=input.date;year=Number(selected.slice(0,4));month=Number(selected.slice(5,7))-1;anchor=selected;render();$('record-form').hidden=true;renderDay();message('러닝 기록을 저장했습니다.');$('add').focus()}catch(e){$('form-error').textContent='저장하지 못했습니다. '+e.message;if(e.field){$(e.field).setAttribute('aria-invalid','true');$(e.field).setAttribute('aria-describedby','form-error');$(e.field).focus()}}});
$('add').addEventListener('click',()=>showForm());$('cancel').addEventListener('click',()=>{$('record-form').hidden=true;$('add').focus()});$('close').addEventListener('click',()=>$('day-dialog').close());$('day-dialog').addEventListener('close',()=>{const target=[...$('days').querySelectorAll('button')].find(b=>b.dataset.date===selected);(target??$('today')).focus()});
function move(delta){month+=delta;if(month<0){month=11;year--}if(month>11){month=0;year++}render()}
$('previous').addEventListener('click',()=>move(-1));$('next').addEventListener('click',()=>move(1));$('today').addEventListener('click',()=>{year=Number(today.slice(0,4));month=Number(today.slice(5,7))-1;render()});
$('export').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=element('a');a.href=url;a.download='running-backup-'+today+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('JSON 백업을 내보냈습니다.')});
$('import').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>100*1024*1024)throw new Error('100MB 이하 JSON 파일을 선택해 주세요.');const incoming=M.parse(await file.text()),result=M.merge(data,incoming);commit(result.data);message(result.added+'개 가져오기 완료 · 중복 '+result.skipped+'개 건너뜀')}catch(e){message('가져오지 못했습니다. '+e.message)}finally{event.target.value=''}});
// Prevent silent overwrites from another tab: reload before making further changes.
window.addEventListener('storage',event=>{if(event.key===M.KEY||event.key===null){blocked=true;$('storage-error').hidden=false;$('storage-error').textContent='다른 탭에서 기록이 변경되었습니다. 새로고침 후 계속해 주세요.';$('day-dialog').close();render()}});
render();


$('info-open').addEventListener('click',()=>$('info-dialog').showModal());
$('info-close').addEventListener('click',()=>$('info-dialog').close());
$('info-dialog').addEventListener('close',()=>$('info-open').focus());
// Size bottom sheets to the visible viewport when an iPhone keyboard is open.
function fitSheets(){const v=window.visualViewport;if(v){document.documentElement.style.setProperty('--sheet-height',Math.round(v.height*.94)+'px');document.documentElement.style.setProperty('--keyboard-inset',Math.max(0,window.innerHeight-v.height-v.offsetTop)+'px')}}
window.visualViewport?.addEventListener('resize',fitSheets);window.visualViewport?.addEventListener('scroll',fitSheets);fitSheets();

function renderPeriod(view){
 for(const type of ['week','month','year','all'])$('mode-'+type).setAttribute('aria-pressed',String(mode===type));
 for(const id of ['period-previous','period-next','period-today'])$(id).hidden=mode==='all';
 $('period-previous').disabled=view.period.start<='0001-01-01';$('period-next').disabled=view.period.end>='9999-12-31';
 const chart=$('distance-chart'),table=$('chart-table');chart.className='distance-chart'+(mode==='all'?' years':'');chart.replaceChildren();table.replaceChildren();
 const max=Math.max(1,...view.buckets.map(b=>b.value));chart.style.setProperty('--columns',Math.max(1,view.buckets.length));
 chart.setAttribute('aria-label',view.period.label+' 기간별 러닝 거리 그래프');
 $('chart-empty').hidden=view.periodStats.count!==0;
 for(const [i,b] of view.buckets.entries()){
  const column=element('div',undefined,'chart-column'),track=element('div',undefined,'bar-track'),bar=element('div',undefined,'bar');
  bar.style.height=(b.value/max*100)+'%';bar.title=b.key+' '+M.distance(b.value)+'km';track.append(bar);column.append(track);
  const show=mode!=='month'||i===0||(i+1)%5===0;
  column.append(element('span',show?b.label:'','bar-label'));column.setAttribute('aria-hidden','true');chart.append(column);
 }
 const grid=element('table'),caption=element('caption','기간별 보정 추정 거리'),head=element('tr');head.append(element('th',mode==='week'||mode==='month'?'날짜':'기간'),element('th','거리 (km)'));grid.append(caption,head);
 for(const b of view.buckets){const row=element('tr');row.append(element('th',b.key),element('td',M.distance(b.value)));grid.append(row)}table.append(grid);
}
function renderLevel(total){
 const state=M.level(total),root=document.documentElement,percent=state.next?Math.min(99,Math.round(state.progress*100)):100;
 root.style.setProperty('--level-color',state.current.color);root.style.setProperty('--level-ink',state.current.ink);root.style.setProperty('--level-tint',state.current.tint);
 const remaining=state.next?state.next.name+'까지 '+M.distance(state.remaining)+' km 남음':'최고 단계 퍼플을 달성했어요';
 $('level-name').textContent=state.current.name;$('level-card-total').textContent='전체 '+M.distance(total)+' km';$('level-meter-fill').style.width=(state.progress*100)+'%';
 $('level-card-remaining').textContent=state.next?remaining+' · '+percent+'%':remaining;
 $('level-open').setAttribute('aria-label','누적 러닝 레벨 '+state.current.name+', 전체 '+M.distance(total)+'km, '+remaining+', 상세 보기');
 $('level-badge').textContent=state.current.name;
 $('level-total').textContent='전체 누적 보정 추정 거리 '+M.distance(total)+' km';
 $('level-progress').value=state.progress*100;
 $('level-progress').setAttribute('aria-valuetext',percent+'%');$('level-percent').textContent='진행률 '+percent+'%';
 $('level-remaining').textContent=remaining;
 const list=$('level-list');list.replaceChildren();M.LEVELS.forEach((l,i)=>{const row=element('div',undefined,'level-row'),dot=element('span',undefined,'level-dot');dot.style.background=l.color;
 const text=element('div'),name=element('strong',l.name+(l.name===state.current.name?' · 현재':'')),range=element('p',l.start.toLocaleString('ko-KR')+'km 이상'+(M.LEVELS[i+1]?' · '+M.LEVELS[i+1].start.toLocaleString('ko-KR')+'km 미만':''),'hint');text.append(name,range);row.append(dot,text,element('span',total>=l.start?'달성':'미달성','hint'));list.append(row)});
}
function setMode(type){mode=type;if(mode==='month'){year=Number(anchor.slice(0,4));month=Number(anchor.slice(5,7))-1}render()}
function movePeriod(delta){let next=M.shiftPeriod(mode,anchor,delta);if(!M.dateValid(next))return;if(mode!=='week')next=monthAnchor(next.slice(0,7));anchor=next;year=Number(next.slice(0,4));month=Number(next.slice(5,7))-1;render()}
for(const type of ['week','month','year','all'])$('mode-'+type).addEventListener('click',()=>setMode(type));
$('period-previous').addEventListener('click',()=>movePeriod(-1));$('period-next').addEventListener('click',()=>movePeriod(1));
$('period-today').addEventListener('click',()=>{anchor=today;year=Number(today.slice(0,4));month=Number(today.slice(5,7))-1;render()});
$('level-open').addEventListener('click',()=>$('level-dialog').showModal());$('level-close').addEventListener('click',()=>$('level-dialog').close());$('level-dialog').addEventListener('close',()=>$('level-open').focus());
