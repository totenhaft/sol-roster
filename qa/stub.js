/* QA stub: runs the app on a copy of the live data inside a sandboxed frame. Nothing is sent anywhere: every save is answered here. */
(function(){
  var R={errors:[],checks:[],calls:[]};window.__R=R;
  window.addEventListener('error',function(e){R.errors.push(String(e.message)+' @'+e.lineno)});
  window.addEventListener('unhandledrejection',function(e){R.errors.push('rejection: '+String(e.reason&&e.reason.message||e.reason))});
  function mem(init){var m=Object.assign({},init||{});return {getItem:function(k){return k in m?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]||null},get length(){return Object.keys(m).length}}}
  try{Object.defineProperty(window,'sessionStorage',{value:mem({'solroster2-auth':JSON.stringify({pin:'qa-stub',remember:false})}),configurable:true})}catch(e){R.errors.push('ss '+e.message)}
  try{Object.defineProperty(window,'localStorage',{value:mem(),configurable:true})}catch(e){R.errors.push('ls '+e.message)}
  window.SOL_ROSTER_API='https://qa.stub/exec';
  window.fetch=function(u,o){var b={};try{b=JSON.parse(o&&o.body||'{}')}catch(e){}var a=b.action,res;R.calls.push(a);
    if(a==='load'){res=JSON.parse(JSON.stringify(window.__LIVE));res.me={role:'admin',name:'QA'}}
    else if(a==='status')res={ok:true,version:22,hasAdmin:true}
    else if(a==='att')res={ok:true,att:null}
    else if(a==='history')res={ok:true,items:[]}
    else res={ok:true,updatedAt:Date.now(),updatedBy:'QA'};
    return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(res)},text:function(){return Promise.resolve(JSON.stringify(res))}})};
})();
