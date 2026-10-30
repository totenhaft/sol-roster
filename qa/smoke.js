(async function(){
  var R=window.__R;function ok(c,m){R.checks.push((c?'PASS ':'FAIL ')+m)}
  var wait=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var q=function(s){return document.querySelector(s)},qa=function(s){return Array.prototype.slice.call(document.querySelectorAll(s))};
  var txt=function(el){return el?el.textContent.replace(/\s+/g,' ').trim():''};
  function pageText(){var out=[],w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null),n;while((n=w.nextNode())){var p=n.parentNode&&n.parentNode.nodeName;if(p==='SCRIPT'||p==='STYLE'||p==='TEMPLATE')continue;out.push(n.nodeValue)}
    qa('input,textarea,select').forEach(function(el){out.push(el.value||'');if(el.placeholder)out.push(el.placeholder)});qa('[aria-label],[title]').forEach(function(el){out.push(el.getAttribute('aria-label')||'');out.push(el.getAttribute('title')||'')});return out.join(' ')}
  function badText(){var t=pageText();var m=t.match(/\bNaN\b|\bundefined\b|\[object Object\]|\bInfinity\b|\bnull(?=[명시일분])/g);return m?Array.from(new Set(m)).join(','):''}
  function ymNow(){var e=q('.mlabel')||qa('b,h1,h2,span,strong').find(function(x){return /^\d{4}년 \d+월$/.test(x.textContent.trim())});return e?e.textContent.trim():''}
  async function tab(k){var b=q('[data-act="tab"][data-k="'+k+'"]');if(!b)return false;b.click();await wait(120);return true}
  async function goMonth(ym){for(var i=0;i<30;i++){var cur=ymNow(),c=cur.match(/\d+/g).map(Number),t=ym.split('-').map(Number);if(c[0]===t[0]&&c[1]===t[1])return true;var b=q('[data-act="month"][data-k="'+((t[0]*12+t[1])>(c[0]*12+c[1])?1:-1)+'"]');if(!b)return false;b.click();await wait(150)}return false}
  try{
  for(var i=0;i<40&&!q('[data-act="tab"]');i++)await wait(250);
  ok(!!q('[data-act="tab"][data-k="att"]'),'opens as 관리자 on the stub (tabs: '+qa('[data-act="tab"]').map(txt).join(',')+')');
  var L=window.__LIVE.data,TY={W:1,N:1,HA:1,HP:1,HN:1,V:1,O:1,OT:1,OTD:1,SUB:1,Q1:1,Q2:1,Q3:1,Q4:1,Q1N:1,Q2N:1,Q3N:1,Q4N:1};(L.config.types||[]).forEach(function(t){TY[t.id]=1});
  /* data checks */
  var badCodes=[],badAdj=[],badPlace=[],badNight=[];
  Object.keys(L.sched).forEach(function(ym){Object.keys(L.sched[ym]).forEach(function(tid){var ro=L.sched[ym][tid],tm=L.teams[tid],posts={};((tm&&tm.posts)||[]).forEach(function(x){posts[x.id]=1});
    Object.keys(ro.cells||{}).forEach(function(sid){Object.keys(ro.cells[sid]).forEach(function(iso){var v=ro.cells[sid][iso];if(v&&!TY[v])badCodes.push(ym+' '+sid+' '+iso+' '+v)})});
    Object.keys(ro.adj||{}).forEach(function(sid){Object.keys(ro.adj[sid]).forEach(function(iso){var a=ro.adj[sid][iso],v=(ro.cells[sid]||{})[iso]||'';if(a.d&&v!=='OTD')badAdj.push(iso+' '+sid+' d-entry on '+(v||'근무'));(a.n||[]).forEach(function(n){var m=n.slice(0,7),r2=L.sched[m]&&L.sched[m][tid],c=r2&&r2.cells&&r2.cells[sid]&&r2.cells[sid][n];if(c&&!/N$/.test(c))badNight.push(iso+' uses '+n+' ('+c+')')})})});
    Object.keys(ro.place||{}).forEach(function(sid){Object.keys(ro.place[sid]).forEach(function(iso){String(ro.place[sid][iso]).split('|').forEach(function(x){if(x&&x!=='-'&&!posts[x])badPlace.push(iso+' '+sid+' '+x)})})})})});
  ok(!badCodes.length,'data: every cell code is known '+badCodes.slice(0,3).join('; '));
  ok(!badAdj.length,'data: 대체오프 sources only on 대체오프 days '+badAdj.slice(0,3).join('; '));
  ok(!badNight.length,'data: 야간 대체 points at night days '+badNight.slice(0,3).join('; '));
  ok(!badPlace.length,'data: places point at existing 자리 '+badPlace.slice(0,3).join('; '));
  var months=['2026-09','2026-10','2026-11','2026-12','2027-01'];
  for(var mi=0;mi<months.length;mi++){var ym=months[mi];
    await tab('roster');var moved=await goMonth(ym);if(!moved){ok(false,ym+' could not open');continue}
    var cal=q('[data-act="rv"][data-k="cal"]');if(cal){cal.click();await wait(120)}
    var b=badText(),cds=qa('.cd').length;ok(cds>0&&!b,ym+' 달력 ('+cds+'칸)'+(b?' 이상한 글자:'+b:''));
    var days=qa('.cd-date[data-day]').map(function(e){return e.dataset.day}).filter(function(d){return d.indexOf(ym)===0}),secs=Array.from(new Set(qa('.cd[data-sec]').map(function(e){return e.dataset.sec}))),paneBad=[];
    for(var di_=0;di_<days.length;di_+=2){for(var si=0;si<secs.length;si++){var c=q('.cd[data-day="'+days[di_]+'"][data-sec="'+secs[si]+'"]');if(!c)continue;c.click();await wait(10);var bb=badText();if(bb)paneBad.push(days[di_]+' '+secs[si]+' '+bb)}
      var dd=q('.cd-date[data-day="'+days[di_]+'"]');if(dd){dd.click();await wait(10);var b2=badText();if(b2)paneBad.push(days[di_]+' 날짜 '+b2)}}
    ok(!paneBad.length,ym+' 칸 눌러 열기 '+days.length+'일×'+secs.length+'줄'+(paneBad.length?' '+paneBad.slice(0,3).join('; '):''));
    var cl=q('[data-act="dayClose"]');if(cl){cl.click();await wait(40)}
    var tv=q('[data-act="rv"][data-k="table"]');if(tv){tv.click();await wait(150);b=badText();ok(qa('.k').length>0&&!b,ym+' 표 보기'+(b?' '+b:''));var cv=q('[data-act="rv"][data-k="cal"]');if(cv){cv.click();await wait(100)}}
    var led=q('#ledger');ok(!!led&&!/NaN|undefined/.test(txt(led)),ym+' 연차·OT 현황 ('+(led?led.querySelectorAll('tbody tr').length:0)+'줄)');
    await tab('place');var wk=q('[data-act="pView"][data-k="week"]');if(wk){wk.click();await wait(100)}
    var plBad=[];for(var w=0;w<6;w++){b=badText();if(b)plBad.push(txt(q('.pnav b'))+' '+b);
      if(w===1){var pc=q('.pboard td.pc');if(pc){pc.click();await wait(40);var hk=['am','pm','all'];for(var hi=0;hi<3;hi++){var hb=q('#dayed [data-act="pHalf"][data-k="'+hk[hi]+'"]');if(hb){hb.click();await wait(30);var b3=badText();if(b3)plBad.push('editor '+hk[hi]+' '+b3)}}var pcl=q('[data-act="pClose"]');if(pcl){pcl.click();await wait(30)}}}
      var nx=q('[data-act="pStep"][data-k="1"]');if(!nx)break;nx.click();await wait(80)}
    var dv=q('[data-act="pView"][data-k="day"]');if(dv){dv.click();await wait(80);b=badText();if(b)plBad.push('day '+b);q('[data-act="pView"][data-k="week"]').click();await wait(60)}
    ok(!plBad.length,ym+' 근무 배치 (주·하루·오전/오후 편집)'+(plBad.length?' '+plBad.slice(0,3).join('; '):''));
    var tabs=['teams','hours','types','rules','att'],tb=[];for(var ti=0;ti<tabs.length;ti++){await tab(tabs[ti]);await wait(60);b=badText();if(b)tb.push(tabs[ti]+' '+b)}
    ok(!tb.length,ym+' 다른 탭 (팀·직원, 진료 시간, 근무 형태, 생성 조건, 근태)'+(tb.length?' '+tb.join('; '):''));
  }
  /* 팀·직원: 달별 설정 드롭다운 */
  await tab('teams');var sel=q('select[data-avsel]');ok(!!sel,'팀·직원: 달별 설정 드롭다운 ('+qa('select[data-avsel]').length+'명)');
  if(sel){sel.value='2026-12';sel.dispatchEvent(new Event('change',{bubbles:true}));await wait(100);ok(!badText(),'달별 설정 12월 고르기')}
  /* 자동 생성 on a copy: 2027년 1월 (달별 요일 따르는지) */
  await tab('roster');await goMonth('2027-01');var g=q('[data-act="gen"]');if(g){g.click();await wait(2500);var go=q('[data-act="genGo"],[data-act="genOk"]');if(go){go.click();await wait(2500)}}
  var tv2=q('[data-act="rv"][data-k="table"]');if(tv2){tv2.click();await wait(200)}
  var viol=[],DOW=['일','월','화','수','목','금','토'];
  Object.keys(L.teams).forEach(function(tid){L.teams[tid].staff.forEach(function(p){var mo=(p.mo||{})['2027-01'],av=mo?mo.a:p.avail;
    qa('.k[aria-label^="'+p.name+' 1월 "]').forEach(function(k){var lb=k.getAttribute('aria-label'),m=lb.match(/1월 (\d+)일 (.)요일 (\S+)/);if(!m)return;var dw=DOW.indexOf(m[2]);if(av.indexOf(dw)<0&&/^(근무|야간)/.test(m[3]))viol.push(lb)})})});
  ok(!viol.length,'자동 생성(2027년 1월, 사본): 근무 가능 요일·달별 설정 지킴'+(viol.length?' '+viol.slice(0,3).join('; '):''));
  ok(!badText(),'자동 생성 뒤 표 보기');
  }catch(e){R.errors.push('harness: '+e.message+' '+(e.stack||'').split('\n')[1])}
  R.saves=R.calls.filter(function(a){return /^save/.test(a)}).length;R.done=true;
  try{parent.postMessage({qa:{errors:R.errors,checks:R.checks,saves:R.saves,calls:Array.from(new Set(R.calls))}},'*')}catch(e){}
})();
