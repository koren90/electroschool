"""Kouřový test: simulace a záložka Realita myší i dotykem, bez chyb v JS. Spuštění: python tools/e2e/smoke.py"""
import asyncio, sys
sys.stdout.reconfigure(encoding='utf-8')
from playwright.async_api import async_playwright
URL = 'http://localhost:8766/index.html'
async def launch(p):
    try: return await p.chromium.launch(channel='chrome')
    except Exception: return await p.chromium.launch()
async def main():
    errs = []
    async with async_playwright() as p:
        b = await launch(p)
        for name, kw in [('počítač', dict(viewport={'width': 1300, 'height': 800})), ('mobil', dict(viewport={'width': 390, 'height': 780}, has_touch=True, is_mobile=True))]:
            ctx = await b.new_context(**kw); pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(URL); await pg.wait_for_timeout(400)
            if name == 'mobil': await pg.click('#menubtn')
            await pg.select_option('#examples', label='Reverzace motoru'); await pg.wait_for_timeout(500)
            await pg.click('[data-cmd=fit]'); await pg.wait_for_timeout(200)
            box = await pg.evaluate("(()=>{const r=document.querySelector('#cv').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
            tap = (lambda x, y: pg.touchscreen.tap(x, y)) if name == 'mobil' else (lambda x, y: pg.mouse.click(x, y))
            await pg.click('#simbtn'); await pg.wait_for_timeout(300)
            t0 = await pg.inner_text('#pos')
            for fx in (0.25, 0.4, 0.55, 0.7):
                for fy in (0.3, 0.5, 0.7): await tap(box[0] + box[2]*fx, box[1] + box[3]*fy); await pg.wait_for_timeout(40)
            await pg.wait_for_timeout(300)
            print(name, 'simulace běží:', t0 != await pg.inner_text('#pos'))
            await pg.click('#simbtn'); await pg.wait_for_timeout(200)
            await pg.click('.tab[data-tab=real]'); await pg.wait_for_timeout(300)
            for fx in (0.3, 0.6): await tap(box[0] + box[2]*fx, box[1] + box[3]*0.5); await pg.wait_for_timeout(60)
            await pg.click('.tab[data-tab=calc]'); await pg.wait_for_timeout(200); await pg.click('.tab[data-tab=schema]'); await pg.wait_for_timeout(200)
            print(name, 'záložky Realita/Kalkulačky/Schéma bez pádu')
            await ctx.close()
        await b.close()
    print('chyb JS:', errs[:3]); sys.exit(1 if errs else 0)
asyncio.run(main())
