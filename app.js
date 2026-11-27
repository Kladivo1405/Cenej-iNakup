'use strict';
const STORES=['Lidl','Hofer','Spar','Tuš','Mercator','Eurospin'];
const storeLogos={
 Lidl:'https://www.lidl.si/cdn/assets/logos/1.0.1/lidl-logo-shop-cdn.svg',
 Hofer:'https://www.hofer.si/favicon.svg',
 Spar:'https://www.spar.si/favicon.ico',
 'Tuš':'https://www.tus.si/app/uploads/2018/10/flavicon_tus.png',
 Mercator:'https://www.mercator.si/mysite/images/favicon/android-chrome-192x192.png',
 Eurospin:'https://www.eurospin.si/wp-content/uploads/cropped-001_Eurospin_Logo_1200x1200px-192x192.jpg'
};
let openStore=null;
const $=id=>document.getElementById(id),money=n=>new Intl.NumberFormat('sl-SI',{style:'currency',currency:'EUR'}).format(n);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f}catch{return f}};
const profilesKey='cn_profiles_v1',activeProfileKey='cn_active_profile_v1';
const receiptKey='cn_receipt_prices_v1',itemsKey='cn_items_v04',choicesKey='cn_choices_v04',listsKey='cn_named_lists_v1';
const infoKey='cn_info_mode_v06',preferencesKey='cn_preferences_v1';
let profiles=read(profilesKey,[{id:'default',name:'Moj profil'}]);
const storedProfile=read(activeProfileKey,'default');
let activeProfile=profiles.find(p=>p.id===storedProfile)?.id||'default';
const profileKey=key=>activeProfile==='default'?key:key+':'+activeProfile;
const readProfile=(key,fallback)=>read(profileKey(key),fallback);
const writeProfile=(key,value)=>localStorage.setItem(profileKey(key),JSON.stringify(value));
let receiptHistory=readProfile(receiptKey,[]),preferences=readProfile(preferencesKey,[]);
function loadListState(){
 return readProfile(listsKey,{activeId:'default',lists:[{id:'default',name:'Moj nakupovalni listek',items:readProfile(itemsKey,[])}]});
}
let listState=loadListState();
const activeList=()=>listState.lists.find(list=>list.id===listState.activeId)||listState.lists[0];
let includeUnverified=readProfile(infoKey,false),items=activeList().items,choices=readProfile(choicesKey,{});
const pendingItems=()=>items.filter(item=>!item.bought);
let offers={},alternatives={},upcoming={},sources={},failures={},busy=false;
const persist=()=>{
 activeList().items=items;
 writeProfile(listsKey,listState);
 writeProfile(choicesKey,choices);
};
const normalize=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9%,.]+/g,' ').trim();
function nameOf(o){return String(o.name||o.product_name||'')}
function brandOf(o){return typeof o.brand==='string'?o.brand:(o.brand&&typeof o.brand.name==='string'?o.brand.name:'')}
function storeOf(o){return STORES.find(s=>normalize(s)===normalize(o.store||o.retailer||''))}
function numericPrice(o){const n=typeof o.price==='number'?o.price:Number(String(o.price??'').replace(',','.'));return Number.isFinite(n)&&n>0?n:null}
function fat(s){const m=String(s).match(/(\d+(?:[,.]\d+)?)\s*%/);return m?Number(m[1].replace(',','.')):null}
function amount(text){
 const s=String(text||'').toLowerCase().replace(/,/g,'.');
 const pieces=s.match(/\b(\d+)\s*(?:kos(?:ov|i|a)?\b|kom\b|pieces\b|\/\s*1\b)/);
 if(pieces)return {v:Number(pieces[1]),kind:'kos',count:1};
 const multi=s.match(/\b(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|dl|l)\b/);
 const reverse=s.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|dl|l)\s*[x×]\s*(\d+)\b/);
 const single=s.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|dl|l)\b/);
 if(!single)return null;
 const count=Number(multi?.[1]??reverse?.[3]??1);
 const value=Number(multi?.[2]??reverse?.[1]??single[1]);
 const unit=multi?.[3]??reverse?.[2]??single[2];
 return {v:value/({g:1000,ml:1000,cl:100,dl:10}[unit]??1),kind:unit.endsWith('g')?'kg':'l',count};
}
function unitPriceLabel(offer){
 const measure=offer.unit_measure;
 const reported=numericPrice({price:offer.unit_price});
 if(reported!==null&&['l','kg','kos'].includes(measure))return money(reported)+'/'+measure;
 const quantity=amount(offer.unit)||amount(nameOf(offer));
 const price=numericPrice(offer);
 if(!quantity||quantity.v<=0||quantity.count<=0||price===null)return '';
 return money(price/(quantity.v*quantity.count))+'/'+quantity.kind;
}
function priceLabel(offer){
 return [money(numericPrice(offer)),unitPriceLabel(offer)].filter(Boolean).join(' · ');
}
function isComparable(item,o){
 const name=nameOf(o);
 if(!name||numericPrice(o)===null)return false;
 const requested=amount(item.name);
 const offered=amount(o.unit)||(!/\b(plenice|jajca)\b/i.test(name)?amount(name):null);
 if(requested&&(!offered||requested.kind!==offered.kind||requested.count!==offered.count||Math.abs(requested.v-offered.v)>0.000001))return false;
 const requestedFat=fat(item.name);
 return requestedFat===null||requestedFat===fat(name);
}
function canUsePrice(o){return !o.coupon_condition&&(o.eligible_for_basket===true||(includeUnverified&&(o.price_status==='unverified'||(o.substitution_reason&&o.price_status==='current'))))}
function alternativesFor(item,store){
 return (alternatives[item.id]||[]).filter(o=>storeOf(o)===store&&numericPrice(o)!==null);
}
function offerRows(item,store){
 const byId=new Map();
 for(const offer of [...candidates(item,store),...alternativesFor(item,store)]){
   const id=offerId(offer);
   if(!byId.has(id)&&offer.price_status!=='expired')byId.set(id,offer);
 }
 return [...byId.values()];
}
function offerPresentation(offer){
 const name=nameOf(offer),normalized=normalize(name);
 let brand=brandOf(offer);
 if(!brand){
   const known=normalized.match(/\b(persil|ariel|lenor|faks|duel|denkmit|poli|lasko|union|duracell|energizer|frutek|pampers|barcaffe)\b/)?.[1];
   if(known)brand=known==='lasko'?'Laško':known==='barcaffe'?'Barcaffè':known[0].toUpperCase()+known.slice(1);
 }
 let title=name,variant="";
 if(/\b(praln\w*|pranje)\b/.test(normalized)){
   if(/\b(prasek|prah)\b/.test(normalized))title='Pralni prašek';
   else if(/\b(gel|tekoc\w*)\b/.test(normalized))title='Gel za pranje';
   else if(/\bkapsul\w*\b/.test(normalized))title='Kapsule za pranje';
   variant=name.match(/\b(?:color|colour|universal|sensitive|regular|white|black|deep clean|touch of lenor)\b/i)?.[0]||'';
 }else if(/\bpol[iy]\b/.test(normalized)&&/\b(narez\w*|salam\w*|rezinah)\b/.test(normalized)){
   title=/\b(narez\w*|rezinah)\b/.test(normalized)?'Narezana salama':'Salama v kosu';
   brand='Poli';
   variant=name.match(/\b(?:mediteran|light|lahka|classic|green|z vrtninami|s sirom|mini)\b/i)?.[0]||'';
 }
 return {name,title,brand,variant};
}
function offerPromotion(offer){
 return offer.promotion===true&&offer.price_status==='current'&&
   typeof offer.price_valid_until==='string'&&offer.price_valid_until>=couponDay.format(new Date());
}
function offerForQuantity(offer,item){
 if(!offer||offer.coupon_condition||offer.price_status==='expired')return null;
 if(offer.price_valid_until&&offer.price_valid_until<couponDay.format(new Date()))return null;
 if(offer.minimum_quantity&&(!offerPromotion(offer)||item.qty<offer.minimum_quantity)){
   const price=numericPrice({price:offer.regular_price});
   if(price===null)return null;
   return {...offer,price,unit_price:null,promotion:false,price_status:'unverified',eligible_for_basket:false,minimum_quantity:null};
 }
 return offer;
}
function quantityPrice(offer){
 const perUnit=unitPriceLabel(offer);
 const perWash=Number.isSafeInteger(offer.wash_count)&&offer.wash_count>0?money(numericPrice(offer)/offer.wash_count)+'/pranje':'';
 return [perUnit,perWash].filter(Boolean).join(' · ');
}
function offerUnitValue(offer){
 const size=amount(offer.unit)||amount(nameOf(offer));
 const value=numericPrice({price:offer.unit_price})??(size?numericPrice(offer)/(size.count*size.v):Infinity);
 return [offer.unit_measure||size?.kind||'',value];
}
function beerBrand(offer){
 const brand=normalize(brandOf(offer)+' '+nameOf(offer)).match(/\b(lasko|union)\b/)?.[1];
 return brand==='lasko'?'Laško':brand==='union'?'Union':null;
}
const genericBeer=item=>/^pivo(?:\s|$)/.test(normalize(item.name))&&!/\b(lasko|union)\b/.test(normalize(item.name));
const offerDialog= $('offerDialog');
let offerOrigin=null;
offerDialog.addEventListener('close',()=>{
 if(offerOrigin?.isConnected)offerOrigin.focus();
 offerOrigin=null;
});
$('offerClose').onclick=()=>offerDialog.close();
function renderOfferPicker(item,store,line){
 const rows=offerRows(item,store);
 if(!rows.length)return;
 const button=document.createElement('button');
 button.className='soft offer-open';
 button.type='button';
 button.textContent='Primerjaj ponudbe ('+rows.length+')';
 button.dataset.offerItem=item.id;
 button.setAttribute('aria-haspopup','dialog');
 button.onclick=()=>openOfferPicker(item,store,rows,button);
 line.append(button);
}
function openOfferPicker(item,store,rows,origin){
 offerOrigin=origin;
 $('offerHeading').textContent=item.name;
 $('offerStore').textContent=store;
 const sort=$('offerSort');
 sort.value='promotion';
 const current=selected(item,store);
 const match=offer=>!offer.substitution_reason&&isComparable(item,offer);
 const refresh=()=>{
   const output=$('offerGroups');
   output.replaceChildren();
   function compare(a,b){
     const aPrice=offerForQuantity(a,item)??a,bPrice=offerForQuantity(b,item)??b;
     if(sort.value==='unit'){
       const [ak,av]=offerUnitValue(aPrice),[bk,bv]=offerUnitValue(bPrice);
       if(ak!==bk)return (ak?0:1)-(bk?0:1)||ak.localeCompare(bk);
       if(av!==bv)return av-bv;
     }
     if(sort.value==='price')return numericPrice(aPrice)-numericPrice(bPrice);
     return Number(offerPromotion(b))-Number(offerPromotion(a))||
       (b.match_score??100)-(a.match_score??100)||numericPrice(aPrice)-numericPrice(bPrice);
   }
   for(const [title,group] of [
     ['Ujema se z iskanjem',rows.filter(match)],
     ['Podobni izdelki',rows.filter(offer=>!match(offer))]
   ]){
     if(!group.length)continue;
     const section=document.createElement('section');
     const heading=document.createElement('h3');
     heading.textContent=title;
     const grid=document.createElement('div');
     grid.className='offer-grid';
     grid.append(...group.sort(compare).map(offer=>productCard(item,store,offer,current)));
     section.append(heading,grid);
     output.append(section);
   }
 };
 sort.onchange=refresh;
 $('offerReset').hidden=!(choices[choiceKey(item,store)]||choices[legacyChoiceKey(item,store)]||(genericBeer(item)&&choices.beerBrand));
 $('offerReset').onclick=()=>{
   delete choices[choiceKey(item,store)];
   delete choices[legacyChoiceKey(item,store)];
   if(genericBeer(item))delete choices.beerBrand;
   finishOfferPick(item);
 };
 refresh();
 offerDialog.showModal();
}
function finishOfferPick(item){
 persist();
 offerDialog.close();
 render();
 const next=[...document.querySelectorAll('.offer-open')].find(button=>button.dataset.offerItem===item.id);
 (next??$('storesHeading')).focus({preventScroll:true});
}
function productCard(item,store,offer,current){
 const card=document.createElement('article');
 card.className='offer-card';
 const effective=offerForQuantity(offer,item),{name,title,brand,variant}=offerPresentation(offer);
 const activePromo=offerPromotion(offer);
 const photo=document.createElement('div');
 photo.className='product-photo';
 const placeholder=document.createElement('span');
 placeholder.setAttribute('aria-hidden','true');
 placeholder.textContent=/praln|pranje/.test(normalize(name))?'🧺':/\bpivo\b/.test(normalize(name))?'🍺':/mlek|jogurt|masl/.test(normalize(name))?'🥛':'🛒';
 photo.append(placeholder);
 if(typeof offer.image_url==='string'&&offer.image_url.startsWith('https://')){
   const img=document.createElement('img');
   img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';
   img.onload=()=>placeholder.hidden=true;
   img.onerror=()=>img.remove();
   img.src=offer.image_url;
   photo.append(img);
 }
 card.append(photo);
 const info=document.createElement('div');
 info.className='product-info';
 const titleEl=document.createElement('strong');titleEl.textContent=title;
 const meta=document.createElement('small');
 meta.textContent=[brand,variant,offer.unit,offer.wash_count?offer.wash_count+' pranj':''].filter(Boolean).join(' · ');
 const price=document.createElement('b');price.className='product-price';price.textContent=money(numericPrice(offer));
 const unit=document.createElement('small');unit.textContent=quantityPrice(offer);
 info.append(titleEl,meta,price,unit);
 if(activePromo){
   const promo=document.createElement('small');
   promo.className='offer-badge';
   promo.textContent=offer.minimum_quantity?'Akcija ob nakupu '+offer.minimum_quantity+' ali več':'V akciji';
   info.append(promo);
 }
 if(offer.minimum_quantity&&item.qty<offer.minimum_quantity&&effective){
   const standard=document.createElement('small');
   standard.textContent='Pri '+item.qty+' × '+[money(effective.price)+' na kos',quantityPrice(effective)].filter(Boolean).join(' · ');
   info.append(standard);
 }
 const reason=offer.substitution_reason||(!isComparable(item,offer)?'Drugačno ali neznano pakiranje':'');
 const hints=[reason,effective?.price_status==='unverified'?'Nepotrjena cena':'',offer.coupon_condition||''].filter(Boolean);
 if(hints.length){
   const detail=document.createElement('small');
   detail.className='offer-note';
   detail.textContent=hints.join(' · ');
   info.append(detail);
 }
 if(name!==title||validOfferLink(offer.url)){
   const details=document.createElement('details');
   const toggle=document.createElement('summary');toggle.textContent='Podrobnosti';
   details.append(toggle);
   if(name!==title){const full=document.createElement('small');full.textContent=name;details.append(full)}
   if(validOfferLink(offer.url)){
     const link=document.createElement('a');
     link.href=offer.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Odpri ponudbo ↗';
     details.append(link);
   }
   info.append(details);
 }
 const selectedNow=Boolean(current&&offerId(current)===offerId(offer));
 const choose=document.createElement('button');
 choose.type='button';choose.className=selectedNow?'light product-pick':'primary product-pick';
 choose.textContent=selectedNow?'Izbrano':effective?.price_status==='unverified'?'Izberi informativno':'Izberi';
 choose.disabled=!effective||selectedNow;
 choose.setAttribute('aria-label',choose.textContent+': '+name);
 choose.onclick=()=>{
   delete choices[legacyChoiceKey(item,store)];
   choices[choiceKey(item,store)]=offerId(offer);
   const brand=genericBeer(item)&&beerBrand(offer);
   if(brand)choices.beerBrand=brand;
   finishOfferPick(item);
 };
 card.append(info,choose);
 return card;
}
function validOfferLink(url){return typeof url==='string'&&/^https:\/\//i.test(url)}

// Product prices transcribed from Lidl receipts, using purchases without a listed discount.
const lidlReceiptPrices=[
 {pattern:/^lasko pivo(?:\s*(?:0[,.]5\s*l|500\s*ml|50\s*cl|5\s*dl))?$/,name:'Laško pivo',unit:'0,5 l',price:1.32,reportedDate:'22. 11. 2026'},
 {pattern:/^poli narezek$/,name:'Poli narezek',price:2.29,receiptDate:'20. 11. 2026'},
 {pattern:/^(?:trajno )?mleko 3[,.]5\s*%$/,name:'Trajno mleko 3,5 %',price:0.93,receiptDate:'17. 11. 2026'},
 {pattern:/^(?:grski jogurt|jogurt na grski nacin)$/,name:'Jogurt na grški način',price:1.15,receiptDate:'14. 11. 2026',referenceOnly:true},
 {pattern:/^sadna kasa$/,name:'Marelična kaša s 3 žiti',price:1.18,receiptDate:'20. 11. 2026',referenceOnly:true},
 {pattern:/^kajzeric[ae]$/,name:'Kajzerica',unit:'1 kos',price:0.21,receiptDate:'6. 11. 2026'},
 {pattern:/^(?:belo vino|chardonnay)$/,name:'Chardonnay',price:4.98,receiptDate:'17. 11. 2026'},
 {pattern:/^(?:cips|chio(?: cips)? soljen|soljeni cips(?: chio)?)$/,name:'Soljeni čips Chio',price:2.69,receiptDate:'17. 11. 2026'},
 {pattern:/^(?:gorski|planinski) caj$/,name:'Gorski čaj',price:1.39,receiptDate:'17. 11. 2026'},
 {pattern:/^(?:edamec rezine|edamec v rezinah)$/,name:'Edamec v rezinah',price:1.14,receiptDate:'14. 11. 2026'},
 {pattern:/^sirova strucka$/,name:'Sirova štručka',unit:'1 kos',price:0.59,receiptDate:'3. 11. 2026'},
 {pattern:/^psenicna strucka$/,name:'Pšenična štručka',unit:'1 kos',price:0.25,receiptDate:'6. 11. 2026'},
 {pattern:/^banane$/,name:'Banane',unit:'1 kg',price:1.39,receiptDate:'20. 11. 2026'}
];
function liveMatches(item,store){
 return (offers[item.id]||[]).filter(o=>storeOf(o)===store&&o.price_status!=='expired'&&isComparable(item,o));
}
function receiptPrice(item,store){
 if(liveMatches(item,store).length)return null;
 const historical=importedPrice(item,store);
 if(historical)return historical;
 if(/^(?:plenice pampers|pampers(?: plenice)?) 52\s*(?:kos(?:ov|i|a)?|kom)$/.test(normalize(item.name)))
   return knownPrice({store,name:'Pampers plenice',unit:'52 kos',price:20.99,reportedDate:'22. 11. 2026'});
 if(store!=='Lidl')return null;
 const query=normalize(item.name).replace(/\s+/g,' ');
 // Match an unlabelled package by product name for display only when a size was requested.
 const withoutSize=query.replace(/\s+\d+(?:[,.]\d+)?\s*(?:kg|g|ml|cl|dl|l)$/, '');
 const row=lidlReceiptPrices.find(entry=>entry.pattern.test(query)||
   (!entry.unit&&entry.pattern.test(withoutSize)));
 if(!row)return null;
 const receiptNote=withoutSize==='planinski caj'?'Možen nadomestek':
   !row.unit&&(withoutSize!==query||row.referenceOnly)?'Pakiranje na računu ni navedeno':
   row.unit==='1 kg'?'Cena za kilogram':'';
 return {...row,store,lastKnown:true,receiptNote,price_status:'unverified',eligible_for_basket:false};
}
function renderReceiptPrice(row,line){
 const note=document.createElement('p');
 note.className='source';
 note.textContent=[row.name,row.unit==='1 kg'?unitPriceLabel(row):priceLabel(row),'Zadnja znana cena',row.receiptNote,'Zunaj seštevka'].filter(Boolean).join(' · ');
 line.append(note);
}

const flyerPrices=[
 {store:'Lidl',pattern:/^(?:trajno )?mleko (?:3[,.]5|2[,.]8)\s*%\s*1 ?l$/,name:'Pilos trajno mleko 2,8 %',unit:'1 l',price:0.59,date:'zajeto 17. 11. 2026',url:'https://www.lidl.si/p/pilos-trajno-mleko/p11263139'},
 {store:'Hofer',pattern:/^jajca(?: 10(?: kos(?:ov)?|\/1)?)?(?: l)?$/, name:'Jajca L iz hlevske reje',unit:'10 kos',price:2.30,date:'43. teden 2026',url:'https://letaki.hofer.si/letak_kw43_2026_dober_razlog_za_vsak_nakup_po_hofer_ceni/page/12-13'},
 {store:'Lidl',pattern:/^(?:parmezan|parmigiano reggiano)(?: 100 ?g)?$/,name:'Deluxe Parmigiano Reggiano, nastrgan',unit:'100 g',price:2.49,date:'2.–7. 11. 2026',url:'https://www.lidl.si/p/deluxe-parmigiano-reggiano/p11000959'},
 {store:'Lidl',pattern:/^(?:belo vino|sauvignon blanc)(?: 0[,.]75 ?l| 750 ?ml)?$/,name:'Sauvignon Blanc Marlborough',unit:'0,75 l',price:3.99,date:'5.–11. 11. 2026',url:'https://www.lidl.si/p/sauvignon-blanc-marlborough/p11327744'}
];
function renderFlyerPrice(item,store,line){
 const row=flyerPrices.find(entry=>entry.store===store&&entry.pattern.test(normalize(item.name).replace(/\s+/g,' ')));
 if(!row)return;
 const details=document.createElement('details');
 details.open=true;
 const heading=document.createElement('summary');
 heading.textContent='Prejšnja cena · '+priceLabel(row);
 const label=document.createElement('p');
 label.className='source';
 label.textContent=[row.name,row.unit,row.date,'Orientacijsko, brez vključitve v seštevek'].join(' · ');
 const link=document.createElement('a');
 link.href=row.url;
 link.target='_blank';
 link.rel='noopener noreferrer';
 link.textContent='Odpri vir ↗';
 details.append(heading,label,link);
 line.append(details);
}

function renderUpcoming(item,store,line){
 const rows=(upcoming[item.id]||[]).filter(row=>storeOf(row)===store&&numericPrice(row)!==null);
 if(!rows.length)return false;
 const formatDate=value=>new Date(value).toLocaleDateString('sl-SI',{timeZone:'Europe/Ljubljana'});
 const details=document.createElement('details');
 details.open=true;
 const heading=document.createElement('summary');
 heading.textContent='Napovedane ponudbe';
 details.append(heading);
 for(const row of rows){
   const text=document.createElement('p');
   text.className='source';
   text.textContent=[row.substitution_reason?'Nadomestek: '+nameOf(row):nameOf(row),row.unit,priceLabel(row),formatDate(row.available_from)+' – '+formatDate(row.available_until),row.substitution_reason].filter(Boolean).join(' · ');
   details.append(text);
   if(/^https:\/\//i.test(row.url||'')){
     const link=document.createElement('a');
     link.href=row.url;
     link.target='_blank';
     link.rel='noopener noreferrer';
     link.textContent='Odpri napoved ↗';
     details.append(link);
   }
 }
 line.append(details);
 return true;
}

function candidates(item,store){return (offers[item.id]||[]).filter(o=>storeOf(o)===store&&numericPrice(o)!==null).slice(0,12)}
function options(item,store){return liveMatches(item,store).map(offer=>offerForQuantity(offer,item)).filter(o=>o&&canUsePrice(o)).sort((a,b)=>numericPrice(a)-numericPrice(b))}
function legacyChoiceKey(item,store){return item.id+'|'+store}
function choiceKey(item,store){return 'query|'+store+'|'+item.name.trim().toLowerCase().replace(/\s+/g,' ')}
function selected(item,store){
 const exact=options(item,store);
 const wanted=choices[choiceKey(item,store)]??choices[legacyChoiceKey(item,store)];
 const chosen=wanted&&offerRows(item,store).find(o=>offerId(o)===wanted||legacyOfferId(o)===wanted||previousOfferId(o)===wanted);
 const preferred=genericBeer(item)&&choices.beerBrand?exact.find(o=>beerBrand(o)===choices.beerBrand):null;
 return offerForQuantity(chosen,item)||preferred||exact[0]||includedReceiptPrice(item,store);
}
function includedReceiptPrice(item,store){
 const row=receiptPrice(item,store);
 return row&&(row.manual||row.unit!=='1 kg')&&row.receiptNote!=='Možen nadomestek'?row:null;
}
function legacyOfferId(o){return String(o.url||'')+'|'+nameOf(o)+'|'+numericPrice(o)+'|'+String(o.unit||'')}
function previousOfferId(o){return JSON.stringify([o.url||nameOf(o),o.unit||''])}
function offerId(o){return JSON.stringify([o.url||'',normalize(nameOf(o)),o.unit||''])}
function add(){const name=$('newItem').value.trim();if(!name)return;const existing=items.find(item=>choiceKey(item,'')===choiceKey({name},''));
 if(existing){existing.qty++;existing.bought=false;}
 else items.push({id:(crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random())),name,qty:1});
 rememberProduct(name);$('newItem').value='';renderSuggestions();persist();render()}
function modify(id,delta){items=items.map(i=>i.id===id?{...i,qty:Math.max(1,i.qty+delta)}:i);persist();render()}
function remove(id){items=items.filter(i=>i.id!==id);delete offers[id];delete alternatives[id];delete upcoming[id];persist();render()}
const couponSources={
 Spar:'https://www.spar.si/promocije-in-projekti/aktualne-promocije',
 Mercator:'https://www.mercator.si/akcije-in-ugodnosti/novo-ta-vikend-dobite-vec/',
 'Tuš':'https://www.tus.si/katalog/tedenski-kuponi/'
};
const couponSelections={};
const couponDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Ljubljana',year:'numeric',month:'2-digit',day:'2-digit'});
let couponInfo={},couponRefresh=0,couponLoading=false,couponRenderDay='';
async function refreshCoupons(){
 if($('pricesView').hidden||document.hidden||couponLoading||Date.now()<couponRefresh)return;
 const url=localStorage.getItem('cn_sb_url'),key=localStorage.getItem('cn_sb_key');
 if(!url||!isPublicSupabaseKey(key||''))return;
 couponLoading=true;
 render();
 try{
   const response=await fetch(url.replace(/\/$/,'')+'/functions/v1/search-prices',{
     method:'POST',headers:{'Content-Type':'application/json',apikey:key,Authorization:'Bearer '+key},
     body:JSON.stringify({action:'coupons'}),signal:AbortSignal.timeout(42000)
   });
   if(!response.ok)throw Error('HTTP '+response.status);
   const data=await response.json();
   if(!data?.stores||typeof data.stores!=='object')throw Error('Manjkajo rezultati kuponov');
   couponInfo=data.stores;
   couponRefresh=Date.now()+(Object.keys(couponSources).every(store=>couponInfo[store]?.available)?60:5)*60000;
 }catch{couponRefresh=Date.now()+5*60000}
 finally{couponLoading=false;render();}
}
function currentCoupons(store,today){
 const coupons=couponInfo[store]?.coupons;
 return Array.isArray(coupons)?coupons.filter(coupon=>
   Array.isArray(coupon.dates)&&coupon.dates.includes(today)&&['item','basket','credit'].includes(coupon.kind)&&
   Number.isFinite(coupon.rate)&&coupon.rate>0&&coupon.rate<1&&Number.isFinite(coupon.minimum)&&
   coupon.minimum>=0&&typeof coupon.id==='string'
 ): [];
}
function couponLabel(coupon){
 if(coupon.kind==='item')return Math.round(coupon.rate*100)+' % na en izdelek';
 if(coupon.kind==='credit')return Math.round(coupon.rate*100)+'–'+Math.round((coupon.maximumRate||coupon.rate)*100)+' % vračila kot D*NAR';
 return Math.round(coupon.rate*100)+' % na nakup';
}
function couponAllowed(offer){
 return !/\b(cigaret\w*|toba[kc]\w*|vinjet\w*|casopis\w*|revij\w*|dariln\w* kartic\w*|povratn\w* embalaz\w*|zacetn\w* formul\w*)\b/.test(normalize(nameOf(offer)));
}
function couponChoices(coupon,rows,complete){
 const rowsEligible=rows.filter(({offer})=>couponAllowed(offer));
 const eligible=rowsEligible.reduce((total,row)=>total+row.cents*row.item.qty,0);
 const threshold=Math.round(coupon.minimum*100);
 if(coupon.kind==='item'){
   return rowsEligible.filter(({offer,cents})=>
     !offerPromotion(offer)&&!offer.lastKnown&&(!threshold||(complete&&eligible-cents>threshold))
   ).map(row=>({...row,saving:Math.round(row.cents*coupon.rate)}));
 }
 if(!complete||eligible<=threshold)return [];
 if(coupon.kind==='credit')return [{saving:0}];
 return [{saving:Math.round(eligible*coupon.rate)}];
}
function couponStatus(coupon,result){
 const options=couponChoices(coupon,result.rows,!result.missing.length);
 if(coupon.kind==='credit'){
   return 'Pri nakupu nad '+money(coupon.minimum)+'. Dobropis za upravičene izdelke po redni ceni se naloži po nakupu.';
 }
 if(coupon.kind==='item'){
   const condition=coupon.minimum?'Preostala košarica mora presegati '+money(coupon.minimum)+'. ':'';
   const best=Math.max(0,...options.map(option=>option.saving));
   return condition+(best?'Ocenjeni prihranek do '+money(best/100)+'.':'V košarici še ni primernega izdelka.');
 }
 if(options.length)return 'Pri nakupu nad '+money(coupon.minimum)+'. Ocenjeni prihranek '+money(options[0].saving/100)+'.';
 return 'Pri nakupu nad '+money(coupon.minimum)+'. '+(result.missing.length?'Za oceno dodaj manjkajoče cene.':'Pogoj v košarici še ni dosežen.');
}
function chooseCoupon(store,selection,focus){
 couponSelections[store]=selection;
 render();
 $(focus)?.focus({preventScroll:true});
}
function renderCoupon(result,card){
 const {store,coupons,today,discount}=result;
 if(!couponSources[store])return;
 const section=document.createElement('div');
 section.className='line';
 const title=document.createElement('b');
 title.textContent='Današnji kuponi';
 section.append(title);
 const current=couponSelections[store];
 const choices=document.createElement('div');
 choices.className='coupon-options';
 for(const coupon of coupons){
   const row=document.createElement('div');
   row.className='coupon-choice';
   const title=document.createElement('strong');
   title.textContent=couponLabel(coupon);
   const note=document.createElement('p');
   note.className='status';
   note.textContent=couponStatus(coupon,result);
   row.append(title,note);
   const options=couponChoices(coupon,result.rows,!result.missing.length);
   const chosen=current?.day===today&&current.id===coupon.id;
   if(coupon.kind==='item'&&options.length){
     const select=document.createElement('select');
     select.id='coupon-'+coupon.id;
     select.setAttribute('aria-label','Izberi izdelek za kupon '+store);
     select.add(new Option('Brez kupona',''));
     for(const option of options)select.add(new Option(offerPresentation(option.offer).title+' · '+money(option.saving/100),option.item.id));
     if(chosen&&discount)select.value=current.itemId;
     select.onchange=()=>{
       const option=options.find(({item})=>item.id===select.value);
       chooseCoupon(store,option?{id:coupon.id,day:today,itemId:option.item.id,offerId:legacyOfferId(option.offer)}:null,select.id);
     };
     row.append(select);
   }
   if(coupon.kind==='basket'&&options.length){
     const button=document.createElement('button');button.type='button';button.className='soft';
     button.id='coupon-'+coupon.id;
     button.textContent=chosen&&discount?'Odstrani kupon':'Uporabi v izračunu';
     button.onclick=()=>chooseCoupon(store,chosen?null:{id:coupon.id,day:today},button.id);
     row.append(button);
   }
   const link=document.createElement('a');
   link.href=validOfferLink(coupon.source)?coupon.source:couponSources[store];
   link.target='_blank';link.rel='noopener noreferrer';link.textContent='Pogoji pri trgovcu ↗';
   row.append(link);
   choices.append(row);
 }
 if(choices.children.length)section.append(choices);
 else{
   const note=document.createElement('p');
   note.className='status';
   note.textContent=couponLoading?'Preverjam kupone …':couponInfo[store]?.available?'Danes ni potrjenega splošnega kupona.':'Današnje objave kuponov ni bilo mogoče potrditi.';
   const link=document.createElement('a');
   link.href=couponSources[store];link.target='_blank';link.rel='noopener noreferrer';link.textContent='Kuponi pri trgovcu ↗';
   section.append(note,link);
 }
 card.append(section);
}
function calc(store,today){
 const rows=[],missing=[],unverified=[];
 let total=0;
 for(const item of pendingItems()){
   const offer=selected(item,store);
   if(!offer){missing.push(item.name);continue}
   const cents=Math.round(numericPrice(offer)*100);
   rows.push({item,offer,cents});
   total+=cents*item.qty;
   if(offer.eligible_for_basket!==true)unverified.push(item.name);
 }
 const coupons=currentCoupons(store,today);
 const choice=couponSelections[store];
 const coupon=coupons.find(coupon=>choice?.day===today&&choice.id===coupon.id);
 const options=coupon?couponChoices(coupon,rows,!missing.length):[];
 const match=coupon?.kind==='item'?options.find(option=>option.item.id===choice.itemId&&choice.offerId===legacyOfferId(option.offer)):options[0];
 const saving=match?.saving??0;
 return {store,total:(total-saving)/100,discount:saving/100,missing,unverified,rows,coupons,today};
}

function renderStoreNavigation(results){
 const nav=$('storeNav');
 nav.replaceChildren();
 for(const result of results){
   const button=document.createElement('button');
   button.type='button';
   button.className='store-tile';
   button.setAttribute('aria-expanded',String(openStore===result.store));
   button.setAttribute('aria-controls','stores');
   const mark=document.createElement('span');
   mark.className='store-mark';
   mark.setAttribute('aria-hidden','true');
   const logo=document.createElement('img');
   logo.alt='';
   logo.referrerPolicy='no-referrer';
   logo.onerror=()=>{mark.textContent=result.store.slice(0,2).toUpperCase()};
   logo.src=storeLogos[result.store];
   mark.append(logo);
   const total=document.createElement('span');
   total.className='store-total';
   total.textContent=pendingItems().length>result.missing.length?money(result.total):'—';
   const coverage=document.createElement('small');
   coverage.textContent=!pendingItems().length?'Ni preostalih izdelkov':result.missing.length?result.missing.length+' brez cene':'Vse cene najdene';
   button.append(mark,document.createTextNode(result.store),total,coverage);
   if(result.coupons.length){
     const note=document.createElement('small');
     note.className='offer-badge';
     note.textContent=result.coupons.length===1?'1 kupon':result.coupons.length+' kupona';
     button.append(note);
   }
   button.onclick=()=>{
     openStore=openStore===result.store?null:result.store;
     render();
     nav.children[results.indexOf(result)].focus();
   };
   nav.append(button);
 }
}
function showView(focus=false){
 const view=location.hash==='#cene'?'prices':location.hash==='#listek'?'list':'overview';
 if(view!=='prices'&&offerDialog.open)offerDialog.close();
 for(const panel of ['overview','list','prices']){
   $(panel+'View').hidden=panel!==view;
   const tab=$(panel+'Tab');
   if(panel===view)tab.setAttribute('aria-current','page');
   else tab.removeAttribute('aria-current');
 }
 $('overviewTools').hidden=view!=='overview';
 if(view==='prices')void refreshCoupons();
 if(location.hash==='#nastavitve'){
   $('connectionSettings').open=true;
   if(focus)$('sburl').focus();
 }else if(focus){
   window.scrollTo(0,0);
   $(view+'Heading').focus({preventScroll:true});
 }
}
window.addEventListener('hashchange',()=>showView(true));
function checkCouponClock(){
 if($('pricesView').hidden||document.hidden)return;
 if(couponRenderDay!==couponDay.format(new Date()))render();
 void refreshCoupons();
}
document.addEventListener('visibilitychange',checkCouponClock);
setInterval(checkCouponClock,60000);
function openList(id){
 if(busy)return;
 listState.activeId=id;
 items=activeList().items;
 offers={};alternatives={};upcoming={};sources={};failures={};
 for(const store of STORES)delete couponSelections[store];
 openStore=null;
 $('progress').textContent='';
 $('priceSettings').hidden=true;
 $('newItem').value='';
 renderSuggestions();
 persist();
 render();
 location.hash='listek';
}
function updateProgress(element,rows){
 const count=rows.filter(row=>row.bought).length;
 element.querySelector('.progress-fill').style.setProperty('--progress',(rows.length?100*count/rows.length:0)+'%');
 element.querySelector('.progress-count').textContent=count+' / '+rows.length+' kupljenih';
}
function renderShoppingLists(){
 const container=$('listCards'),current=activeList();
 container.replaceChildren();
 for(const list of listState.lists){
   const card=document.createElement('button');
   card.type='button';
   card.className='list-card';
   card.disabled=busy;
   card.innerHTML='<strong></strong><div class="list-progress"><div class="progress-track"><span class="progress-fill"></span></div><span class="progress-count"></span></div>';
   card.querySelector('strong').textContent=list.name;
   updateProgress(card,list.items);
   card.onclick=()=>openList(list.id);
   container.append(card);
 }
 $('listHeading').textContent=current.name;
 updateProgress($('editorProgress'),items);
}
$('newListForm').onsubmit=event=>{
 event.preventDefault();
 if(busy)return;
 const input=$('newListName'),name=input.value.trim();
 if(!name)return;
 const id=crypto.randomUUID();
 listState.lists.push({id,name,items:[]});
 input.value='';
 $('createList').open=false;
 openList(id);
};
function render(){
 renderShoppingLists();
 const pending=pendingItems();
 $('listCount').textContent=pending.length;
 $('listCount').hidden=!pending.length;
 $('priceEmpty').textContent=items.length?'Vsi izdelki na tem seznamu so označeni kot kupljeni.':'Najprej dodaj izdelke na listek.';
 $('priceEmpty').hidden=Boolean(pending.length);
 $('priceSummary').hidden=!pending.length;
 $('priceStores').hidden=!pending.length;
 $('clear').disabled=!items.length;
 $('refresh').disabled=busy||!pending.length;
 $('refresh').textContent=pending.length===items.length?'Poišči cene':'Poišči cene za preostale';
 const list=$('list');
 list.replaceChildren();
 if(!items.length)list.innerHTML='<p class="muted">Dodaj prvi izdelek.</p>';
 for(const i of [...pending,...items.filter(item=>item.bought)]){
   const div=document.createElement('div');
   div.className='line row'+(i.bought?' is-bought':'');
   div.innerHTML=`<label class="check-item"><input type="checkbox"><span>${esc(i.name)}</span></label><div class="qty"><button class="light" data-act="minus" aria-label="Zmanjšaj količino">−</button><b>${i.qty}</b><button class="light" data-act="plus" aria-label="Povečaj količino">+</button><button class="delete" data-act="remove" aria-label="Odstrani izdelek">✕</button></div>`;
   const check=div.querySelector('input');
   check.checked=Boolean(i.bought);
   check.dataset.itemId=i.id;
   check.onchange=()=>{
     i.bought=check.checked;persist();render();
     Array.from(list.querySelectorAll('input')).find(input=>input.dataset.itemId===i.id)?.focus({preventScroll:true});
   };
   div.querySelector('[data-act=minus]').onclick=()=>modify(i.id,-1);
   div.querySelector('[data-act=plus]').onclick=()=>modify(i.id,1);
   div.querySelector('[data-act=remove]').onclick=()=>remove(i.id);
   list.append(div);
 }
couponRenderDay=couponDay.format(new Date());
const results=STORES.map(store=>calc(store,couponRenderDay)),complete=results.filter(x=>!x.missing.length&&pending.length),confirmed=complete.filter(x=>!x.unverified.length&&!x.discount),winner=[...confirmed].sort((a,b)=>a.total-b.total)[0],infoWinner=[...complete].sort((a,b)=>a.total-b.total)[0];$('winner').textContent=winner?winner.store+' · '+money(winner.total):'—';$('winnerNote').textContent=winner?'Najcenejša popolna košarica s potrjenimi cenami.':'Nobena trgovina nima potrjenih cen za vse izdelke.';let info=$('infoSummary');if(info){info.textContent=(includeUnverified||results.some(r=>r.discount))?(infoWinner?'Informativno najcenejša: '+infoWinner.store+' · '+money(infoWinner.total)+(infoWinner.discount?' (ocena s kuponom)':infoWinner.unverified.length?' (vključuje nepotrjene cene)':''):'Ni popolne informativne košarice.'):'Vklopi informativni način, če želiš vključiti primerljive, vendar nepotrjene ponudbe.'}
renderStoreNavigation(results);
const root=$('stores');root.replaceChildren();for(const r of results.filter(result=>result.store===openStore)){const card=document.createElement('section');card.className='card store';const head=document.createElement('div');head.className='storehead';head.innerHTML=`<h2>${esc(r.store)}</h2>${winner&&winner.store===r.store?'<span class="pill">Najcenejša potrjena</span>':r.missing.length?`<span class="warn">⚠ ${r.missing.length} manjka</span>`:''}`;card.append(head);
for(const i of pending){const o=selected(i,r.store),unitPrice=o?quantityPrice(o):'',line=document.createElement('div');line.className='line';if(!o){line.innerHTML=`<div class="row"><div><b>${esc(i.name)}</b><br><small>${failures[i.id]?'Iskanje ni uspelo':'Ni potrjene primerljive ponudbe'}</small></div><span class="warn">Ni cene</span></div>`;const hasUpcoming=renderUpcoming(i,r.store,line),receipt=receiptPrice(i,r.store);if(receipt)renderReceiptPrice(receipt,line);else if(!hasUpcoming)renderFlyerPrice(i,r.store,line)}else{line.innerHTML=`<div class="offer"><div style="flex:1"><small>${esc(i.name)} · ${i.qty} ×</small><br><b>${o.substitution_reason?"Nadomestek: ":""}${esc(nameOf(o))}</b><br><small>${esc(brandOf(o))} ${esc(o.unit||'')}</small><br>${o.substitution_reason?`<small>${esc(o.substitution_reason)}</small><br>`:''}<small>${o.eligible_for_basket===true?'✓ Potrjena ponudba':o.lastKnown?'Zadnja znana cena':o.price_status==='current'?'Aktualna ponudba – informativno':'⚠ Nepotrjena cena – informativno'}</small><br><small>${o.checked_at?'Zajeto: '+esc(new Date(o.checked_at).toLocaleString('sl-SI')):''}</small>${o.url&&/^https:\/\//i.test(o.url)?`<br><a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">Odpri ponudbo ↗</a>`:''}</div><div class="offerprice">${money(numericPrice(o)*i.qty)}${unitPrice?`<small class="unit-price">${esc(unitPrice)}</small>`: ''}</div></div>`;}renderOfferPicker(i,r.store,line);card.append(line)}
renderCoupon(r,card);
const manualButton=document.createElement('button');
manualButton.type='button';
manualButton.className='soft';
manualButton.textContent='Vnesi ceno za '+r.store;
manualButton.onclick=()=>{
 $('manualPrices').open=true;
 $('manualStore').value=r.store;
 $('manualName').focus();
};
card.append(manualButton);
const bottom=document.createElement('div');bottom.className='total row';bottom.innerHTML=`<span>${r.missing.length?'Delni seštevek':r.discount?'Ocenjeno plačilo s kuponom':r.unverified.length?'Informativni seštevek':'Skupaj'}</span><span>${pending.length&&(r.total>0||!r.missing.length)?money(r.total):'Ni podatkov'}</span>`;card.append(bottom);if(r.unverified.length){const caution=document.createElement('p');caution.className='warn';caution.style.fontSize='12px';caution.textContent='Nepotrjene cene: '+r.unverified.join(', ')+'. Preveri v trgovini.';card.append(caution)}if(r.missing.length){const note=document.createElement('p');note.className='warn';note.style.fontSize='12px';note.textContent='Manjka: '+r.missing.join(', ');card.append(note)}root.append(card)} }
async function search(){const requested=pendingItems();if(busy||!requested.length)return;location.hash='cene';showView(true);const url=localStorage.getItem('cn_sb_url'),key=localStorage.getItem('cn_sb_key');if(!url||!isPublicSupabaseKey(key||'')){$('progress').textContent='Najprej shrani povezavo s Supabase.';$('priceSettings').hidden=false;return}$('priceSettings').hidden=true;busy=true;$('refresh').disabled=true;$('progress').textContent='Pridobivam ponudbe …';offers={};alternatives={};upcoming={};failures={};sources={};render();let count=0;
for(const [index,i] of requested.entries()){try{const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),35000);let res;try{res=await fetch(url.replace(/\/$/,'')+'/functions/v1/search-prices',{method:'POST',headers:{'Content-Type':'application/json','apikey':key,'Authorization':'Bearer '+key},body:JSON.stringify({query:i.name}),signal:controller.signal})}finally{clearTimeout(timeout)}if(!res.ok)throw Error('HTTP '+res.status);const j=await res.json();offers[i.id]=Array.isArray(j.offers)?j.offers:[];alternatives[i.id]=Array.isArray(j.alternatives)?j.alternatives:[];upcoming[i.id]=Array.isArray(j.upcoming)?j.upcoming:[];Object.assign(sources,j.sources||{});count+=offers[i.id].length}catch(e){offers[i.id]=[];failures[i.id]=String(e.message||e)}$('progress').textContent='Preverjeno '+(index+1)+'/'+requested.length+' izdelkov.';render()}
$('sources').textContent=Object.entries(sources).map(([k,v])=>k+': '+v).join(' | ')||'Viri niso vrnili statusa.';$('progress').textContent=`Prejetih ponudb: ${count}. V seštevek se vključijo le ponudbe s potrjeno veljavnostjo in količino. Ostale lahko pogledaš pod opozorili.`;busy=false;$('refresh').disabled=false;render()}
function knownPrice(row){
 return {...row,lastKnown:true,price_status:'unverified',eligible_for_basket:false};
}
function receiptName(text){
 return normalize(text.replace(/\s+\d+(?:[,.]\d+)?\s*(?:kg|g|ml|cl|dl|l|kos(?:ov|i|a)?|kom)$/i,'')).replace(/\s+/g,' ');
}
function importedPrice(item,store){
 const requested=amount(item.name);
 const row=receiptHistory.find(row=>{
   if(row.store!==store||receiptName(row.name)!==receiptName(item.name))return false;
   if(!requested)return true;
   const size=amount(row.unit);
   return size&&size.kind===requested.kind&&size.count===requested.count&&Math.abs(size.v-requested.v)<0.000001;
 });
 return row?knownPrice(row):null;
}
function parseSparReceiptLine(line){
 const fields=line.match(/^(.+?)(?:\s*[x×+]\s*|\s+)(\d+(?:[,.]\d{1,3})?)\s*[x×]?\s+(\d+[,.]\d{2})\s+(\d+[,.]\d{2})\s+(\d+[,.]\d{2})(?:\s*[A-F])?$/i);
 if(!fields||!/[a-z]/.test(normalize(fields[1])))return null;
 const [,label,quantity,price,discount,total]=fields;
 const numeric=value=>Number(value.replace(',','.'));
 const count=numeric(quantity),weighted=/[,.]/.test(quantity)&&!Number.isInteger(count);
 const suffix=label.match(/(?:\s+|\.)(\d+(?:[,.]\d+)?\s*(?:kg|g|ml|cl|dl|l|kos(?:ov|i|a)?|kom))$/i);
 const cents=value=>Math.round(numeric(value)*100);
 const expected=Math.round(count*cents(price))-cents(discount);
 const valid=count>0&&cents(price)>0&&Math.abs(expected-cents(total))<=(weighted?1:0);
 return {
   name:suffix?label.slice(0,suffix.index):label,
   unit:weighted?'1 kg':suffix?.[1].toLowerCase(),
   price:cents(price)>0?price:'',
   receiptVerified:valid,
   receiptByWeight:weighted,
   receiptLabel:label,
   receiptValues:[quantity,price,discount,total].map(numeric),
   use:valid&&cents(discount)===0,
   receiptDetail:'Količina '+quantity+(weighted?' kg':'')+' · Popust '+discount+' € · Znesek '+total+' €'+
     (valid?'':' · Računica se ne ujema. Preveri odčitek')
 };
}
function parseReceipt(text,store){
 const found=text.match(/\b(\d{1,2})[./]\s*(\d{1,2})[./]\s*(20\d{2})\b/);
 const date=found?[found[3],found[2].padStart(2,'0'),found[1].padStart(2,'0')].join('-'):'';
 const rows=[];
 for(const raw of text.split(/\r?\n/)){
   const line=raw.trim(),key=normalize(line);
   if(/^(za placilo|skupaj|placilo|kartica|gotovina|potrdilo za kupca)\b/.test(key))break;
   if(/\b(popust|kupon|vzemi \d+ ali vec)\b/.test(key)){
     if(rows.length)rows.at(-1).use=false;
     continue;
   }
   const weighed=line.match(/^\d+[,.]\d+\s*kg\s*[x×]\s*(\d+[,.]\d{2})/i);
   if(weighed&&rows.length){Object.assign(rows.at(-1),{unit:'1 kg',price:weighed[1],use:false});continue}
   if(store==='Spar'){
     const row=parseSparReceiptLine(line);
     if(row)rows.push(row);
     continue;
   }
   const match=line.match(/^(.+?)\s+(?:(\d+)\s*[x×]\s*)?(?:(\d+[,.]\d{2})\s+)?(\d+[,.]\d{2})(?:\s+[A-F])?$/i);
   if(!match||(!match[2]&&!/\s[A-F]$/i.test(line))||!/[a-z]/.test(normalize(match[1])))continue;
   rows.push({name:match[1],price:match[3]||(Number(match[4].replace(',','.'))/Number(match[2]||1)).toFixed(2),use:true});
 }
 return {date,rows};
}
function reconcileSparReceipts(first,second){
 if(first.date&&second.date&&first.date!==second.date)return first;
 const key=row=>normalize(row.receiptLabel);
 const rows=first.rows.map(row=>{
   const label=key(row);
   if(first.rows.filter(candidate=>key(candidate)===label).length!==1)return row;
   const matches=second.rows.filter(candidate=>key(candidate)===label);
   if(matches.length!==1||!matches[0].receiptVerified)return row;
   const other=matches[0];
   if(!row.receiptVerified)return {...other,use:false,receiptDetail:other.receiptDetail+' · Ponovno prebrano. Preveri na računu.'};
   if(row.receiptValues.some((value,index)=>value!==other.receiptValues[index])){
     return {...row,use:false,receiptDetail:row.receiptDetail+' · Odčitka se razlikujeta. Preveri na računu.'};
   }
   return row;
 });
 return {date:first.date||second.date,rows};
}
async function prepareReceiptImage(file,enhance=true){
 const image=await createImageBitmap(file);
 try{
   const scale=Math.min(2,2200/image.width,4800/image.height);
   const canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(image.width*scale));
   canvas.height=Math.max(1,Math.round(image.height*scale));
   const context=canvas.getContext('2d',{alpha:false});
   context.fillStyle='white';
   context.fillRect(0,0,canvas.width,canvas.height);
   if(enhance)context.filter='grayscale(1) contrast(1.35)';
   context.drawImage(image,0,0,canvas.width,canvas.height);
   return canvas;
 }finally{image.close()}
}
async function recognizeReceipt(file,store){
 const base=new URL('./vendor/ocr/',location.href);
 const {default:{createWorker}}=await import(new URL('tesseract.esm.min.js',base).href);
 const worker=await createWorker('slv',1,{
   workerPath:new URL('worker.min.js',base).href,
   workerBlobURL:false,
   corePath:new URL('tesseract-core-lstm.wasm.js',base).href,
   langPath:base.href
 });
 try{
   const first=parseReceipt((await worker.recognize(file)).data.text,store);
   if(store!=='Spar'||(first.rows.length&&first.rows.every(row=>row.receiptVerified)))return first;
   try{
     const image=await prepareReceiptImage(file);
     await worker.setParameters({tessedit_pageseg_mode:'6'});
     const second=parseReceipt((await worker.recognize(image)).data.text,store);
     return first.rows.length?reconcileSparReceipts(first,second):second;
   }catch{return first}
 }
 finally{await worker.terminate()}
}
async function recognizeReceiptWithAI(file,store){
 const {connect}=await import('./shared-lists.js');
 const client=await connect();
 const {data:{session},error}=await client.auth.getSession();
 if(error||!session)throw new Error('Za branje z AI se prijavi z Googlom.');
 const image=await prepareReceiptImage(file,false);
 const jpeg=await new Promise(resolve=>image.toBlob(resolve,'image/jpeg',0.86));
 if(!jpeg||jpeg.size>3*1024*1024)throw new Error('Slika je prevelika za AI.');
 const endpoint=localStorage.getItem('cn_sb_url').replace(/\/$/,'')+'/functions/v1/read-receipt';
 const response=await fetch(endpoint,{
   method:'POST',
   headers:{
     Authorization:'Bearer '+session.access_token,
     apikey:localStorage.getItem('cn_sb_key'),
     'Content-Type':'image/jpeg',
     'x-receipt-store':store==='Tuš'?'Tus':store
   },
   body:jpeg,
   signal:AbortSignal.timeout(55000)
 });
 const result=await response.json().catch(()=>null);
 if(!response.ok){
   const detail=typeof result?.error==='string'?result.error:'Supabase je vrnil HTTP '+response.status+'.';
   throw new Error(detail);
 }
 if(!Array.isArray(result?.rows)||!result.rows.length)throw new Error('AI ni našel postavk.');
 return result;
}
function initReceiptImport(){
 const mode=$('receiptMode'),saveStatus=$('receiptSaveStatus');
 const store=$('receiptStore'),image=$('receiptImage'),review=$('receiptReview'),status=$('receiptStatus'),date=$('receiptDate'),rows=$('receiptRows');
 for(const name of STORES)store.add(new Option(name,name));
 function addRow(data={}){
   const row=document.createElement('div');
   row.className='line';
   row.innerHTML='<label><input type="checkbox" style="width:auto"> Shrani</label> <label>Izdelek <input maxlength="100"></label> <label>Pakiranje <input maxlength="40" placeholder="Npr. 150 g"></label> <label><span>Cena (€)</span> <input inputmode="decimal"></label>';
   const [use,name,unit,price]=row.querySelectorAll('input');
   use.checked=data.use!==false;
   name.value=data.name||'';
   const readUnit=(data.unit||'').trim();
   unit.value=/^(?:kos|kom|pcs?)[.]?$/i.test(readUnit)?'1 kos':
     /^(?:pakiranje|paket|pak)[.]?$/i.test(readUnit)?'':readUnit;
   price.value=data.price||'';
   if(data.receiptByWeight)row.querySelector('span').textContent='Cena na kilogram (€/kg)';
   if(data.receiptDetail){
     const detail=document.createElement('small');
     detail.textContent=data.receiptDetail;
     row.append(detail);
   }
   rows.append(row);
 }
 $('receiptAdd').onclick=()=>addRow();
 image.onchange=async ()=>{
   const file=image.files[0];
   if(!file)return;
   image.value='';
   if(!store.value){status.textContent='Najprej izberi trgovino.';store.focus();return}
   review.hidden=true;
   rows.replaceChildren();
   saveStatus.textContent='';
   date.value='';
   mode.disabled=store.disabled=image.disabled=true;
   status.textContent=mode.value==='ai'?'Berem račun z AI …':'Berem račun v brskalniku …';
   try{
     let result, locally=mode.value==='local', fallback='';
     if(!locally){
       try{result=await recognizeReceiptWithAI(file,store.value)}
       catch(error){
         locally=true;
         fallback=(error.name==='TimeoutError'?'Branje z AI je trajalo predolgo.':error.message||'Branje z AI ni uspelo.')+' ';
         status.textContent=fallback+'Berem v brskalniku …';
       }
     }
     if(locally)result=await recognizeReceipt(file,store.value);
     date.value=result.date;
     result.rows.forEach(addRow);
     status.textContent=fallback+(result.rows.length?(locally?'Lokalni odčitek. ':'Odčitek AI. ')+'Preveri postavke.':'Postavk nisem našel. Vneseš jih lahko ročno.');
   }catch{
     status.textContent='Branje slike ni uspelo. Poskusi z drugo sliko ali vnesi postavke ročno.';
   }finally{
     if(!rows.children.length)addRow();
     review.hidden=false;
     mode.disabled=store.disabled=image.disabled=false;
   }
 };
 $('receiptForm').onsubmit=event=>{
   event.preventDefault();
   if(review.hidden)return;
   saveStatus.textContent='';
   for(const row of rows.children){
     row.querySelector('.receipt-row-error')?.remove();
     for(const input of row.querySelectorAll('[aria-invalid]'))input.removeAttribute('aria-invalid');
   }
   if(!STORES.includes(store.value)||!date.value||!date.validity.valid){
     const missingStore=!STORES.includes(store.value);
     saveStatus.textContent=missingStore?'Izberi trgovino.':'Vnesi veljaven datum nakupa.';
     (missingStore?store:date).focus();
     return;
   }
   const accepted=[];
   let invalidCount=0,firstError;
   for(const row of rows.children){
     const [use,nameInput,unitInput,priceInput]=row.querySelectorAll('input');
     if(!use.checked)continue;
     const name=nameInput.value.trim(),unit=unitInput.value.trim(),price=numericPrice({price:priceInput.value});
     const size=unit?amount(unit):null;
     let input,message;
     if(!receiptName(name)){input=nameInput;message='Vnesi naziv izdelka.'}
     else if(price===null){input=priceInput;message='Vnesi ceno, večjo od 0 €.'}
     else if(unit&&(!size||!(size.v>0)||!(size.count>0))){
       input=unitInput;
       message='Vnesi pakiranje, npr. 150 g, 0,5 l ali 10 kos. Če ni znano, pusti prazno.';
     }
     if(input){
       input.setAttribute('aria-invalid','true');
       const error=document.createElement('p');
       error.className='warn receipt-row-error';
       error.textContent=message;
       row.append(error);
       firstError??=input;
       invalidCount++;
       continue;
     }
     accepted.push({row,entry:{store:store.value,name,unit:unit||(amount(name)?name:''),price,date:date.value}});
   }
   if(!accepted.length&&!invalidCount){
     saveStatus.textContent='Označi vsaj eno postavko.';
     return;
   }
   if(accepted.length){
     try{savePrices(accepted.map(item=>item.entry))}
     catch{saveStatus.textContent='Shranjevanje v brskalnik ni uspelo. Postavke so še na voljo za urejanje.';return}
   }
   if(invalidCount){
     for(const {row} of accepted)row.remove();
     const message=(accepted.length?'Shranjene postavke: '+accepted.length+'. ':'')+'Za pregled: '+invalidCount+'. Popravi označena polja.';
     status.textContent=saveStatus.textContent=message;
     firstError.focus();
   }else{
     rows.replaceChildren();
     date.value='';
     review.hidden=true;
     status.textContent='Shranjene postavke v tem profilu: '+accepted.length+'.';
     status.focus();
   }
   if(accepted.length)render();
 };
}
function savePrices(imported){
 const latest=new Map();
 for(const row of [...readProfile(receiptKey,[]),...imported]){
   const key=JSON.stringify([row.store,receiptName(row.name),amount(row.unit)]);
   if(!latest.has(key)||latest.get(key).date<=row.date)latest.set(key,row);
 }
 const next=[...latest.values()].sort((a,b)=>b.date.localeCompare(a.date));
 writeProfile(receiptKey,next);
 receiptHistory=next;
 renderSuggestions();
}
function rememberProduct(name){
 const key=normalize(name);
 const previous=preferences.find(product=>normalize(product.name)===key);
 preferences=[{name,count:(previous?.count||0)+1},...preferences.filter(product=>normalize(product.name)!==key)].slice(0,200);
 writeProfile(preferencesKey,preferences);
}
const commonProducts=['Mleko','Trajno mleko 3,5 % 1 l','Sveže mleko','Kruh','Kajzerica','Jajca 10 kos','Maslo 250 g','Grški jogurt 500 g','Poli narezek 150 g','Sir','Čips','Baterije AA','Planinski čaj','Hrenovke','Jabolka','Banane','Krompir','Paradižnik','Pivo','Belo vino','Riž','Testenine','Moka','Kava','Mineralna voda','Sadna kaša','Plenice'];
function renderSuggestions(){
 const target=$('suggestions'),query=normalize($('newItem').value);
 const tokens=query.split(/\s+/).filter(Boolean);
 target.replaceChildren();
 const matches=new Map();
 const personal=[...preferences,...receiptHistory];
 for(const product of [...personal,...(query?commonProducts.map(name=>({name})):[])]){
   const key=normalize(product.name);
   if(key&&key!==query&&tokens.every(token=>key.includes(token))&&!matches.has(key))matches.set(key,product);
 }
 const ranked=[...matches.entries()].sort(([a,x],[b,y])=>
   (y.count||0)-(x.count||0)||Number(b.startsWith(query))-Number(a.startsWith(query)));
 $('suggestionPanel').hidden=!ranked.length;
 $('suggestionLabel').textContent=query?'Predlogi':'Pogosto dodano';
 for(const [,product] of ranked.slice(0,6)){
   const button=document.createElement('button');
   button.type='button';
   button.className='soft';
   button.textContent='+ '+product.name;
   button.onclick=()=>{$('newItem').value=product.name;add();$('newItem').focus()};
   target.append(button);
 }
}
function renderProfiles(){
 const select=$('profileSelect');
 select.replaceChildren(...profiles.map(p=>new Option(p.name,p.id)));
 select.value=activeProfile;
}
function profileReady(){
 if(!busy&&!$('receiptImage').disabled)return true;
 $('profileStatus').textContent='Počakaj, da se iskanje ali uvoz konča.';
 renderProfiles();
 return false;
}
function switchProfile(id){
 if(!profileReady())return;
 localStorage.setItem(activeProfileKey,JSON.stringify(id));
 activeProfile=id;
 listState=loadListState();
 items=activeList().items;
 choices=readProfile(choicesKey,{});
 receiptHistory=readProfile(receiptKey,[]);
 preferences=readProfile(preferencesKey,[]);
 includeUnverified=readProfile(infoKey,false);
 offers={};alternatives={};upcoming={};sources={};failures={};
 for(const store of STORES)delete couponSelections[store];
 openStore=null;
 $('infoMode').checked=includeUnverified;
 $('newItem').value='';
 renderSuggestions();
 $('progress').textContent='';
 $('sources').textContent='Še ni iskanja.';
 $('receiptForm').reset();
 $('receiptReview').hidden=true;
 $('receiptSaveStatus').textContent='';
 $('receiptRows').replaceChildren();
 $('receiptStatus').textContent='Po branju preglej postavke in potrdi shranjevanje.';
 $('manualPriceForm').reset();
 $('manualStatus').textContent='';
 $('profileStatus').textContent='';
 renderProfiles();
 render();
}
function initProfiles(){
 renderProfiles();
 $('profileSelect').onchange=event=>switchProfile(event.target.value);
 $('profileForm').onsubmit=event=>{
   event.preventDefault();
   const input=$('profileName'),name=input.value.trim();
   if(!normalize(name)||profiles.some(profile=>normalize(profile.name)===normalize(name))){
     $('profileStatus').textContent='Vnesi novo, različno ime profila.';
     return;
   }
   if(!profileReady())return;
   const profile={id:crypto.randomUUID(),name};
   const next=[...profiles,profile];
   localStorage.setItem(profilesKey,JSON.stringify(next));
   profiles=next;
   switchProfile(profile.id);
   input.value='';
   $('newProfile').open=false;
 };
 $('newItem').addEventListener('input',renderSuggestions);
 renderSuggestions();
 for(const store of STORES)$('manualStore').add(new Option(store,store));
 $('manualPriceForm').onsubmit=event=>{
   event.preventDefault();
   const store=$('manualStore').value,name=$('manualName').value.trim(),unit=$('manualUnit').value.trim();
   const price=numericPrice({price:$('manualPrice').value});
   if(!STORES.includes(store)||!receiptName(name)||price===null||(unit&&!amount(unit))){
     $('manualStatus').textContent='Preveri trgovino, izdelek, pakiranje in ceno.';
     return;
   }
   try{savePrices([{store,name,unit:unit||(amount(name)?name:''),price,manual:true,date:couponDay.format(new Date())}])}
   catch{$('manualStatus').textContent='Shranjevanje cene ni uspelo.';return}
   $('manualName').value=$('manualUnit').value=$('manualPrice').value='';
   $('manualStatus').textContent='Cena je shranjena v tem profilu.';
   render();
 };
}
initProfiles();
if(new URLSearchParams(location.search).has('povabilo')||location.hash.startsWith('#povabilo=')||sessionStorage.getItem('cn_pending_shared_invite'))$('sharedTools').open=true;
showView();
initReceiptImport();
$('infoMode').checked=includeUnverified;$('infoMode').onchange=e=>{includeUnverified=e.target.checked;writeProfile(infoKey,includeUnverified);render()};$('productForm').onsubmit=event=>{event.preventDefault();add();$('newItem').focus()};$('refresh').onclick=search;$('clear').onclick=()=>{if(confirm('Izbrišem vse postavke na tem seznamu?')){for(const item of [...items])for(const store of STORES)delete choices[legacyChoiceKey(item,store)];items=[];offers={};alternatives={};upcoming={};failures={};persist();render()}};
function isPublicSupabaseKey(key){
 if(/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))return true;
 try{
   const parts=key.split('.');
   return parts.length===3&&JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='anon';
 }catch{return false}
}
$('save').onclick=()=>{
 const url=$('sburl').value.trim().replace(/\/$/,'');
 const key=$('sbkey').value.trim();
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)||!isPublicSupabaseKey(key)){
   $('configState').textContent='Vnesi pravilen Supabase URL in publishable/anon ključ.';
   return;
 }
 localStorage.setItem('cn_sb_url',url);
 localStorage.setItem('cn_sb_key',key);
 couponRefresh=0;couponInfo={};
 $('configState').textContent='Povezava je shranjena v tem brskalniku.';
};
$('sburl').value=localStorage.getItem('cn_sb_url')||'';
const savedConnectionKey=localStorage.getItem('cn_sb_key');
if(savedConnectionKey&&!isPublicSupabaseKey(savedConnectionKey)){
 localStorage.removeItem('cn_sb_key');
 $('configState').textContent='Neveljaven ključ je bil odstranjen iz brskalnika. Če je bil skrivni ključ, ga zamenjaj v Supabase.';
}else if(savedConnectionKey){
 $('sbkey').value=savedConnectionKey;
 $('configState').textContent='Shranjena povezava je bila naložena.';
}
render();
