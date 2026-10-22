# Ruby production setup

`/admin` is a public, client-only diagnostic page. Open it on the BIDC computer running Ruby. Nothing connects on page load. The operator enters the local API address and a Personal Access Token, then runs the checks and downloads a report. Credentials and responses are held in tab memory; there is no server proxy, upload endpoint, or database write.

The supplied Swagger snapshot identifies the API on `https://localhost:5001`, with its schema at `/swagger/1.0-OpenApi/swagger.json`. The Ruby dashboard uses port 2402; the remote-access certificate is served on port 5000. The snapshot lists operations but contains no request or response schemas, so the diagnostic must retrieve the live schema before we implement mutations.

The October 22 BIDC reports establish that direct browser access and PersonalAccessToken authentication work. Design and workbench reads succeed. Without a target-device header, profiles returned an empty list, the queue returned HTTP 204, and device/job status returned HTTP 400 with `ERR_QUEUE_000`. The operator confirmed that the laser was on and connected in Ruby's UI.

Trotec's official [Smart Add-on](https://chromewebstore.google.com/detail/trotec-ruby-smart-add-on/mbfamlpjhmahobdfniiadkibhlefeggh) version 1.0.1 confirms the request headers in `src/service-worker/open-api.js`: `Authorization: PersonalAccessToken <token>`, `x-api-version: 1.0-OpenApi`, and `x-target-device: <serial number>`. Its English messages define `ERR_QUEUE_000` as "No device." Both collectors accept the serial number and target device, profile, and queue reads. Design and workbench lists omit the target header because their schema does not declare it.

The targeted October 22 report identifies a Speedy 400 Flexx and returns its active job, progress, and 13 queue entries. Browser access, authentication, and device selection are verified. Profiles still return an empty list; check the API user's Profiles menu before deciding whether profiles must be created. Designs and workbenches also returned empty lists after the headers changed; the cause is not established. `GetJobsStatus` returned `ERR_TN_002` when called without its `trackingNumber` query parameter. The setup collector no longer calls this endpoint; tracked-job status belongs after an import with a known tracking number.

## What we collect

- OpenAPI schemas, including upload, profile, workbench, queue, and error contracts.
- `GetDeviceStatus`, `GetImportProfiles`, `GetDesigns`, `GetWorkbenches`, and `GetQueueElements` JSON responses.
- HTTP status, Ruby error codes, target serial number, elapsed time, browser origin/version, and failures. Each request has a 15-second timeout and an 8 MB response bound. Collections are a single API response, not an exhaustive crawl. HTTP 204 means no response content; it does not establish that a laser is connected or its queue is empty.
- Optional operator notes identifying known working acrylic and stamp profiles.

The browser requests only these GET endpoints, with cookies omitted and redirects rejected. It never follows URLs from a Ruby response or OpenAPI `servers` entry. Origins are limited to localhost, private IPv4 addresses, and the supplied BIDC hostnames. Network addresses require HTTPS; HTTP is allowed only for loopback diagnostics. Tokens are never placed in URLs or persisted. Submitted tokens, JWTs, and credential fields are redacted from exported responses.

The Windows PowerShell collector provides the same reads plus an OPTIONS request with the production site's Origin and requested authorization, API-version, and target-device headers. It records relevant CORS headers and validates certificates normally. It does not install certificates, change Windows security settings, start a persistent service, or require administrator rights.

A readable 401 proves HTTP access and indicates an authentication problem. A rejected browser fetch cannot distinguish TLS, reachability, local-network permission, CORS, or redirects. Compare the browser and Windows reports; do not label every fetch failure as CORS. A successful read also does not validate laser power, speed, focus, or material suitability.

## Next implementation, after BIDC diagnostics

```mermaid
flowchart LR
  A[Published badge manifest and cutting SVGs] --> B[Admin page on BIDC computer]
  B --> C[Match sheet material to known Ruby profile]
  C --> D[Import at exact physical size]
  D --> E[Inspect the first imported job in Ruby]
  E --> F[Enqueue once per sheet]
  F --> G[Operator checks setup and starts laser in Ruby]
```

1. Inspect the API user's Profiles menu and confirm the intended profiles are returned. Browser access, authentication, device status, and queue reads already work; a connector is not currently needed.
2. Map each acrylic type/thickness and stamp rubber to a known working profile. The public API only returns profile IDs, names, and material names; design/workbench lists similarly omit dimensions and processing settings. Obtain a profile export or inspect the configuration in Ruby. Profiles are separate from the material database and specify laser, material, scaling, positioning, and whether to save or queue the job. Preserve millimetre dimensions and the stamp's existing manufacturing mirroring; do not apply a second mirror or infer power/speed from a preview.
3. Import one agreed test sheet and inspect its dimensions and settings in Ruby. `Upload` accepts multipart `uploadedFile`; `UploadFromMany` accepts multipart `uploadedFiles` and an explicit target. Both take `importProfileId` and `trackingNumber` query parameters and return no useful IDs. Recover created items using the tracking number. A profile may queue during import; check its processing steps and resulting queue before issuing `EnqueueWorkbench` (a JSON array of workbench IDs). These are later mutation tests, not part of diagnostics.
4. Queue each sheet once, using a durable key derived from the published asset hash, sheet identity, profile, and configuration. Record Ruby IDs before retrying. Recover partial imports by reading existing items instead of blindly creating duplicates.
5. Add queue progress using the documented SignalR hub `/publicTrotecNotification` (`DeviceStateInfo`, `QueueInfo`, `JobQueueEntryStateInfo`) after basic import/queue behavior is verified. The current collector does not subscribe or fetch camera streams.

Public access to the diagnostic page does not grant Ruby access. Future job mutations must remain bound to a local operator's authenticated Ruby session/connector and must not be triggered on page load. No physical execution API is included in this design.

References: [Trotec Ruby REST API and profiles](https://www.troteclaser.com/en-gb/helpcenter/software/ruby/ruby-2-9), [Ruby 2.11 manual, Profiles on pages 17–20](https://www.troteclaser.com/static/pdf/Knowledge/ruby-help/Ruby_V2.11_SM_en-us.pdf), [Trotec Smart Add-on](https://www.troteclaser.com/en-us/helpcenter/software/ruby/ruby-workflow-tips/trotec-ruby-smart-add-on), [Chrome local-network access](https://developer.chrome.com/blog/local-network-access), [browser CORS behavior](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).
