# SYC-570 checkpoint (24 Oct 2026)
Worktree: vibrant-wilson-707b0e, clean at origin/main 56b53027. NO CODE yet: mockups first (Samuel's gate).
Done: read SYC-570/512/171; code map (ReportWizard.tsx, UrgentAdvice.tsx, AttentionAdvice.tsx, VetList.tsx); web preview works (expo web port 8591, pid in /private/tmp/claude-501/expo-570.pid; Next is disabled until a geolocation fix, so grant it); screenshots of current screens in scratchpad cur-*.png.
Findings: urgent copy is LOCKED (welfareGuidance.test.ts pins capacity paragraph word for word, and says it must be last). Cutting it to 2 sentences = Samuel approval + new en pin + new el/fr strings. Step 1 says "Any of the clinics above", so moving the vet list off screen 4 would need a reword.
Next: publish mockup Artifact, AskUserQuestion one decision at a time, record choices on SYC-570, then build.
