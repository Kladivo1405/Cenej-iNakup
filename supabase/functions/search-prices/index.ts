// CenejsiNakup Edge Function - quality-first adapter version
// Only public retailer pages/endpoints; robots.txt is checked before every fetch.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SOURCES: Record<string, {base:string; endpoint:string}> = {
  tus: {base:"https://www.tus.si",endpoint:"/wp-json/wc/store/products"},
  eurospin: {base:"https://www.eurospin.si",endpoint:"/akcije/"},
  lidl: {base:"https://www.lidl.si",endpoint:"/p/export/SI/sl/product_sitemap.xml.gz"},
  hofer: {base:"https://www.hofer.si",endpoint:"/sitemap_products.xml"},
};
const UA="CenejsiNakup/0.8 (+https://github.com/Kladivo1405/Cenej-iNakup)";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const norm=(s:string)=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const decodeHtml=(s:string)=>String(s??"").replace(/&amp;/g,"&").replace(/&nbsp;/g," ").replace(/&euro;/g,"€").replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,"<").replace(/&gt;/g,">");
function allowedByRobots(txt:string,path:string):boolean {
  // Evaluate the *-group, with the longest matching path taking precedence.
  // This is a conservative subset of robots.txt (wildcards/$ are rejected).
  let agents:string[]=[], rules:{path:string;allow:boolean}[]=[], groups:{agents:string[];rules:{path:string;allow:boolean}[]}[]=[];
  function finish(){if(agents.length)groups.push({agents:[...agents],rules:[...rules]});agents=[];rules=[];}
  for(const raw of txt.split(/\r?\n/)){
    const line=raw.split("#")[0].trim();if(!line)continue;
    const i=line.indexOf(":");if(i<0)continue;
    const k=line.slice(0,i).trim().toLowerCase(),v=line.slice(i+1).trim();
    if(k==="user-agent") {if(rules.length)finish();agents.push(v.toLowerCase());}
    else if(k==="allow"||k==="disallow") {if(agents.length&&v)rules.push({path:v,allow:k==="allow"});}
  }
  finish();
  const applicable=groups.filter(g=>g.agents.includes("*"));
  const matches=applicable.flatMap(g=>g.rules).filter(r=>!/[*$]/.test(r.path)&&path.startsWith(r.path));
  if(applicable.some(g=>g.rules.some(r=>/[*$]/.test(r.path))))return false;
  matches.sort((a,b)=>b.path.length-a.path.length||Number(b.allow)-Number(a.allow));
  return matches.length?matches[0].allow:true;
}
async function fetchPublic(url:string):Promise<Response>{
  const u=new URL(url);const rr=await fetch(u.origin+"/robots.txt",{headers:{"User-Agent":UA},signal:AbortSignal.timeout(12000)});
  if(!rr.ok)throw new Error(`robots.txt ni dosegljiv (${rr.status}); vir preskočen`);
  if(!allowedByRobots(await rr.text(),u.pathname+(u.search||"")))throw new Error("robots.txt ne dovoljuje dostopa do te poti");
  return await fetch(url,{headers:{"User-Agent":UA,"Accept":"application/json,text/html,application/xml,text/xml,*/*"},signal:AbortSignal.timeout(18000)});
}
function priceFromMinor(p:any,minor=2){if(p==null)return null;const n=Number(p);return Number.isFinite(n)?n/Math.pow(10,minor):null}
function brandName(v:any):string|null { if(!v)return null;if(typeof v==="string")return v;if(Array.isArray(v))return brandName(v[0]);return typeof v.name==="string"?v.name:null; }
function parseQuantity(text:string):{amount:number;unit:"l"|"kg";label:string}|null {
  const t=String(text??"").replace(/,/g,".").toLowerCase();
  const multi=t.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(ml|l|g|kg)\b/i);
  let amount:number,unit:string;
  if(multi){amount=Number(multi[1])*Number(multi[2]);unit=multi[3].toLowerCase();}
  else {const m=t.match(/(?:^|[^\d])(\d+(?:\.\d+)?)\s*(ml|l|g|kg)\b/i);if(!m)return null;amount=Number(m[1]);unit=m[2].toLowerCase();}
  if(!Number.isFinite(amount)||amount<=0)return null;
  if(unit==="ml")return {amount:amount/1000,unit:"l",label:`${amount} ml`};
  if(unit==="g")return {amount:amount/1000,unit:"kg",label:`${amount} g`};
  return {amount,unit:unit as "l"|"kg",label:`${amount} ${unit}`};
}
function productType(text:string):string|null {
 const n=norm(text);
 if(/\b(cokoladno|kakav|cocoa|chocolate|napitek|drink)\b/.test(n)&&/\bmlek/.test(n))return "chocolate-milk";
 if(/\b(mleko|milk|milch)\b/.test(n))return "milk";
 if(/\b(maslo|butter)\b/.test(n))return "butter";
 if(/\b(jajca|jajce|eggs)\b/.test(n))return "eggs";
 return null;
}
function attributes(text:string){const n=norm(text);return {
 lactoseFree:/brez laktoze|lactose free|laktosefrei/.test(n),
 fresh:/\b(sveze|svezega|fresh|frisch)\b/.test(n),
 uht:/\b(trajno|uht|haltbar)\b/.test(n),
 chocolate:/\b(cokoladno|kakav|cocoa|chocolate)\b/.test(n),
 };}
function queryMatches(q:string,name:string,description=""):boolean {
 const title=norm(name);const combined=name+' '+description;
 if(/mleko za telo|losjon|lotion|milo|lonec|robcki|kopel|sampon|balzam|krema|kozmet/.test(title))return false;
 const qt=productType(q),nt=productType(name);if(qt&&nt!==qt)return false;
 if(qt==="milk"){
   const a=attributes(q),b=attributes(combined);
   if(a.lactoseFree!==b.lactoseFree||a.chocolate!==b.chocolate)return false;
   if(a.fresh&&b.uht||a.uht&&b.fresh)return false;
 }
 const qFat=q.match(/(\d+(?:[,.]\d+)?)\s*%/), nFat=combined.match(/(\d+(?:[,.]\d+)?)\s*%/);
 if(qFat){if(!nFat||Math.abs(Number(qFat[1].replace(',','.'))-Number(nFat[1].replace(',','.')))>0.01)return false;}
 const requested=parseQuantity(q),actual=parseQuantity(combined);
 if(requested&&actual&&(requested.unit!==actual.unit||Math.abs(requested.amount-actual.amount)>0.001))return false;
 if(!qt){const meaningful=norm(q).split(' ').filter(x=>x.length>3&&!/^\d/.test(x));if(!meaningful.some(t=>title.includes(t)))return false;}
 return true;
}
function validity(validUntil:any):{status:"current"|"expired"|"unverified";date:string|null} {
  if(!validUntil)return {status:"unverified",date:null};
  const d=new Date(validUntil);if(Number.isNaN(d.getTime()))return {status:"unverified",date:null};
  const end=new Date(d);end.setHours(23,59,59,999);
  return {status:end.getTime()>=Date.now()?"current":"expired",date:d.toISOString().slice(0,10)};
}
function makeOffer(input:any){
  const price=Number(input.price);if(!Number.isFinite(price)||price<=0)return null;
  const quantity=parseQuantity(`${input.name??""} ${input.weight??""} ${input.description??""}`);
  const valid=validity(input.priceValidUntil);
  return {store:input.store,name:decodeHtml(input.name??"Neimenovan izdelek").replace(/\s+/g," ").trim(),brand:brandName(input.brand),price,unit:quantity?.label??null,unit_price:quantity?price/quantity.amount:null,unit_measure:quantity?.unit??null,price_valid_until:valid.date,price_status:valid.status,eligible_for_basket:false,url:input.url??null,source:input.source??null,checked_at:new Date().toISOString()};
}
function applyBasketEligibility(offer:any,query:string){
  const requested=parseQuantity(query);
  const actual=offer.unit_price!=null?offer.price/offer.unit_price:null;
  offer.eligible_for_basket=Boolean(requested&&actual!==null&&offer.unit_measure===requested.unit&&Math.abs(actual-requested.amount)<0.001&&offer.price_status==="current"&&queryMatches(query,offer.name));
  return offer;
}
async function searchTus(q:string){
 const url=`https://www.tus.si/wp-json/wc/store/products?search=${encodeURIComponent(q)}&per_page=50`;
 const r=await fetchPublic(url);if(!r.ok)throw new Error(`Tuš HTTP ${r.status}`);const arr=await r.json();if(!Array.isArray(arr))return [];
 return arr.flatMap((p:any)=>{const description=decodeHtml(String(p.description??p.short_description??"").replace(/<[^>]+>/g," "));if(!queryMatches(q,p.name,description))return[];const o=makeOffer({store:"Tuš",name:p.name,description,brand:brandName(p.brands?.[0]),price:priceFromMinor(p.prices?.price,p.prices?.currency_minor_unit??2),priceValidUntil:null,url:p.permalink,source:url});return o?[applyBasketEligibility(o,q)]:[];});
}
async function searchEurospin(q:string){
 const url="https://www.eurospin.si/akcije/";const r=await fetchPublic(url);if(!r.ok)throw new Error(`Eurospin HTTP ${r.status}`);const html=await r.text();const out:any[]=[];
 const blocks=html.split(/<h[1-4][^>]*>/i).slice(1);
 for(const block of blocks){const title=decodeHtml((block.split(/<\/h[1-4]>/i)[0]||"").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim();if(!title)continue;
  const text=decodeHtml(block.slice(0,2200).replace(/<[^>]+>/g," ")).replace(/\s+/g," ");if(!queryMatches(q,title,text))continue;
  const matches=[...text.matchAll(/(?:^|\s)(\d{1,3},\d{2})\s*€/g)].map(m=>Number(m[1].replace(",",".")));if(!matches.length)continue;
  const o=makeOffer({store:"Eurospin",name:title,description:text,price:matches[matches.length-1],url,source:url,priceValidUntil:null});if(o)out.push(applyBasketEligibility(o,q));
 }
 return out.slice(0,20);
}
function collectProducts(obj:any):any[]{if(!obj||typeof obj!=="object")return[];const found:any[]=[];if(obj["@type"]==="Product"||(Array.isArray(obj["@type"])&&obj["@type"].includes("Product")))found.push(obj);if(Array.isArray(obj))for(const x of obj)found.push(...collectProducts(x));else for(const v of Object.values(obj))if(v&&typeof v==="object")found.push(...collectProducts(v));return found;}
async function searchSitemap(store:"Lidl"|"Hofer",q:string){
 const cfg=store==="Lidl"?SOURCES.lidl:SOURCES.hofer;const sitemap=cfg.base+cfg.endpoint;const r=await fetchPublic(sitemap);if(!r.ok)throw new Error(`${store} sitemap HTTP ${r.status}`);
 let xml:string;if(sitemap.endsWith(".gz")){const bytes=new Uint8Array(await r.arrayBuffer());const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));xml=await new Response(stream).text();}else xml=await r.text();
 const first=norm(q).split(" ")[0];const urls=[...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1].trim()).filter(u=>{try{return norm(decodeURIComponent(u)).includes(first)}catch{return norm(u).includes(first)}}).slice(0,25);
 const out:any[]=[];
 for(const u of urls){try{const p=await fetchPublic(u);if(!p.ok)continue;const html=await p.text();const scripts=[...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for(const m of scripts){try{const obj=JSON.parse(m[1]);for(const x of collectProducts(obj)){const name=String(x.name??"");const description=decodeHtml(String(x.description??"").replace(/<[^>]+>/g," "));if(!name||!queryMatches(q,name,description))continue;
   const offers=Array.isArray(x.offers)?x.offers[0]:x.offers;const o=makeOffer({store,name,description,brand:x.brand,price:offers?.price??offers?.lowPrice,priceValidUntil:offers?.priceValidUntil,url:offers?.url||u,source:u});if(o)out.push(applyBasketEligibility(o,q));
  }}catch{}}
 }catch{}}
 return out;
}
// Conservative discovery: official shop landing pages only. No guessed private API.
// Product offers are accepted only when official JSON-LD exposes a numeric price.
async function searchOfficialShop(store:"Spar"|"Mercator",q:string){
 const base=store==="Spar"?"https://online.spar.si/":"https://mercatoronline.si/";
 // Category pages expose product listings; homepage-only search misses them.
 // This is a conservative discovery probe, not a full catalog integration.
 const paths=store==="Spar"&&productType(q)==="milk"
  ? ["ca/hlajeni-in-mlecni-izdelki/mleko-in-mlecni-napitki/sveze-mleko/S2/S2-1/S2-1-2"]
  : [""];
 const out:any[]=[];
 for(const path of paths){
 const pageUrl=new URL(path,base).toString();
 const r=await fetchPublic(pageUrl);if(!r.ok)throw new Error(`${store} HTTP ${r.status}`);
 const html=await r.text();
 const scripts=[...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
 if(!scripts.length)throw new Error(`${store}: stran ${pageUrl} ne vsebuje JSON-LD Product; potreben je namenski katalog adapter`);
 for(const m of scripts){try{const data=JSON.parse(m[1]);for(const x of collectProducts(data)){
  const name=decodeHtml(String(x.name??""));const desc=decodeHtml(String(x.description??"").replace(/<[^>]+>/g," "));
  if(!queryMatches(q,name,desc))continue;
  const offers=Array.isArray(x.offers)?x.offers[0]:x.offers;
  const price=Number(offers?.price??offers?.lowPrice);
  if(!Number.isFinite(price)||price<=0)continue;
  const candidate=makeOffer({store,name,description:desc,brand:x.brand,price,
   priceValidUntil:offers?.priceValidUntil,url:offers?.url||x.url||pageUrl,source:pageUrl});
  if(candidate)out.push(applyBasketEligibility(candidate,q));
 }}catch{/* invalid JSON-LD is ignored */}}
 }
 return out.slice(0,25);
}
serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 try{
  if(req.method!=="POST")return new Response(JSON.stringify({error:"POST required"}),{status:405,headers:{...cors,"Content-Type":"application/json"}});
  const body=await req.json();const q=String(body.query||"").trim();if(q.length<2||q.length>100)throw new Error("Vnesi iskalni niz med 2 in 100 znaki.");
  const offers:any[]=[];const sources:Record<string,string>={};
  const jobs=[ ["Tuš",()=>searchTus(q)], ["Eurospin",()=>searchEurospin(q)], ["Lidl",()=>searchSitemap("Lidl",q)], ["Hofer",()=>searchSitemap("Hofer",q)], ["Spar",()=>searchOfficialShop("Spar",q)], ["Mercator",()=>searchOfficialShop("Mercator",q)] ] as const;
  await Promise.all(jobs.map(async([name,fn])=>{try{const rows=await fn();offers.push(...rows);sources[name]=`${rows.length} ustreznih ponudb`; }catch(e){sources[name]=`ni podatka: ${String(e).slice(0,150)}`;}}));
  
  const summary={total:offers.length,eligible:offers.filter(x=>x.eligible_for_basket).length,unverified:offers.filter(x=>x.price_status==="unverified").length,expired:offers.filter(x=>x.price_status==="expired").length};
  return new Response(JSON.stringify({query:q,offers:offers.filter(x=>x.price_status!=="expired"),sources,summary,notice:"Brez dokazljive veljavnosti cene ponudba ostane nepotrjena. Preverjen čas zajema ni datum veljavnosti. Nič ni avtomatsko potrjeno samo zaradi prikaza cene."}),{headers:{...cors,"Content-Type":"application/json"}});
 }catch(e){return new Response(JSON.stringify({error:String(e)}),{status:400,headers:{...cors,"Content-Type":"application/json"}});}
});
