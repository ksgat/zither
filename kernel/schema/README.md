# Onshape API snapshot

Downloaded from the public [Onshape OpenAPI endpoint](https://cad.onshape.com/api/openapi).
The document declares Apache 2.0 licensing; see LICENSE. `source.json` records the
source URL, upstream version, SHA-256, server version, and coverage counts.
The upstream JSON is unmodified. `Zither.Operations` is generated from every operation.

Refresh with `node scripts/import-onshape.mjs` from the repository root, then review
the schema and generated code together. Builds never fetch a moving schema.
`node scripts/import-onshape.mjs kernel/schema/onshape-openapi.json` regenerates offline.

Catalog coverage means documentation is imported, not that every operation is a
tested model tool. The model only receives the small supported editing vocabulary.
CAD feature types, custom FeatureScript, and API endpoints are different things;
feature specifications and geometry still need document-specific reads.
