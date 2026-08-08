# Phase 2 — Native MCP server (rmcp over bay-core)

[← Phase 1](phase-1.md) · [Plan](plan.md) · [Tasks](task.md) · [Phase 3 →](phase-3.md)

**Estimated duration:** 4-6 weeks · **Tasks:** 6

## Goal
Expose bay-core to agents/tools as a thin rmcp transport shell with ZERO domain logic of its own: the same Command/Query enum that drives undo/redo and autosave becomes the MCP tool surface, and projects/timeline/media become MCP resources. A single-writer core actor serializes all mutations so the future GPUI shell and the MCP server can share one SQLite store without SQLITE_BUSY or lost updates.

## ✅ Exit gate (must all pass to advance)
- [ ] An MCP client can list/open/create/delete projects, mutate the timeline through undoable commands, and read project/timeline/media resources
- [ ] All MCP mutations persist through Phase 1 persistence with single-writer serialization (no SQLITE_BUSY, no lost updates)
- [ ] Every tool schema round-trips a valid payload and rejects a malformed one; import/quota guards active
- [ ] rmcp fully isolated behind handlers (a version bump does not ripple into bay-core)

## Test strategy for this phase
Integration tests drive the server over stdio against a temp SQLite store, asserting persistence + undo + resource JSON parity with the persistence layer. A concurrent-writer test proves the single-writer actor. Tool-schema unit tests guard against drift by deriving schemas from the model. This phase adds no golden-frame surface.

## Deliverables
- bay-mcp crate (thin rmcp shell) with a single-writer CoreHandle
- Tool surface generated from the domain-model Command/Query enum with JsonSchema-derived contracts
- Project/timeline/media resource providers and structured error mapping
- Coalesced MCP change-notifications wired to the EventBus

## Workstreams & tasks

### Workstream: MCP server

#### `P2-MCP-01` — Core actor / single-writer command-queue front
Wrap the owned Editor + persistence in a CoreHandle (mpsc/actor) that is the SINGLE writer, designed from day one so the Phase 3 shell and the MCP server both go through it; serializes execute(Command)/query(Query) against one WAL SQLite connection.

> **Test gate:** Integration: concurrent mutations from two clients are serialized by the actor with no lost update and no SQLITE_BUSY.

#### `P2-MCP-02` — rmcp server shell + transport
Stand up rmcp (pinned version, MCP 2026-07-28) with #[tool_router], stdio transport for a local desktop connector plus optional streamable-HTTP; isolate rmcp behind handlers so SDK churn never touches bay-core.

> **Test gate:** Integration: an MCP client completes initialize/list-tools over stdio and HTTP; server carries no domain logic (handlers only call CoreHandle).

#### `P2-MCP-03` — Tool surface (Command/Query -> tools)
Map each Command/Query variant to a tool with input/output types deriving Serialize/Deserialize/JsonSchema FROM the domain model (no hand-written schemas -> no drift): list/open/create/delete projects, read metadata/timeline, add/move/trim/split/delete elements, set background, upsert keyframes, apply motion preset, import/export.

> **Test gate:** Integration: set_background persists (undoable) and reloads reflecting it; unit: each tool schema deserializes a representative payload and rejects a malformed one.

#### `P2-MCP-04` — Resource providers
Expose bay://project/{id} (SerializedProject JSON from P1-PER-01), bay://project/{id}/timeline (scenes/tracks view), and bay://project/{id}/media/{mediaId} as MCP resources.

> **Test gate:** Golden: reading bay://project/{id} returns JSON equal to what persistence would write for that project.

#### `P2-MCP-05` — Import/quota guards + error mapping
Route media-import tools through the blob-store traversal guard + quota gate (P1-PER-05/03); map core/persistence/quota errors to structured JSON-RPC McpError responses.

> **Test gate:** Unit: import with a traversal path or oversized file is rejected with a structured McpError; quota-exceeded surfaces cleanly.

#### `P2-MCP-06` — Change-notifications
Bridge the coalesced EventBus to MCP change-notifications (one per committed command, not per notify), and decide batching so many agent tool-calls don't flood shell undo history.

> **Test gate:** Integration: a batch of edits emits exactly one coalesced MCP notification with monotonic versions.

---
[← Phase 1](phase-1.md) · [Plan](plan.md) · [Tasks](task.md) · [Phase 3 →](phase-3.md)
