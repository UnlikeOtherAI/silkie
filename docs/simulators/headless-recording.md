# Headless Multi-Recording

> Batch-execute recording scripts via MCP tools. Each job wraps the server-side
> recording pipeline with job queuing, concurrency limits, and async polling.

## Overview

The headless recording system enables LLMs and automation tools to batch-execute
recording scripts without an interactive browser session. Each recording job:

1. Validates the script and queues the job.
2. Calls `POST /script/{udid}/run` with `record: true` (the server-side Final
   Record pipeline defined in [scripting.md](scripting.md#final-record)).
3. Monitors SSE progress events from the run.
4. On completion, returns the output file path.

No browser or WebKit instance is involved. The server captures video via
`simctl io recordVideo` (iOS) or `adb screenrecord` (Android), executes the
script steps via idb/adb, and composites overlay indicators using ffmpeg. This
is the same pipeline used by interactive Final Record — headless recording adds
job management on top.

Multiple jobs run concurrently, limited by configurable max concurrency.

---

## MCP Tools

All tools use the `selkie_` prefix (matching the selkie MCP namespace).

### `selkie_headless_record`

Start a new headless recording job.

**Input:**

```typescript
{
  // Required
  script: Script;               // Full script object (see scripting.md data model)
  udid: string;                 // Target simulator UDID
  output_path: string;          // Absolute path for the output video file

  // Optional
  create_directories?: boolean; // Create missing parent dirs (default: true)
  playback_speed?: number;      // 0.5, 1, 2 — default: 1
  overlay?: boolean;            // Composite tap/swipe overlays (default: true)
  timeout_seconds?: number;     // Max job duration before abort (default: 300)
  viewport?: {                  // Output video resolution
    width: number;              // Pixels, e.g. 390 — default: simulator logical width
    height: number;             // Pixels, e.g. 844 — default: simulator logical height
  };
}
```

**Output:**

```typescript
{
  job_id: string;               // UUID — use to poll status
  run_id: string;               // Script execution run_id (from POST /script/{udid}/run)
  status: "queued";
  message: "Recording job queued";
}
```

**Errors:**

| Code | Condition |
|------|-----------|
| `invalid_script` | Script JSON fails validation |
| `simulator_not_found` | UDID does not match a booted simulator |
| `simulator_busy` | Simulator is already running a script or recording |
| `platform_mismatch` | Script `platform` does not match target simulator platform |
| `path_not_writable` | Output path parent exists but is not writable |
| `max_concurrency` | All recording slots are in use — retry later |
| `job_not_found` | Referenced job_id does not exist or has been purged |

### `selkie_headless_status`

Poll the status of a recording job.

**Input:**

```typescript
{
  job_id: string;
}
```

**Output:**

```typescript
{
  job_id: string;
  run_id?: string;              // Present once the run has started
  status: "queued" | "running" | "completed" | "failed" | "aborted";
  progress?: {
    current_step: number;       // 0-indexed
    total_steps: number;
    elapsed_ms: number;
  };
  result?: {                    // Present when status is "completed"
    output_path: string;        // Confirmed path of the written file
    file_size_bytes: number;
    duration_ms: number;        // Video duration
    steps_executed: number;
    steps_skipped: number;      // Disabled steps
  };
  error?: {                     // Present when status is "failed"
    step_index?: number;        // Step that failed (if applicable)
    message: string;
  };
}
```

**Errors:** returns `job_not_found` if the `job_id` does not exist or has been
purged after `job_history_retention`.

### `selkie_headless_abort`

Cancel a running or queued recording job.

**Input:**

```typescript
{
  job_id: string;
}
```

**Output:**

```typescript
{
  job_id: string;
  status: "aborted";
  message: "Job aborted";
}
```

Aborting a running job internally calls
`DELETE /script/{udid}/run?run_id={run_id}` to stop the server-side executor.
The temp video file is deleted — no partial output is retained. This matches
the failure behavior: any non-success termination (abort, failure, timeout)
deletes the temp file.

### `selkie_headless_list`

List all active and recent recording jobs.

**Input:**

```typescript
{
  status_filter?: "queued" | "running" | "completed" | "failed" | "aborted";
  limit?: number;               // Default: 20
}
```

**Output:**

```typescript
{
  jobs: Array<{
    job_id: string;
    run_id?: string;
    status: string;
    udid: string;
    script_name: string;
    output_path: string;
    created_at: string;         // ISO 8601
    completed_at?: string;
    error_message?: string;     // Summary for failed jobs (avoids polling each)
  }>;
}
```

---

## Architecture

### Server-Side Pipeline

Headless recording is a job management layer around the existing server-side
recording pipeline. No browser, WebView, or client-side rendering is involved.

```
┌──────────────────┐     ┌───────────────┐     ┌──────────────┐
│  Job Manager     │     │  Script       │     │  Simulator   │
│  (Go service)    │────►│  Executor     │────►│  (idb/adb)   │
│                  │     │               │     └──────────────┘
│  • queue FIFO    │     │  POST /script/│
│  • concurrency   │     │  {udid}/run   │     ┌──────────────┐
│  • timeout       │     │  record: true │────►│  simctl io   │
│  • status track  │     │               │     │  recordVideo │
│                  │◄────│  SSE events   │     │  / adb       │
│                  │     └───────────────┘     │  screenrecord│
│  output_path     │                           └──────┬───────┘
│  ← rename .tmp   │◄─────────────────────────────────┘
└──────────────────┘     ffmpeg composite (if overlay: true)
```

**Flow:**

1. MCP tool call → Job Manager validates script (via `libscriptcore`
   `sc_script_parse`), checks platform match, creates job in `queued` state.
2. When a concurrency slot opens, Job Manager calls
   `POST /script/{udid}/run` with `{ script, record: true, playback_speed }`.
3. Job Manager subscribes to `GET /script/{udid}/events?run_id={run_id}` and
   updates job progress from SSE events.
4. On `script.complete`, the server returns `output_path`. Job Manager renames
   the file from `{output_path}.tmp` to `{output_path}`.
5. If `overlay: true`, the server composites tap/swipe indicators onto the raw
   capture using ffmpeg before returning the output path.
6. If `viewport` is specified and differs from the raw capture resolution, the
   server scales the output using ffmpeg (`-vf scale=W:H`).

### Output File Handling

**Directory creation:** when `create_directories` is `true` (the default), the
server calls `mkdir -p` on the parent directory of `output_path` before
starting the job. If the directory cannot be created (permissions, disk full),
the job fails immediately with `path_not_writable`.

**Atomic writes:** the output file is written to `{output_path}.tmp` during
recording, then renamed on completion. On any non-success termination (abort,
failure, timeout), the temp file is deleted. No partial files are ever left at
the final path.

**Overwrite behavior:** if a file already exists at `output_path`, the job
overwrites it. The MCP tool does not check for existing files — the caller is
responsible for path uniqueness.

**File access:** the output file is on the server's local filesystem. The
caller accesses it directly if co-located, or via a separate file transfer
mechanism (SCP, shared mount, etc.). File download via MCP is out of scope
for v1.

### Concurrency

```yaml
headless_recording:
  max_concurrent_jobs: 4          # Total across all simulators
  max_per_simulator: 1            # One recording per simulator at a time
  job_history_retention: "24h"    # Keep completed/failed job records
  default_timeout_seconds: 300
  queue_timeout_seconds: 120      # Max time a job can wait in queue
```

Jobs exceeding `max_concurrent_jobs` are queued (FIFO). Queued jobs start
automatically when a slot opens. Jobs waiting in queue for longer than
`queue_timeout_seconds` (default: 120) are failed with `max_concurrency`.

Only one recording job can target a given simulator at a time
(`max_per_simulator: 1`). A second job targeting the same UDID is queued until
the first completes.

---

## Job Lifecycle

```
                    ┌─────────┐
     submit ──────► │ queued  │
                    └────┬────┘
                         │ slot available
                    ┌────▼────┐
                    │ running │
                    └────┬────┘
                    ┌────┼────────────┐
               ┌────▼──┐  ┌────▼───┐  ┌───▼────┐
               │complete│  │ failed │  │aborted │
               └────────┘  └────────┘  └────────┘
```

**State transitions:**

| From | To | Trigger |
|------|----|---------|
| — | `queued` | `selkie_headless_record` called |
| `queued` | `running` | Concurrency slot available, `POST /script/{udid}/run` called |
| `queued` | `aborted` | `selkie_headless_abort` called |
| `queued` | `failed` | Queue timeout exceeded |
| `running` | `completed` | `script.complete` SSE event received, file renamed |
| `running` | `failed` | `script.error` SSE event, timeout, simulator crash, write error |
| `running` | `aborted` | `selkie_headless_abort` called |

**Race condition resolution:** if a timeout fires and an abort arrives
simultaneously, whichever transition fires first wins atomically (CAS on job
state). The second transition is a no-op.

Failed and completed jobs retain their status records for `job_history_retention`
(default 24h), then are purged. The output file is not deleted on purge.

---

## Viewport / Resolution

The `viewport` parameter controls the output video resolution. If omitted, the
output matches the simulator's native resolution from the capture pipeline.

When `viewport` is specified:
- The server captures at native resolution, then scales using ffmpeg
  (`-vf scale={width}:{height}:flags=lanczos`) as a post-processing step.
- Aspect ratio mismatches result in letterboxing (black bars).
- The `coordinate_mapper` in `libscriptcore` handles the mapping for overlay
  positioning.

| Viewport | Use case |
|----------|----------|
| (omitted) | Native simulator resolution |
| `390 x 844` | iPhone 15 logical (1x) |
| `1170 x 2532` | iPhone 15 full res (3x) |
| `1080 x 2400` | Android full HD |

---

## HTTP API (Internal)

These endpoints are used internally by the MCP tool layer. They are not exposed
through selkie's zero-trust proxy — only the MCP tools are the external
interface.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/headless/jobs` | Create a recording job |
| `GET` | `/headless/jobs` | List jobs (query: `?status=running&limit=20`) |
| `GET` | `/headless/jobs/{job_id}` | Get job status |
| `DELETE` | `/headless/jobs/{job_id}` | Abort a job |

Request body for `POST /headless/jobs`:

```typescript
{
  script: Script;
  udid: string;
  output_path: string;
  create_directories: boolean;
  playback_speed: number;
  overlay: boolean;
  timeout_seconds: number;
  viewport?: { width: number; height: number };
}
```

Response matches `selkie_headless_status` output format.

---

## Error Handling

### Step execution failure

If a step fails during headless recording (idb/adb error, timeout), the server
emits `script.error` via SSE. The Job Manager transitions the job to `failed`.
The error includes the step index and message. The temp video file is deleted.

### Simulator disconnection

If the simulator crashes or reboots during recording, the executor emits
`script.error`. The Job Manager transitions to `failed` with:

```json
{
  "error": {
    "step_index": 5,
    "message": "Simulator disconnected at step 5"
  }
}
```

### Timeout

Jobs exceeding `timeout_seconds` are aborted by the Job Manager, which calls
`DELETE /script/{udid}/run?run_id={run_id}` to stop the executor. The status
becomes `failed` with message `"Job timed out after {N} seconds"`. The temp
file is deleted.

### Disk space

Before starting the recording, the system checks that the output directory has
at least 500MB of free space. If not, the job fails immediately with
`"Insufficient disk space"`. This is a floor safety net — if the disk fills
during a long recording, the capture pipeline will fail with a write error and
the job transitions to `failed`.

---

## Integration with libscriptcore

The Job Manager uses `libscriptcore` (via cgo, linked as `libscriptcore.a`) for:

- **`script_parser`**: validates the incoming script JSON and checks platform
  compatibility with the target simulator.
- **`step_scheduler`**: not used directly by the Job Manager — the server-side
  executor uses it internally.
- **`coordinate_mapper`**: used by the ffmpeg overlay compositing step to
  position indicators at the correct coordinates for the output resolution.

The Job Manager does not load WASM — it links the C++ library statically via
cgo, same as the rest of the Go server agent.

---

## MCP Usage Examples

### Record a script to a specific path

```json
{
  "tool": "selkie_headless_record",
  "input": {
    "script": { "version": 1, "name": "Login flow", "...": "..." },
    "udid": "ABCD-1234-EFGH-5678",
    "output_path": "/recordings/2026-04-06/login-flow.mp4",
    "create_directories": true
  }
}
```

Response:
```json
{
  "job_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "run_id": "e23d9a01-7c4f-4821-b3e1-1a2b3c4d5e6f",
  "status": "queued",
  "message": "Recording job queued"
}
```

### Poll until done

```json
{
  "tool": "selkie_headless_status",
  "input": {
    "job_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
  }
}
```

Response (in progress):
```json
{
  "job_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "run_id": "e23d9a01-7c4f-4821-b3e1-1a2b3c4d5e6f",
  "status": "running",
  "progress": {
    "current_step": 5,
    "total_steps": 12,
    "elapsed_ms": 7200
  }
}
```

Response (completed):
```json
{
  "job_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "completed",
  "result": {
    "output_path": "/recordings/2026-04-06/login-flow.mp4",
    "file_size_bytes": 4823040,
    "duration_ms": 14200,
    "steps_executed": 11,
    "steps_skipped": 1
  }
}
```

### Batch record multiple scripts

An LLM can fire multiple `selkie_headless_record` calls in parallel, each
targeting a different simulator (or the same simulator sequentially via the
queue). Each returns its own `job_id` for independent polling.

```
selkie_headless_record(script_a, udid_1, ...) → job_1
selkie_headless_record(script_b, udid_2, ...) → job_2
selkie_headless_record(script_c, udid_1, ...) → job_3  (queued behind job_1)

selkie_headless_status(job_1) → running
selkie_headless_status(job_2) → running
selkie_headless_status(job_3) → queued
```

---

## Out of Scope for v1

- **Live preview via MCP** — headless jobs produce a file, not a live stream.
  Watching progress requires polling `selkie_headless_status`.
- **Job priority** — queue is FIFO only, no priority levels.
- **Distributed recording** — all jobs run on the local machine. Multi-machine
  orchestration is a v2 concern.
- **Audio capture** — video only. Simulator audio is not captured.
- **Webhook notifications** — completion is poll-based via MCP. SSE/webhook
  callbacks for job completion can be added in v2.
- **File download via MCP** — output files are on the server's filesystem.
  Callers access them directly or via SCP/shared mount.
- **Pause/resume** — headless jobs run to completion or abort. Interactive
  pause/resume is available in the browser UI but not exposed for headless jobs.
- **WebM output** — v1 produces MP4 only (native output from simctl/adb +
  ffmpeg). WebM would require a transcode pass and is deferred.
- **Framerate control** — output framerate matches the capture pipeline
  (typically 30fps). Custom framerate is a v2 option.
