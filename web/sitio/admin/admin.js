/* ===========================================================
   JW Marriott — Panel de administración (recepción / ADMIN)
   API en mismo origen (/api) vía proxy nginx -> gateway.
   =========================================================== */
"use strict";
const API = "";
const S = { token:null, usuario:null, roles:[], vista:"dashboard", timer:null,
            auto:true, rango:{desde:null,hasta:null}, charts:[],
            cache:{ habitaciones:[], paquetes:[], tours:[], reservas:[], clientes:[] } };

const $=(s,c=document)=>c.querySelector(s);
const $$=(s,c=document)=>[...c.querySelectorAll(s)];
const soles=n=>"S/ "+Number(n||0).toLocaleString("es-PE",{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

async function api(path,opt={}){
  const h=Object.assign({"Content-Type":"application/json"},opt.headers||{});
  if(S.token) h["Authorization"]="Bearer "+S.token;
  const r=await fetch(API+path,Object.assign({},opt,{headers:h}));
  const t=await r.text(); let d=null; try{d=t?JSON.parse(t):null;}catch{d=t;}
  if(!r.ok) throw {status:r.status,data:d};
  return d;
}
function arr(v){ return Array.isArray(v)?v:(v&&(v.disponibles||v.content||v.data||v.items||v.habitaciones||[]))||[]; }
function toast(msg,err){ const t=document.createElement("div"); t.className="toast"+(err?" err":""); t.textContent=msg;
  document.body.appendChild(t); setTimeout(()=>t.remove(),3500); }

/* ================= AUTH ================= */
async function login(e){
  e&&e.preventDefault();
  const u=$("#u").value.trim(), c=$("#c").value;
  const btn=$("#btnLogin"); btn.disabled=true; btn.innerHTML='<span class="spin"></span>';
  $("#loginMsg").innerHTML="";
  try{
    const d=await api("/api/v1/auth/token",{method:"POST",body:JSON.stringify({usuario:u,clave:c})});
    const roles=d.roles||[];
    if(!roles.includes("ADMIN")){
      $("#loginMsg").innerHTML='<div class="msg err">Esta cuenta no tiene permisos de administrador.</div>';
      btn.disabled=false; btn.textContent="Ingresar"; return;
    }
    S.token=d.access_token||d.token; S.usuario=d.usuario||u; S.roles=roles;
    entrar();
  }catch(ex){
    $("#loginMsg").innerHTML='<div class="msg err">'+(ex.status===401?"Usuario o clave incorrectos.":"No se pudo conectar con la API.")+'</div>';
    btn.disabled=false; btn.textContent="Ingresar";
  }
}
function salir(){ S.token=null; S.roles=[]; clearInterval(S.timer); render(); }

function entrar(){
  $("#loginView").hidden=true;
  $("#appView").hidden=false;
  $("#quien").textContent=S.usuario;
  irA("dashboard");
}

/* ================= NAVEGACIÓN ================= */
const VISTAS=[
  ["dashboard","Dashboard","▦"],
  ["habitaciones","Habitaciones","🛏"],
  ["paquetes","Paquetes","🎁"],
  ["tours","Tours","🗺"],
  ["reservas","Reservas","📋"],
  ["clientes","Clientes","👤"],
];
function irA(v){
  S.vista=v; clearInterval(S.timer);
  $$(".nav a").forEach(a=>a.classList.toggle("active",a.dataset.v===v));
  const main=$("#main"); main.innerHTML='<div class="loading"><span class="spin"></span> Cargando…</div>';
  if(v==="dashboard") verDashboard();
  else if(v==="habitaciones") verHabitaciones();
  else if(v==="paquetes") verPaquetes();
  else if(v==="tours") verTours();
  else if(v==="reservas") verReservas();
  else if(v==="clientes") verClientes();
}

/* ================= DASHBOARD ================= */
async function cargarTodo(){
  const [h,p,t]=await Promise.allSettled([
    api("/api/v1/habitaciones"), api("/api/v1/paquetes"), api("/api/v1/tours")
  ]);
  S.cache.habitaciones = h.status==="fulfilled"?arr(h.value):[];
  S.cache.paquetes = p.status==="fulfilled"?arr(p.value):[];
  S.cache.tours = t.status==="fulfilled"?arr(t.value):[];
  // Reservas: intentar el endpoint de "todas" (si el backend lo tiene)
  try{ const rv=await api("/api/v1/reservas/todas"); S.cache.reservas=arr(rv); S.reservasOk=true; }
  catch{ S.reservasOk=false; }
  // Clientes
  try{ const cl=await api("/api/v1/clientes"); S.cache.clientes=arr(cl); }catch{ S.cache.clientes=[]; }
  // Salud de los microservicios (agregador del gateway)
  try{ S.cache.salud=await api("/api/v1/salud"); S.saludOk=true; }
  catch{ S.saludOk=false; S.cache.salud=null; }
}

function disp(h){ return !(h.disponible===false||/MANTEN|OCUP/i.test(h.estado||"")); }
function tipoHab(h){ return (h.tipo||h.categoria||"").toString().toUpperCase(); }
function precioHab(h){ return h.tarifa_noche??h.tarifaNoche??h.precioNoche??h.precio??0; }

async function verDashboard(){
  // rango por defecto: últimos 14 días
  if(!S.rango.desde){ const d=ultimosDias(14); S.rango.desde=d[0]; S.rango.hasta=d[d.length-1]; }
  try{ await cargarTodo(); }catch(e){ $("#main").innerHTML=err(e); return; }
  pintarDashboard();
  programarAuto();
}
function programarAuto(){
  clearInterval(S.timer); S.timer=null;
  if(S.auto){
    S.timer=setInterval(async()=>{
      if(S.vista!=="dashboard"){ return; }
      // modo "live": el rango sigue a los últimos 14 días
      const d=ultimosDias(14); S.rango.desde=d[0]; S.rango.hasta=d[d.length-1];
      try{ await cargarTodo(); if(S.vista==="dashboard") pintarDashboard(); }catch{}
    },20000);
  }
}
/* --- controles del filtro (estilo SIEM) --- */
function toggleAuto(on){
  S.auto=on;
  if(on){ const d=ultimosDias(14); S.rango.desde=d[0]; S.rango.hasta=d[d.length-1]; }
  verDashboard(); // recarga + reprograma timer
}
function aplicarRango(){
  const d=$("#fDesde").value, h=$("#fHasta").value;
  if(!d||!h){ toast("Elige fecha inicio y fin",true); return; }
  if(d>h){ toast("La fecha inicio no puede ser mayor que la fin",true); return; }
  S.rango.desde=d; S.rango.hasta=h;
  pintarDashboard();
}
function rangoRapido(n){
  if(S.auto){ $("#chkAuto").checked=false; S.auto=false; clearInterval(S.timer); S.timer=null; }
  const d=ultimosDias(n); S.rango.desde=d[0]; S.rango.hasta=d[d.length-1];
  pintarDashboard();
}
/* genera el array de días YYYY-MM-DD entre desde y hasta (inclusive) */
function diasRango(desde,hasta){
  const a=[]; const d=new Date(desde+"T00:00:00"), f=new Date(hasta+"T00:00:00");
  for(let x=new Date(d); x<=f; x.setDate(x.getDate()+1)) a.push(x.toISOString().slice(0,10));
  return a.length?a:ultimosDias(14);
}
/* una reserva "cuenta" en el día de su creación (o, si no hay, el check-in) */
function diaDe(r){ return fechaCreada(r) || (r.desde||"").slice(0,10); }

function pintarDashboard(){
  const H=S.cache.habitaciones, Rall=S.cache.reservas, C=S.cache.clientes;
  // filtrar reservas al rango activo
  const R = S.reservasOk ? Rall.filter(r=>{ const dd=diaDe(r); return dd>=S.rango.desde && dd<=S.rango.hasta; }) : [];
  const dispo=H.filter(disp).length, mant=H.length-dispo;
  const confirmadas=R.filter(r=>/CONFIRM/i.test(r.estado||"")).length;
  const canceladas=R.filter(r=>/CANCEL/i.test(r.estado||"")).length;
  const ingresos=R.filter(r=>/CONFIRM/i.test(r.estado||"")).reduce((a,r)=>a+Number(r.total||0),0);
  const ocupacion = H.length? Math.round((mant/H.length)*100):0;

  const kReservas = S.reservasOk
    ? `<div class="kpi"><div class="lbl">Reservas confirmadas</div><div class="val ok num">${confirmadas}</div><div class="sub">${canceladas} canceladas · en rango</div></div>
       <div class="kpi"><div class="lbl">Ingresos confirmados</div><div class="val oro num">${soles(ingresos)}</div><div class="sub">confirmadas en rango</div></div>`
    : `<div class="kpi"><div class="lbl">Reservas</div><div class="val num">—</div><div class="sub">endpoint no disponible</div></div>
       <div class="kpi"><div class="lbl">Ingresos</div><div class="val num">—</div><div class="sub">requiere /reservas/todas</div></div>`;

  const estadoLive = S.auto
    ? `<span class="live"><span class="dot"></span> EN VIVO · cada 20 s</span>`
    : `<span class="paused">⏸ PAUSADO · filtro manual</span>`;

  $("#main").innerHTML=`<div class="view">
    <div class="topbar"><h1>Dashboard</h1>
      <div class="meta">${estadoLive} · ${new Date().toLocaleTimeString("es-PE")}</div></div>

    <div class="filtro-siem">
      <label class="chk"><input type="checkbox" id="chkAuto" ${S.auto?"checked":""}> Actualización automática (20&nbsp;s)</label>
      <div class="rango">
        <span class="fl2">Desde</span><input type="date" class="in sm" id="fDesde" value="${S.rango.desde}" ${S.auto?"disabled":""}>
        <span class="fl2">Hasta</span><input type="date" class="in sm" id="fHasta" value="${S.rango.hasta}" ${S.auto?"disabled":""}>
        <button class="btn sm oro" id="btnAplicar" ${S.auto?"disabled":""}>Aplicar</button>
      </div>
      <div class="atajos">
        <button class="btn sm ghost" data-n="1">Hoy</button>
        <button class="btn sm ghost" data-n="7">7 días</button>
        <button class="btn sm ghost" data-n="14">14 días</button>
        <button class="btn sm ghost" data-n="30">30 días</button>
      </div>
    </div>

    ${bloqueSalud()}

    <div class="kpis">
      <div class="kpi"><div class="lbl">Habitaciones disponibles</div><div class="val ok num">${dispo}</div><div class="sub">de ${H.length} totales</div></div>
      <div class="kpi"><div class="lbl">En mantenimiento / ocupadas</div><div class="val navy num">${mant}</div><div class="sub">${ocupacion}% del total</div></div>
      ${kReservas}
      <div class="kpi"><div class="lbl">Clientes registrados</div><div class="val num">${C.length||"—"}</div><div class="sub">en el sistema</div></div>
      <div class="kpi"><div class="lbl">Paquetes activos</div><div class="val num">${S.cache.paquetes.filter(p=>p.activo!==false).length}</div><div class="sub">${S.cache.tours.length} tours</div></div>
    </div>
    <div class="charts">
      <div class="card"><h3>Habitaciones por tipo</h3><div class="csub">Distribución del inventario</div>
        <div class="chart-box"><canvas id="chTipo"></canvas></div></div>
      <div class="card"><h3>Reservas por día</h3>
        <div class="csub">${S.reservasOk?rotuloRango():"Requiere /reservas/todas"}</div>
        <div class="chart-box"><canvas id="chResLinea"></canvas></div></div>
    </div>
    ${S.reservasOk?`<div class="charts">
      <div class="card"><h3>Reservas por día</h3><div class="csub">Conteo diario · ${rotuloRango()}</div><div class="chart-box"><canvas id="chResBar"></canvas></div></div>
      <div class="card"><h3>Ingresos por día</h3><div class="csub">Reservas confirmadas · ${rotuloRango()}</div><div class="chart-box"><canvas id="chIng"></canvas></div></div>
    </div>`:""}
  </div>`;

  // listeners del filtro
  $("#chkAuto")?.addEventListener("change",e=>toggleAuto(e.target.checked));
  $("#btnAplicar")?.addEventListener("click",aplicarRango);
  $$(".atajos button").forEach(b=>b.addEventListener("click",()=>rangoRapido(+b.dataset.n)));

  dibujarGraficos(R);
}
function rotuloRango(){ return `${S.rango.desde} → ${S.rango.hasta}`; }

/* --- tarjeta de disponibilidad de servicios (estilo SIEM) --- */
function bloqueSalud(){
  if(!S.saludOk || !S.cache.salud){
    return `<div class="salud card">
      <div class="salud-h"><h3>Estado de los servicios</h3>
        <span class="salud-sum down">SIN DATOS</span></div>
      <div class="csub">No se pudo consultar <b>/api/v1/salud</b> (requiere el agregador en el gateway).</div></div>`;
  }
  const d=S.cache.salud;
  const nodos=[d.gateway, ...(d.servicios||[])].filter(Boolean);
  const sumCls = d.resumen==="OPERATIVO"?"ok":(d.resumen==="CAIDO"?"down":"warn");
  const chips=nodos.map(n=>{
    const up=n.estado==="UP";
    return `<div class="svc ${up?"up":"down"}">
      <span class="svc-dot"></span>
      <div class="svc-info"><b>${esc(n.nombre)}</b>
        <span>${up?`${n.latencia_ms} ms`:"sin respuesta"}</span></div>
    </div>`;
  }).join("");
  return `<div class="salud card">
    <div class="salud-h">
      <h3>Estado de los servicios</h3>
      <span class="salud-sum ${sumCls}">${esc(d.resumen)} · ${d.arriba}/${d.total}</span>
    </div>
    <div class="csub">Microservicios del SOA · consulta al gateway en vivo</div>
    <div class="svc-grid">${chips}</div>
  </div>`;
}

function destruirGraficos(){ S.charts.forEach(c=>{try{c.destroy();}catch{}}); S.charts=[]; }

function dibujarGraficos(R){
  destruirGraficos();
  const col={oro:"#c9a35a",navy:"#3d6aa5",ok:"#3ec97a",err:"#e5737d",grid:"#2a3a4f",txt:"#93a1b5"};
  Chart.defaults.color=col.txt; Chart.defaults.borderColor=col.grid; Chart.defaults.font.family="Jost,sans-serif";
  // Habitaciones por tipo
  const tipos=["SIMPLE","DOBLE","SUITE","PRESIDENCIAL"];
  const porTipo=tipos.map(t=>S.cache.habitaciones.filter(h=>tipoHab(h)===t).length);
  S.charts.push(new Chart($("#chTipo"),{type:"doughnut",data:{labels:["Simple","Doble","Suite","Presidencial"],
    datasets:[{data:porTipo,backgroundColor:[col.navy,"#5a86bd",col.oro,col.err],borderWidth:0}]},
    options:{plugins:{legend:{position:"bottom"}},cutout:"62%",maintainAspectRatio:false}}));

  if(S.reservasOk){
    const dias=diasRango(S.rango.desde,S.rango.hasta);
    const porDia=dias.map(d=>R.filter(r=>diaDe(r)===d).length);
    const ingDia=dias.map(d=>R.filter(r=>/CONFIRM/i.test(r.estado||"")&&diaDe(r)===d).reduce((a,r)=>a+Number(r.total||0),0));
    const lab=dias.map(d=>d.slice(5));
    // Reservas por día — línea (tendencia)
    S.charts.push(new Chart($("#chResLinea"),{type:"line",data:{labels:lab,datasets:[{label:"Reservas",data:porDia,borderColor:col.oro,backgroundColor:"rgba(201,163,90,.15)",fill:true,tension:.3}]},
      options:{plugins:{legend:{display:false}},maintainAspectRatio:false,scales:{y:{beginAtZero:true,ticks:{precision:0}}}}}));
    // Reservas por día — barras (conteo)
    S.charts.push(new Chart($("#chResBar"),{type:"bar",data:{labels:lab,datasets:[{label:"Reservas",data:porDia,backgroundColor:col.oro}]},
      options:{plugins:{legend:{display:false}},maintainAspectRatio:false,scales:{y:{beginAtZero:true,ticks:{precision:0}}}}}));
    // Ingresos por día — barras
    S.charts.push(new Chart($("#chIng"),{type:"bar",data:{labels:lab,datasets:[{label:"Ingresos",data:ingDia,backgroundColor:col.navy}]},
      options:{plugins:{legend:{display:false}},maintainAspectRatio:false,scales:{y:{beginAtZero:true}}}}));
  }else{
    const dispo=S.cache.habitaciones.filter(disp).length, mant=S.cache.habitaciones.length-dispo;
    S.charts.push(new Chart($("#chResLinea"),{type:"bar",data:{labels:["Disponibles","No disponibles"],datasets:[{data:[dispo,mant],backgroundColor:[col.ok,col.err]}]},
      options:{plugins:{legend:{display:false}},maintainAspectRatio:false,scales:{y:{beginAtZero:true,ticks:{precision:0}}}}}));
  }
}
function ultimosDias(n){ const a=[]; for(let i=n-1;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); a.push(d.toISOString().slice(0,10)); } return a; }
function fechaCreada(r){ return (r.creado_en||r.creadoEn||"").slice(0,10); }

function err(e){ return `<div class="view"><div class="empty">No se pudo cargar la información. (${e.status||"red"})</div></div>`; }

/* ================= HABITACIONES ================= */
async function verHabitaciones(){
  try{ S.cache.habitaciones=arr(await api("/api/v1/habitaciones")); }catch(e){ $("#main").innerHTML=err(e); return; }
  const rows=S.cache.habitaciones.map(h=>{
    const d=disp(h);
    return `<tr><td><b>${esc(h.id||h.codigo)}</b></td><td>${esc(tipoHab(h))}</td><td class="num">${h.piso??"—"}</td>
      <td class="num">${soles(precioHab(h))}</td>
      <td><span class="badge ${d?"ok":"warn"}">${d?"Disponible":(h.estado||"No disp.")}</span></td></tr>`;
  }).join("");
  $("#main").innerHTML=`<div class="view">
    <div class="topbar"><h1>Habitaciones</h1></div>
    <div class="toolbar"><div></div><button class="btn oro" onclick="modalHabitacion()">+ Nueva habitación</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Código</th><th>Tipo</th><th>Piso</th><th>Tarifa/noche</th><th>Estado</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="5" class="empty">Sin habitaciones</td></tr>'}</tbody></table></div></div>`;
}
function modalHabitacion(){
  abrirModal("Nueva habitación",`
    <div class="grid2">
      <div><label class="fl">Código</label><input class="in" id="hId" placeholder="HAB-301"></div>
      <div><label class="fl">Tipo</label><select class="in" id="hTipo"><option>SIMPLE</option><option>DOBLE</option><option>SUITE</option><option>PRESIDENCIAL</option></select></div>
      <div><label class="fl">Piso</label><input class="in" id="hPiso" type="number" value="1" min="1"></div>
      <div><label class="fl">Tarifa por noche (PEN)</label><input class="in" id="hTarifa" type="number" value="420" min="1" step="10"></div>
    </div>
    <label class="fl">Estado</label><select class="in" id="hEstado"><option>DISPONIBLE</option><option>MANTENIMIENTO</option></select>
    <div id="mMsg"></div>`,
    `<button class="btn ghost" onclick="cerrarModal()">Cancelar</button>
     <button class="btn oro" id="mOk" onclick="guardarHabitacion()">Crear</button>`);
}
async function guardarHabitacion(){
  const btn=$("#mOk"); btn.disabled=true;
  const body={ id:$("#hId").value.trim(), tipo:$("#hTipo").value, piso:+$("#hPiso").value,
    tarifaNoche:+$("#hTarifa").value, tarifa_noche:+$("#hTarifa").value, moneda:"PEN", estado:$("#hEstado").value };
  try{ await api("/api/v1/habitaciones",{method:"POST",body:JSON.stringify(body)});
    cerrarModal(); toast("Habitación creada"); verHabitaciones();
  }catch(e){ $("#mMsg").innerHTML=msgErr(e); btn.disabled=false; }
}

/* ================= PAQUETES (CRUD completo) ================= */
async function verPaquetes(){
  try{ S.cache.paquetes=arr(await api("/api/v1/paquetes")); }catch(e){ $("#main").innerHTML=err(e); return; }
  const rows=S.cache.paquetes.map(p=>{
    const id=p.codigo||p.id;
    return `<tr><td><b>${esc(p.nombre)}</b><div style="color:var(--tinta2);font-size:.8rem">${esc(p.descripcion||"")}</div></td>
      <td class="num">${soles(p.precio??p.costo??0)}</td>
      <td><span class="badge ${p.activo!==false?"ok":"err"}">${p.activo!==false?"Activo":"Inactivo"}</span></td>
      <td class="acciones">
        <button class="btn sm ghost" onclick='modalPaquete(${JSON.stringify(JSON.stringify(p))})'>Editar</button>
        <button class="btn sm danger" onclick="eliminarPaquete('${esc(id)}')">Eliminar</button></td></tr>`;
  }).join("");
  $("#main").innerHTML=`<div class="view">
    <div class="topbar"><h1>Paquetes turísticos</h1></div>
    <div class="toolbar"><div></div><button class="btn oro" onclick="modalPaquete()">+ Nuevo paquete</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Paquete</th><th>Precio</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="4" class="empty">Sin paquetes</td></tr>'}</tbody></table></div></div>`;
}
function modalPaquete(j){
  const p=j?JSON.parse(j):null;
  abrirModal(p?"Editar paquete":"Nuevo paquete",`
    <input type="hidden" id="pId" value="${p?esc(p.codigo||p.id):""}">
    <label class="fl">Nombre</label><input class="in" id="pNom" value="${p?esc(p.nombre):""}" placeholder="Lima Gastronómica">
    <label class="fl">Descripción</label><input class="in" id="pDesc" value="${p?esc(p.descripcion||""):""}" placeholder="Cena degustación para 2">
    <div class="grid2">
      <div><label class="fl">Precio (PEN)</label><input class="in" id="pPre" type="number" value="${p?(p.precio??p.costo??0):1200}" min="1" step="10"></div>
      <div><label class="fl">Estado</label><select class="in" id="pAct"><option value="true" ${p&&p.activo===false?"":"selected"}>Activo</option><option value="false" ${p&&p.activo===false?"selected":""}>Inactivo</option></select></div>
    </div><div id="mMsg"></div>`,
    `<button class="btn ghost" onclick="cerrarModal()">Cancelar</button>
     <button class="btn oro" id="mOk" onclick="guardarPaquete()">${p?"Guardar":"Crear"}</button>`);
}
async function guardarPaquete(){
  const btn=$("#mOk"); btn.disabled=true;
  const id=$("#pId").value;
  const body={ nombre:$("#pNom").value.trim(), descripcion:$("#pDesc").value.trim(),
    precio:+$("#pPre").value, moneda:"PEN", activo:$("#pAct").value==="true" };
  try{
    if(id) await api("/api/v1/paquetes/"+encodeURIComponent(id),{method:"PUT",body:JSON.stringify(body)});
    else await api("/api/v1/paquetes",{method:"POST",body:JSON.stringify(body)});
    cerrarModal(); toast(id?"Paquete actualizado":"Paquete creado"); verPaquetes();
  }catch(e){ $("#mMsg").innerHTML=msgErr(e); btn.disabled=false; }
}
async function eliminarPaquete(id){
  if(!confirm("¿Eliminar este paquete?")) return;
  try{ await api("/api/v1/paquetes/"+encodeURIComponent(id),{method:"DELETE"}); toast("Paquete eliminado"); verPaquetes(); }
  catch(e){ toast("No se pudo eliminar ("+(e.status||"red")+")",true); }
}

/* ================= TOURS (crear/eliminar) ================= */
async function verTours(){
  try{ S.cache.tours=arr(await api("/api/v1/tours")); }catch(e){ $("#main").innerHTML=err(e); return; }
  const rows=S.cache.tours.map(t=>{
    const id=t.codigo||t.id;
    return `<tr><td><b>${esc(t.nombre)}</b></td><td>${esc(t.fecha||"—")}</td>
      <td class="num">${t.cupoDisponible??t.cupo_disponible??t.cupoTotal??"—"}</td>
      <td class="num">${soles(t.precio??0)}</td>
      <td class="acciones"><button class="btn sm danger" onclick="eliminarTour('${esc(id)}')">Eliminar</button></td></tr>`;
  }).join("");
  $("#main").innerHTML=`<div class="view">
    <div class="topbar"><h1>Tours</h1></div>
    <div class="toolbar"><div></div><button class="btn oro" onclick="modalTour()">+ Nuevo tour</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Tour</th><th>Fecha</th><th>Cupo</th><th>Precio</th><th>Acciones</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="5" class="empty">Sin tours</td></tr>'}</tbody></table></div></div>`;
}
function modalTour(){
  const hoy=new Date(); hoy.setDate(hoy.getDate()+7);
  abrirModal("Nuevo tour",`
    <label class="fl">Nombre</label><input class="in" id="tNom" placeholder="City Tour Lima Colonial">
    <div class="grid2">
      <div><label class="fl">Fecha</label><input class="in" id="tFecha" type="date" value="${hoy.toISOString().slice(0,10)}"></div>
      <div><label class="fl">Cupo total</label><input class="in" id="tCupo" type="number" value="20" min="1"></div>
    </div>
    <label class="fl">Precio (PEN)</label><input class="in" id="tPre" type="number" value="180" min="1" step="10">
    <div id="mMsg"></div>`,
    `<button class="btn ghost" onclick="cerrarModal()">Cancelar</button>
     <button class="btn oro" id="mOk" onclick="guardarTour()">Crear</button>`);
}
async function guardarTour(){
  const btn=$("#mOk"); btn.disabled=true;
  const body={ nombre:$("#tNom").value.trim(), fecha:$("#tFecha").value, cupoTotal:+$("#tCupo").value,
    precio:+$("#tPre").value, moneda:"PEN" };
  try{ await api("/api/v1/tours",{method:"POST",body:JSON.stringify(body)});
    cerrarModal(); toast("Tour creado"); verTours();
  }catch(e){ $("#mMsg").innerHTML=msgErr(e); btn.disabled=false; }
}
async function eliminarTour(id){
  if(!confirm("¿Eliminar este tour?")) return;
  try{ await api("/api/v1/tours/"+encodeURIComponent(id),{method:"DELETE"}); toast("Tour eliminado"); verTours(); }
  catch(e){ toast("No se pudo eliminar ("+(e.status||"red")+")",true); }
}

/* ================= RESERVAS (listar/cancelar) ================= */
async function verReservas(){
  let ok=true;
  try{ S.cache.reservas=arr(await api("/api/v1/reservas/todas")); }catch{ ok=false; }
  if(!ok){
    $("#main").innerHTML=`<div class="view"><div class="topbar"><h1>Reservas</h1></div>
      <div class="tbl-wrap"><div class="empty">El listado global de reservas requiere el endpoint <b>/api/v1/reservas/todas</b> en el backend (incluido en los cambios para support).</div></div></div>`;
    return;
  }
  const rows=S.cache.reservas.map(r=>{
    const est=(r.estado||"").toUpperCase();
    const cls=/CONFIRM/.test(est)?"ok":/CANCEL/.test(est)?"err":"warn";
    const id=r.reserva_id||r.reservaId||r.id;
    return `<tr><td><b>${esc(id)}</b></td><td>${esc(r.clienteId||r.cliente_id||"—")}</td>
      <td>${esc(r.habitacionId||r.habitacion_id||"—")}</td>
      <td>${esc((r.desde||"").slice(0,10))} → ${esc((r.hasta||"").slice(0,10))}</td>
      <td class="num">${soles(r.total)}</td>
      <td><span class="badge ${cls}">${esc(est)}</span></td>
      <td class="acciones">${/CONFIRM|PENDI/.test(est)?`<button class="btn sm danger" onclick="cancelarReserva('${esc(id)}')">Cancelar</button>`:"—"}</td></tr>`;
  }).join("");
  $("#main").innerHTML=`<div class="view">
    <div class="topbar"><h1>Reservas</h1><div class="meta">${S.cache.reservas.length} reservas</div></div>
    <div class="tbl-wrap"><table><thead><tr><th>Código</th><th>Cliente</th><th>Habitación</th><th>Estadía</th><th>Total</th><th>Estado</th><th></th></tr></thead>
      <tbody>${rows||'<tr><td colspan="7" class="empty">Sin reservas</td></tr>'}</tbody></table></div></div>`;
}
async function cancelarReserva(id){
  if(!confirm("¿Cancelar la reserva "+id+"? Se reembolsará si hubo cobro.")) return;
  try{ await api("/api/v1/reservas/"+encodeURIComponent(id),{method:"DELETE"}); toast("Reserva cancelada"); verReservas(); }
  catch(e){ toast("No se pudo cancelar ("+(e.status||"red")+")",true); }
}

/* ================= CLIENTES (listar/editar) ================= */
async function verClientes(){
  try{ S.cache.clientes=arr(await api("/api/v1/clientes")); }catch(e){ $("#main").innerHTML=err(e); return; }
  const rows=S.cache.clientes.map(c=>{
    const doc=c.documento||{};
    return `<tr><td><b>${esc(c.nombres)} ${esc(c.apellidos)}</b></td><td>${esc(c.email)}</td>
      <td>${esc(doc.tipo||"")} ${esc(doc.numero||"")}</td><td>${esc(c.telefono||"—")}</td>
      <td class="acciones"><button class="btn sm ghost" onclick='modalCliente(${JSON.stringify(JSON.stringify(c))})'>Editar</button></td></tr>`;
  }).join("");
  $("#main").innerHTML=`<div class="view">
    <div class="topbar"><h1>Clientes</h1><div class="meta">${S.cache.clientes.length} clientes</div></div>
    <div class="tbl-wrap"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Documento</th><th>Teléfono</th><th></th></tr></thead>
      <tbody>${rows||'<tr><td colspan="5" class="empty">Sin clientes</td></tr>'}</tbody></table></div></div>`;
}
function modalCliente(j){
  const c=JSON.parse(j), doc=c.documento||{};
  abrirModal("Editar cliente",`
    <input type="hidden" id="cId" value="${esc(c.id)}">
    <div class="grid2">
      <div><label class="fl">Nombres</label><input class="in" id="cNom" value="${esc(c.nombres)}"></div>
      <div><label class="fl">Apellidos</label><input class="in" id="cApe" value="${esc(c.apellidos)}"></div>
    </div>
    <label class="fl">Correo</label><input class="in" id="cEmail" value="${esc(c.email)}">
    <div class="grid2">
      <div><label class="fl">Tipo doc.</label><select class="in" id="cDocT">${["DNI","CE","PASAPORTE","RUC"].map(x=>`<option ${x===doc.tipo?"selected":""}>${x}</option>`).join("")}</select></div>
      <div><label class="fl">Número</label><input class="in" id="cDocN" value="${esc(doc.numero||"")}"></div>
    </div>
    <label class="fl">Teléfono</label><input class="in" id="cTel" value="${esc(c.telefono||"")}">
    <div id="mMsg"></div>`,
    `<button class="btn ghost" onclick="cerrarModal()">Cancelar</button>
     <button class="btn oro" id="mOk" onclick="guardarCliente()">Guardar</button>`);
}
async function guardarCliente(){
  const btn=$("#mOk"); btn.disabled=true;
  const id=$("#cId").value;
  const body={ nombres:$("#cNom").value.trim(), apellidos:$("#cApe").value.trim(), email:$("#cEmail").value.trim(),
    documento:{tipo:$("#cDocT").value,numero:$("#cDocN").value.trim()}, telefono:$("#cTel").value.trim() };
  try{ await api("/api/v1/clientes/"+encodeURIComponent(id),{method:"PUT",body:JSON.stringify(body)});
    cerrarModal(); toast("Cliente actualizado"); verClientes();
  }catch(e){ $("#mMsg").innerHTML=msgErr(e); btn.disabled=false; }
}

/* ================= MODAL / UTILS ================= */
function abrirModal(titulo,cuerpo,pie){
  const o=document.createElement("div"); o.className="overlay"; o.id="overlay";
  o.innerHTML=`<div class="modal"><div class="modal-h"><h3>${titulo}</h3><button class="x" onclick="cerrarModal()">×</button></div>
    <div class="modal-b">${cuerpo}<div class="modal-foot">${pie}</div></div></div>`;
  o.addEventListener("click",e=>{ if(e.target.id==="overlay") cerrarModal(); });
  document.body.appendChild(o);
}
function cerrarModal(){ $("#overlay")?.remove(); }
function msgErr(e){
  const m=(e.data&&(e.data.mensaje||e.data.error))||"";
  const dets=e.data&&e.data.detalles?" ("+e.data.detalles.join("; ")+")":"";
  return `<div class="msg err">${esc(m||"No se pudo guardar")}${esc(dets)} ${e.status?`· ${e.status}`:""}</div>`;
}

/* ================= RENDER RAÍZ ================= */
function render(){
  if(!S.token){ $("#appView").hidden=true; $("#loginView").hidden=false;
    const b=$("#btnLogin"); if(b){b.disabled=false;b.textContent="Ingresar";} }
}
window.addEventListener("DOMContentLoaded",()=>{
  $("#loginForm")?.addEventListener("submit",login);
  $$(".nav a").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();irA(a.dataset.v);}));
  $("#btnSalir")?.addEventListener("click",salir);
  document.addEventListener("keydown",e=>{ if(e.key==="Escape") cerrarModal(); });
});
Object.assign(window,{ irA, modalHabitacion, guardarHabitacion, modalPaquete, guardarPaquete, eliminarPaquete,
  modalTour, guardarTour, eliminarTour, cancelarReserva, modalCliente, guardarCliente, cerrarModal,
  toggleAuto, aplicarRango, rangoRapido });
