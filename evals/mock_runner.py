from pathlib import Path
import sys
sys.stdin.read()
files={
 'src/health.mjs':'export function health() { return { ok: true }; }\n',
 'src/access.mjs':"export function canRead(user, record) { return Boolean(typeof user?.id === 'string' && user.id.length && typeof record?.ownerId === 'string' && user.id === record.ownerId); }\n",
 'src/service.mjs':"import { lineTotal } from './money.mjs';\nexport function invoiceTotal(items) { return items.reduce((sum, item) => { const next = sum + lineTotal(item.price, item.quantity); if (!Number.isSafeInteger(next)) throw new RangeError('Overflow'); return next; },0); }\n",
}
for file,content in files.items():
 p=Path(file)
 if p.exists(): p.write_text(content,encoding='utf-8'); break
else: sys.exit(1)
