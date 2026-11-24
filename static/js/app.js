let currentIpExport = null, currentPhoneExport = null, overviewMap = null, ipMap = null, lastIp = null;
const $ = id => document.getElementById(id);
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
function esc(s){return String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function showView(name){
 document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
 $('view-'+name).classList.add('active');
 document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.view===name));
 const titles={dashboard:'Overview',ip:'IP Intelligence',phone:'Phone Intelligence',history:'Investigation History',settings:'Settings & Ethics'};
 $('page-title').textContent=titles[name];$('crumb').textContent=titles[name].toUpperCase();
 if(name==='history')loadHistory(); if(name==='dashboard')loadOverview();
}
document.querySelectorAll('.nav').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.go)));
function detailHTML(obj, labels){return Object.entries(labels).map(([k,label])=>`<div class="detail-item"><small>${esc(label)}</small><b>${esc(obj[k]||'Not available')}</b></div>`).join('')}
function initMap(id, lat, lon, zoom=4){
 if(!window.L){$(id).innerHTML='<div style="padding:25px;color:#a0b2c5">Map library unavailable. Check internet access.</div>';return null}
 const map=L.map(id,{scrollWheelZoom:false}).setView([lat,lon],zoom);
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; OpenStreetMap'}).addTo(map);
 return map;
}
function marker(map,lat,lon,label){if(map){L.marker([lat,lon]).addTo(map).bindPopup(esc(label)).openPopup();map.setView([lat,lon],7)}}
function renderOverviewMap(lat,lon,label){
 if(!overviewMap){overviewMap=initMap('map',lat,lon,3)}
 if(overviewMap){marker(overviewMap,lat,lon,label)}
 $('map-coords').textContent=`${Number(lat).toFixed(3)}, ${Number(lon).toFixed(3)}`;
}
async function post(url,data){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw new Error(j.error||'Request failed');return j}
$('ip-submit').addEventListener('click',async()=>{
 const ip=$('ip-input').value.trim();if(!ip){$('ip-error').textContent='Enter an IP address first.';$('ip-error').classList.remove('hidden');return}
 const btn=$('ip-submit');btn.disabled=true;btn.textContent='Analyzing…';$('ip-error').classList.add('hidden');$('ip-results').classList.add('hidden');
 try{
  const d=await post('/api/ip',{ip});lastIp=d;currentIpExport=null;
  $('ip-result-title').textContent=d.ip;
  $('ip-details').innerHTML=detailHTML(d,{ip:'IP ADDRESS',type:'ADDRESS TYPE',continent:'CONTINENT',country:'COUNTRY',country_code:'COUNTRY CODE',region:'REGION',city:'CITY',postal:'POSTAL CODE',timezone:'TIME ZONE',isp:'ISP',organization:'ORGANIZATION',asn:'ASN',domain:'NETWORK DOMAIN',provider:'DATA PROVIDER'});
  $('ip-results').classList.remove('hidden');
  if(d.latitude!=null&&d.longitude!=null){if(ipMap){ipMap.remove();ipMap=null}setTimeout(()=>{ipMap=initMap('ip-map',d.latitude,d.longitude,7);marker(ipMap,d.latitude,d.longitude,`${d.city||''}, ${d.country||''}`);},80);renderOverviewMap(d.latitude,d.longitude,`${d.city||''}, ${d.country||''}`);$('ip-map-caption').textContent=`${d.latitude}, ${d.longitude} · Approximate network position`;}
  loadOverview();toast('IP analysis completed');
 }catch(e){$('ip-error').textContent=e.message;$('ip-error').classList.remove('hidden')}
 finally{btn.disabled=false;btn.innerHTML='Analyze IP <span>→</span>'}
});
$('ip-input').addEventListener('keydown',e=>{if(e.key==='Enter')$('ip-submit').click()});
$('phone-submit').addEventListener('click',async()=>{
 const phone=$('phone-input').value.trim();if(!phone){$('phone-error').textContent='Enter a phone number first.';$('phone-error').classList.remove('hidden');return}
 const btn=$('phone-submit');btn.disabled=true;btn.textContent='Analyzing…';$('phone-error').classList.add('hidden');$('phone-results').classList.add('hidden');
 try{
  const d=await post('/api/phone',{phone});currentPhoneExport=null;
  $('phone-validity').className='validation-banner '+(d.valid?'valid':'invalid');
  $('phone-validity').textContent=d.valid?'✓ Valid number according to current numbering metadata':(d.possible?'! Possible number, but not valid in current metadata':'! Number is not considered possible/valid');
  $('phone-details').innerHTML=detailHTML(d,{international_format:'INTERNATIONAL FORMAT',national_format:'NATIONAL FORMAT',e164:'E.164 FORMAT',country_code:'COUNTRY CALLING CODE',national_number:'NATIONAL NUMBER',region:'NUMBERING REGION',carrier:'CARRIER METADATA',number_type:'NUMBER TYPE',time_zones:'ASSOCIATED TIME ZONES',possible:'POSSIBLE NUMBER',valid:'VALID NUMBER'});
  $('phone-results').classList.remove('hidden');loadOverview();toast('Phone metadata analysis completed');
 }catch(e){$('phone-error').textContent=e.message;$('phone-error').classList.remove('hidden')}
 finally{btn.disabled=false;btn.innerHTML='Analyze number <span>→</span>'}
});
$('phone-input').addEventListener('keydown',e=>{if(e.key==='Enter')$('phone-submit').click()});
$('ip-export').addEventListener('click',()=>{if(lastIp)downloadJSON(lastIp,'loc-ip-analysis.json')});
$('phone-export').addEventListener('click',()=>{toast('Use Investigation History to export the saved record as JSON.')});
function downloadJSON(data,name){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download=name;a.click();URL.revokeObjectURL(a.href)}
async function loadOverview(){
 try{const rows=await (await fetch('/api/history')).json();$('total-count').textContent=rows.length;$('ip-count').textContent=rows.filter(x=>x.kind==='IP').length;$('phone-count').textContent=rows.filter(x=>x.kind==='PHONE').length;
  const recent=rows.slice(0,5);$('recent-list').className='recent-list'+(recent.length?'':' empty');
  $('recent-list').innerHTML=recent.length?recent.map(r=>`<div class="history-row"><span class="kind ${r.kind==='PHONE'?'phone':''}">${r.kind}</span><b>${esc(r.query)}</b><small>${esc(new Date(r.created_at).toLocaleString())}</small><span></span><span></span></div>`).join(''):'No investigations yet. Start with an IP or phone analysis.';
 }catch(e){}
}
async function loadHistory(){
 const box=$('history-list');try{const rows=await (await fetch('/api/history')).json();box.className='history-list'+(rows.length?'':' empty');
 box.innerHTML=rows.length?rows.map(r=>`<div class="history-row"><span class="kind ${r.kind==='PHONE'?'phone':''}">${r.kind}</span><b>${esc(r.query)}</b><small>${esc(r.kind==='IP'?(JSON.parse(r.result).city||JSON.parse(r.result).country||'IP lookup'):(JSON.parse(r.result).region||'Phone analysis'))}</small><small class="history-date">${esc(new Date(r.created_at).toLocaleString())}</small><span class="row-actions history-actions"><a href="/api/export/${r.id}">JSON ↓</a><button data-delete="${r.id}">Delete</button></span></div>`).join(''):'No records available.';
 box.querySelectorAll('[data-delete]').forEach(b=>b.addEventListener('click',async()=>{await fetch('/api/history/'+b.dataset.delete,{method:'DELETE'});loadHistory();loadOverview();toast('Record deleted')}));
 }catch(e){box.textContent='Unable to load history.'}
}
$('clear-history').addEventListener('click',async()=>{if(!confirm('Delete all locally stored investigation records?'))return;await fetch('/api/history/clear',{method:'DELETE'});loadHistory();loadOverview();toast('History cleared')});
loadOverview();
