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
const decodeHtml=(s:string)=>String(s??"").replace(/&nbsp;|&#160;/g," ").replace(/&euro;/g,"€").replace(/&#39;|&apos;/g,"'").replace(/&quot;|&#34;/g,'"').replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");
const plainText=(s:string)=>decodeHtml(s.replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim();
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
function queryMatches(q:string,name:string,description="",weight="",brand=""):boolean {
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
 if(!qt){
   const meaningful=norm(q).split(" ").filter(x=>x.length>3&&!/^\d/.test(x));
   const words=new Set(norm(name+" "+brand).split(" "));
   if(!meaningful.length||!meaningful.every(word=>words.has(word)))return false;
 }
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
  const diapers=/\bplenice\b/.test(norm(name));
  const pieces=diapers?Number(name.match(/\b(\d+)\s*(?:\/\s*1\b|kos(?:ov)?\b)/i)?.[1]):0;
  const quantity=diapers
    ? pieces>0?{amount:pieces,unit:"kos",label:`${pieces} kos`}:null
    : parseQuantity(name)??parseQuantity(input.weight)??(productType(name)==="milk"?null:parseQuantity(input.description));
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
 const term=discoveryTerms(q)[0];
 if(!term)return [];
 const url=`https://www.tus.si/wp-json/wc/store/products?search=${encodeURIComponent(term)}&per_page=50`;
 const r=await fetchPublic(url);
 if(!r.ok)throw new Error(`Tuš HTTP ${r.status}`);
 const products=await r.json();
 if(!Array.isArray(products))throw new Error("Tuš: neprepoznan odgovor kataloga");
 const candidates=products.filter(p=>{
   if(typeof p.name!=="string"||!/^https:\/\/www\.tus\.si\/izdelki\/[a-z0-9-]+\/$/.test(p.permalink))return false;
   const description=plainText(p.description??p.short_description??"");
   const quantity=parseQuantity(q);
   return (!quantity||sameQuantity(quantity,parseQuantity(p.name)))&&
     (productType(q)==="milk"?productType(p.name)==="milk":queryMatches(q,decodeHtml(p.name),description,"",brandName(p.brands)??""));
 });
 return await searchProductPages("Tuš",candidates.map(p=>p.permalink),(html,url)=>{
   const product=structuredProducts(html)[0];
   if(typeof product?.name!=="string")return null;
   const description=plainText(product.description??"");
   const brand=brandName(product.brand);
   if(!queryMatches(q,product.name,description,"",brand??""))return null;
   const regular=html.match(/<p class="price-regular"[^>]*>\s*<label>\s*Redna cena:\s*<\/label>\s*([\d,]+)\s*(?:€|&euro;)\s*<\/p>/i)?.[1];
   const offer=product.offers;
   // The catalogue's sale price can require a club card, coupon or minimum quantity.
   const price=regular?Number(regular.replace(",",".")):
     /price-discounted|Veljavnost akcije:/i.test(html)?null:
     offer?.priceCurrency==="EUR"?offer.price:null;
   return makeOffer({store:"Tuš",name:product.name,description,brand,price,url,source:url});
 });
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
function structuredProducts(html:string):any[]{
  return [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].flatMap(match=>{
    try{return collectProducts(JSON.parse(match[1]));}catch{return [];}
  });
}
async function searchProductPages(store:string,urls:string[],parse:(html:string,url:string)=>ReturnType<typeof makeOffer>){
  const out:NonNullable<ReturnType<typeof makeOffer>>[]=[];
  let failures=0;
  const candidates=[...new Set(urls)].slice(0,12);
  for(let i=0;i<candidates.length;i+=4){
    const pages=await Promise.allSettled(candidates.slice(i,i+4).map(async url=>{
      const page=await fetchPublic(url);
      if(page.status===404||page.status===410)return null;
      if(!page.ok)throw new Error(store+" HTTP "+page.status);
      return parse(await page.text(),url);
    }));
    for(const page of pages){
      if(page.status==="rejected")failures++;
      else if(page.value)out.push(page.value);
    }
  }
  if(failures&&!out.length)throw new Error(store+": neuspešen dostop do strani izdelkov ("+failures+")");
  return out;
}
async function searchLidlDairy(q:string){
  const url="https://www.lidl.si/h/mlecni-izdelki-in-jajca/h10095761";
  const response=await fetchPublic(url);
  if(!response.ok)throw new Error("Lidl HTTP "+response.status);
  const html=await response.text();
  const tiles=[...html.matchAll(/\bdata-grid-data="([^"]+)"/g)];
  if(!tiles.length)throw new Error("Lidl: neprepoznana kategorija izdelkov");
  const offers=new Map<string,NonNullable<ReturnType<typeof makeOffer>>>();
  const requested=parseQuantity(q);
  for(const tile of tiles){
    let p;
    try{p=JSON.parse(decodeHtml(tile[1]));}catch{continue;}
    const path=p.canonicalPath;
    if(typeof path!=="string"||!/^\/p\/[a-z0-9-]+\/p\d+$/.test(path))continue;
    if(typeof p.fullTitle!=="string"||p.price?.currencyCode!=="EUR"||p.lidlPlus?.length)continue;
    const details=plainText(p.keyfacts?.description??"");
    const weight=plainText(p.price?.packaging?.text??"");
    const brand=brandName(p.brand);
    // Keep the published public price informational. A listing can be location-dependent.
    const name=productType(q)==="milk"?milkDisplayName(p.fullTitle,details):p.fullTitle;
    const quantity=parseQuantity(name)??parseQuantity(weight);
    if(!queryMatches(q,name,details,weight,brand??""))continue;
    if(requested&&!sameQuantity(requested,quantity))continue;
    if(p.multipack===true&&(!quantity||quantity.count===1))continue;
    const offer=makeOffer({store:"Lidl",name,brand,weight,price:p.price.price,url:"https://www.lidl.si"+path,source:url});
    if(offer)offers.set(path,offer);
  }
  return [...offers.values()];
}
function milkDisplayName(name:string,details:string){
  const fat=details.match(/\b\d+(?:[,.]\d+)?\s*%/)?.[0];
  return fat&&!name.includes("%")?name+", "+fat:name;
}
async function searchSitemap(store:"Lidl"|"Hofer",q:string){
  if(store==="Lidl"&&["milk","butter","eggs"].includes(productType(q)??""))return await searchLidlDairy(q);
  const cfg=store==="Lidl"?SOURCES.lidl:SOURCES.hofer;
  const sitemap=cfg.base+cfg.endpoint;
  const response=await fetchPublic(sitemap);
  if(!response.ok)throw new Error(store+" sitemap HTTP "+response.status);
  const xml=sitemap.endsWith(".gz")
    ?await new Response(response.body!.pipeThrough(new DecompressionStream("gzip"))).text()
    :await response.text();
  const terms=discoveryTerms(q);
  if(!terms.length)return [];
  const path=store==="Hofer"?/^\/izdelek\/[a-z0-9-]+$/:/^\/p\/[a-z0-9-]+\/p\d+$/;
  const candidates=[...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].flatMap(match=>{
    try{
      const url=new URL(match[1].trim());
      if(url.origin!==cfg.base||!path.test(url.pathname))return [];
      const rank=candidateRank(store==="Lidl"?url.pathname.replace(/\/p\d+$/,""):url.pathname,q,terms);
      return rank?[{url:url.href,rank}]:[];
    }catch{return [];}
  }).sort((a,b)=>b.rank-a.rank);
  return await searchProductPages(store,candidates.map(p=>p.url),(html,url)=>{
    const p=structuredProducts(html)[0];
    if(typeof p?.name!=="string")return null;
    const brand=brandName(p.brand);
    const description=plainText(p.description??"");
    const weight=store==="Hofer"?description:"";
    // Hofer puts the milk composition and pack size into the product facts.
    const name=store==="Hofer"&&productType(q)==="milk"?milkDisplayName(p.name,description):p.name;
    if(!queryMatches(q,name,description,weight,brand??""))return null;
    const offers=Array.isArray(p.offers)?p.offers:p.offers?[p.offers]:[];
    const offer=offers.find((x:any)=>x["@type"]==="Offer"&&x.priceCurrency==="EUR");
    if(offer&&validity(offer.priceValidUntil).status==="expired")return null;
    const regular=store==="Hofer"?html.match(/<span class="base-price__regular">\s*<span>\s*(\d+,\d{2})(?:\s|&nbsp;)*(?:€|&euro;)\s*<\/span>/i)?.[1]:null;
    const price=regular?Number(regular.replace(",",".")):offer?.price;
    return makeOffer({store,name,description,weight,brand,price,url,source:url});
  });
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
