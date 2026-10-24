# SYC-575 checkpoint
Samuel chose option 1 (24 Oct): one "Take a photo" button, always opens phone camera; "Choose from your photos" link under it; live view removed. Hide lightbulb glyph from screen readers.
- [ ] CaptureControls rewrite + test
- [ ] spot.tsx: drop live view wiring
- [ ] i18n en/el/fr
- [ ] preview 320/390/desktop light+dark
- [ ] draft PR, SYC-346 strings, SYC-596 notes

## 24 Oct update
Done + committed: CaptureControls rewrite, spot.tsx live view removed, i18n (en/el/fr: takePhoto en, chooseFromLibrary x3, cameraPermissionHint x3 reworded; removed showLiveView, cameraUnavailableHint, captureHint), tests updated. vitest 2721/2721 locally.
Next: typecheck, web preview 320/390/desktop light+dark, a11y tree, screenshots, draft PR, SYC-346 comment, SYC-596 note, git rm CHECKPOINT.md before PR.
