# CenejšiNakup — projekt v0.2 (brez izmišljenih cen)

## Kaj je pripravljeno
- `index.html`: mobilna spletna aplikacija, seznam, količine, prikaz ponudb in povezava na Supabase.
- `supabase/migrations/001_schema.sql`: osnovna shema trgovin in ponudb.
- `supabase/functions/search-prices/index.ts`: strežniška funkcija za iskanje po javnih virih.
- Ni vgrajenih testnih cen. Če vir ne vrne cene, je rezultat prazen.

## Trenutna realna pokritost adapterjev
- Tuš: javni WooCommerce Store API (`/wp-json/wc/store/products`), odziv je treba potrditi v tvojem Supabase okolju.
- Eurospin: javna stran akcij; parser bere samo vidne ponudbe in je občutljiv na spremembe HTML.
- Lidl in Hofer: javni produktni sitemap + JSON-LD produktnih strani; cena se pokaže samo, če je javno objavljena v strukturiranih podatkih.
- SPAR in Mercator: adapterja sta namenoma označena kot čakajoča na potrditev natančnega javnega API formata. Ne pošiljamo ugibanih zahtevkov in ne prikazujemo izmišljenih cen.

## Namestitev
1. Ustvari Supabase projekt.
2. V SQL Editorju zaženi `supabase/migrations/001_schema.sql`.
3. Namesti Supabase CLI in se prijavi:
   `supabase login`
4. Poveži projekt:
   `supabase link --project-ref TVOJ_PROJECT_REF`
5. Objavi funkcijo:
   `supabase functions deploy search-prices`
6. V Supabase Dashboard -> Edge Functions -> Secrets nastavi samo potrebne strežniške skrivnosti, če jih boš kasneje dodal. Service role ključ ne sodi v `index.html`.
7. V GitHub repository naloži `index.html` v root kot `index.html`, omogoči GitHub Pages.
8. V aplikaciji vnesi Project URL in anon/public key.

## Omejitve in varno zajemanje
- Funkcija pred dostopom preveri robots.txt in ob napaki fail-closed.
- Ne obhaja prijav, paywallov ali tehničnih zaščit.
- Zajem je namenoma omejen na iskanje na zahtevo; za dnevni zajem je potreben ločen scheduler in dogovorjeni intervali.
- Pred javno uporabo preveri pogoje posamezne trgovine in po potrebi pridobi dovoljenje.
- Cene so informativne; ob vsakem rezultatu je vir in čas zajema.

## Pomembno
Ta paket je začetna integracijska osnova, ne trditev, da je vseh šest adapterjev že potrjeno delujočih. Za dokončanje SPAR/Mercator adapterjev in preverjanje ostalih potrebujemo resnične odzive endpointov iz dovoljenih javnih virov.

## Prijava z Googlom in skupni listki

V Supabase projektu `pccpqzkdmuedtshpbvph` ročno zaženi migracijo
`supabase/migrations/002_shared_lists.sql`. V Authentication → Providers
omogoči Google z odjemalcem OAuth iz Google Cloud Console. V konfiguraciji
odjemalca Google dodaj preusmeritveni naslov
`https://pccpqzkdmuedtshpbvph.supabase.co/auth/v1/callback`. V Supabase
Authentication → URL Configuration med dovoljene preusmeritve dodaj
`https://kladivo1405.github.io/Cenej-iNakup/`.

V aplikaciji shrani obstoječi javni ključ projekta kot publishable/anon ključ.
Prijavi se z Googlom, ustvari skupni listek in po potrebi kopiraj trenutne
postavke. Lastnik lahko ustvari povezavo za eno pridružitev. Nova povezava
razveljavi prejšnjo. Član lahko dodaja postavke in jih označi kot kupljene.
Zasebni nakupovalni listki, računi in preference so vezani na lokalni profil
v brskalniku.

## Branje računov z AI

Privzeti način »AI« uporablja prijavo z Googlom. Sliko pošlje funkciji
`read-receipt`, ta pa jo za prepoznavanje posreduje OpenAI. CenejšiNakup ne
shranjuje slike. Uporabnik lahko izbere lokalno branje v brskalniku ali potrdi
predlagane postavke za lokalno shranjevanje.

V Supabase Dashboard dodaj Edge Function secret `OPENAI_API_KEY` in objavi
funkcijo `read-receipt` iz `supabase/functions/read-receipt/index.ts`. Funkcija
preveri uporabniško sejo z Authom pred klicem modela. Če preverjanje JWT na
prehodu Supabase zavrne veljavne seje projekta, ga izklopi samo za
`read-receipt`, saj funkcija opravi lastno preverjanje. Klici modela porabljajo
sredstva projekta OpenAI. Branje brez prijave ali brez delujoče funkcije se
samodejno nadaljuje lokalno.

## Android APK

Androidov zaganjalnik v imeniku `android` odpre objavljeno spletno aplikacijo
v privzetem brskalniku. Brskalniki s podporo za Custom Tabs jo odprejo v
prilagojenem zavihku in uporabijo obstoječo sejo brskalnika.

Za gradnjo uporabi Android SDK (platforma 35, Build Tools 35.0.0), JDK in
`zip`. Nastavi `ANDROID_SDK_ROOT`, `APK_KEYSTORE`, `APK_KEY_ALIAS` in
`APK_STORE_PASSWORD`, nato zaženi
`./android/build-apk.sh /absolutna/pot/CenejsiNakup.apk`. Za posodobitve
obdrži isti podpisni ključ in povečaj `versionCode` v manifestu.

## Varnostne spremembe

Najprej v **Supabase → SQL Editor** uporabi
`supabase/migrations/003_security_hardening.sql`. Nato posodobi Edge Function
`read-receipt`. Do uporabe migracije funkcija zavrne plačljiv klic, aplikacija
pa preklopi na lokalno branje. Obstoječi skrivni ključ OpenAI ostane nastavljen
v Edge Functions → Secrets. Supabase funkciji zagotovi strežniški
`SUPABASE_SERVICE_ROLE_KEY`.

Branje z AI omogoča največ **15 zahtev na račun** in **120 zahtev za aplikacijo**
na dan, po času Europe/Ljubljana. Odšteje se vsaka zahteva, ki je bila
sprejeta za klic ponudnika, tudi če ponudnik pozneje vrne napako. Lastnik
skupnega listka lahko članom odvzame dostop. Nova povabila nosijo žeton
v fragmentu URL-ja, stare povezave pa ostanejo združljive.

Knjižnice za prijavo, lokalni OCR in Manrope streže repozitorij. Verzije in
integriteto paketov navaja `vendor/package-lock.json`. Datoteke so prevzete iz
paketov Supabase JS 2.89.0, Tesseract.js 6.0.1, Tesseract.js Core 6.0.0,
slovenskega jezikovnega modela 1.0.0 (4.0.0_best_int) in Manrope 5.2.8.
Aplikacija omejuje vire z metaoznako CSP in nastavlja `no-referrer`.

Po objavi preveri branje računa, ustvarjanje povabila in odvzem dostopa med
dvema računoma. Za zaščito veje `main` v GitHubu odpri **Settings → Rules →
Rulesets**, ustvari aktiven Branch Ruleset za privzeto vejo ter vključi
**Restrict deletions**, **Block force pushes** in **Require a pull request
before merging**. V repozitoriju z enim vzdrževalcem lahko število zahtevanih
odobritev ostane 0, da lastnik še vedno lahko združi svoj pull request.
