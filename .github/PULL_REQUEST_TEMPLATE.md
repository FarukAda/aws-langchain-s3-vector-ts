## What

## Why

## How

## Testing

## Breaking changes

None.

## Checklist

- [ ] `npm run lint`, `npm run typecheck`, `npm run typecheck:test`, `npm run typecheck:types` and `npm test` pass at 100 % coverage
- [ ] `npm run build` and `npm run pack:check` pass if `package.json` or the build configuration changed
- [ ] tests were written first and cover the change (unit; the live-AWS suite for anything that depends on the real service)
- [ ] CHANGELOG `[Unreleased]` entry for anything a user can observe
- [ ] README updated where documented behaviour changed; `npm run docs` regenerated if public JSDoc changed
- [ ] the change respects [docs/STABILITY.md](../docs/STABILITY.md)
