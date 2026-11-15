// Supabase Edge Function: search-prices
// Only public retailer sources; robots.txt is checked before each fetch.
// No login, paywall, anti-bot bypass, or third-party comparison-site scraping.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SOURCES: Record<string, {base:string; robots:string; kind:string; endpoint:string}> = {
  tus: {base:"https://www.tus.si",robots:"https://www.tus.si/robots.txt",kind:"woo",endpoint:"/wp-json/wc/store/products"},
  eurospin: {base:"https://www.eurospin.si",robots:"https://www.eurospin.si/robots.txt",kind:"html",endpoint:"/akcije/"},
  lidl: {base:"https://www.lidl.si",robots:"https://www.lidl.si/robots.txt",kind:"sitemap",endpoint:"/p/export/SI/sl/product_sitemap.xml.gz"},
  hofer: {base:"https://www.hofer.si",robots:"https://www.hofer.si/robots.txt",kind:"sitemap",endpoint:"/sitemap_products.xml"},
  mercator: {base:"https://www.mercatoronline.si",robots:"https://www.mercatoronline.si/robots.txt",kind:"api",endpoint:"/products/browseProducts/getProducts"},
  spar: {base:"https://www.spar.si",robots:"https://www.spar.si/robots.txt",kind:"api",endpoint:""}
};
const UA="CenejsiNakup/0.1 (+https://github.com/)";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const norm=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
function allowedByRobots(txt:string,path:string):boolean {
  // Conservative parser: honor User-agent: * Disallow rules; fail closed if robots unavailable.
  let active=false; const rules:string[]=[];
  for(const raw of txt.split(/\r?\n/)){const line=raw.split("#")[0].trim();if(!line)continue;const i=line.indexOf(":");if(i<0)continue;const k=line.slice(0,i).trim().toLowerCase(),v=line.slice(i+1).trim();
    if(k==="user-agent"){active=v==="*";continue}
    if(active&&k==="disallow"&&v)rules.push(v);
  }
  return !rules.some(r=>path.startsWith(r));
}
async function fetchPublic(url:string):Promise<Response>{
  const u=new URL(url);const base=u.origin;
  const robotsUrl=base+"/robots.txt";
  const rr=await fetch(robotsUrl,{headers:{"User-Agent":UA},signal:AbortSignal.timeout(12000)});
  if(!rr.ok)throw new Error(`robots.txt ni dosegljiv (${rr.status}); vir preskočen`);
  const ok=allowedByRobots(await rr.text(),u.pathname+(u.search||""));
  if(!ok)throw new Error("robots.txt ne dovoljuje dostopa do te poti");
  return await fetch(url,{headers:{"User-Agent":UA,"Accept":"application/json,text/html,application/xml,text/xml,*/*"},signal:AbortSignal.timeout(18000)});
}
function priceFromMinor(p:any,minor=2){if(p==null)return null;const n=Number(p);return Number.isFinite(n)?n/Math.pow(10,minor):null}
async function searchTus(q:string){
 const url=`https://www.tus.si/wp-json/wc/store/products?search=${encodeURIComponent(q)}&per_page=20`;
 const r=await fetchPublic(url);if(!r.ok)throw new Error(`Tuš HTTP ${r.status}`);
 const arr=await r.json();if(!Array.isArray(arr))return [];
 return arr.map((p:any)=>({store:"Tuš",name:p.name,brand:null,price:priceFromMinor(p.prices?.price,p.prices?.currency_minor_unit??2),unit_price:null,unit:null,url:p.permalink,source:url,checked_at:new Date().toISOString()})).filter((x:any)=>x.price!=null);
}
async function searchEurospin(q:string){
 const url="https://www.eurospin.si/akcije/";const r=await fetchPublic(url);if(!r.ok)throw new Error(`Eurospin HTTP ${r.status}`);
 const html=await r.text();const wanted=norm(q);const out:any[]=[];
 // Parse product headings and nearby visible text only; avoid guessing prices if the layout changes.
 const blocks=html.split(/<h[1-4][^>]*>/i).slice(1);
 for(const block of blocks){const title=(block.split(/<\/h[1-4]>/i)[0]||"").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").trim();
   if(!title||!norm(title).includes(wanted))continue;
   const text=block.slice(0,1800).replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&euro;/g,"€").replace(/\s+/g," ");
   const matches=[...text.matchAll(/(?:^|\s)(\d{1,3},\d{2})\s*€/g)].map(m=>Number(m[1].replace(",",".")));
   const qty=text.match(/(\d+(?:[,.]\d+)?\s?(?:kg|g|ml|l))\b/i)?.[1]||null;
   if(matches.length){out.push({store:"Eurospin",name:title,brand:null,price:matches[matches.length-1],unit_price:null,unit:qty,url,source:url,checked_at:new Date().toISOString()})}
 }
 return out.slice(0,10);
}
async function searchSitemap(store:string,q:string){
 const cfg=SOURCES[store];const sitemap=cfg.base+cfg.endpoint;const r=await fetchPublic(sitemap);if(!r.ok)throw new Error(`${store} sitemap HTTP ${r.status}`);
 let xml=await r.text();const urls=[...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1].trim()).filter(u=>norm(decodeURIComponent(u)).includes(norm(q).split(" ")[0])).slice(0,5);
 const out:any[]=[];
 for(const u of urls){try{const p=await fetchPublic(u);if(!p.ok)continue;const html=await p.text();const scripts=[...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
 for(const m of scripts){try{const obj=JSON.parse(m[1]);const nodes=Array.isArray(obj)?obj:[obj];for(const n of nodes){const x=n["@type"]==="Product"?n:(n["@graph"]||[]).find((z:any)=>z["@type"]==="Product");if(x?.name&&norm(x.name).includes(norm(q).split(" ")[0])){const offers=Array.isArray(x.offers)?x.offers[0]:x.offers;const price=offers?.price?Number(offers.price):null;if(price)out.push({store:store==="lidl"?"Lidl":"Hofer",name:x.name,brand:x.brand?.name||x.brand||null,price,unit_price:null,unit:null,url:offers?.url||u,source:u,checked_at:new Date().toISOString()})}}}catch{}}}catch{}}
 return out;
}
serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 try{
  if(req.method!=="POST")return new Response(JSON.stringify({error:"POST required"}),{status:405,headers:{...cors,"Content-Type":"application/json"}});
  const body=await req.json();const q=String(body.query||"").trim();if(q.length<2||q.length>100)throw new Error("Vnesi iskalni niz med 2 in 100 znaki.");
  const offers:any[]=[];const sources:Record<string,string>={};
  const jobs=[
   ["Tuš",()=>searchTus(q)],["Eurospin",()=>searchEurospin(q)],
   ["Lidl",()=>searchSitemap("lidl",q)],["Hofer",()=>searchSitemap("hofer",q)]
  ] as const;
  await Promise.all(jobs.map(async([name,fn])=>{try{const rows=await fn();offers.push(...rows);sources[name]=`${rows.length} ponudb`;}catch(e){sources[name]=`ni podatka: ${String(e).slice(0,120)}`}}));
  // Spar and Mercator are intentionally reported as pending until their public request schemas
  // are verified against live responses; do not fabricate prices or send guessed payloads.
  sources["Spar"]="adapter čaka na preverjen javni API-format";
  sources["Mercator"]="adapter čaka na preverjen javni API-format";
  return new Response(JSON.stringify({query:q,offers,sources,notice:"Prikazane so samo cene, ki jih je vir dejansko vrnil."}),{headers:{...cors,"Content-Type":"application/json"}});
 }catch(e){return new Response(JSON.stringify({error:String(e)}),{status:400,headers:{...cors,"Content-Type":"application/json"}})}
});
