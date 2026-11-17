"""Prohlížečové testy ovládání plátna (Playwright). Spuštění: python tools/e2e/ux.py  (server na portu 8766 ze složky app/)"""
import asyncio, sys
from playwright.async_api import async_playwright
sys.stdout.reconfigure(encoding="utf-8")
URL = 'http://localhost:8766/index.html'
async def launch(p):
    try: return await p.chromium.launch(channel='chrome')
    except Exception: return await p.chromium.launch()

PICK = """(()=>{const d=ESApp._debug(),v=d.view,r=document.querySelector('#cv').getBoundingClientRect();
 for(const it of d.doc.items){const k=ES.getDef(it.type).kind;if(['wire','node','text','gfx','supply','motor3'].includes(k))continue;const b=ES.bboxOf(it);if(!b)continue;
  const cx=it.n[8]+b[0]+b[2]/2,cy=it.n[9]+b[1]+b[3]/2;if(d.hit(cx,cy)!==it)continue;const X=r.left+v.ox+cx*v.s,Y=r.top+v.oy+cy*v.s;
  if(X>r.left+20&&X<r.right-20&&Y>r.top+20&&Y<r.bottom-20)return {uid:it.uid,x:X,y:Y,px:it.n[8],py:it.n[9]};}return null})()"""
POS = "(uid=>{const it=ESApp._debug().doc.items.find(i=>i.uid===uid);return [it.n[8],it.n[9]]})"
async def ex(pg, name):
    await pg.select_option('#examples', label=name); await pg.wait_for_timeout(500)
    await pg.click('[data-cmd=fit]'); await pg.wait_for_timeout(200)
async def main():
    errs = []; res = []
    ok = lambda c, m: (res.append((bool(c), m)), print('ok  ' if c else 'FAIL', m))
    async with async_playwright() as p:
        b = await launch(p)
        # ---- počítač
        pg = await b.new_page(viewport={'width': 1300, 'height': 800}); pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(400); await ex(pg, 'Reverzace motoru')
        ok(await pg.evaluate("!document.querySelector('#bar [data-cmd=undo]')"), 'Zpět/Znovu už nejsou v horní liště')
        ok(await pg.is_visible('#cvHist') and await pg.is_visible('#cvZoom'), 'Zpět/Znovu a zoom jsou na plátně')
        ok(await pg.is_hidden('#cvCtx'), 'Otočit/Smazat/Hotovo se bez výběru neukazují')
        box = await pg.evaluate("(()=>{const r=document.querySelector('#cv').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
        # tažení prázdné plochy = posun výkresu
        before = await pg.evaluate("[window.__v&&0]")  # view není exportován, měříme polohu prvku přes snímek
        s0 = await pg.screenshot(clip={'x':box[0],'y':box[1],'width':box[2],'height':box[3]})
        await pg.mouse.move(box[0]+box[2]-60, box[1]+70); await pg.mouse.down(); await pg.mouse.move(box[0]+box[2]-120, box[1]+110, steps=6); await pg.mouse.up(); await pg.wait_for_timeout(150)
        s1 = await pg.screenshot(clip={'x':box[0],'y':box[1],'width':box[2],'height':box[3]})
        ok(s0 != s1, 'tažení prázdné plochy posunulo výkres')
        ok(await pg.is_hidden('#cvCtx'), 'po tažení prázdné plochy se nic nevybralo')
        await pg.click('[data-cmd=fit]'); await pg.wait_for_timeout(150)
        # výběr oblasti tlačítkem
        await pg.click('#cvBand'); ok(await pg.is_visible('#cvDone'), 'v režimu Oblast je vidět Hotovo')
        await pg.mouse.move(box[0]+4, box[1]+4); await pg.mouse.down(); await pg.mouse.move(box[0]+box[2]-4, box[1]+box[3]-4, steps=8); await pg.mouse.up(); await pg.wait_for_timeout(150)
        ok(await pg.is_visible('#cvDel') and await pg.is_visible('#cvRot'), 'po výběru oblasti je vidět Otočit a Smazat')
        ok(await pg.is_hidden('#cvDone'), 'po výběru oblasti se vrátil nástroj Výběr')
        await pg.keyboard.press('Escape')
        # Shift + tažení
        await pg.keyboard.down('Shift'); await pg.mouse.move(box[0]+4, box[1]+4); await pg.mouse.down(); await pg.mouse.move(box[0]+box[2]-4, box[1]+box[3]-4, steps=6); await pg.mouse.up(); await pg.keyboard.up('Shift'); await pg.wait_for_timeout(100)
        ok(await pg.is_visible('#cvDel'), 'Shift + tažení vybírá oblast')
        # vodič: Hotovo viditelné, Esc/Hotovo končí
        await pg.keyboard.press('w'); ok(await pg.is_visible('#cvDone'), 'nástroj vodič ukazuje Hotovo')
        await pg.click('#cvDone'); ok(await pg.is_hidden('#cvDone'), 'Hotovo vrací nástroj Výběr')
        # záložka Realita nemění pohled schématu
        await pg.click('.tab[data-tab=schema]')
        s2 = await pg.screenshot(clip={'x':box[0],'y':box[1],'width':box[2],'height':box[3]})
        await pg.click('.tab[data-tab=real]'); await pg.wait_for_timeout(200); await pg.click('.tab[data-tab=schema]'); await pg.wait_for_timeout(200)
        s3 = await pg.screenshot(clip={'x':box[0],'y':box[1],'width':box[2],'height':box[3]})
        ok(s2 == s3, 'přepnutí záložek nezměnilo pohled')
        await pg.keyboard.press('Escape'); await pg.mouse.click(box[0]+box[2]-30, box[1]+box[3]-30)
        pk = await pg.evaluate(PICK); ok(pk, 'v příkladu je přístroj k zkoušce')
        await pg.mouse.click(pk['x'], pk['y']); await pg.wait_for_timeout(100)
        ok(await pg.evaluate(POS+"(%d)" % pk['uid']) == [pk['px'], pk['py']], 'myš: klik na přístroj ho nepohnul')
        ok(await pg.is_visible('#cvProps') and await pg.is_visible('#cvRot'), 'myš: vybraný přístroj ukazuje Vlastnosti a Otočit')
        await pg.mouse.move(pk['x'], pk['y']); await pg.mouse.down(); await pg.mouse.move(pk['x']+40, pk['y'], steps=6); await pg.mouse.up(); await pg.wait_for_timeout(100)
        ok(await pg.evaluate(POS+"(%d)" % pk['uid']) != [pk['px'], pk['py']], 'myš: tažení přístroj posunulo')
        await pg.click('#cvHist [data-cmd=undo]'); await pg.wait_for_timeout(100)
        ok(await pg.evaluate(POS+"(%d)" % pk['uid']) == [pk['px'], pk['py']], 'Zpět na plátně vrátilo posun')
        await pg.mouse.click(pk['x'], pk['y']); await pg.click('#cvProps'); await pg.wait_for_timeout(150); ok(await pg.evaluate("document.querySelector('#dlg').open"), 'Vlastnosti otevřely dialog'); await pg.keyboard.press('Escape')
        await pg.keyboard.press('Escape')
        await pg.screenshot(path='tools/e2e/desktop.png')
        await pg.close()
        # ---- mobil (dotyk)
        ctx = await b.new_context(viewport={'width': 390, 'height': 780}, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(400); await pg.click('#menubtn'); await ex(pg, 'Reverzace motoru')
        cdp = await ctx.new_cdp_session(pg)
        async def touch(kind, pts): await cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})
        box = await pg.evaluate("(()=>{const r=document.querySelector('#cv').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
        ok(await pg.is_hidden('#examples'), 'soubory jsou v nabídce (☰)')
        await pg.click('#menubtn'); ok(await pg.is_visible('#examples'), '☰ otevře nabídku souborů'); await pg.click('#menubtn')
        # klepnutí na prázdno / na prvek
        async def snap(): return await pg.screenshot(clip={'x':box[0],'y':box[1],'width':box[2],'height':box[3]})
        s0 = await snap()
        await touch('touchStart', [(200, 300)]); 
        for i in range(1, 7): await touch('touchMove', [(200 - 8*i, 300 + 6*i)]); await pg.wait_for_timeout(16)
        await touch('touchEnd', []); await pg.wait_for_timeout(150)
        s1 = await snap(); ok(s0 != s1, 'jeden prst na prázdné ploše posouvá výkres')
        # dva prsty: zoom
        await pg.evaluate('ESApp._debug().sel.clear()'); await pg.click('[data-cmd=fit]'); await pg.wait_for_timeout(150); s0 = await snap()
        a = [(150, 300), (250, 300)]; await touch('touchStart', a)
        for i in range(1, 9): await touch('touchMove', [(150 - 6*i, 300), (250 + 6*i, 300)]); await pg.wait_for_timeout(16)
        await touch('touchEnd', []); await pg.wait_for_timeout(150)
        s1 = await snap(); ok(s0 != s1, 'dva prsty přiblížily výkres')
        ok(await pg.is_hidden('#cvCtx'), 'gesto dvěma prsty nic nevybralo')
        pk = await pg.evaluate(PICK); ok(pk, 'mobil: v příkladu je přístroj k zkoušce')
        if pk:
            await touch('touchStart', [(pk['x'], pk['y'])]); await touch('touchEnd', []); await pg.wait_for_timeout(120)
            ok(await pg.evaluate(POS+"(%d)" % pk['uid']) == [pk['px'], pk['py']], 'mobil: klepnutí na přístroj ho nepohnulo')
            ok(await pg.is_visible('#cvProps'), 'mobil: klepnutí vybralo přístroj (Vlastnosti)')
            await touch('touchStart', [(pk['x'], pk['y'])])
            for i in range(1, 8): await touch('touchMove', [(pk['x'] + 6*i, pk['y'])]); await pg.wait_for_timeout(16)
            await touch('touchEnd', []); await pg.wait_for_timeout(120)
            ok(await pg.evaluate(POS+"(%d)" % pk['uid']) != [pk['px'], pk['py']], 'mobil: tažení přístroj posunulo')
        await pg.screenshot(path='tools/e2e/mobil.png')
        await ctx.close(); await b.close()
    bad = [m for c, m in res if not c]
    print('\nchyb JS:', errs[:3], '| neprošlo:', len(bad), 'z', len(res)); sys.exit(1 if bad or errs else 0)
asyncio.run(main())
