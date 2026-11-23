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
