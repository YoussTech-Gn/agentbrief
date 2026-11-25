---
title: Authorization invariants
---
Fail closed for missing or malformed identity and owner ID. Identifiers must be nonempty strings, compared strictly. Only the owner can read a private record; roles, including admin, do not bypass this policy. No new dependency. Do not modify generated instructions.
