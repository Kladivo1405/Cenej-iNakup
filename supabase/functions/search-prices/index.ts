// CenejsiNakup Edge Function - quality-first adapter version
// Only public retailer pages/endpoints; robots.txt is checked before every fetch.

const SOURCES: Record<string, {base:string; endpoint:string}> = {
  tus: {base:"https://www.tus.si",endpoint:"/wp-json/wc/store/products"},
  eurospin: {base:"https://www.eurospin.si",endpoint:"/akcije/"},
  lidl: {base:"https://www.lidl.si",endpoint:"/p/export/SI/sl/product_sitemap.xml.gz"},
  hofer: {base:"https://www.hofer.si",endpoint:"/sitemap_products.xml"},
};
const UA="CenejsiNakup/0.9 (+https://github.com/Kladivo1405/Cenej-iNakup)";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const jsonHeaders={...cors,"Content-Type":"application/json; charset=utf-8"};
const norm=(s:string)=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const decodeHtml=(s:string)=>String(s??"").replace(/&amp;/g,"&").replace(/&nbsp;/g," ").replace(/&euro;/g,"€").replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,"<").replace(/&gt;/g,">");
// RFC 9309: match relevant user-agent group, longest Allow/Disallow rule,
// wildcard * and terminal $. No bypass of explicit restrictions.
type RobotRule={pattern:string;allow:boolean};
const ROBOT_TOKEN="CenejsiNakup";
function robotsDecision(txt:string, path:string, token=ROBOT_TOKEN):{allowed:boolean;reason:string}{
  const groups:{agents:string[];rules:RobotRule[]}[]=[];
  let agents:string[]=[],rules:RobotRule[]=[],hasRules=false;
  const flush=()=>{if(agents.length)groups.push({agents:[...agents],rules:[...rules]});agents=[];rules=[];hasRules=false;};
  for(const raw of txt.split(/\r?\n/)){
    const line=raw.split("#",1)[0].trim();if(!line)continue;
    const i=line.indexOf(":");if(i<0)continue;
    const key=line.slice(0,i).trim().toLowerCase(), val=line.slice(i+1).trim();
    if(key==="user-agent"){
      if(hasRules)flush();
      agents.push(val.toLowerCase());
    }else if((key==="allow"||key==="disallow")&&agents.length){
      hasRules=true;
      if(val)rules.push({pattern:val,allow:key==="allow"});
    }
  }
  flush();
  const ua=token.toLowerCase();
  const specific=groups.filter(g=>g.agents.some(a=>a!=="*"&&(ua===a||ua.includes(a))));
  const applicable=specific.length?specific:groups.filter(g=>g.agents.includes("*"));
  const candidates:{rule:RobotRule;length:number}[]=[];
  for(const g of applicable)for(const rule of g.rules){
    // Match against URL path + query, preserving anchored prefix semantics.
    const anchor=rule.pattern.endsWith("$");
    const rawPattern=anchor?rule.pattern.slice(0,-1):rule.pattern;
    const escaped=rawPattern.split("*").map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join(".*");
    try{if(new RegExp("^"+escaped+(anchor?"$":"")).test(path))candidates.push({rule,length:rawPattern.replace(/\*/g,"").length});}catch{return {allowed:false,reason:"neveljavno robots pravilo"};}
  }
  candidates.sort((a,b)=>b.length-a.length||Number(b.rule.allow)-Number(a.rule.allow));
  if(!candidates.length)return {allowed:true,reason:"ni ujemajočega se pravila"};
  const winner=candidates[0].rule;
  return {allowed:winner.allow,reason:`${winner.allow?"Allow":"Disallow"}: ${winner.pattern}`};
}
const robotsCache=new Map<string,{text:string;until:number}>();
async function fetchPublic(url:string):Promise<Response>{
  const u=new URL(url);
  if(u.protocol!=="https:")throw new Error("dovoljen je samo HTTPS");
  let cached=robotsCache.get(u.origin);
  if(!cached||cached.until<Date.now()){
    let rr:Response;
    try{rr=await fetch(u.origin+"/robots.txt",{headers:{"User-Agent":UA},signal:AbortSignal.timeout(12000),redirect:"error"});}
    catch(e){throw new Error(`robots.txt nedosegljiv: ${String(e).slice(0,90)}`);}
    if(!rr.ok)throw new Error(`robots.txt HTTP ${rr.status}; vir preskočen`);
    cached={text:await rr.text(),until:Date.now()+15*60*1000};robotsCache.set(u.origin,cached);
  }
  const decision=robotsDecision(cached.text,u.pathname+(u.search||""));
  if(!decision.allowed)throw new Error(`robots.txt blokira ${u.pathname}: ${decision.reason}`);
  return await fetch(url,{headers:{"User-Agent":UA,"Accept":"application/json,text/html,application/xml,text/xml,*/*"},signal:AbortSignal.timeout(18000),redirect:"error"});
}
function priceFromMinor(p:any,minor=2){if(p==null)return null;const n=Number(p);return Number.isFinite(n)?n/Math.pow(10,minor):null}
function brandName(v:any):string|null { if(!v)return null;if(typeof v==="string")return v;if(Array.isArray(v))return brandName(v[0]);return typeof v.name==="string"?v.name:null; }
function parseQuantity(text:string):{amount:number;unit:"l"|"kg";label:string;count:number;each:number}|null {
  const t=String(text??"").replace(/,/g,".").toLowerCase();
  const multi=t.match(/\b(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(ml|cl|dl|l|g|kg)\b/i);
  const reverse=t.match(/\b(\d+(?:\.\d+)?)\s*(ml|cl|dl|l|g|kg)\s*[x×]\s*(\d+)\b/i);
  let amount:number,unit:string;
  const count=Number(multi?.[1]??reverse?.[3]??1);
  if(multi){amount=Number(multi[2]);unit=multi[3];}
  else if(reverse){amount=Number(reverse[1]);unit=reverse[2];}
  else {const m=t.match(/\b(\d+(?:\.\d+)?)\s*(ml|cl|dl|l|g|kg)\b/i);if(!m)return null;amount=Number(m[1]);unit=m[2];}
  if(!Number.isFinite(amount*count)||amount<=0||count<=0)return null;
  const scale:Record<string,number>={ml:1000,cl:100,dl:10,g:1000};
  const each=amount/(scale[unit]??1);
  const label=`${count>1?`${count} × `:""}${amount} ${unit}`;
  return {amount:each*count,unit:unit.endsWith("g")?"kg":"l",label,count,each};
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
 chocolate:/\b(cokoladno|kakav|cocoa|chocolate)\b/.test(n),
 };}
function milkType(text:string, fallback:"fresh"|null=null):"fresh"|"uht"|null {
 const n=norm(text);
 const fresh=/\b(sveze|svezega|fresh|frisch|pasteriziran\w*)\b|podaljsano svezino/.test(n);
 const uht=/\b(trajno|uht|haltbar|steriliziran\w*)\b/.test(n);
 if(fresh&&uht)return null;
 return fresh?"fresh":uht?"uht":fallback;
}
function sameQuantity(requested:NonNullable<ReturnType<typeof parseQuantity>>,actual:ReturnType<typeof parseQuantity>){
 return !!actual&&requested.unit===actual.unit&&requested.count===actual.count&&Math.abs(requested.each-actual.each)<0.000001;
}
function queryMatches(q:string,name:string,description="",weight=""):boolean {
 const title=norm(name);const combined=name+' '+description;
 if(/mleko za telo|losjon|lotion|milo|lonec|robcki|kopel|sampon|balzam|krema|kozmet/.test(title))return false;
 const qt=productType(q),nt=productType(name);if(qt&&nt!==qt)return false;
 if(qt==="milk"){
   const a=attributes(q),b=attributes(combined);
   if(a.lactoseFree!==b.lactoseFree||a.chocolate!==b.chocolate)return false;
   if(/\b(napitek|kislo|kondenzirano|kozje|ovcje|sojino|ovseno|rizevo|mandljevo|kokosovo)\b|\bv prahu\b/.test(title))return false;
   const requestedType=milkType(q,"fresh");
   if(!requestedType||requestedType!==milkType(combined))return false;
 }
 const qFat=q.match(/(\d+(?:[,.]\d+)?)\s*%/), nFat=(qt==="milk"?name:combined).match(/(\d+(?:[,.]\d+)?)\s*%/);
 if(qFat){if(!nFat||Math.abs(Number(qFat[1].replace(',','.'))-Number(nFat[1].replace(',','.')))>0.01)return false;}
 const requested=parseQuantity(q);
 const actual=parseQuantity(name)??parseQuantity(weight)??(qt==="milk"?null:parseQuantity(description));
 if(requested&&(qt==="milk"||actual)&&!sameQuantity(requested,actual))return false;
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
  const name=decodeHtml(input.name??"Neimenovan izdelek").replace(/\s+/g," ").trim();
  const quantity=parseQuantity(name)??parseQuantity(input.weight)??(productType(name)==="milk"?null:parseQuantity(input.description));
  const valid=validity(input.priceValidUntil);
  return {store:input.store,name,brand:brandName(input.brand),price,unit:quantity?.label??null,unit_price:quantity?price/quantity.amount:null,unit_measure:quantity?.unit??null,price_valid_until:valid.date,price_status:valid.status,eligible_for_basket:false,url:input.url??null,source:input.source??null,checked_at:new Date().toISOString()};
}
function applyBasketEligibility(offer:any,query:string,description=""){
  const requested=parseQuantity(query);
  const actual=offer.unit_price!=null?offer.price/offer.unit_price:null;
  offer.eligible_for_basket=Boolean(requested&&actual!==null&&offer.unit_measure===requested.unit&&Math.abs(actual-requested.amount)<0.001&&offer.price_status==="current"&&queryMatches(query,offer.name,description,offer.unit??""));
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
// SPAR search HTML streams Next.js records. Parse data only and use the detail
// page's EUR Offer for the price rather than the search card's promotion fields.
function sparProductPaths(html:string,q:string):string[] {
  const chunks:string[]=[];
  for(const match of html.matchAll(/<script>self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)<\/script>/g)){
    chunks.push(JSON.parse(match[1]));
  }
  const paths=new Set<string>();
  const milk=productType(q)==="milk";
  const requested=parseQuantity(q);
  const fat=q.match(/(\d+(?:[,.]\d+)?)\s*%/)?.[1]?.replace(",",".");
  for(const line of chunks.join("").split("\n")){
    const record=line.match(/^[a-f0-9]+:(\{.*\})$/);
    if(!record||!line.includes('"CatalogProductModel"'))continue;
    try{
      const p=JSON.parse(record[1]);
      if(p.__typename!=="CatalogProductModel"||p.isAvailable!==true||typeof p.name!=="string"||!/^[a-z0-9-]+$/.test(p.slug))continue;
      if(milk){
        const actual=parseQuantity(p.name);
        const actualFat=p.name.match(/(\d+(?:[,.]\d+)?)\s*%/)?.[1]?.replace(",",".");
        if(requested&&actual&&!sameQuantity(requested,actual))continue;
        if(fat&&actualFat&&Number(fat)!==Number(actualFat))continue;
      }
      paths.add("/p/"+p.slug);
    }catch{ /* Flight text can contain lines that are not JSON records. */ }
  }
 if(!chunks.length){
    throw new Error("SPAR: neprepoznan izpis kataloga");
  }
  return [...paths];
}
function sparDetail(html:string,url:string,q:string){
  const script=html.match(/<script\b[^>]*\bid="product-structured-data"[^>]*>([\s\S]*?)<\/script>/i);
  if(!script)return null;
  const p=JSON.parse(script[1]);
  const offer=p.offers;
  const price=offer?.priceSpecification?.price??offer?.price;
  const currency=offer?.priceSpecification?.priceCurrency??offer?.priceCurrency;
  if(p["@type"]!=="Product"||typeof p.name!=="string"||offer?.availability!=="https://schema.org/InStock"||currency!=="EUR")return null;
  const name=decodeHtml(p.name);
  const description=String(p.description??"");
  const weight=decodeHtml(description.match(/Neto količina<\/h3>\s*<p>([^<]*)<\/p>/i)?.[1]??"");
  const processing=decodeHtml(description.match(/Prehrambni tip artikla<\/h3>\s*<p>([^<]*)<\/p>/i)?.[1]??"");
  if(!queryMatches(q,name,processing,weight))return null;
  // Repeated requests showed priceValidUntil advancing with the request time.
  return makeOffer({store:"Spar",name,description:processing,weight,brand:p.brand,price,url,source:url});
}
function mercatorDetail(html:string,url:string,q:string){
  const title=html.match(/<h1 class="lib-analytics-product-name">([^<]*)<\/h1>/i)?.[1];
  // Only the visible package price. Ignore cards, old prices, unit rates and
  // analytics values that can still be present when a product cannot be bought.
  const price=html.match(/<div class="price-box\s*">\s*<span class="price">\s*(\d+,\d{2})\s*€\s*<\/span>/i)?.[1];
  if(!title||!price||!html.includes('data-analytics-label="AddToCartProductPage"'))return null;
  const name=decodeHtml(title).trim();
  if(!queryMatches(q,name))return null;
  return makeOffer({store:"Mercator",name,price:price.replace(",","."),url,source:url});
}
function discoveryTerms(q:string){
  const kind=productType(q);
  if(kind==="milk")return ["mleko"];
  if(kind==="butter")return ["maslo"];
  if(kind==="eggs")return ["jajca"];
  return norm(q).split(" ").filter(word=>word.length>2&&/^[a-z]/.test(word));
}
function candidateRank(path:string,q:string,terms:string[]){
  const slug=norm(path.split("/").pop()??"");
  const words=new Set(slug.split(" "));
  const hits=terms.filter(word=>words.has(word)).length;
  if(!hits)return 0;
  const milk=productType(q)==="milk";
  const type=milkType(slug);
  if(milk&&type&&type!==milkType(q,"fresh"))return 0;
  const fat=q.match(/(\d+(?:[,.]\d+)?)\s*%/)?.[1]?.replace(/[,.]/," ");
  return hits+(milk&&type?2:0)+(fat&&(" "+slug+" ").includes(" "+fat+" ")?4:0);
}
async function searchRetailer(store:"Spar"|"Mercator",q:string){
  const spar=store==="Spar";
  const base=spar?"https://online.spar.si":"https://mercatoronline.si";
  const terms=discoveryTerms(q);
  if(!terms.length)return [];
  const discovery=spar?base+"/search?name="+encodeURIComponent(terms.join(" ")):base+"/sitemap.xml";
  const response=await fetchPublic(discovery);
  if(!response.ok)throw new Error(store+" HTTP "+response.status);
  const body=await response.text();
  const mercatorPath=/^https:\/\/mercatoronline\.si(\/izdelek\/\d+\/[a-z0-9-]+)$/;
  const paths=spar?sparProductPaths(body,q):[...body.matchAll(/<loc>([^<]+)<\/loc>/gi)]
    .flatMap(m=>m[1].trim().match(mercatorPath)?.[1]??[]);
  if(!spar&&!paths.length)throw new Error("Mercator: zemljevid nima povezav do izdelkov");
  const candidates=[...new Set(paths)].map(path=>({path,rank:candidateRank(path,q,terms)}))
    .filter(p=>p.rank>0).sort((a,b)=>b.rank-a.rank).slice(0,12);
  const parse=spar?sparDetail:mercatorDetail;
  const out=[];
  let failures=0;
  for(let i=0;i<candidates.length;i+=4){
    const results=await Promise.allSettled(candidates.slice(i,i+4).map(async ({path})=>{
      const url=base+path;
      const page=await fetchPublic(url);
      if(page.status===404||page.status===410)return null;
      if(!page.ok)throw new Error(store+" HTTP "+page.status);
      return parse(await page.text(),url,q);
    }));
    for(const result of results){
      if(result.status==="rejected")failures++;
      else if(result.value)out.push(result.value);
    }
  }
  if(failures&&!out.length)throw new Error(store+": neuspešen dostop do strani izdelkov ("+failures+")");
  return out;
}
async function handleSearch(req:Request){
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 try{
  if(req.method!=="POST")return new Response(JSON.stringify({error:"POST required"}),{status:405,headers:jsonHeaders});
  const body=await req.json();const q=String(body.query||"").trim();if(q.length<2||q.length>100)throw new Error("Vnesi iskalni niz med 2 in 100 znaki.");
  const offers:any[]=[];const sources:Record<string,string>={};
  const jobs=[ ["Tuš",()=>searchTus(q)], ["Eurospin",()=>searchEurospin(q)], ["Lidl",()=>searchSitemap("Lidl",q)], ["Hofer",()=>searchSitemap("Hofer",q)], ["Spar",()=>searchRetailer("Spar",q)], ["Mercator",()=>searchRetailer("Mercator",q)] ] as const;
  await Promise.all(jobs.map(async([name,fn])=>{try{const rows=await fn();offers.push(...rows);sources[name]=`${rows.length} ustreznih ponudb`; }catch(e){sources[name]=`ni podatka: ${String(e).slice(0,150)}`;}}));
  
  const summary={total:offers.length,eligible:offers.filter(x=>x.eligible_for_basket).length,unverified:offers.filter(x=>x.price_status==="unverified").length,expired:offers.filter(x=>x.price_status==="expired").length};
  return new Response(JSON.stringify({query:q,offers:offers.filter(x=>x.price_status!=="expired"),sources,summary,notice:"Brez dokazljive veljavnosti cene ponudba ostane nepotrjena. Pri mleku brez navedene vrste iščemo sveže mleko. Za trajno mleko dodaj trajno ali UHT."}),{headers:jsonHeaders});
 }catch(e){return new Response(JSON.stringify({error:String(e)}),{status:400,headers:jsonHeaders});}
}

Deno.serve(handleSearch);
