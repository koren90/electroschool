# ElectroSchool

Simulátor elektrických schémat pro výuku i praxi: **schéma** podle ČSN EN 60617, **realistické zapojení** přístrojů barevnými vodiči, **simulace** (proudy, napětí, motory, ochrany) a **kalkulačky** pro elektrikáře. Čte a ukládá soubory `.cad` programu CADe_SIMU.

- **Webová verze:** https://duppi09.github.io/electroschool/ – stačí otevřít v prohlížeči (Chrome, Edge, Safari, Firefox) – viz složka `docs/` (GitHub Pages). V Chrome a Edge se ukládá přímo do souboru (další ⌘S / Ctrl+S přepíše tentýž soubor), v ostatních prohlížečích se soubor stáhne. Funguje i offline a dá se nainstalovat jako aplikace.
- **Aplikace pro macOS:** `./build.sh` → `build/ElectroSchool.app`.

Obě verze sdílejí tentýž kód ve složce `app/`.

## Sestavení

```bash
./build_web.sh   # webová verze do docs/
./build.sh       # aplikace pro macOS (vyžaduje Xcode / swiftc)
```

Testy (JavaScriptCore z macOS):

```bash
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
$JSC app/core.js tools/elektro_test.js -- Priklady
$JSC app/core.js app/real.js tools/real_test.js -- Priklady
$JSC app/core.js app/real.js tools/route_test.js -- Priklady
$JSC app/core.js app/real.js tools/demo_domov.js -- test
$JSC app/core.js app/real.js tools/domov3f_test.js
$JSC app/calc.js tools/calc_test.js
```

Testy v Node (bez macOS, stejné kontroly jako výše přes `tools/run.js`):

```bash
node tools/run.js app/core.js,tools/elektro_test.js -- Priklady
node tools/run.js app/core.js,app/real.js,tools/real_test.js -- Priklady
node tools/run.js app/core.js,app/real.js,tools/route_test.js -- Priklady
node tools/run.js app/core.js,app/real.js,tools/domov3f_test.js
node tools/run.js app/calc.js,tools/calc_test.js
```

Testy ovládání v prohlížeči (Playwright, Chrome; myš i dotyk, plátno a nabídky):

```bash
pip install playwright
python -m http.server 8766 --directory app &
python tools/e2e/ux.py
python tools/e2e/smoke.py
```

Ukázková schémata ve složce `Priklady/` (kromě souborů „ElectroSchool – …“) pocházejí z repozitáře [ELECTROALL/CADE-SIMU](https://github.com/ELECTROALL/CADE-SIMU).

## Původní popis

Nativní macOS aplikace pro kreslení a simulaci elektrických (stykačových) schémat.
Je to nově napsaná náhrada windowsového programu CADe_SIMU – čte a ukládá jeho soubory `.cad`.

## Spuštění
Aplikace je nainstalovaná v `/Applications/ElectroSchool.app`. Soubory `.cad` lze otevřít z menu,
přetažením do okna nebo přes „Otevřít v aplikaci“ ve Finderu. Ukázky jsou v menu **Příklady…** a ve složce `Priklady/`.

## Ovládání
- **Kreslení:** součástku vyberte v paletě a klikněte do plátna (R = otočit). Vodič: W, klik–klik, konec na svorce nebo dvojklikem.
- **Úpravy:** dvojklik = vlastnosti (označení, svorky, čas, barva), tažení = přesun, ⌫ = smazat, ⌘Z/⇧⌘Z, ⌘C/⌘V.
- **Plátno:** tažení prázdné plochy posouvá výkres, Shift + tažení (nebo tlačítko **Oblast**) vybírá oblast, kolečko s ⌘ nebo dva prsty přibližují.
  Zpět/Znovu a přiblížení jsou tlačítka přímo na plátně, Otočit / Smazat / Vlastnosti / Hotovo se ukážou jen tam, kde dávají smysl.
- **Dotyk (telefon, tablet):** jeden prst vybírá a posouvá přístroje (krátké klepnutí je jen vybere), tažení prázdné plochy posouvá výkres,
  dva prsty posouvají a přibližují. Vložení součástky a body vodiče se provedou až po zvednutí prstu. Na úzké obrazovce je paleta dole a soubory v nabídce ☰.
- **Simulace (⌘R):** jističe a vypínače se zapínají kliknutím, tlačítka držením myši (Shift+klik = zůstane stisknuté),
  klik na tepelné relé = vybavení. Kontakty se řídí cívkou / tlačítkem se **stejným označením**.
- Vodiče se v simulaci barví podle potenciálu (L1 hnědá, L2 černá, L3 šedá, N modrá, PE zelená). Zkrat vybaví jistič.

## Měření a ochrany
- **Voltmetr, ampérmetr** (paleta *Měření*): v simulaci ukazují hodnotu na displeji. Ampérmetr zapojený přímo na síť je zkrat.
- **Transformátor 230/24 V** (*Napájení*): sekundár je samostatný zdroj (fialové vodiče); napětí lze ve vlastnostech změnit.
  Primár odebírá výkon podle zátěže sekundáru. Uzemnění 0 V sekundáru na PE není zkrat.
- **Motorový spouštěč** (*Jištění*): ruční zapnutí, zkratová spoušť a tepelná spoušť třídy 10 (nastavení Iᵣ ve vlastnostech,
  6 × Iᵣ vybaví asi za 15 s). Stejnou tepelnou spoušť má i tepelné relé, pokud mu nastavíte Iᵣ.
- **Proudový chránič 30 mA** 2P a 4P (*Jištění*): vybaví, když se proud vrací jinudy než přes chránič (např. přes PE).
  Klik na zapnutý chránič = tlačítko TEST.
- Zátěže mají jmenovité příkony (cívka 8 W, časové relé 3 W, signálka 2 W, houkačka 15 W, ventil 6 W) a jmenovité napětí
  podle zdroje (230 V, 24 V DC nebo sekundár transformátoru). Motor odebírá proud podle výkonu (ve vlastnostech, výchozí 4 kW)
  a při rozběhu 6 × Iₙ. Ukázka: *Příklady… → Měření a ochrany*.
- Prvky s kódy 20000+ jsou rozšíření ElectroSchool – původní CADe_SIMU je v souboru nepozná.

## Kalkulačky
Záložka **Kalkulačky** (⌘2, zpět na schéma ⌘1): Ohmův zákon a výkon, proud motoru a jištění, úbytek napětí
a průřez vodiče, hvězda/trojúhelník, otáčky a skluz, kompenzace účiníku, odpory sériově/paralelně, spotřeba a cena energie.
Počítá se průběžně při psaní; čísla lze psát s desetinnou čárkou i s předponou (4k7, 2,2k).
Testy: `jsc app/calc.js tools/calc_test.js`.

## Jak simulace počítá
- Síť TN 3×400/230 V, 50 Hz (fázory L1, L2, L3 po 120°), N a PE na potenciálu země, stejnosměrný zdroj 24 V.
- Napětí se počítají uzlovou metodou: cívky, žárovky a vinutí motorů jsou odpory, zdroje ideální.
  Proto fungují i sériová zapojení (dvě žárovky v sérii svítí slabě, cívka v sérii se žárovkou nepřitáhne),
  sdružené napětí 400 V mezi fázemi a vodič „pod napětím přes zátěž“ při přerušeném nuláku.
- Cívka přitáhne / signálka svítí od 70 % jmenovitého napětí (230 V AC, resp. 24 V DC); jas žárovky ~ U².
- Motor: z napětí vinutí se spočítá sousledná a zpětná složka; moment ~ |U1|² − |U2|². Z toho plyne směr otáčení,
  třetinový moment ve hvězdě (1350 ot/min) proti trojúhelníku (1450 ot/min) i ztráta točivého pole při výpadku fáze.
  U motoru se zobrazuje otáčkoměr (ot/min), počítadlo otáček Σ a napětí na vinutí.
- Zkrat (přímé spojení různých potenciálů včetně fáze–PE) vybaví jistič, bez jističe přepálí pojistku.
- Vodiče se spojují ve společných koncových bodech, ve svorkách a ve spojovacích tečkách; křížení bez tečky spojené není.
- Zjednodušení: motor při výpadku fáze vždy doběhne (skutečný nezatížený motor by mohl běžet dál na dvě fáze),
  jistič nevybavuje přetížením (jen zkratem), úbytky na vedení se nepočítají, impedance zátěží jsou činné odpory.

Testy: `jsc app/core.js tools/elektro_test.js` (jsc = /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc).

## Co umí
Napájení (1f, 3f, DC), vodiče, pojistky, jističe, tepelné relé, stykače, vypínače, pomocné a časové kontakty,
tlačítka, přepínače, koncové spínače, cívky, časová relé (zpožděný přítah/odpad), signálky, houkačku, ventil,
motory (3f, Y/Δ, 1f), GRAFCET (kroky, přechody, akce S/R) a jednoduchý pneumatický válec, čáry/tvary/text.

Prvky původního programu, které zatím podporované nejsou (PLC, logická hradla, měniče, další pneumatika…),
se zobrazí čárkovaným rámečkem a při uložení zůstanou v souboru zachované.

## Sestavení ze zdrojů
```bash
./build.sh
```
Vyžaduje Xcode (swiftc). Výsledek: `build/ElectroSchool.app`. Testy jádra: `tools/test.js` (spouští se přes `jsc`).

## Struktura
- `app/` – jádro (core.js: formát .cad + simulace, symbols.js: značky, ui.js: editor)
- `mac/` – nativní obal (Swift, WKWebView) a ikona
- `Priklady/` – ukázková schémata z původního repozitáře


## Záložka Realita

Stejné schéma zobrazené jako skutečné přístroje (jističe na DIN liště, stykače, tlačítka, signálky, motor se svorkovnicí…), které se propojují barevnými vodiči.

- **Přístroje** jsou tytéž prvky jako ve schématu. Prvky se stejným označením se skládají do jednoho přístroje: cívka + hlavní + pomocné kontakty = jeden stykač, tlačítko s více kontakty = jedno tlačítko s více kontaktními bloky. Přístroj vložený v realitě se objeví i ve schématu (na volném místě) a naopak.
- **Vodič** natáhnete tažením ze svorky na svorku, nebo klikáním (svorka → lomové body → svorka). Barvu zvolíte v paletě; dvojklikem na vodič ji změníte nebo vodič smažete.
- **Barvy přístrojů** jsou ve výchozím stavu černobílé; dvojklikem na přístroj nastavíte barvu těla a hmatníku/páčky (u signálky barvu světla).
- **⇣ Zapojit podle schématu** natáhne vodiče podle schématu (L1 hnědá, L2 černá, L3 šedá, N modrá, PE zelenožlutá).
- **⇡ Překreslit schéma** smaže vodiče schématu a nakreslí je znovu podle reality (automatické vedení kolmých vodičů, značky zůstanou na místě).
- **Porovnat** vypíše rozdíly mezi realitou a schématem a označí dotčené svorky červeně.
- **Simulace v realitě** počítá jen s nataženými vodiči – zapomenutý vodič se projeví stejně jako ve skutečnosti. Najetím na svorku změříte napětí.
- Realistické zapojení se ukládá do souboru .cad za jeho konec (původní CADe_SIMU ho ignoruje). GRAFCET v realitě zobrazen není a zůstává propojený podle schématu.


## Domovní instalace

V paletě (Schéma i Realita) se nahoře přepíná sada **Průmysl / Domovní instalace**. Domovní sada je rozdělená podle norem:

| Skupina | Norma | Prvky |
|---|---|---|
| Rozvodnice | ČSN 33 2000-4-41, ČSN 33 2000-5-53 | přípojka 230 V / 3×400 V, elektroměr 1f (1-3 / 4-6) a 3f, hlavní vypínač 3P, jističe 1P/3P, proudové chrániče 2P/4P 30 mA, pojistka |
| Spínače | řazení dle ČSN EN 60669-1 | č. 1 jednopólový, č. 2 dvoupólový, č. 5 sériový (dvě kolébky), č. 6 střídavý (schodišťový), č. 7 křížový, tlačítko č. 1/0 |
| Zásuvky | ČSN EN 60884-1, ČSN 35 4516, ČSN EN 60309 | zásuvka 230 V s ochranným kolíkem, zásuvka 400 V 16 A a 32 A (CEE 5p, „motorová“) – v simulaci kliknutím zapojíte spotřebič; měření ukáže sled fází (pravotočivý / levotočivý), chybějící fázi, N a PE |
| Svítidla a spotřebiče | ČSN EN 60598, ČSN EN 62080 | svítidlo, zvonek, sporák / varná deska 3f, ohřívač vody (bojler), ventilátor – příkon ve W |
| Ovládací přístroje | ČSN EN 60669-2-1, -2-2, -2-3 | impulsní relé, schodišťový automat, pohybové čidlo, časová relé (zpožděný přítah / odpad), instalační stykač 2P, termostat, soumrakový spínač, spínací hodiny (zkrácený čas zap/vyp) |
| Spojování | ČSN EN 60998 | spojovací svorky 3× a 5× |

Barvy vodičů odpovídají ČSN EN 60445 (L hnědá/černá/šedá, N světle modrá, PE zelenožlutá). Měření myší na zásuvce ukáže napětí L–N, zda je připojen ochranný kolík a zda není fáze na nulové dutince. Ukázky: *Příklady → Domovní instalace (schodiště, zásuvka, impulsní relé)* a *Domovní instalace 3f (sporák, motorová zásuvka, bojler)*. Testy: `jsc app/core.js app/real.js tools/demo_domov.js -- test`.


## Kalkulačky (přehled)

Záložka Kalkulačky je rozdělená do sekcí, nahoře je vyhledávání (např. „jistič“, „chránič“, „LED“):

- **Základy:** Ohmův zákon, výkon a proud 1f/3f (P, S, Q), odpory sériově/paralelně, reaktance a impedance RLC.
- **Vedení a jištění:** průřez vodiče a jistič podle uložení (A1–E), teploty a souběhu (ČSN 33 2000-5-52, Ib ≤ In ≤ Iz), úbytek napětí, impedance smyčky a zkratový proud – vypne jistič B/C/D do 0,4 s a jaká je největší délka vedení (ČSN 33 2000-4-41).
- **Ochrana a revize:** proudový chránič (vybavovací časy, odpor uzemnění TT), izolační odpor (ČSN 33 2000-6), význam kódu krytí IP.
- **Motory a pohony:** proud motoru a jištění, otáčky a skluz, hvězda/trojúhelník, kompenzace účiníku, třífázový motor na 230 V (Steinmetz).
- **Domácnost a spotřeba:** soudobý příkon a hlavní jistič, spotřeba a cena energie, ohřev vody v bojleru, osvětlení místnosti.
- **Převody a elektronika:** transformátor, AWG ↔ mm², předřadný odpor pro LED.

Tabulkové hodnoty jsou orientační (Cu, PVC); pro projekt a revizi platí aktuální znění norem.
