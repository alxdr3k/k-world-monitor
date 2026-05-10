# Generated Docs

Generated docs are derived from code, schema, migrations, configs, or specs.

**Do not edit generated docs by hand.** If a generated doc is wrong, fix
the generator (or the underlying source); do not patch the output.

## Active generators

Fill this table once your project commits a generator. One row per output.
Keep it concise — the generator script and source paths are the canonical
references.

| Output | Command | Source | When to regenerate |
|--------|---------|--------|--------------------|
| _e.g._ `schema.md` | `bun run docs:generate:schema` | `migrations/*.sql` | Any migration change |

If this table is empty, no generators are committed in this project yet —
that is fine. Add rows as you wire generators in.

## Potential generated docs

Common candidates worth generating once the project has the matching source:

- DB schema reference (from migrations / ORM schema file)
- API / route reference (from routes config or framework introspection)
- Provider / adapter capabilities (from typed adapter modules)
- Enum / reference docs (from migration constraints or type definitions)
- Module graph (from compiler output or import walker)
- Eval report summaries (from eval harness output)

When you add a generator, add a row to "Active generators" above and
update `docs/DOCUMENTATION.md` "What to update when" with the rule for
keeping the output fresh.
