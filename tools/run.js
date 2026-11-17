// Spouští testy z tools/ v Node (náhrada za jsc, který je jen na macOS).
// Použití: node tools/run.js <soubory.js oddělené čárkou> [-- argumenty testu]
// Příklad: node tools/run.js app/core.js,tools/elektro_test.js -- Priklady
const fs = require('fs'), vm = require('vm'), path = require('path');
const argv = process.argv.slice(2), sep = argv.indexOf('--');
const files = argv[0].split(','), args = sep < 0 ? [] : argv.slice(sep + 1);
const ctx = {
  print: s => console.log(s),
  readFile: (p, enc) => enc === 'binary' ? fs.readFileSync(p) : fs.readFileSync(p, 'utf8'),
  arguments: args, console, setTimeout, clearTimeout, Math, JSON, Date, Uint8Array,
};
ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx);
let code = 0;
for (const f of files) {
  try { vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f }); }
  catch (e) { console.log('CHYBA ' + f + ': ' + e.message); code = 1; }
}
process.exit(code);
