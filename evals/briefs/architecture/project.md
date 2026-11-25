---
title: Billing architecture
---
All currency uses integer minor units. Reuse the existing lineTotal helper from money.mjs rather than duplicating validation or multiplication. Reject unsafe accumulated totals. Keep money.mjs unchanged and preserve invoiceTotal's named export. No new dependencies.
