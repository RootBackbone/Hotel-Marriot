/* ===========================================================
   JW Marriott Hotel Lima — app.js
   SPA multisección + catálogo vía API + reserva + chatbot guiado.
   API en mismo origen (/api) vía proxy nginx -> gateway.
   =========================================================== */
"use strict";

/* ---------- Config / estado ---------- */
const API = "";                      // mismo origen; nginx hace proxy /api -> gateway
const CLIENTE_DEMO = { usuario: "cliente", clave: "cliente123" };
const CLIENTE_ID   = "CLI-000123";   // cliente demo para la reserva
const FOTO = {
  SIMPLE:"img/simple.jpg", DOBLE:"img/doble.jpg",
  SUITE:"img/suite.jpg", PRESIDENCIAL:"img/presidencial.jpg"
};
const S = {                          // estado en memoria (sin localStorage en artifacts)
  token:null, habitaciones:[], paquetes:[], tours:[],
  sel:{ hab:null, checkin:null, checkout:null, huespedes:2, paquete:null, tours:[] }
};

/* ---------- Utilidades ---------- */
const $  = (s,c=document)=>c.querySelector(s);
const $$ = (s,c=document)=>[...c.querySelectorAll(s)];
const soles = n => "S/ " + Number(n||0).toLocaleString("es-PE",{minimumFractionDigits:2,maximumFractionDigits:2});
const hoy   = () => new Date().toISOString().slice(0,10);
const mas   = d => { const t=new Date(); t.setDate(t.getDate()+d); return t.toISOString().slice(0,10); };
const noches= (a,b)=>{ const d=(new Date(b)-new Date(a))/864e5; return d>0?Math.round(d):0; };
const uuid  = () => (crypto.randomUUID?crypto.randomUUID():"idem-"+Date.now()+"-"+Math.random().toString(16).slice(2));

async function api(path, opt={}){
  const h = Object.assign({ "Content-Type":"application/json" }, opt.headers||{});
  if (S.token) h["Authorization"] = "Bearer " + S.token;
  const r = await fetch(API + path, Object.assign({}, opt, { headers:h }));
  const txt = await r.text();
  let data=null; try{ data = txt?JSON.parse(txt):null; }catch{ data = txt; }
  if (!r.ok) throw { status:r.status, data };
  return data;
}

/* ---------- Auth (cliente demo, solo para leer catálogo y reservar) ---------- */
async function asegurarToken(){
  if (S.token) return S.token;
  const d = await api("/api/v1/auth/token", { method:"POST", body:JSON.stringify(CLIENTE_DEMO) });
  S.token = d.access_token || d.token || d.accessToken;
  return S.token;
}

/* ===========================================================
   NAVEGACIÓN ENTRE SECCIONES
   =========================================================== */
function irA(id, push=true){
  const el = document.getElementById(id);
  if (!el) return;
  cerrarMenuMovil();
  el.scrollIntoView({ behavior:"smooth", block:"start" });
  marcarActivo(id);
  if (push) history.replaceState(null,"","#"+id);
}
function marcarActivo(id){
  $$(".nav-links a,[data-nav]").forEach(a=>a.classList.toggle("active", a.dataset.go===id));
}
function cerrarMenuMovil(){ $("#mobileMenu")?.classList.remove("open"); }

/* observador: resalta el link de la sección visible */
function observarSecciones(){
  const obs = new IntersectionObserver(es=>{
    es.forEach(e=>{ if(e.isIntersecting) marcarActivo(e.target.id); });
  }, { rootMargin:"-45% 0px -50% 0px", threshold:0 });
  $$("section[id]").forEach(s=>obs.observe(s));
}

/* ===========================================================
   CATÁLOGO: HABITACIONES (API) + GASTRONOMÍA/ÁREAS (estáticas)
   =========================================================== */
async function cargarCatalogo(){
  const cont = $("#roomsGrid");
  try{
    await asegurarToken();
    const [habs, paks, trs] = await Promise.allSettled([
      api("/api/v1/habitaciones"),
      api("/api/v1/paquetes"),
      api("/api/v1/tours")
    ]);
    S.habitaciones = norm(habs);
    S.paquetes     = norm(paks);
    S.tours        = norm(trs);
    pintarRooms();
  }catch(e){
    cont.innerHTML = `<div class="skeleton">No se pudo cargar el catálogo en vivo.
      Verifica la conexión con la API. (${e.status||"red"})</div>`;
  }
}
function norm(res){
  if (res.status!=="fulfilled" || !res.value) return [];
  const v = res.value;
  return Array.isArray(v) ? v : (v.disponibles || v.content || v.data || v.items || v.habitaciones || []);
}
function tipoDe(h){
  const t = (h.tipo || h.categoria || h.tipoHabitacion || h.nombre || "").toString().toUpperCase();
  if (t.includes("PRESIDEN")) return "PRESIDENCIAL";
  if (t.includes("SUITE"))    return "SUITE";
  if (t.includes("DOBLE")||t.includes("DOUBLE")) return "DOBLE";
  return "SIMPLE";
}
function precioDe(h){
  return h.precioNoche ?? h.precio ?? h.tarifa ?? h.tarifa_noche ?? h.tarifaNoche ?? h.precio_noche ?? 0;
}
const ORDEN_TIPO = ["SIMPLE","DOBLE","SUITE","PRESIDENCIAL"];
function disponible(h){ return !(h.disponible===false || /MANTEN|OCUP/i.test(h.estado||"")); }

/* Agrupa las habitaciones por tipo: una tarjeta por tipo con contador de disponibilidad */
function agruparPorTipo(){
  const g = {};
  S.habitaciones.forEach(h=>{
    const t = tipoDe(h);
    (g[t] = g[t] || { tipo:t, items:[], disp:0, precio:Infinity }).items.push(h);
    if (disponible(h)) g[t].disp++;
    const p = precioDe(h); if (p>0) g[t].precio = Math.min(g[t].precio, p);
  });
  return ORDEN_TIPO.filter(t=>g[t]).map(t=>g[t]);
}

function pintarRooms(){
  const cont = $("#roomsGrid");
  if (!S.habitaciones.length){
    cont.innerHTML = `<div class="skeleton">No hay habitaciones disponibles por ahora.</div>`;
    return;
  }
  const grupos = agruparPorTipo();
  cont.innerHTML = grupos.map(g=>{
    const t = g.tipo;
    const hay = g.disp>0;
    const precio = isFinite(g.precio)?g.precio:0;
    const cont2 = hay
      ? `<span class="cnt ok"><b>${g.disp}</b> disponible${g.disp>1?"s":""}</span>`
      : `<span class="cnt no">Sin disponibilidad</span>`;
    return `<article class="room">
      <div class="ph" style="background-image:url('${FOTO[t]}')">
        <span class="tag">${t}</span>
        <button class="verdet" onclick="verDetalle('${t}')">Ver detalle</button>
      </div>
      <div class="body">
        <h3>${nombreTipo(t)}</h3>
        <div class="meta">${g.items.length} habitacion${g.items.length>1?"es":""} · ${t}</div>
        <p style="color:var(--tinta2);font-size:.9rem;margin:0 0 10px">${descTipo(t)}</p>
        ${cont2}
        <div class="foot">
          <div class="price"><span>Desde</span> <b>${soles(precio)}</b> <span>/ noche</span></div>
          <button class="btn sm ${hay?"oro":""}" ${hay?"":"disabled"}
            onclick="reservarTipo('${t}')">${hay?"Reservar":"Agotado"}</button>
        </div>
      </div>
    </article>`;
  }).join("");
}
function nombreTipo(t){return{SIMPLE:"Habitación Deluxe",DOBLE:"Habitación Doble Superior",SUITE:"Suite Ejecutiva",PRESIDENCIAL:"Suite Presidencial"}[t];}
function descTipo(t){return{
  SIMPLE:"Cama king, vista a la ciudad y escritorio ejecutivo.",
  DOBLE:"Dos camas, ideal para familias, con vista parcial al mar.",
  SUITE:"Sala independiente, terraza y vista al malecón de Miraflores.",
  PRESIDENCIAL:"La mejor vista al Pacífico, jacuzzi y atención de mayordomo."
}[t];}
/* amenities por tipo para el detalle */
function amenitiesTipo(t){return{
  SIMPLE:["Cama king","Wi-Fi de alta velocidad","Escritorio ejecutivo","Smart TV 50\"","Minibar","Caja fuerte"],
  DOBLE:["Dos camas queen","Vista parcial al mar","Wi-Fi de alta velocidad","Smart TV 55\"","Minibar","Cafetera"],
  SUITE:["Sala independiente","Terraza con vista al malecón","Cama king","Bañera y ducha","Smart TV 65\"","Executive Lounge"],
  PRESIDENCIAL:["Vista total al Pacífico","Jacuzzi privado","Mayordomo 24 h","Comedor para 8","Dos ambientes","Executive Lounge"]
}[t];}

/* ---- fotos de detalle por tipo (galería) ---- */
const FOTO_DET = {
  SIMPLE:["img/det-simple-1.jpg","img/det-simple-2.jpg","img/det-simple-3.jpg"],
  DOBLE:["img/det-doble-1.jpg","img/det-doble-2.jpg","img/det-doble-3.jpg"],
  SUITE:["img/det-suite-1.jpg","img/det-suite-2.jpg","img/det-suite-3.jpg"],
  PRESIDENCIAL:["img/det-presidencial-1.jpg","img/det-presidencial-2.jpg","img/det-presidencial-3.jpg"]
};
let DET_IDX = 0, DET_TIPO = null;
function primeraDisponible(t){
  return S.habitaciones.find(h=>tipoDe(h)===t && disponible(h))
      || S.habitaciones.find(h=>tipoDe(h)===t);
}
function reservarTipo(t){
  const h = primeraDisponible(t);
  if (h) abrirReserva(JSON.stringify(h));
}
function verDetalle(t){
  DET_TIPO=t; DET_IDX=0;
  const g = agruparPorTipo().find(x=>x.tipo===t) || {items:[],disp:0,precio:0};
  const fotos = FOTO_DET[t]||[FOTO[t]];
  const precio = isFinite(g.precio)&&g.precio?g.precio:precioDe(primeraDisponible(t)||{});
  $("#detBody").innerHTML = `
    <div class="det-gal">
      <img id="detImg" src="${fotos[0]}" alt="${nombreTipo(t)}">
      ${fotos.length>1?`
        <button class="det-nav prev" onclick="detPaso(-1)" aria-label="Anterior">‹</button>
        <button class="det-nav next" onclick="detPaso(1)" aria-label="Siguiente">›</button>
        <div class="det-dots" id="detDots">${fotos.map((_,i)=>`<span class="${i===0?"on":""}"></span>`).join("")}</div>`:""}
    </div>
    <div class="det-info">
      <div class="det-head">
        <div><h3>${nombreTipo(t)}</h3><div class="det-sub">${t} · ${g.items.length} en el hotel</div></div>
        <div class="det-price"><span>Desde</span><b>${soles(precio)}</b><span>/ noche</span></div>
      </div>
      <p>${descTipo(t)}</p>
      <div class="det-amen">${amenitiesTipo(t).map(a=>`<span>✓ ${a}</span>`).join("")}</div>
      <div class="det-foot">
        <span class="cnt ${g.disp>0?"ok":"no"}">${g.disp>0?`<b>${g.disp}</b> disponible${g.disp>1?"s":""} ahora`:"Sin disponibilidad"}</span>
        <button class="btn oro" ${g.disp>0?"":"disabled"} onclick="cerrarDetalle();reservarTipo('${t}')">${g.disp>0?"Reservar esta habitación":"Agotado"}</button>
      </div>
    </div>`;
  $("#detTitle").textContent = nombreTipo(t);
  $("#detalle").hidden=false; document.body.style.overflow="hidden";
}
function detPaso(d){
  const fotos = FOTO_DET[DET_TIPO]||[];
  if(!fotos.length) return;
  DET_IDX = (DET_IDX + d + fotos.length) % fotos.length;
  $("#detImg").src = fotos[DET_IDX];
  $$("#detDots span").forEach((s,i)=>s.classList.toggle("on", i===DET_IDX));
}
function cerrarDetalle(){ $("#detalle").hidden=true; document.body.style.overflow=""; }

/* ===========================================================
   RESERVA (modal de 3 pasos) — conserva el flujo real contra la API
   =========================================================== */
let HAB_ACTUAL=null, PASO=1;
function abrirReserva(hJson){
  HAB_ACTUAL = JSON.parse(typeof hJson==="string"?hJson:JSON.stringify(hJson));
  S.sel.hab = HAB_ACTUAL;
  S.sel.checkin  = S.sel.checkin  || mas(7);
  S.sel.checkout = S.sel.checkout || mas(9);
  PASO = 1;
  $("#overlay").hidden = false;
  document.body.style.overflow="hidden";
  render();
}
function cerrarReserva(){ $("#overlay").hidden=true; document.body.style.overflow=""; }

function render(){
  const b = $("#modalBody");
  $("#modalTitle").textContent =
    PASO===1?"Tu estadía": PASO===2?"Personaliza tu experiencia":"Confirmación";
  $$(".steps .s").forEach((s,i)=>s.classList.toggle("on", i<PASO));
  if (PASO===1) b.innerHTML = paso1HTML();
  else if (PASO===2) b.innerHTML = paso2HTML();
  else b.innerHTML = paso3HTML();
}

function paso1HTML(){
  const h=HAB_ACTUAL, tipo=tipoDe(h);
  const precio=precioDe(h);
  return `
   <div style="display:flex;gap:16px;align-items:center;margin-bottom:8px">
     <img src="${FOTO[tipo]}" style="width:92px;height:72px;object-fit:cover;border:1px solid var(--linea)" alt="">
     <div><h3 style="font-size:1.4rem">${h.nombre||nombreTipo(tipo)}</h3>
       <div style="color:var(--tinta2);font-size:.85rem">${soles(precio)} / noche</div></div>
   </div>
   <label class="fl">Check-in</label>
   <input class="in" type="date" id="fIn" min="${hoy()}" value="${S.sel.checkin}">
   <label class="fl">Check-out</label>
   <input class="in" type="date" id="fOut" min="${mas(1)}" value="${S.sel.checkout}">
   <label class="fl">Huéspedes</label>
   <select class="in" id="fHue">
     ${[1,2,3,4].map(n=>`<option ${n===S.sel.huespedes?"selected":""}>${n}</option>`).join("")}
   </select>
   <div id="m1"></div>
   <div class="modal-foot">
     <button class="btn line" onclick="cerrarReserva()">Cancelar</button>
     <button class="btn oro" onclick="irPaso2()">Continuar</button>
   </div>`;
}
function irPaso2(){
  S.sel.checkin=$("#fIn").value; S.sel.checkout=$("#fOut").value;
  S.sel.huespedes=+$("#fHue").value;
  if (noches(S.sel.checkin,S.sel.checkout)<1){
    $("#m1").innerHTML=`<div class="msg err">El check-out debe ser posterior al check-in.</div>`; return;
  }
  PASO=2; render();
}

function paso2HTML(){
  const paks = S.paquetes.slice(0,4);
  const trs  = S.tours.slice(0,4);
  const pak = (p)=>{
    const id=p.codigo||p.id, pr=p.precio??p.costo??0, on=S.sel.paquete&&(S.sel.paquete.codigo||S.sel.paquete.id)===id;
    return `<label class="addon"><input type="radio" name="pak" ${on?"checked":""}
       onchange='selPaquete(${JSON.stringify(JSON.stringify(p))})'>
       <span class="info"><b>${p.nombre||"Paquete"}</b><span>${p.descripcion||"Experiencia incluida"}</span></span>
       <span class="pr">${soles(pr)}</span></label>`;
  };
  const tour=(t)=>{
    const id=t.codigo||t.id, pr=t.precio??t.costo??0, on=S.sel.tours.some(x=>(x.codigo||x.id)===id);
    return `<label class="addon"><input type="checkbox" ${on?"checked":""}
       onchange='togTour(${JSON.stringify(JSON.stringify(t))},this.checked)'>
       <span class="info"><b>${t.nombre||"Tour"}</b><span>${t.descripcion||"Actividad opcional"}</span></span>
       <span class="pr">${soles(pr)}</span></label>`;
  };
  return `
   ${paks.length?`<label class="fl">Paquetes gastronómicos y experiencias</label>
     <div class="addons"><label class="addon"><input type="radio" name="pak" ${!S.sel.paquete?"checked":""}
        onchange="selPaquete(null)"><span class="info"><b>Sin paquete</b><span>Solo alojamiento</span></span>
        <span class="pr">S/ 0.00</span></label>${paks.map(pak).join("")}</div>`:""}
   ${trs.length?`<label class="fl" style="margin-top:18px">Tours y actividades</label>
     <div class="addons">${trs.map(tour).join("")}</div>`:""}
   ${(!paks.length&&!trs.length)?`<p style="color:var(--tinta2)">No hay experiencias adicionales disponibles. Puedes continuar con tu reserva.</p>`:""}
   <div class="modal-foot">
     <button class="btn line" onclick="PASO=1;render()">Atrás</button>
     <button class="btn oro" onclick="PASO=3;render()">Ver resumen</button>
   </div>`;
}
function selPaquete(j){ S.sel.paquete = j?JSON.parse(j):null; }
function togTour(j,on){
  const t=JSON.parse(j), id=t.codigo||t.id;
  S.sel.tours = S.sel.tours.filter(x=>(x.codigo||x.id)!==id);
  if(on) S.sel.tours.push(t);
}

function calcular(){
  const h=S.sel.hab, pr=precioDe(h);
  const n=noches(S.sel.checkin,S.sel.checkout);
  const alo=pr*n;
  const pak=S.sel.paquete?(S.sel.paquete.precio??S.sel.paquete.costo??0):0;
  const tr=S.sel.tours.reduce((a,t)=>a+(t.precio??t.costo??0),0);
  return { n, alo, pak, tr, total:alo+pak+tr };
}
function paso3HTML(){
  const h=S.sel.hab, tipo=tipoDe(h), c=calcular();
  const lis=[
    [`Alojamiento · ${c.n} noche${c.n>1?"s":""}`, soles(c.alo)],
    S.sel.paquete?[`Paquete · ${S.sel.paquete.nombre}`, soles(c.pak)]:null,
    ...S.sel.tours.map(t=>[`Tour · ${t.nombre||t.codigo}`, soles(t.precio??t.costo??0)])
  ].filter(Boolean);
  return `
   <div class="resumen">
     <div class="li"><span><b>${h.nombre||nombreTipo(tipo)}</b></span><span>${tipo}</span></div>
     <div class="li"><span>Check-in</span><span>${S.sel.checkin}</span></div>
     <div class="li"><span>Check-out</span><span>${S.sel.checkout}</span></div>
     <div class="li"><span>Huéspedes</span><span>${S.sel.huespedes}</span></div>
     ${lis.map(l=>`<div class="li"><span>${l[0]}</span><span>${l[1]}</span></div>`).join("")}
     <div class="li tot"><span>Total</span><b>${soles(c.total)}</b></div>
   </div>
   <label class="fl" style="margin-top:16px">Tarjeta (simulada para la demo)</label>
   <input class="in" id="fTar" value="4111 1111 1111 1111" maxlength="19">
   <label class="toggle"><input type="checkbox" id="fRechazo"> Simular pago rechazado (demo Saga)</label>
   <div id="m3"></div>
   <div class="modal-foot">
     <button class="btn line" onclick="PASO=2;render()">Atrás</button>
     <button class="btn oro" id="btnConf" onclick="confirmar()">Confirmar y pagar ${soles(c.total)}</button>
   </div>`;
}

async function confirmar(){
  const btn=$("#btnConf"), c=calcular();
  btn.disabled=true; btn.textContent="Procesando…";
  const rechazo = $("#fRechazo")?.checked;
  const body = {
    clienteId: CLIENTE_ID,
    habitacionCodigo: S.sel.hab.codigo || S.sel.hab.id,
    fechaInicio: S.sel.checkin, fechaFin: S.sel.checkout,
    huespedes: S.sel.huespedes,
    paqueteCodigo: S.sel.paquete ? (S.sel.paquete.codigo||S.sel.paquete.id) : null,
    tours: S.sel.tours.map(t=>t.codigo||t.id),
    pago: { metodo:"TARJETA", token: rechazo?"tok_rechazo":"tok_ok", monto:c.total }
  };
  try{
    await asegurarToken();
    const r = await api("/api/v1/reservas", {
      method:"POST",
      headers:{ "Idempotency-Key": uuid() },
      body: JSON.stringify(body)
    });
    const cod = r.codigo || r.reservaId || r.id || "RES-"+Math.floor(Math.random()*9e5+1e5);
    $("#modalBody").innerHTML = `
      <div class="success">
        <div class="ic">✓</div>
        <h3>¡Reserva confirmada!</h3>
        <p style="color:var(--tinta2)">Tu código de reserva</p>
        <div class="code">${cod}</div>
        <p class="hint">Hemos enviado la confirmación por correo. ¡Te esperamos en el JW Marriott Hotel Lima!</p>
        <div style="margin-top:20px"><button class="btn" onclick="cerrarReserva()">Listo</button></div>
      </div>`;
    $("#modalTitle").textContent="Confirmación";
  }catch(e){
    const msg = e.status===409 ? "El pago fue rechazado. La reserva se liberó automáticamente (compensación Saga)."
             : e.status===422 ? "La habitación ya no está disponible para esas fechas."
             : "No se pudo completar la reserva. Intenta nuevamente.";
    $("#m3").innerHTML=`<div class="msg err">${msg}</div>`;
    btn.disabled=false; btn.textContent="Reintentar";
  }
}

/* ===========================================================
   GALERÍA (lightbox)
   =========================================================== */
function abrirFoto(src){ const lb=$("#lightbox"); $("#lbImg").src=src; lb.hidden=false; document.body.style.overflow="hidden"; }
function cerrarFoto(){ $("#lightbox").hidden=true; document.body.style.overflow=""; }

/* ===========================================================
   CHATBOT GUIADO (reglas, sin IA externa; usa la API para disponibilidad)
   =========================================================== */
const CHAT = {
  saludo:"¡Hola! Soy <b>Jacques</b>, tu concierge virtual del JW Marriott Hotel Lima. ¿En qué te ayudo hoy?",
  chips:["Reservar habitación","Ver precios","Horarios del restobar","Spa y piscina","¿Cómo llego?","Hablar con recepción"],
  abierto:false
};
function toggleChat(f){
  CHAT.abierto = f!=null?f:!CHAT.abierto;
  $("#chatPanel").hidden = !CHAT.abierto;
  $("#chatFab").textContent = CHAT.abierto ? "✕" : "💬";
  if (CHAT.abierto && !$("#chatBody").dataset.init){
    bot(CHAT.saludo); chips(CHAT.chips);
    $("#chatBody").dataset.init="1";
    setTimeout(()=>$("#chatText")?.focus(),100);
  }
}
function bot(html){ burbuja(html,"bot"); }
function yo(txt){ burbuja(txt,"user"); }
function burbuja(html,cls){
  const b=document.createElement("div"); b.className="bubble "+cls; b.innerHTML=html;
  $("#chatBody").appendChild(b); $("#chatBody").scrollTop=1e6;
}
function chips(arr){
  const old=$("#chatChips"); old.innerHTML="";
  arr.forEach(t=>{ const c=document.createElement("button"); c.className="chip"; c.textContent=t;
    c.onclick=()=>responder(t); old.appendChild(c); });
}
function enviarChat(e){
  e&&e.preventDefault();
  const i=$("#chatText"); const t=i.value.trim(); if(!t) return;
  i.value=""; responder(t);
}
async function responder(txt){
  yo(txt);
  const q = txt.toLowerCase();
  const tiene = (...k)=>k.some(x=>q.includes(x));

  if (tiene("reserv","habitacion","habitación","cuarto","alojar")){
    bot("¡Con gusto! Te muestro nuestras habitaciones disponibles. ¿Para qué fechas?");
    chips(["Este fin de semana","La próxima semana","Ver todas las habitaciones"]);
    return;
  }
  if (tiene("este fin","fin de semana","próxima semana","proxima semana","ver todas")){
    bot("Perfecto. Abajo puedes ver y reservar en vivo. ¿Quieres que te lleve al catálogo?");
    setTimeout(()=>irA("habitaciones"),400);
    await disponibilidadResumen();
    chips(["Ver precios","Spa y piscina","Gracias"]);
    return;
  }
  if (tiene("precio","tarifa","cuesta","cuánto","cuanto","costo")){
    await preciosResumen();
    chips(["Reservar habitación","Horarios del restobar","Gracias"]);
    return;
  }
  if (tiene("restobar","bar","restaurant","comer","comida","cena","desayun","gastro","plato","cocina")){
    bot("Nuestra propuesta gastronómica:<br>🍸 <b>Celesté Restobar</b> — 12:00 a 00:00 h<br>🍽️ <b>La Vista</b> (alta cocina peruana) — 19:00 a 23:00 h<br>☕ <b>Desayuno buffet</b> — 06:00 a 10:30 h<br>🛎️ <b>Room service</b> — 24 horas");
    chips(["Ver platos","Reservar habitación","Áreas de entretenimiento"]);
    return;
  }
  if (tiene("ver platos","áreas","areas","entreten","esparci","piscina","spa","gimnasio","gym","eventos","salon","salón")){
    bot("Contamos con:<br>🏊 Piscina temperada en la azotea<br>💆 Spa & wellness con circuito de aguas<br>🏋️ Gimnasio 24 h con equipo Technogym<br>🎉 Salones para eventos y banquetes hasta 500 personas");
    setTimeout(()=>irA("areas"),400);
    chips(["Reservar habitación","¿Cómo llego?","Gracias"]);
    return;
  }
  if (tiene("horario","hora","abre","cierra")){
    bot("Horarios principales:<br>• Check-in: 15:00 h · Check-out: 12:00 h<br>• Restobar: 12:00–00:00 h<br>• Spa: 08:00–21:00 h<br>• Piscina y gimnasio: 24 horas");
    chips(["Reservar habitación","Spa y piscina","Gracias"]);
    return;
  }
  if (tiene("llego","dirección","direccion","dónde","donde","ubica","mapa","llegar")){
    bot("Estamos en <b>Malecón de la Reserva 615, Miraflores — Lima</b>, junto al centro comercial Larcomar y frente al Pacífico. A 40 min del Aeropuerto Jorge Chávez.");
    setTimeout(()=>irA("contacto"),400);
    chips(["Reservar habitación","Gracias"]);
    return;
  }
  if (tiene("recepcion","recepción","humano","persona","llamar","telefono","teléfono","contacto")){
    bot("Puedes comunicarte con recepción:<br>📞 <b>(01) 217-7000</b><br>✉️ reservas.lima@marriott.com<br>Atención 24 horas. ¿Te ayudo con algo más mientras tanto?");
    chips(["Reservar habitación","Ver precios","Gracias"]);
    return;
  }
  if (tiene("gracias","genial","perfecto","listo","chau","adiós","adios")){
    bot("¡Un placer atenderte! Estaré aquí si necesitas algo más. 🌊");
    chips(CHAT.chips);
    return;
  }
  // fallback
  bot("No estoy seguro de haber entendido. Puedo ayudarte con reservas, precios, horarios del restobar, spa y piscina o cómo llegar. ¿Qué prefieres?");
  chips(CHAT.chips);
}

async function disponibilidadResumen(){
  try{
    await asegurarToken();
    if(!S.habitaciones.length) await cargarCatalogo();
    const disp = S.habitaciones.filter(h=>!(h.disponible===false||/MANTEN|OCUP/i.test(h.estado||""))).length;
    bot(`Ahora mismo tenemos <b>${disp}</b> habitación${disp===1?"":"es"} disponible${disp===1?"":"s"} para reservar en línea.`);
  }catch{ bot("Puedes ver la disponibilidad en vivo en la sección de habitaciones."); }
}
async function preciosResumen(){
  try{
    await asegurarToken();
    if(!S.habitaciones.length) await cargarCatalogo();
    const precios = S.habitaciones.map(h=>h.precioNoche??h.precio??h.tarifa??0).filter(n=>n>0);
    if(precios.length){
      bot(`Nuestras tarifas van desde <b>${soles(Math.min(...precios))}</b> hasta <b>${soles(Math.max(...precios))}</b> por noche, según el tipo de habitación. Los precios se muestran en vivo abajo.`);
    } else bot("Los precios se muestran en vivo en la sección de habitaciones.");
  }catch{ bot("Puedes consultar los precios actualizados en la sección de habitaciones."); }
}

/* ===========================================================
   ARRANQUE
   =========================================================== */
window.addEventListener("DOMContentLoaded", ()=>{
  // navegación
  $$("[data-go]").forEach(a=>a.addEventListener("click",ev=>{ev.preventDefault();irA(a.dataset.go);}));
  $("#burger")?.addEventListener("click",()=>$("#mobileMenu").classList.toggle("open"));
  observarSecciones();
  // buscador hero
  $("#heroBuscar")?.addEventListener("click",()=>{
    S.sel.checkin=$("#hIn")?.value||mas(7);
    S.sel.checkout=$("#hOut")?.value||mas(9);
    S.sel.huespedes=+($("#hHue")?.value||2);
    irA("habitaciones");
  });
  // fechas por defecto en el buscador
  if($("#hIn")) $("#hIn").value=mas(7);
  if($("#hOut")) $("#hOut").value=mas(9);
  // chatbot
  $("#chatFab")?.addEventListener("click",()=>toggleChat());
  $("#chatClose")?.addEventListener("click",()=>toggleChat(false));
  $("#chatForm")?.addEventListener("submit",enviarChat);
  // cerrar modales con Escape / click fuera
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"){cerrarReserva();cerrarFoto();cerrarDetalle();}
    if(!$("#detalle").hidden){ if(e.key==="ArrowRight")detPaso(1); if(e.key==="ArrowLeft")detPaso(-1); }
  });
  $("#overlay")?.addEventListener("click",e=>{ if(e.target.id==="overlay") cerrarReserva(); });
  $("#detalle")?.addEventListener("click",e=>{ if(e.target.id==="detalle") cerrarDetalle(); });
  // catálogo en vivo
  cargarCatalogo();
  // ancla inicial
  if(location.hash) setTimeout(()=>irA(location.hash.slice(1),false),300);
});

/* exponer funciones usadas en onclick inline */
Object.assign(window,{ irA, abrirReserva, cerrarReserva, irPaso2, selPaquete, togTour,
  confirmar, abrirFoto, cerrarFoto, toggleChat, enviarChat,
  verDetalle, cerrarDetalle, detPaso, reservarTipo });
