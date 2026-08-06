# MotoTrack public-site deployment governance

Release model (target):

```
feature PR → automated checks → merge to main → explicit staging/production promotion decision
```

NOT `merge to main → automatic public production deployment`.

## Rules

1. **`main` is the integration branch.** Merging to `main` builds and validates; it does not
   promote anything to the public `mototrack` Worker.
2. **Production promotion is an explicit operator action** pinned to a reviewed commit:
   check out the exact SHA, apply migrations/bindings/secrets in runbook order, run the
   deployment, and record BOTH the Git commit SHA and the resulting Cloudflare Worker
   version ID so it is always traceable which code is serving.
3. **Staging is deployed deliberately** with `npx wrangler deploy --env staging` to the
   isolated staging Worker. PR builds are never redirected there automatically.
4. **Rollback preserves data.** Moving traffic back to a previously known-good Worker
   version must never delete, recreate, or reverse the production D1 database.

This file is documentation only: it changes no product behavior, no route, no binding,
and no configuration. It exists so the governance model is recorded in the repository
alongside the code it governs.
