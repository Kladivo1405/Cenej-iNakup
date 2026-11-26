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
function parseQuantity(text:string):{amount:number;unit:"l"|"kg"|"kos";label:string;count:number;each:number}|null {
  const t=String(text??"").replace(/,/g,".").toLowerCase();
  const pieces=t.match(/\b(\d+)\s*(?:kos(?:ov|i|a)?\b|kom\b|pieces\b|\/\s*1\b)/);
  if(pieces)return {amount:Number(pieces[1]),unit:"kos",label:pieces[1]+" kos",count:1,each:Number(pieces[1])};
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
function milkType(text:string, fallback:"uht"|null=null):"fresh"|"uht"|null {
 const n=norm(text);
 const fresh=/\b(sveze|svezega|fresh|frisch|pasteriziran\w*)\b|podaljsano svezino/.test(n);
 const uht=/\b(trajno|uht|haltbar|steriliziran\w*)\b/.test(n);
 if(fresh&&uht)return null;
 return fresh?"fresh":uht?"uht":fallback;
}
function sameQuantity(requested:NonNullable<ReturnType<typeof parseQuantity>>,actual:ReturnType<typeof parseQuantity>){
 return !!actual&&requested.unit===actual.unit&&requested.count===actual.count&&Math.abs(requested.each-actual.each)<0.000001;
}
function packageQuantity(name:string,weight="",description=""){
 const piecesOnly=/\b(plenice|jajca|jajce)\b/.test(norm(name));
 if(piecesOnly){
   for(const field of [name,weight]){
     const quantity=parseQuantity(field);
     if(quantity?.unit==="kos")return quantity;
   }
   return null;
 }
 return parseQuantity(name)??parseQuantity(weight)??(productType(name)==="milk"?null:parseQuantity(description));
}
function searchWords(q:string){
 return norm(q.replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|ml|cl|dl|l|kos(?:ov|i|a)?|kom)\b/gi," "))
   .split(" ").filter(word=>word.length>=3&&/^[a-z]/.test(word)&&!["pak","kos","kom"].includes(word));
}
function diaperSize(text:string){
 return norm(text).match(/\b(?:velikost|vel|size|maxi|junior|midi|s)\s*(\d{1,2})\b|\bs(\d{1,2})\b/)?.slice(1).find(Boolean)??null;
}
function eggSize(text:string){return text.match(/\b(?:XL|[SML])\b/i)?.[0].toUpperCase()??null;}
function rearing(text:string){return norm(text).match(/\b(hlevska|prosta|talna|ekoloska|baterijska)\b/)?.[0]??null;}
function greekYogurt(text:string){
 const words=norm(text);
 return /\bjogurt(?:a)?\b/.test(words)&&/\b(?:grski|grskem|grski nacin|greek)\b/.test(words);
}
function greekYogurtTerms(q:string){
 return searchWords(q).filter(word=>!["grski","grskem","nacin","greek","jogurt","jogurta"].includes(word));
}
function queryMatches(q:string,name:string,description="",weight="",brand=""):boolean {
 const title=norm(name);const combined=name+' '+description;
 const requestedWords=norm(q);
 const greek=greekYogurt(q);
 if(greek&&!greekYogurt(name))return false;
 if(/\bbaterij\w*\s+aa\b/.test(requestedWords)){
   const battery=norm(combined+" "+weight);
   if(!/\b(?:aa|lr6|hr6|r6)\b/.test(battery)||/\b(?:gumbn\w*|cr\d{4})\b/.test(title))return false;
 }
 if(/^parmezan(?:\s+\d.*)?$/.test(requestedWords)&&/\b(?:namaz|salama|omaka|juha|prigrizek)\b/.test(title))return false;
 if(/mleko za telo|losjon|lotion|milo|lonec|robcki|kopel|sampon|balzam|krema|kozmet/.test(title))return false;
 const qt=productType(q),nt=productType(name);if(qt&&nt!==qt)return false;
 if(qt==="eggs"&&((eggSize(q)&&eggSize(name)!==eggSize(q))||(rearing(q)&&rearing(combined)!==rearing(q))))return false;
 if(/\bplenice\b/.test(norm(q))&&diaperSize(q)&&diaperSize(name)!==diaperSize(q))return false;
 if(qt==="milk"){
   if(/\balpsko\b/.test(norm(q))&&!/\balpsko\b/.test(norm(name+" "+brand)))return false;
   const a=attributes(q),b=attributes(combined);
   if(a.lactoseFree!==b.lactoseFree||a.chocolate!==b.chocolate)return false;
   if(/\b(napitek|kislo|kondenzirano|kozje|ovcje|sojino|ovseno|rizevo|mandljevo|kokosovo)\b|\bv prahu\b/.test(title))return false;
   const requestedType=milkType(q,"uht");
   if(!requestedType||requestedType!==milkType(combined))return false;
 }
 const qFat=q.match(/(\d+(?:[,.]\d+)?)\s*%/), nFat=(qt==="milk"?name:combined).match(/(\d+(?:[,.]\d+)?)\s*%/);
 if(qFat){if(!nFat||Math.abs(Number(qFat[1].replace(',','.'))-Number(nFat[1].replace(',','.')))>0.01)return false;}
 const requested=parseQuantity(q);
 const actual=packageQuantity(name,weight,description);
 if(requested&&!sameQuantity(requested,actual))return false;
 if(!qt||qt==="eggs"){
   const terms=/\bplenice\b/.test(norm(q))&&diaperSize(q)?q.replace(/\b(?:velikost|vel|size|maxi|junior|midi|s)\s*\d{1,2}\b|\bs\d{1,2}\b/gi," "):q;
   const meaningful=greek?greekYogurtTerms(terms):searchWords(terms);
   const words=new Set(norm(name+" "+brand).split(" "));
   if((!greek&&!meaningful.length)||!meaningful.every(word=>words.has(word)))return false;
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
  const quantity=packageQuantity(name,input.weight,input.description);
  const valid=validity(input.priceValidUntil);
  return {store:input.store,name,brand:brandName(input.brand),price,unit:quantity?.label??null,unit_price:quantity?price/quantity.amount:null,unit_measure:quantity?.unit??null,price_valid_until:valid.date,price_status:valid.status,eligible_for_basket:false,url:input.url??null,source:input.source??null,checked_at:new Date().toISOString()};
}
function applyBasketEligibility(offer:any,query:string,description=""){
  const requested=parseQuantity(query);
  offer.eligible_for_basket=Boolean(requested&&sameQuantity(requested,parseQuantity(offer.unit))&&offer.price_status==="current"&&queryMatches(query,offer.name,description,offer.unit??"",offer.brand??""));
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
   return (!quantity||sameQuantity(quantity,packageQuantity(p.name)))&&
     (productType(q)==="milk"?productType(p.name)==="milk":queryMatches(q,decodeHtml(p.name),description,"",brandName(p.brands)??""));
 });
 return await searchProductPages("Tuš",candidates.map(p=>p.permalink),(html,url)=>{
   const product=structuredProducts(html)[0];
   if(typeof product?.name!=="string")return null;
   const ingredientsTab=html.match(/<li\s+data-id="(\d+)"\s+class="[^"]*\bingredients\b[^"]*"/i)?.[1];
   const ingredients=ingredientsTab
     ?plainText(html.match(new RegExp('<div class="tab-content js-tab-content[^"]*" data-id="'+ingredientsTab+'"[^>]*>([\\s\\S]*?)<\\/div>',"i"))?.[1]??"")
     :"";
   const milk=productType(q)==="milk";
   const description=milk?ingredients||plainText(product.description??""):plainText(product.description??"");
   const name=milk?milkDisplayName(product.name,description):product.name;
   const brand=brandName(product.brand);
   if(!queryMatches(q,name,description,"",brand??""))return null;
   const regular=html.match(/<p class="price-regular"[^>]*>\s*<label>\s*Redna cena:\s*<\/label>\s*([\d,]+)\s*(?:€|&euro;)\s*<\/p>/i)?.[1];
   const offer=product.offers;
   // The catalogue's sale price can require a club card, coupon or minimum quantity.
   const price=regular?Number(regular.replace(",",".")):
     /price-discounted|Veljavnost akcije:/i.test(html)?null:
     offer?.priceCurrency==="EUR"?offer.price:null;
   return makeOffer({store:"Tuš",name,description,brand,price,url,source:url});
 });
}
async function searchEurospin(q:string){
 const url="https://www.eurospin.si/akcije/";
 const response=await fetchPublic(url);
 if(!response.ok)throw new Error("Eurospin HTTP "+response.status);
 const html=await response.text();
 const cards=[...html.matchAll(/<a\b[^>]*class="sn_promo_grid_item"[^>]*>([\s\S]*?)<\/a>/gi)];
 if(!cards.length)throw new Error("Eurospin: neprepoznane kartice izdelkov");
 const result=[];
 for(const [,card] of cards){
   const name=plainText(card.match(/<h2\b[^>]*itemprop="name"[^>]*>([\s\S]*?)<\/h2>/i)?.[1]??"");
   const brand=plainText(card.match(/<div itemprop="brand"[^>]*>([^<]*)<\/div>/i)?.[1]??"");
   const weight=plainText(card.match(/<div class="i_price_info"[^>]*>([^<]*)<\/div>/i)?.[1]??"").split(/\s+-\s+/)[0];
   const range=plainText(card.match(/<div class="date_current_promo"[^>]*>([^<]*)<\/div>/i)?.[1]??"");
   const price=plainText(card.match(/<i itemprop="price"[^>]*>([^<]*)<\/i>/i)?.[1]??"").match(/^(\d+,\d{2})\s*€$/)?.[1];
   if(!name||!price||!activeEurospinRange(range)||!queryMatches(q,name,"",weight,brand))continue;
   const offer=makeOffer({store:"Eurospin",name,brand,weight,price:Number(price.replace(",",".")),url,source:url});
   if(offer)result.push(offer);
 }
 return result.slice(0,20);
}
function activeEurospinRange(text:string,now=new Date()){
 const range=text.match(/^(\d{1,2})\.(\d{1,2})\.?\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.?$/);
 if(!range)return false;
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Ljubljana",month:"numeric",day:"numeric"}).formatToParts(now);
 const today=Number(parts.find(p=>p.type==="month")?.value)*100+Number(parts.find(p=>p.type==="day")?.value);
 const start=Number(range[2])*100+Number(range[1]),end=Number(range[4])*100+Number(range[3]);
 return start<=end?today>=start&&today<=end:today>=start||today<=end;
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
const CATEGORY_PAGES=[
  {words:/\b(mleko|maslo|jajca|sir|parmezan|jogurt|smetana|skuta)\b/,lidl:"/h/mlecni-izdelki-in-jajca/h10095761",hofer:"/izdelki/mleko-mlecni-izdelki-in-jajca/k/1588161418378170"},
  {words:/\b(riz|testenine|moka|sladkor|strocnice|leca)\b/,lidl:"/h/iz-shrambe/h10096095",hofer:"/izdelki/testenine-riz-in-strocnice/k/1588161418378190"},
  {words:/\b(poli|salama|hrenovke|piscanec|sunka|meso|prust|prsut)\b/,lidl:"/h/meso-in-perutnina/h10095752",hofer:"/izdelki/meso-mesni-izdelki-in-ribe/k/1588161418378160"},
  {words:/\b(kava|caj|kakav)\b/,lidl:"/h/kava-caj-in-kakav/h10071683",hofer:null},
  {words:/\b(cips|krekerji|kokice|piskoti|cokolada)\b/,lidl:"/h/sladkarije-in-prigrizki/h10096205",hofer:"/izdelki/sladki-in-slani-prigrizki/k/1588161418378240"},
  {words:/\b(plenice|robcki)\b/,lidl:"/h/dojencki-in-otroci/h10096283",hofer:"/izdelki/otroska-prehrana-in-nega/k/1588161418378290"},
  {words:/\b(kruh|kajzerica|zemlja|bageta)\b/,lidl:"/h/pekarna/h10096086",hofer:"/izdelki/pekovski-izdelki-namazi-in-kosmici/k/1588161418378180"},
  {words:/\b(pivo|vino|lasko)\b/,lidl:"/h/vino-pivo-in-zgane-pijace/h10096268",hofer:"/izdelki/alkoholne-pijace/k/1588161418378260"},
  {words:/\b(voda|sok|pijaca)\b/,lidl:"/h/pijace/h10071022",hofer:"/izdelki/brezalkoholne-pijace/k/1588161418378250"},
  {words:/\b(jabolka|banane|krompir|cebula|solata)\b/,lidl:"/h/sadje-in-zelenjava/h10071012",hofer:"/izdelki/sadje-in-zelenjava/k/1588161418378150"},
] as const;
async function searchLidlListings(q:string,upcoming=false){
  const category=CATEGORY_PAGES.find(entry=>entry.words.test(norm(q)))?.lidl;
  const terms=discoveryTerms(q);
  if(!terms.length)return [];
  const term=/\balpsko\b/.test(norm(q))?"alpsko mleko":terms.join(" ");
  const search="https://www.lidl.si/q/search?q="+encodeURIComponent(term);
  const urls=category?["https://www.lidl.si"+category,search]:[search];
  const pages=await Promise.allSettled(urls.map(async url=>{
    const result=await fetchPublic(url);
    if(result.status===404||result.status===410)return [];
    if(!result.ok)throw new Error("Lidl HTTP "+result.status);
    return lidlGridOffers(await result.text(),url,q,upcoming);
  }));
  const offers=new Map<string,NonNullable<ReturnType<typeof makeOffer>>&{available_from?:string;available_until?:string}>();
  for(const page of pages)if(page.status==="fulfilled")for(const offer of page.value){
    if(!offers.has(offer.url))offers.set(offer.url,offer);
  }
  if(pages.every(page=>page.status==="rejected"))throw new Error("Lidl: javne strani trenutno nedosegljive");
  return [...offers.values()];
}
function lidlGridOffers(html:string,url:string,q?:string,upcoming=false,now=Date.now()){
  const tiles=[...html.matchAll(/\bdata-grid-data="([^"]+)"/g)];
  if(!tiles.length&&url.includes("/h/"))throw new Error("Lidl: neprepoznana kategorija izdelkov");
  const offers=new Map<string,NonNullable<ReturnType<typeof makeOffer>>&{available_from?:string;available_until?:string}>();
  const requested=q?parseQuantity(q):null;
  for(const tile of tiles){
    let p;
    try{p=JSON.parse(decodeHtml(tile[1]));}catch{continue;}
    const path=p.canonicalPath;
    if(typeof path!=="string"||!/^\/p\/[a-z0-9-]+\/p\d+$/.test(path))continue;
    if(typeof p.fullTitle!=="string"||p.price?.currencyCode!=="EUR"||p.lidlPlus?.length||p.price.variantsHaveDifferentPrices)continue;
    const schedule=p.stockAvailability?.badgeInfoV2?.find((entry:any)=>
      entry.badges?.some((badge:any)=>String(badge.type).includes("DATE_RANGE"))&&
      Number.isFinite(entry.validFrom)&&Number.isFinite(entry.validUntil));
    const starts=schedule?schedule.validFrom*1000:null;
    const ends=schedule?schedule.validUntil*1000:null;
    if(upcoming?(starts===null||starts<=now):(starts!==null&&starts>now)||(ends!==null&&ends<now))continue;
    if(!schedule&&p.stockAvailability?.badgeInfo?.badges?.some((badge:any)=>String(badge.type).includes("FUTURE")))continue;
    const dates=p.regionsPrices?.["1"]?.currentPrice;
    if(Date.parse(dates?.endDate)<(upcoming?(starts??now):now))continue;
    const details=plainText(p.keyfacts?.description??"");
    const weight=plainText(p.price?.packaging?.text??"");
    const brand=brandName(p.brand);
    // Keep the published public price informational. A listing can be location-dependent.
    const name=productType(p.fullTitle)==="milk"?milkDisplayName(p.fullTitle,details):p.fullTitle;
    const quantity=packageQuantity(name,weight);
    if(q&&!queryMatches(q,name,details,weight,brand??""))continue;
    if(requested&&!sameQuantity(requested,quantity))continue;
    if(p.multipack===true&&(!quantity||quantity.count===1))continue;
    const offer=makeOffer({store:"Lidl",name,brand,weight,price:p.price.price,url:"https://www.lidl.si"+path,source:url});
    if(offer)offers.set(path,upcoming&&starts!==null&&ends!==null?{
      ...offer,available_from:new Date(starts).toISOString(),available_until:new Date(ends).toISOString()
    }:offer);
  }
  return [...offers.values()];
}
function milkDisplayName(name:string,details:string){
  const fat=details.match(/\b\d+(?:[,.]\d+)?\s*%/)?.[0];
  return fat&&!name.includes("%")?name+", "+fat:name;
}
async function searchSitemap(store:"Lidl"|"Hofer",q:string){
  const dairy=["milk","butter","eggs"].includes(productType(q)??"");
  if(store==="Lidl"&&dairy)return await searchLidlListings(q);
  const [details,listings]=await Promise.allSettled([
    searchCatalogDetails(store,q),
    store==="Lidl"?searchLidlListings(q):searchHoferListings(q)
  ]);
  const rows=[
    ...(details.status==="fulfilled"?details.value:[]),
    ...(listings.status==="fulfilled"?listings.value:[]),
  ];
  if(!rows.length){
    if(details.status==="rejected")throw details.reason;
    if(listings.status==="rejected")throw listings.reason;
  }
  const merged=new Map<string,NonNullable<ReturnType<typeof makeOffer>>>();
  for(const offer of rows){
    const existing=merged.get(offer.url);
    if(!existing||(!existing.unit&&offer.unit&&existing.price===offer.price))merged.set(offer.url,offer);
  }
  return [...merged.values()];
}
async function searchHoferListings(q:string){
  const base=SOURCES.hofer.base;
  const category=CATEGORY_PAGES.find(entry=>entry.words.test(norm(q)))?.hofer;
  const urls=[...(category?[base+category]:[]),base+"/izdelki/vse-spuscene-cene/k/1588161418378360"];
  const pages=await Promise.all(urls.map(readHoferCategory));
  if(pages.every(page=>!page.html))throw new Error("Hofer: javne kategorije trenutno nedosegljive");
  return pages.flatMap(({url,html})=>hoferGridOffers(html,url,q));
}
async function searchCatalogDetails(store:"Lidl"|"Hofer",q:string){
  const cfg=store==="Lidl"?SOURCES.lidl:SOURCES.hofer;
  const sitemap=cfg.base+cfg.endpoint;
  const dairy=store==="Hofer"&&["milk","butter","eggs"].includes(productType(q)??"");
  const categoryUrls=dairy?[
    cfg.base+"/izdelki/mleko-mlecni-izdelki-in-jajca/k/1588161418378170",
    cfg.base+"/izdelki/vse-spuscene-cene/k/1588161418378360"
  ]:[];
  const [sitemapResult,...categories]=await Promise.all([
    fetchPublic(sitemap).then(async response=>{
      if(!response.ok)throw new Error(store+" sitemap HTTP "+response.status);
      const xml=sitemap.endsWith(".gz")
        ?await new Response(response.body!.pipeThrough(new DecompressionStream("gzip"))).text()
        :await response.text();
      return {links:[...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m=>m[1].trim()),error:null};
    }).catch(error=>({links:[],error})),
    ...categoryUrls.map(async url=>{
      const {html}=await readHoferCategory(url);
      return {links:await hoferCategoryLinks(url,html),error:null};
    })
  ]);
  const links=categories.flatMap(category=>category.links).concat(sitemapResult.links);
  if(!links.length&&sitemapResult.error)throw sitemapResult.error;
  const terms=discoveryTerms(q);
  if(!terms.length)return [];
  const path=store==="Hofer"?/^\/izdelek\/[a-z0-9-]+$/:/^\/p\/[a-z0-9-]+\/p\d+$/;

  const candidates=[...new Set(links)].flatMap(link=>{
    try{
      const url=new URL(link);
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
async function readHoferCategory(url:string){
  const html=await fetchPublic(url).then(r=>r.ok?r.text():"").catch(()=>"");
  return {url,html};
}
function hoferGridOffers(html:string,source:string,q:string){
  const out=[];
  for(const card of html.matchAll(/<a href="(\/izdelek\/[a-z0-9-]+)" class="base-link product-tile__link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)){
    const body=card[2];
    // This marker identifies the regular-price cards on Hofer's category pages.
    if(!body.includes("TO NI AKCIJA"))continue;
    const name=plainText(body.match(/<div class="product-tile__name"[^>]*>\s*<p[^>]*>([^<]*)/i)?.[1]??"");
    const brand=plainText(body.match(/<div class="product-tile__brandname"[^>]*>\s*<p[^>]*>([^<]*)/i)?.[1]??"");
    const weight=plainText(body.match(/class="product-tile__unit-of-measurement"[^>]*><p>([^<]*)/i)?.[1]??"");
    const price=body.match(/<span class="base-price__regular">\s*<span>\s*(\d+,\d{2})(?:\s|&nbsp;)*(?:€|&euro;)\s*<\/span>/i)?.[1];
    if(!name||!price||!queryMatches(q,name,"",weight,brand))continue;
    const offer=makeOffer({store:"Hofer",name,brand,weight,price:Number(price.replace(",",".")),url:"https://www.hofer.si"+card[1],source});
    if(offer)out.push(offer);
  }
  return out;
}
async function hoferCategoryLinks(url:string,first:string){
  const category=new URL(url);
  const paths=[...first.matchAll(/href="([^"]+\?page=\d+)"/gi)].flatMap(m=>{
    try{
      const page=new URL(m[1],url);
      return page.origin===category.origin&&page.pathname===category.pathname?[page.href]:[];
    }catch{return [];}
  });
  const pages=[first,...(await Promise.all([...new Set(paths)].slice(0,4).map(readHoferCategory))).map(page=>page.html)];
  return pages.flatMap(html=>[...html.matchAll(/href="(\/izdelek\/[a-z0-9-]+)"/gi)].map(m=>category.origin+m[1]));
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
  let models=0;
  for(const line of chunks.join("").split("\n")){
    const record=line.match(/^[a-f0-9]+:([\[{].*)$/);
    if(!record||!line.includes('"CatalogProductModel"'))continue;
    let root:unknown;
    try{
      root=JSON.parse(record[1]);
    }catch{continue;}
    const pending:unknown[]=[root];
    while(pending.length){
      const value=pending.pop();
      if(!value||typeof value!=="object")continue;
      const p=value as Record<string,unknown>;
      if(p.__typename!=="CatalogProductModel"){
        const children=Object.values(value);
        for(let i=children.length-1;i>=0;i--)pending.push(children[i]);
        continue;
      }
      models++;
      if(p.isAvailable!==true||typeof p.name!=="string"||typeof p.slug!=="string"||!/^[a-z0-9-]+$/.test(p.slug))continue;
      if(milk){
        const actual=parseQuantity(p.name);
        const actualFat=p.name.match(/(\d+(?:[,.]\d+)?)\s*%/)?.[1]?.replace(",",".");
        if(requested&&actual&&!sameQuantity(requested,actual))continue;
        if(fat&&actualFat&&Number(fat)!==Number(actualFat))continue;
      }
      paths.add("/p/"+p.slug);
    }
  }
 if(!chunks.length||(!models&&html.includes("CatalogProductModel"))){
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
  if(!queryMatches(q,name,processing,weight,brandName(p.brand)??""))return null;
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
  if(greekYogurt(q))return ["jogurt"];
  if(kind==="milk")return ["mleko"];
  if(kind==="butter")return ["maslo"];
  if(kind==="eggs")return ["jajca"];
  return searchWords(q);
}
function candidateRank(path:string,q:string,terms:string[],target=parseQuantity(q)){
  const slug=norm(path.split("/").pop()??"");
  const words=new Set(slug.split(" "));
  const hits=terms.filter(word=>words.has(word)).length;
  if(greekYogurt(q)){
    if(!greekYogurt(slug))return 0;
    const size=parseQuantity(path);
    if(!target||!size||size.unit!==target.unit||size.count!==target.count)return 1;
    return 2+1/(1+Math.abs(size.amount-target.amount)*1000);
  }
  if(!hits)return 0;
  const milk=productType(q)==="milk";
  const type=milkType(slug);
  if(milk&&type&&type!==milkType(q,"uht"))return 0;
  const fat=q.match(/(\d+(?:[,.]\d+)?)\s*%/)?.[1]?.replace(/[,.]/," ");
  return hits+(milk&&type?2:0)+(fat&&(" "+slug+" ").includes(" "+fat+" ")?4:0);
}
async function searchRetailer(store:"Spar"|"Mercator",q:string,target=parseQuantity(q)){
  const spar=store==="Spar";
  const base=spar?"https://online.spar.si":"https://mercatoronline.si";
  const terms=discoveryTerms(q);
  if(!terms.length)return [];
  const discovery=spar?base+"/search?name="+encodeURIComponent(greekYogurt(q)?"grški":terms.join(" ")):base+"/sitemap.xml";
  const response=await fetchPublic(discovery);
  if(!response.ok)throw new Error(store+" HTTP "+response.status);
  const body=await response.text();
  const mercatorPath=/^https:\/\/mercatoronline\.si(\/izdelek\/\d+\/[a-z0-9-]+)$/;
  const paths=spar?sparProductPaths(body,q):[...body.matchAll(/<loc>([^<]+)<\/loc>/gi)]
    .flatMap(m=>m[1].trim().match(mercatorPath)?.[1]??[]);
  if(!spar&&!paths.length)throw new Error("Mercator: zemljevid nima povezav do izdelkov");
  const candidates=[...new Set(paths)].map(path=>({path,rank:candidateRank(path,q,terms,target)}))
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
function substitutionFor(query:string):{query:string;reason:string;rank:(offer:any)=>number}|null {
 const type=productType(query);
 const quantity=parseQuantity(query);
 if(greekYogurt(query)&&quantity?.unit==="kg"&&quantity.count===1){
   const relaxed=query.replace(/\b\d+(?:[,.]\d+)?\s*(?:kg|g)\b/i,"").trim();
   return {query:relaxed,reason:"Druga velikost pakiranja",rank:offer=>{
     const size=parseQuantity(offer.unit);
     if(!size||size.unit!=="kg"||size.count!==1||!greekYogurt(offer.name))return Infinity;
     const difference=Math.abs(size.amount-quantity.amount);
     return difference>0.000001&&difference<=quantity.amount*0.25+0.000001?difference:Infinity;
   }};
 }
 if(type==="milk"&&quantity&&milkType(query,"uht")){
   const fat=query.match(/(\d+(?:[,.]\d+)?)\s*%/);
   if(fat){
     const target=Number(fat[1].replace(",","."));
     return {query:query.replace(fat[0]," ").replace(/\bm[.\s]*m\./i," ").trim(),reason:"Drugačen delež maščobe",rank:offer=>{
       const value=offer.name.match(/(\d+(?:[,.]\d+)?)\s*%/)?.[1];
       const difference=Math.abs(Number(value?.replace(",","."))-target);
       return difference>0?difference:Infinity;
     }};
   }
 }
 const normalized=norm(query);
 const brandPatterns=[
   {valid:/\bplenice\b/.test(normalized)&&!!diaperSize(query),pattern:/\b(pampers|lupilu|mamia|violeta)\b/i},
   {valid:type==="eggs"&&!!eggSize(query)&&quantity?.unit==="kos",pattern:/\b(jata|agragold)\b/i},
   {valid:/\bkava\b/.test(normalized)&&/\b(mleta|zrnju|instant)\b/.test(normalized)&&quantity?.unit==="kg",pattern:/\b(barcaffe|barcaff[eé]|lavazza|jacobs|dallmayr|franck)\b/i},
 ];
 for(const rule of brandPatterns){
   if(!rule.valid)continue;
   const brand=query.match(rule.pattern)?.[0];
   if(!brand)continue;
   return {query:query.replace(brand," ").trim(),reason:"Druga znamka",rank:offer=>
     new RegExp("\\b"+norm(brand)+"\\b").test(norm(offer.name+" "+(offer.brand??"")))?Infinity:0};
 }
 return null;
}

async function handleSearch(req:Request){
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 try{
  if(req.method!=="POST")return new Response(JSON.stringify({error:"POST required"}),{status:405,headers:jsonHeaders});
  const body=await req.json();
  const input=String(body.query||"").trim();
  if(input.length<2||input.length>100)throw new Error("Vnesi iskalni niz med 2 in 100 znaki.");
  const q=/\bjajca\b/i.test(input)&&!parseQuantity(input)&&/\s[1-9]\d{0,2}$/.test(input)?input+" kos":input;
  const offers:any[]=[];
  const alternatives:any[]=[];
  const upcoming:any[]=[];
  const sources:Record<string,string>={};
  const substitute=substitutionFor(q);
  const jobs=[["Tuš",searchTus],["Eurospin",searchEurospin],["Lidl",(term:string)=>searchSitemap("Lidl",term)],["Hofer",(term:string)=>searchSitemap("Hofer",term)],["Spar",(term:string)=>searchRetailer("Spar",term)],["Mercator",(term:string)=>searchRetailer("Mercator",term)]] as const;
  await Promise.all(jobs.map(async ([store,search])=>{
    try{
      const rows=(await search(q)).filter(row=>row.price_status!=="expired");
      offers.push(...rows);
      sources[store]=rows.length+" ustreznih ponudb";
      if(rows.length)return;
      let similarCount=0;
      try{
        if(substitute){
          const found=(store==="Spar"||store==="Mercator")&&greekYogurt(q)
            ?await searchRetailer(store,substitute.query,parseQuantity(q)):await search(substitute.query);
          const similar=found.map(offer=>({offer,rank:substitute.rank(offer)}))
            .filter(row=>Number.isFinite(row.rank)&&row.offer.price_status!=="expired")
            .sort((a,b)=>a.rank-b.rank||a.offer.price-b.offer.price);
          const suggestions=greekYogurt(q)
            ?similar.filter((entry,index)=>similar.findIndex(other=>other.rank===entry.rank&&other.offer.unit===entry.offer.unit)===index)
            :similar;
          similarCount=suggestions.length;
          alternatives.push(...suggestions.slice(0,3).map(({offer})=>({...offer,eligible_for_basket:false,substitution_reason:substitute.reason})));
        }
      }catch{ /* Exact-match status remains available if search for substitutes fails. */ }
      if(store==="Lidl"&&!similarCount&&["milk","eggs"].includes(productType(q)??"")){
        try{
          const exact=await searchLidlListings(q,true);
          if(exact.length)upcoming.push(...exact.slice(0,3));
          else if(substitute){
            const similar=(await searchLidlListings(substitute.query,true))
              .filter(offer=>Number.isFinite(substitute.rank(offer)))
              .sort((a,b)=>substitute.rank(a)-substitute.rank(b));
            upcoming.push(...similar.slice(0,3).map(offer=>({...offer,substitution_reason:substitute.reason})));
          }
        }catch{ /* The preview is optional when the live listing is unavailable. */ }
      }
    }catch(e){
      sources[store]="ni podatka: "+String(e).slice(0,150);
    }
  }));
  const summary={total:offers.length,eligible:offers.filter(x=>x.eligible_for_basket).length,unverified:offers.filter(x=>x.price_status==="unverified").length,expired:offers.filter(x=>x.price_status==="expired").length};
  return new Response(JSON.stringify({query:input,offers,alternatives,upcoming,sources,summary,notice:"Brez dokazljive veljavnosti cene ponudba ostane nepotrjena. Pri mleku brez navedene vrste iščemo trajno mleko. Za sveže mleko dodaj sveže."}),{headers:jsonHeaders});
 }catch(e){return new Response(JSON.stringify({error:String(e)}),{status:400,headers:jsonHeaders});}
}

Deno.serve(handleSearch);
