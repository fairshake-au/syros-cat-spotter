# SYC-527 spec session — checkpoint

Branch: claude/blissful-feistel-417000 (app-made worktree). Spec only, no implementation code.

## Done
- [x] Read SYC-527, SYC-57, SYC-56, SYC-493 (+comments), SYC-496, SYC-396 comments (21 Oct)
- [x] Read code: findFromPhoto.ts, teamCats.ts, photoVisibility (display photo is computed live per cat; keyed by photo id), photoVariants, matching.ts, coat reader, build.mjs (onnxruntime-node already external), pnpm-workspace, CI (postgres:16 plain, no pgvector)
- [x] Probes (21 Oct):
  - Neon prod (mute-cloud-06317963, read-only): pgvector 0.8.0 AVAILABLE, not installed. 28 cats, all with main photo; 52 photos, 0 removed; 35 resolved sightings with photo; only 6 cats have 2+ photos.
  - Replit AI integration docs list no embeddings; OpenAI embeddings are text-only -> no paid probe needed.
  - Local benchmark (M5 Pro, transformers.js 3.7.5, q8, cpu, 640px): CLIP B/32 512-d, ~32 ms/photo, RSS +240 MB, 85 MB model; DINOv2-small 384-d, ~44 ms/photo, RSS +110 MB, 24 MB model. Cold load ~0.2 s cached. onnxruntime-node 208 MB installed.
  - Voyage multimodal-3: $0.60/B pixels -> ~$0.0002 per 640x480 photo (docs.voyageai.com/docs/pricing).
  - Migrations: 0035 claimed by origin/claude/syc-396-pr-3-1b-vet-settings; 3.3a report_downloads next.
  - No records import before launch (records-import.md: optional, post-MVP).

## Next
- [ ] Draft docs/specs/find-from-a-photo-whole-island.md
- [ ] Critic (Sonnet, own worktree) -> fold in
- [ ] Artifact, draft PR, Linear comment, deferred tickets
