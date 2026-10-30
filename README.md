# TALEDATABASE 2000 (Political Sample Finder)

Søg i **rigtige folketingsreferater med verificeret original MP3**. Teksten er søgenøglen; lyden er produktet. Intet søgeresultat vises uden en kontrolleret lydkobling. Original lyd streames kun ved afspilning og kan klippes til 16-bit WAV.

## Projektets afgrænsning (besluttet 25. oktober 2026)

- **Lydsøgning:** Fokusér på Folketingets verificerede originale MP3-arkiv **fra 8. november 2024 og fremad**. Indlæs hele den dokumenterede periode med XML-referater, taler, talere, partier og tidsankre – kun når den tilhørende MP3 er bekræftet.
- **Ingen 2010-lydjagt:** Vi bruger ikke ressourcer på at finde/konvertere ældre videooptagelser til TALEDATABASE 2000. Vi kan udvide grænsen, hvis originale, direkte lydfiler senere bliver dokumenteret, men det er ikke en opgave nu.
- **Særskilt tekstprojekt:** Ordskyer, hyppigste ord, fraser, historisk tekstanalyse og partisammenligninger placeres i et senere selvstændigt projekt, foreløbigt **ORDLAB 2000**. Det skal kunne søge i historiske referater uden krav om lyd, evt. fra 2010 hvis datakilder og dækningsgrad kan verificeres.
- **Mulig kobling:** Tekstprojektet kan linke til TALEDATABASE 2000, hvis der også findes et verificeret matchende lydklip. Intet krav om fælles database eller identisk dækningsperiode.


## Roadmap

- **[ORDLAB 2000 – selvstændigt fremtidigt tekstprojekt](https://github.com/filipsanderrasmussen/political-sample-finder/issues/1)**: ordskyer, sammenligning af partiers karakteristiske ord, fraser og historiske trends; **kræver ikke MP3** og ligger uden for denne apps scope. Link til lydsøgning er en valgfri integration, ikke en afhængighed.

## Cloudflare-udgaven v0.4

- Worker API + D1 FTS5 til verificerede taler med lyd. Kun poster knyttet til `meeting_audio` returneres.
- Søgefladen fokuserer på ord og sætninger, med valgfri filtrering på taler og parti samt **25 fund ad gangen**. Datoafgrænsning er fjernet fra brugerfladen, men understøttes fortsat i API'et for eksisterende integrationer og links.
- Folketingets **officielle XML** hentes fra `oda.ft.dk` via en begrænset GitHub Actions-kørsel. Kun møder med matchende, HTTP HEAD-verificeret original Kaltura-MP3 og **færdigredigerede referater** accepteres.
- GitHub committer små JSON-mødefiler i `public/archive/xml/`. Cloudflare Cron importerer dem i 60-talebatches og opdaterer FTS5.
- Ældre PDF-arkivfiler bevares, men importeres ikke længere automatisk. Deres taler vises kun, hvis en original MP3 er verificeret og koblet til møde-id.
- MP3 hentes i browseren **først når brugeren afspiller eller klipper**. Ved tekstsøgning estimerer afspilleren søgeordets position ud fra ordandelen og tiden til næste indlægs start; den starter 6 sekunder før den estimerede position, når tidsdata er troværdige, ellers fra indlæggets begyndelse. En særskilt knap hopper altid til indlæggets start. WAV-klipperen benytter Kalturas officielle CORS- og byte-range-lydkilde direkte; proxyen bevares som sikker serverfunktion. Ingen videobehandling.
- Den nye version er verificeret live på workers.dev: FTS5-søgning, pagination, partifilter og udelukkende lydresultater er testet. En ægte Chrome-test har bekræftet 1 sek. WAV med lyd fra 02:00:00 i en 2024-MP3. XML-import i D1 udføres gradvist af Cron.

## Installation kun i browser (ingen Terminal)

1. Åbn https://dash.cloudflare.com/ og vælg den Cloudflare-konto, som skal eje projektet.
2. Gå til **Workers & Pages → Create application → Import a repository / GitHub**.
3. Vælg **filipsanderrasmussen/political-sample-finder** og branchen **main**.
4. Arbejdsmappe er repositoryets rod (/). Worker-navnet skal være **political-sample-finder** (som i wrangler.jsonc). Hvis Cloudflare beder om deploy command, brug **npx wrangler deploy**.
5. Vælg **Save and Deploy**. D1-bindingen skal hedde **DB**. Nyere Wrangler kan oprette databasen automatisk. Kontrollér, at bindingen er synlig efter deploy. Ellers opret og tilknyt en D1-database gennem dashboardet.
6. Åbn Workeren: **Settings → Variables and Secrets → Add → Secret**. Navn: **APP_PASSWORD**. Værdi: en selvvalgt stærk adgangskode (mindst 12 tegn). Gem med **Deploy**. Læg aldrig adgangskoden i GitHub.
7. Verificér at seneste deployment på Cloudflare indeholder `public/archive/xml/manifest.json`. Kontroller `https://<din-worker>/api/archive/status` for `xml_meetings` og `xml_imported_meetings`. GitHub Actions' egen commit kan kræve et efterfølgende deployment på Cloudflare.
8. Cron importerer XML-gradvist. Hvis du vil fremskynde processen, vælg **LOG IND** nederst på siden, log ind med `APP_PASSWORD`, åbn **ARKIVSTATUS** øverst og brug **Indeksér lydverificeret XML**. Søg dernæst efter f.eks. **ansvar**, og bekræft at hvert resultat har knappen **Lyt** og en original MP3.

## Automatisk XML + verificeret MP3 (oktober 2026)

1. Workflow: `.github/workflows/build-xml-audio-archive.yml`, **fire gange dagligt** (kl. 04:43, 10:43, 16:43 og 22:43 UTC) eller manuelt fra GitHub Actions. Højst **8 nye møder og 40 XML-forsøg pr. kørsel**. Script: `scripts/build_xml_audio_archive.py`. Arkivrobotten gemmer sin rullende position i `scripts/xml-audio-position.json`, så endnu ufærdige møder ikke spærrer vejen til ældre lyd. Første tirsdag i oktober bestemmer grundsamlingen, og `1`-/`2`-samlinger kontrolleres mod den faktiske mødedato. Gentagne MP3-enclosures tælles kun én gang pr. dato/mødenummer.
2. Læs `src/audio-index.json` (officielle RSS-enclosures). For hvert møde kontrolleres samling, dato, mødenummer og et **direkte MP3-link** via HTTP HEAD med `audio/mpeg`. **Ingen video**.
3. Hent `<samling>_M<møde>_helemoedet.xml` via FTP `oda.ft.dk/ODAXML/Referat/samling/` og kontrollér både metadata og tekst. Møder med **»Talen er under udarbejdelse«** eller **»afventer korrektur«** accepteres først, når referatet er færdigt.
4. Gem højst 8 fuldførte møder per kørsel i `public/archive/xml/` og opdater den versionsmærkede manifestfil. Kun møder med færdigt referat og direkte verificeret original MP3 indgår.
5. Når disse assets **er deployet**, indlæser Cloudflare Workerens Cron **seks batches à 60 taleafsnit**, to gange i timen. En færdig import registrerer MP3-link og tidsstempler sammen med mødet; den vises først ved `status=ready`.
6. Separat verificerer `src/audio-registry.js` op til 8 af eksisterende officielle MP3-links pr. Cron-kørsel for at bevare relevante PDF-indekserede taler med lyd.
7. Den gamle PDF-tilbagefyldning i `.github/workflows/backfill-archive.yml` **kører ikke automatisk** længere. Der er alene en manuel nødudgang til ældre data.
8. Kontrollér `/api/stats`, `/api/archive/status`, GitHub Actions-loggen og det faktiske Cloudflare-deployment. GitHub Actions-commits med `GITHUB_TOKEN` behøver ikke automatisk udløse alle eksterne CI/CD-processer.

**To importtrin:** GitHub henter XML og verifierer MP3; Cloudflare indlæser senere JSON i D1 og FTS5. `/api/archive/status` angiver `xml_meetings` (klargjort), `xml_imported_meetings` (færdigindlæst) og `xml_remaining_meetings` (afventer). Tallene for klargjorte XML-filer må **ikke** lægges oven i produktionsdatabasens taleantal, fordi importen kan erstatte ældre PDF-baserede afsnit fra de samme møder. En separat GitHub Action, `live-status.yml`, kontrollerer at XML-manifestet er deployet til Cloudflare.

**Dækningsgrænse:** Det offentligt verificerede MP3-feed rækker pt. tilbage til 8. november 2024. Ældre lyd kan først tilføjes, når en reel afspillelig original-MP3 er dokumenteret.

## Lydklipper / TD-2000

1. Find et reelt citat, og åbn **Original lyd**.
2. Find passagen ved at bruge lydafspilleren og ±15 sek. spring.
3. Klik **SÆT IN** og **SÆT OUT**, og justér præcist med ±0,01 / ±0,10 sek. eller skriv tidskoder som `01:02:03.450`.
4. Klik **FORHØR UDKLIP**. Højst 30 sekunder.
5. Klik **GEM WAV**. Den originale MP3 streames direkte fra Kaltura (CORS + Range), så Cloudflare ikke skal videresende hele optagelsen. Browseren optager kun det valgte tidsrum i realtid og gemmer stereo PCM i en WAV-fil.

Kliplængden fastsættes i hele PCM-frames ved browserens samplefrekvens. Positionen ved start af en komprimeret MP3 afhænger dog af browserens dekoder/seek og kan variere lidt; referatets oprindelige klokkeslæt er kun et cirka-anker. **Kontrollér altid præcise klipgrænser ved at lytte.** Forhør bruger den almindelige afspillers tidsstyring og er også vejledende. Klipperen accepterer udelukkende det officielle Kaltura MP3-mønster, og den tilbageværende serverproxy bruger samme stramme whitelist. En eksport på 10 sekunder tager omtrent 10 sekunder.

Lydens kilde er Folketinget. Rettigheder til offentliggørelse og musikalsk genbrug skal vurderes særskilt. Der foretages ingen lydoptagelse på serveren, og WAV-filen genereres i browseren.

## Vigtige begrænsninger

- Referater indeholder klokkeslæt ved **starten af taleindlæg**, ikke tidskoder for hvert enkelt ord. Den estimerede position er ikke en nøjagtig ord-tidskode. Indlæggets estimerede varighed kommer fra næste senere tidsstempel i samme møde, og interpolation slås fra ved usikre intervaller eller usandsynlig talehastighed.
- Nye XML-møder kræver samling, mødenummer, dato og en særskilt verificeret MP3-kilde. Eksisterende RSS-registreringer forbindes via match på dato **og mødenummer** og kontrolleres med HEAD.
- En lydoptagelse starter ikke nødvendigvis ved det første referatklokkeslæt; afspillerens tidsposition er derfor kun et overslag.
- RSS-feedets historiske dækning er ikke komplet verificeret.
- PDF-parseren i webversionen bruger PDF.js og kan udtrække et andet antal taleindlæg end den lokale Python-version. Hvis udtrækket fejler, skal det rettes på rigtige kildeeksempler.
- Folketingets lyd er omfattet af brugsbetingelser. Download og musikalsk bearbejdning til udgivelse kræver rettighedsvurdering.

## Sikkerhed og hosting

- Repositoryet er aktuelt **offentligt**. Gem aldrig adgangskoder deri.
- Ændringer (import, favoritter, RSS) kræver APP_PASSWORD. Når den ikke er sat, er alle skrivehandlinger deaktiverede.
- Administratoradgangen benytter en signeret, `HttpOnly`-sessioncookie med 30 dages gyldighed. Adgangskoden gemmes ikke i browserens localStorage eller sessionStorage. **ARKIVSTATUS** og importværktøjerne vises kun efter login; anonyme brugere finder et diskret **LOG IND** i sidefoden.
- Søge-API og allerede importerede offentlige referater er også offentligt tilgængelige på workers.dev. Brug Cloudflare Access, hvis hele appen skal være privat.
- Ingen individuel brugeradministration eller automatisk download af MP3 er implementeret.

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
