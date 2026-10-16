# CAD tree and edit compiler

Onshape owns geometric evaluation. This Haskell process owns the imported feature
tree and compiles small instructions into revision-bound updates. It has no model,
credentials, network calls, or geometry guesses.

```
Pi: set_parameter(elementId, featureId, parameterId, expression)
  → gateway fetches full current feature JSON
  → Haskell imports ordered history and nested ownership
  → Haskell checks the observed revision and patches one existing expression
  → gateway submits the preserved feature with rejectMicroversionSkew
  → gateway reads back the expression and checks rebuild states
```

The desktop agent discovers tabs within the user-selected document and keys each
observation by element ID. After a write it discards observations of other tabs.
Each kernel invocation still receives one complete Part Studio tree; document
discovery does not flatten trees or infer dependencies between Part Studios.

The tree retains source JSON, including sketch constraints, query structures,
subfeatures, custom namespaces, and fields we do not understand. The model sees
only a projection. A projection is never used to reconstruct the original feature.
History order is not a dependency graph; opaque geometry queries are not inferred
references. Subfeatures are visible but cannot be edited independently yet.

The complete public OpenAPI snapshot imports **302 operations and 1,249 schemas**.
`Zither.Operations` indexes every operation; `Zither.Catalog` retrieves an operation
and the reachable request/response schemas, handling recursive references. The
catalog does not grant the model arbitrary HTTP execution. Only existing expression
edits are currently exposed. The compiler can group up to 64 expression changes to
one feature into one update; the current model tool sends one at a time.

## Build

Install GHC 9.6.7 and Cabal 3.12 (CI uses these versions), then:

```sh
cd kernel
cabal update
cabal build all
cabal test all
cabal list-bin exe:zither-kernel
```

Set server `ZITHER_KERNEL_PATH` to that absolute executable path. CAD reads and
edits require it. Sign-in and the desktop shell can run without it. Keep the Cabal
build/data directory available for the catalog command. Use `cabal run exe:zither-kernel`
for that command during development, or set `zither_kernel_datadir` to the absolute
`kernel` source directory when launching the binary directly. `cabal install` installs
the declared schema data file when distributing the executable. Packaging is still
release work. No Haskell runtime or schema is passed to the renderer.

Each invocation accepts one JSON request on stdin and returns one JSON value on
stdout. Requests use `version: 1` and `action: inspect | compile | catalog`.
The server limits input/output to 16 MiB and execution to 10 seconds, supports
cancellation, and starts the executable directly without a shell. No persistent
worker or cache is needed yet; profile on real models before adding either.

```json
{"version":1,"action":"catalog","operationId":"getAssemblyDefinition"}
```

`inspect` takes `tree`, the complete feature-list API response. `compile` takes
the same `tree`, `expectedMicroversion`, `featureId`, and `edits`, an array of
`{parameterId, expression}`. Compilation is pure and performs no HTTP request.
The gateway alone dispatches the supported `updatePartStudioFeature` operation.

## Quality bar

Tests exercise import/export preservation, nested ownership, sketch/query/custom
data retention, batches, no-ops, stale snapshots, duplicate IDs/edits, incomplete
trees, rollback state, and unsupported targets. The Linux CI job builds the real
executable, then runs the TypeScript tests against it with mocked Onshape HTTP.
Tests without `ZITHER_KERNEL_PATH` explicitly skip those integration cases.

Fixtures are synthetic examples of the documented API structures. Live editing
quality, geometry selection, units/FeatureScript evaluation, many-feature fillets,
and assembly mating are not established by these tests. Next additions need
document-specific feature specs, revision-bound geometry observations, concrete
sparse instructions, and disposable real-design checks.

Sources: [feature API](https://onshape-public.github.io/docs/api-adv/featureaccess/),
[API model and versioning](https://onshape-public.github.io/docs/api-intro/),
[pinned catalog provenance](schema/source.json).
