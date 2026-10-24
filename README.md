# Political Sample Finder

Find citater fra **rigtige folketingsreferater**, se taler og klokkeslæt, og åbn den mulige originaloptagelse som MP3. Ingen opdigtede søgeresultater og ingen automatisk MP3-klipning.

## Cloudflare-udgaven v0.3

- Worker API + D1-database til referater, taleindlæg, podcastlinks og favoritter.
- PDF-læsning i browseren via PDF.js, med tekstsøgning og filter på politiker.
- Officielt podcast-RSS og afspiller med *omtrentlig* tidsposition, der kan justeres.
- Koden er testet for syntaks, dato/RSS og enkle talersektioner. **Live-import og afspilning er endnu ikke testet i Cloudflare.**

## Installation kun i browser (ingen Terminal)

1. Åbn https://dash.cloudflare.com/ og vælg den Cloudflare-konto, som skal eje projektet.
2. Gå til **Workers & Pages → Create application → Import a repository / GitHub**.
3. Vælg **filipsanderrasmussen/political-sample-finder** og branchen **main**.
4. Arbejdsmappe er repositoryets rod (/). Worker-navnet skal være **political-sample-finder** (som i wrangler.jsonc). Hvis Cloudflare beder om deploy command, brug **npx wrangler deploy**.
5. Vælg **Save and Deploy**. D1-bindingen skal hedde **DB**. Nyere Wrangler kan oprette databasen automatisk. Kontrollér, at bindingen er synlig efter deploy. Ellers opret og tilknyt en D1-database gennem dashboardet.
6. Åbn Workeren: **Settings → Variables and Secrets → Add → Secret**. Navn: **APP_PASSWORD**. Værdi: en selvvalgt stærk adgangskode (mindst 12 tegn). Gem med **Deploy**. Læg aldrig adgangskoden i GitHub.
7. Åbn den nye workers.dev-adresse, vælg **Indlæs data** og skriv adgangskoden. Prøv samling **20251**, møde **41**. Hvis server-fetch af PDF fejler, download original-PDF'en og vælg **Indlæs valgt PDF**.
8. Vælg **Opdatér lydindeks**, feed **Folketingssalen**, og søg f.eks. efter **ansvar**.

## Vigtige begrænsninger

- Referater indeholder klokkeslæt ved **starten af taleindlæg**, ikke tidskoder for hvert enkelt ord.
- MP3-links matches foreløbigt på **mødedato**, ikke på verificeret møde-ID. Kontroller altid lydfilen.
- En lydoptagelse starter ikke nødvendigvis ved det første referatklokkeslæt; afspillerens tidsposition er derfor kun et overslag.
- RSS-feedets historiske dækning er ikke komplet verificeret.
- PDF-parseren i webversionen bruger PDF.js og kan udtrække et andet antal taleindlæg end den lokale Python-version. Hvis udtrækket fejler, skal det rettes på rigtige kildeeksempler.
- Folketingets lyd er omfattet af brugsbetingelser. Download og musikalsk bearbejdning til udgivelse kræver rettighedsvurdering.

## Sikkerhed og hosting

- Repositoryet er aktuelt **offentligt**. Gem aldrig adgangskoder deri.
- Ændringer (import, favoritter, RSS) kræver APP_PASSWORD. Når den ikke er sat, er alle skrivehandlinger deaktiverede.
- Adgangskoden gemmes kun i browserfanens sessionStorage.
- Søge-API og allerede importerede offentlige referater er også offentligt tilgængelige på workers.dev. Brug Cloudflare Access, hvis hele appen skal være privat.
- Ingen privat loginbruger, brugeradministration eller automatisk download af MP3 er implementeret.

## Filstruktur

- src/worker.js: API, RSS og D1.
- public/index.html, public/style.css, public/app.js: browserapp, søgning og PDF-parser.
- wrangler.jsonc: Worker, statiske assets og D1-binding.
- package.json: build-konfiguration til Cloudflare.

## Første live-test efter deploy

1. /api/stats skal vise JSON, ikke en serverfejl.
2. Import af referat skal returnere et faktisk antal taler.
3. Søgning skal finde citater og links til den originale PDF.
4. RSS-indekset skal indeholde faktiske MP3-adresser.
5. Afspilning og cirka-hop skal testes manuelt mod originale tidsangivelser.

Dette er en fokuseret prototype. Live-integrationen er ikke testet i Cloudflare endnu.
