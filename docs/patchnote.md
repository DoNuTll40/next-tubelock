---
title: บันทึกการอัปเดต (Patch Notes)
group: ข้อมูลระบบและการอัปเดต
order: 4
updated: 19 พฤศจิกายน 2026
---

# บันทึกการอัปเดตระบบ (Patch Notes & Changelog)

> **สาระสำคัญ:** รายละเอียดการพัฒนา การปรับปรุงความเสถียร และการแก้ไขข้อผิดพลาดของระบบ TubeLock อย่างเป็นทางการ

---

## เวอร์ชัน 1.2.7 Patch v2 (Build 1.2.7.20261119 — 19 พฤศจิกายน 2026) — Global Singleton Video Player (`#movie_player`), Global Ambient Light & Player-First Instant Startup

### 1. สถาปัตยกรรม Global Singleton `#movie_player` + `AmbientLight`
- **Persistent Root Player (`GlobalPlayerContext.jsx` & `AppShell.jsx`):**
  - สร้าง `GlobalPlayerProvider`, `useGlobalPlayer()` และ `primeGlobalWatchVideo()` ครอบใต้ `SessionProvider` ใน `src/components/AppShell.jsx`
  - ใช้ `useSyncExternalStore` + `createPortal` เพื่อสร้างและรักษา DOM container `<div id="movie_player">` เพียงตัวเดียวตลอดอายุการเปิดแท็บ ครอบทั้ง `<AmbientLight>` และ `<VideoPlayer>` แล้วพักไว้ใน `#movie_player_parking` นอกจอเมื่อไม่ได้อยู่หน้า `/watch`
- **DOM Reparenting ไร้รอยต่อ (`dockPlayerSlot` / `undockPlayerSlot`):**
  - ปรับ `src/app/watch/[id]/WatchClient.jsx` ให้ถอด `<VideoPlayer>` และ `<AmbientLight>` ออก เหลือเป็น `<div id="player-primary-container" />` พร้อม fallback `aspectRatio` ระหว่างก่อน dock
  - เมื่อเข้าหน้า `/watch/[id]` ระบบจะย้าย `<div id="movie_player">` ด้วย `appendChild` ใน `useLayoutEffect` และเรียก `hydrateWatchPage(...)` เพื่อผสานข้อมูลจาก SSR (`description`, `versions`, `subtitle_tracks`) โดย **ไม่รีสตาร์ทสตรีมที่กำลังโหลดอยู่** และจะย้ายกลับพร้อมสั่งหยุดเล่นอัตโนมัติเมื่อออกจาก `/watch` (ยกเว้นขณะเปิด OS Picture-in-Picture ค้างไว้)

### 2. Player-First Startup ตั้งแต่จังหวะกดคลิก (`t = 0ms`)
- **Prewarm + Click Priming ครบทุกจุด (`VideoCard.jsx`, `HistoryClient.jsx`, `ResultsClient.jsx`):**
  - เพิ่มการเรียก `preloadHlsModule()` ควบคู่กับ `prewarmVideoSourceClient()` ตอนชี้/กด และเพิ่ม click handler (`primeGlobalWatchVideo`) บนการ์ดวิดีโอทุกแบบ ให้ Global `#movie_player` เริ่มถอดรหัส manifest และบัฟเฟอร์ไฟล์ทันทีตั้งแต่จังหวะกดคลิกโดยไม่ต้องรอผล SSR ของหน้า `/watch/[id]` เสร็จก่อน
  - แยก `initStream()` ใน `GlobalPlayerContext.jsx` ให้ไม่รอผล metadata `/api/videos/[id]` บน critical path ก่อนสร้าง Blob URL และเริ่ม `hls.js`

### 3. Safe Parking, Audio Recovery & Zero-Reload Protection (`VideoPlayer.jsx`, `PlayerBottomBar.jsx`, `GlobalPlayerContext.jsx`, `VideoCard.jsx`, `ResultsClient.jsx`)
- **ควบคุมสถานะเมื่อถูกจอดนอกหน้า Watch (`isActive` + `isActiveRef`):** ปิดคีย์ลัด, ปิดเมนู/context menu, พัก `MediaSession` และป้องกันไม่ให้ `attemptAutoPlay` หรือ `onPause` auto-resume แอบเล่นต่อเบื้องหลังเมื่อออกจาก `/watch`
- **ป้องกันการรีเซ็ต `hls.js` ตอน SSR Hydrate:** เก็บ `resolution` ใน `resolutionRef` และนำออกจาก dependency array ของ `initHls` พร้อมรีเซ็ต `lastReportedRatioRef` / `detectedRatio` ทุกครั้งที่สลับ `videoId`
- **แก้ปัญหาเสียงหายเวลาสลับคลิป & ปุ่มเปิด/ปิดเสียงบนมือถือ/PWA:** ปรับ `attemptAutoPlay` ไม่ให้ปิดเสียง (`v.muted = true`) เมื่อเกิด `AbortError` ระหว่างเปลี่ยนคลิป, ให้ `MANIFEST_PARSED` เรียกเล่นเฉพาะเมื่อ `v.readyState >= 2`, เพิ่ม `isUserMutedRef` คืนค่าเสียงอัตโนมัติในคลิปถัดไป และเพิ่มปุ่ม `<Volume2>` / `<VolumeX>` ข้างแถบเวลาใน `PlayerBottomBar.jsx` ทั้งโหมดแนวตั้งและเต็มจอ (ติดไฮไลต์สีส้มเมื่อถูกปิดเสียง)
- **กำจัดเสียงตัด/กระแทกระหว่างสลับคลิป & True In-Place Switching (`GlobalPlayerContext.jsx`, `VideoPlayer.jsx`, `VideoCard.jsx`):**
  - ปรับ `VideoCard.jsx` ให้สลับคลิปผ่าน `primeGlobalWatchVideo(..., { inPlace: true, replace })` → `handleSelectVideo()` ทันทีเมื่อกำลังอยู่บน `/watch/` อยู่แล้ว (อัปเดต URL, `document.title` และสลับคลิปเก่ากลับเข้า `relatedVideos` โดยไม่ unmount `WatchClient`)
  - เพิ่ม `reparentPlayerHost()` ใช้ `Element.moveBefore()` (fallback `appendChild`) เพื่อย้าย `#movie_player` แบบอะตอมิกโดยไม่ตัด pipeline ของ `<video>` และถอด `v.play()` ออกจาก `dockPlayerSlot`
  - ถอด attribute `autoPlay` ออกจากแท็ก `<video>`, คุมระดับเสียงเป็น `v.volume = 0` + `v.muted = true` (`silenceAndPauseCurrentVideo()`) ตลอดช่วงเปลี่ยนสตรีม/รื้อ `hls.js` และเลื่อนการคืนเสียงไปยัง `restoreAudioAfterTransition()` ใน `attemptAutoPlay()` / `togglePlay()` / `onPlaying` พร้อมตัด `v.currentTime = 0` ที่ซ้ำซ้อน
- **แก้ไข Lint Error เดิมใน `ResultsClient.jsx`:** ลบการเรียก `setLoading(true)` ซ้ำซ้อนใน `useEffect`, ย้ายฐานเวลา `Date.now()` ออกจากการ render และ escape อัญประกาศใน JSX ให้ผ่าน `eslint` ด้วย 0 errors

---

## เวอร์ชัน 1.2.7 (Build 1.2.7.20261119 — 19 พฤศจิกายน 2026) — ปรับแต่งประสิทธิภาพการ Render, SSR Cache, Bundle Splitting และ GPU Compositing ของหน้า `/watch/[id]`

### 1. Server-Side Rendering & Session Caching (ลดงานซ้ำฝั่งเซิร์ฟเวอร์และ Neon DB)
- **Cached Server Session (`React.cache()` + 30s TTL Map):** เพิ่ม `getCachedServerSession()` และ `evictCachedServerSession(token)` ใน `src/lib/access.js` (bounded cache สูงสุด 500 รายการ, TTL 30 วินาที) เพื่อให้ `src/app/layout.jsx` และ `src/app/watch/[id]/page.jsx` ใช้ผลลัพธ์ session เดียวกันภายใน request และลด query ซ้ำไปยัง Neon DB พร้อมสั่งล้าง cache ทันทีเมื่อ logout ใน `src/app/api/auth/logout/route.js`
- **Parallel SSR Queries:** ปรับ `src/app/watch/[id]/page.jsx` ให้เรียก `getCachedServerSession()` ขนานกับ `cookies()` และรวม query วิดีโอหลัก (`getVideoById`), เวอร์ชันวิดีโอ (`getVideoVersions`) และรายการวิดีโอแนะนำ (`relatedRows`) เข้าใน `Promise.all(...)` ชุดเดียวกัน

### 2. Critical Path Fonts, JS Bundle & Dynamic Imports (ลด Render-Blocking และ Initial JS)
- **Non-blocking Font Loading:** นำ `@import url(...)` ที่บล็อกการ render ออกจาก `src/app/globals.css` แล้วเปลี่ยนไปใช้ `<link rel="preconnect">`, `<link rel="dns-prefetch">` ไปยัง `https://donut-font.vercel.app` และ `<link rel="stylesheet">` ใน `src/app/layout.jsx`
- **Package Import Optimization:** เปิดใช้งาน `experimental.optimizePackageImports: ['lucide-react', 'framer-motion']` ใน `next.config.mjs`
- **Zero GSAP / Framer Motion on Player Hot Path:**
  - แทนที่ `gsap` / `@gsap/react` ใน `src/components/player/DoubleTapArrows.jsx` ด้วย CSS `@keyframes dt-arrow-left` และ `@keyframes dt-arrow-right` บน GPU compositor
  - แทนที่ `framer-motion` ใน `src/components/player/PlayerCenterControls.jsx` ด้วยแอนิเมชัน CSS ล้วนและปุ่ม `<button>` ปกติ
- **Code-Splitting Modal & Overlay ของ Player:** โหลด `PlayerSettingsModal`, `PlayerStatsModal`, `PlayerContextMenu` และ `PlayerEndScreen` แบบ `next/dynamic(..., { ssr: false })` ใน `src/components/VideoPlayer.jsx`
- **Preload `hls.js` แบบ Deduped:** เพิ่ม `preloadHlsModule()` ใน `src/lib/playbackResolver.js` เพื่อโหลดโมดูล `hls.js` ล่วงหน้าขนานกับการเรียก `/source` ใน `src/app/watch/[id]/WatchClient.jsx`

### 3. Direct DOM Player Scrubber & Zero Re-render Playback (ลด React Re-renders ระหว่างเล่นวิดีโอ)
- **Direct DOM Scrubber & Time Display:** ปรับ `src/components/player/PlayerScrubber.jsx`, `src/components/player/PlayerBottomBar.jsx` และ `src/components/VideoPlayer.jsx` ให้ควบคุมความคืบหน้า (`progressBarRef`, `hoverBarRef`, `scrubberKnobRef`, `timeDisplayRef`) ผ่าน DOM โดยตรงและซิงก์ผ่าน `useLayoutEffect` เมื่อเปลี่ยน layout ช่วยตัด React state ที่เคยอัปเดตทุกวินาทีหรือทุกการขยับเมาส์ออกทั้งหมด
- **Lazy Subtitle Settings Fetch & No-Spurious-Write:** เพิ่มการตรวจสอบ `hasSession`, หน่วง `GET /api/user/subtitle-settings` 1,200ms พร้อม cache 5 นาที (`subSettingsCache`) และใช้ `userChangedSubPrefsRef` เพื่อไม่ให้เกิดการยิง `POST` ลงฐานข้อมูลโดยไม่จำเป็นตอน mount
- **Defer Navbar Search Fetches:** ปรับ `src/components/navbar/SearchDropdown.jsx` ให้เลื่อนการเรียก `/api/search/history` และ `/api/videos` ไปทำเมื่อเปิด dropdown (`isOpen`) เท่านั้น พร้อม cache ระดับโมดูล 120 วินาที

### 4. Client Hydration, Paint & GPU Compositing (`/watch/[id]` & Related Grid)
- **Single-Mount Related Videos + Content Visibility:** ปรับ `src/app/watch/[id]/WatchClient.jsx` ให้ mount รายการวิดีโอแนะนำเพียงชุดเดียวตามหน้าจอผ่าน `useSyncExternalStore` (`min-width: 1024px`) และใส่ `contentVisibility: 'auto'` สำหรับรายการลำดับ `idx >= 4`, เพิ่ม `fetchPriority="high"` และ `decoding="async"` ให้รูปปกเริ่มต้น พร้อม hoist `formatDuration`, ครอบ handlers ด้วย `useCallback` และจำกัด `ResizeObserver` ฝั่ง mobile
- **Memoization & Lazy Modal/Color Extraction:** ครอบ `DescriptionBox` และ `VideoCard` ด้วย `React.memo`, ใส่ `loading="lazy" decoding="async"` ใน `VideoCard`, เลื่อน `extractDominantColor` ไปทำเมื่อ `onMouseEnter`/`onFocus` (`ensureDominantColor()`) และ mount `<DeleteVideoModal />` เฉพาะเมื่อเปิดใช้งาน
- **Optimized Ambient Light Canvas:** ปรับ `src/components/player/AmbientLight.jsx` ให้ตรวจสิทธิ์ CORS canvas (`getImageData`) เพียงครั้งเดียวผ่าน `corsCheckedRef`, ข้ามการวาดซ้ำเมื่อแท็บถูกซ่อน (`document.hidden`), จอเล็กกว่า 640px หรือหยุดเล่นหลังวาดเฟรมแรก พร้อมเพิ่ม `visibilitychange` listener และเปลี่ยน `will-change-transform` เป็น `will-change-[opacity]`

---

## เวอร์ชัน 1.2.6 (Build 1.2.6.20261119 — 19 พฤศจิกายน 2026) — เร่งความเร็ว TTFF สตรีม HLS, ประหยัด Neon Free Tier, บังคับระบุภาษาซับ และปรับ Responsive UI

### 1. เร่งความเร็วการเปิดวิดีโอ (TTFF Optimization) ภายใต้ Free Tier ($0)
- **Two-Phase Microsoft Graph `$batch` Cold Start (`videoSourceService.js`, `playbackResolver.js`, `WatchClient.jsx`, `VideoPlayer.jsx`):**
  - สำหรับคลิปที่ไม่เคยเปิดหรือแคชหมดอายุ (โดยเฉพาะคลิปยาวที่มี 500–4,300+ ไฟล์) ระบบจะขอเซ็นลิงก์เฉพาะ 12 chunk แรกครบทุกความละเอียดใน 1 คำขอ `$batch` (~400–600 ms แทนการรอเซ็นครบทั้งโฟลเดอร์ 2–16 วินาที) เพื่อให้วิดีโอเริ่มเล่นเฟรมแรกทันที
  - โหลดรายการลิงก์เต็มทั้งโฟลเดอร์พร้อมบันทึกลงแคช Neon DB ในเบื้องหลังผ่าน `after()` (`maxDuration = 60`) แล้วสลับลิงก์ตรงเข้าสู่ `hls.js` แบบไร้รอยต่อด้วย custom `fLoader` (`SegmentHydrationLoader`) โดยไม่รบกวนผู้ใช้
- **Fast-Start ABR บน Player (`VideoPlayer.jsx`):**
  - ตั้งค่า `autoStartLoad: false` และ `testBandwidth: false` เพื่อเริ่มโหลด chunk แรกที่ระดับ 360p/480p (ไฟล์เล็ก โหลดและถอดรหัสเฟรมแรกไวมาก) จากนั้นให้ Auto ABR ดันขึ้น 1080p/4K อัตโนมัติตั้งแต่ chunk ถัดไป (ยังคงเคารพความละเอียดที่ผู้ใช้เลือกค้างไว้ใน `localStorage`)
- **แยกคอลัมน์ `m3u8_cache_br` & SSR Warm Handoff (`videoSourceService.js`, `watch/[id]/page.jsx`):**
  - เก็บเนื้อหา `.m3u8` ขนาดเล็กมาก (~1–7 KB) แยกต่างหากใน `videos` และ `video_versions` ทำให้ไม่ต้องโหลด `.m3u8` จาก SharePoint ซ้ำตอน Cold Miss และฝั่งเบราว์เซอร์สร้าง Blob URL ได้ภายใน ~6–11 ms
  - ส่งข้อมูล source ที่อุ่นอยู่ใน RAM จาก SSR เข้า `WatchClient` ทันที และเพิ่ม `<link rel="preconnect">` ไปยัง Cloudflare Worker ใน `layout.jsx`
  - รองรับตัวแปร `ONEDRIVE_DRIVE_ID` ใน environment (`onedriveServer.js`) เพื่อตัดคำขอ `/users/.../drive` ตอน Cold Start (~500 ms)
- **แคช Session ใน Middleware และ `/streams/` แบบ Cache-First (`proxy.js`, `logout/route.js`, `streams/[...path]/route.js`):**
  - แคชผลการตรวจ `user_sessions` ในหน่วยความจำ 60 วินาที (และล้างทันทีตอนออกจากระบบ) ลดเวลา `proxy.ts` จาก 250–1,364 ms เหลือ ~4–6 ms และลดจำนวน query ไป Neon DB ลง ~95%
  - ปรับ `/streams/[...path]` ให้ตรวจสอบ `sourceCache` ก่อนเชื่อมต่อ Neon DB ทำให้ redirect ไฟล์ได้ใน `< 1 ms` โดยไม่ยิง DB

### 2. ลดปริมาณ Neon DB Network Transfer (Egress)
- **ข้ามการดึง `source_cache_br` ที่หมดอายุตอน Cold Miss:** ลดข้อมูลที่ส่งออกจาก Neon DB จาก 180–653 KB เหลือเฉพาะ `m3u8_cache_br` (~1–7 KB หรือลดลง ~98%) พร้อมขยายอายุแคช HLS ที่แปลงเสร็จแล้วเป็น 50 นาที
- **ตัดการส่งซับไตเติลซ้ำซ้อน (`watch/[id]/page.jsx`, `api/videos/[id]/route.js`):** เมื่อวิดีโอมีข้อมูล `subtitle_tracks` แล้ว จะไม่ส่ง `subtitle_srt` และ `subtitle_vtt` รุ่นเก่าซ้ำอีก ช่วยลด Neon Egress ฝั่งซับลง ~50%

### 3. ซับไตเติล AI, ภาษาต้นฉบับวิดีโอ และระบบหลายเวอร์ชัน
- **บังคับระบุภาษาต้นฉบับของวิดีโอ (`source_language`):** เพิ่มตัวเลือกภาษาต้นฉบับในขั้นตอนอัปโหลด (Upload Studio) และหน้าแก้ไขวิดีโอ เพื่อส่งให้ Worker ถอดเสียงได้ตรงภาษาจริง ไม่หลุดไปภาษาอื่น
- **อัปเกรด Subtitle Worker เป็น Parallel Gemini 3.8 Flash (`scripts/audio-subtitle-worker.js`, `scripts/gemini-transcribe.js`):** ประมวลผลช่วงเสียงแบบขนาน (ลดเวลาถอดเสียงลงมาก) พร้อมระบบกู้คืนเฉพาะช่วงที่ถอดผิดภาษาด้วย `gemini-3.5-transcribe` และปรับการเว้นวรรคภาษาไทย/CJK ให้สะอาดขึ้น
- **ระบบวิดีโอหลายเวอร์ชัน (Multi-Version Videos):** รองรับการสลับเวอร์ชันวิดีโอภายในเมนูตั้งค่า Player พร้อมพรีเซ็ต `Remove Mosaics` และจัดการเวอร์ชันในหน้า Studio

### 4. Responsive UI/UX และ Benchmark Lab
- **ปรับเลย์เอาต์หน้าจอแท็บเล็ตและ Split-screen (`Navbar.jsx`, `WatchClient.jsx`):**
  - เปลี่ยนช่องค้นหาบน Navbar เป็น Flexbox ไม่ทับซ้อนปุ่มด้านขวาในความกว้าง `768px–1279px` และยุบป้ายชื่อผู้ใช้เป็น Avatar อัตโนมัติเมื่อจอแคบ
  - จัดแนว breakpoint ของ sticky player ให้ตรงกับ Navbar (`md:`), ปรับ AmbientLight ให้ไล่แสงเนียนขึ้น และแสดงรายการวิดีโอแนะนำบนแท็บเล็ตเป็นกริด 2 คอลัมน์
- **ปรับปรุง Benchmark Lab (`/benchmark`):**
  - แสดง `Server-Timing` แยกเวลาฝั่งเซิร์ฟเวอร์และสถานะแคช (`cold-batch`, `memory-hit`, `db-hit`, `X-TubeLock-Cache`), ไม่ดาวน์โหลด chunk แรกซ้ำซ้อนในขั้น MSE Decode และป้องกันหน้าเว็บ crash เมื่อ Neon DB timeout ชั่วคราว

---

## 17 พฤศจิกายน 2026 — คลังวิดีโอ, หน้าแก้ไข, ซับไตเติล AI และ Neon

### คลังวิดีโอและหน้าแก้ไข

- เจ้าของวิดีโอและผู้ดูแลเปิดหน้าแก้ไขจากคลังวิดีโอ หน้ารับชม หรือหน้าคิวได้ตามสิทธิ์
- หน้าแก้ไขรวมข้อมูลวิดีโอ ภาพปก แทร็กซับ ตัวอย่างวิดีโอ และสถานะการแปลงไว้ในที่เดียว
- การ์ดถอดซับใช้ร่วมกับหน้าอัปโหลด และรองรับการสร้างซับใหม่จากเสียงที่เก็บไว้หรือ HLS
- แสดงผลประเมินเรตและล็อกการเปลี่ยนเรตหลังประเมินเสร็จ

### ซับไตเติล AI

- ถอดซับตามภาษาที่พูดก่อน คลิปภาษาไทยได้แทร็กเดียว ส่วนคลิปภาษาต่างประเทศได้แทร็กต้นฉบับและแทร็กแปลไทยแยกกัน
- หากผลถอดเสียงบางช่วงเป็นไทยแต่ช่วงอื่นพบภาษาต่างประเทศ ระบบจะฟังช่วงนั้นใหม่ก่อนรวมแทร็กต้นฉบับ และรับเฉพาะ `original_srt` ในขั้นถอดเสียง
- เมื่อสั่งสร้างซับใหม่ ระบบใช้ `audio.mp3` ที่เก็บใน OneDrive ถ้ายังไม่มี จะสกัดจาก MP4 หรือจาก HLS เมื่อ MP4 ถูกลบ แล้วบันทึกเสียงไว้ก่อนเริ่มถอดซับ

### การอ่านข้อมูลจาก Neon

- Upload Studio ส่งซับและบันทึก worker กลับมาเมื่อข้อมูลเปลี่ยน และตัด `source_cache` ออกจากผล query สถานะ
- Benchmark Lab ให้ PostgreSQL คำนวณขนาดข้อมูลและนับไฟล์ ลดการอ่านข้อมูลแคชทั้งชุดเพื่อทำรายงาน

### แถบเมนูแบบย่อบนเดสก์ท็อป

- จัดลำดับและแบ่งกลุ่มเมนูให้ตรงกับแถบเมนูตัวเต็ม พร้อมใช้สีไฮไลต์เดียวกันในธีมสว่างและมืด
- กระชับระยะห่างระหว่างไอคอนกับชื่อเมนู เพิ่มกรอบโฟกัสสำหรับการใช้คีย์บอร์ด และนำป้ายเวอร์ชันเก่าด้านล่างออก

### งานที่อยู่ระหว่างทดสอบ

- บันทึกแนวทางส่งสถานะงานจาก GitHub Actions ไปยัง Upload Studio และหน้าคิวผ่าน WebSocket ไว้สำหรับการทดลอง

---

## เวอร์ชัน 1.2.5 (Build 1.2.5.20261113 — 13 พฤศจิกายน 2026) — แก้ไขความแม่นยำไทม์ไลน์ซับไตเติล ระบบแปล AI และเสถียรภาพ Worker

### 1. ระบบซับไตเติล AI และการซิงก์ไทม์ไลน์ให้ตรงเสียง (`subtitleUtils.js`, `audio-subtitle-worker.js`, `VideoPlayer.jsx`)
- **ตัวแยกคิว SRT/VTT แบบทนทานต่อรูปแบบเพี้ยน (`src/lib/subtitleUtils.js`):**
  - รองรับไทม์โค้ดที่ AI ย่อหลักวินาทีหรือคั่นมิลลิวินาทีด้วยโคลอน (`00:54:0,500`, `01:01:200`), ซ่อมไทม์โค้ดหรือลูกศรที่ถูกตัดขึ้นบรรทัดใหม่ (`--\n>`, `00:05:\n0,910`), และแตกคิวที่ถูกยุบต่อเป็นแถวเดียวกลับมาเป็นคิวอิสระพร้อมตัดเลขลำดับคิว/ค่าจัดตำแหน่ง WebVTT ส่วนเกิน
- **ซิงก์ไทม์ไลน์เสียงและวิดีโออย่างแม่นยำ (`alignChunkCuesToWindow` & `normalizeSubtitleTimeline`):**
  - แยกไฟล์เสียงต้นทางด้วย `-af aresample=async=1:first_pts=0` พร้อมสกัด PCM `.wav` สำหรับตัดช่วงเสียงแบบ sample-exact ลดอาการเวลาคลาดเคลื่อนสะสมในคลิปยาว
  - ตรวจจับและจัดตำแหน่งไทม์โค้ดของแต่ละช่วงอัตโนมัติ (ป้องกันการบวก offset ซ้ำหรือหลุดช่วง), ปรับความยาวประโยคที่ยืดค้างผิดปกติ, ลบรอยต่อซ้ำซ้อน, และจัดเรียงคิวไม่ให้เวลาทับซ้อนกันก่อนบันทึกเป็น `.SRT` และ `.VTT`
  - อัปเดต `parseSubtitleCues` และ `findActiveSubtitleCue` (`playerUtils.js`) บนตัวเล่นวิดีโอ `VideoPlayer.jsx` ให้ค้นหาคิวล่าสุดตาม `currentTime` แบบ Binary Search เพื่อไม่ให้คิวเก่าค้างทับคำพูดใหม่
- **แปลภาษาไทยแบบล็อกรหัส `id` 1-ต่อ-1 (`subtitlePrompts.js` & `translateCuesToThaiWithGemini`):**
  - ปรับขั้นที่ 2 จากการให้ AI เขียน SRT ซ้ำทั้งไฟล์เป็นการแปล JSON `{ "id", "text" }` ชุดละ `65` ประโยค โดยล็อกเวลาจากขั้นที่ 1 100% พร้อมแบ่งครึ่งส่งซ้ำอัตโนมัติเมื่อได้คำแปลไม่ครบ และกำชับขั้นที่ 1 ไม่ให้แปลคำพูดภาษาต่างประเทศเป็นภาษาไทยปนในแทร็กต้นฉบับ
- **ป้องกันอาการค้างนานระหว่างสลับโมเดล AI (`callGeminiWithFallback` & `buildRequestBodyForModel`):**
  - ปิดโหมดคิดลึก (`thinkingBudget: 0` / `thinkingLevel: 'minimal'`) บนโมเดลสำรองตระกูล Gemini 2.5 และ Gemini 3 เพื่อลดเวลาตอบกลับจากหลายนาทีเหลือหลักสิบวินาที พร้อมลด Timeout ต่อคำขอลงเหลือ `95s` (ไม่รอซ้ำซ้อน) และส่ง Heartbeat Log สถานะขึ้น DB/Console ทุก `18s` ระหว่างรอผล

### 2. ความเสถียรของ Worker แปลงสตรีม HLS, หน้าต่างแจ้งเตือนสื่อ และระบบ AI จัดเรตเนื้อหา
- **แสดงภาพปกและชื่อช่องบนแถบแจ้งเตือนเล่นสื่อ (`VideoPlayer.jsx` & `playerUtils.js`):** เชื่อมต่อ Media Session API (`MediaMetadata`, `playbackState`, `setPositionState` และปุ่มควบคุม `play`/`pause`/`seekbackward`/`seekforward`/`seekto`) ให้แถบแจ้งเตือนบน Android/เดสก์ท็อปและหูฟังบลูทูธแสดงภาพ Thumbnail ของวิดีโอ (ผ่าน `/api/og/*.jpg` ที่ไม่มีปัญหารีไดเรกต์/Content-Disposition พร้อมปิดบังเป็นไอคอนแอปสำหรับวิดีโอ 18+ ที่ซ่อนภาพปก), ชื่อคลิปสะอาด และชื่อช่องแทนชื่อแท็บกับโลโก้เว็บ
- **จัดตำแหน่งซับให้อยู่ในกรอบภาพจริงและปรับระยะบรรทัด (`computeSubtitleBoxLayout` & `computeSubtitleStyles`):** คำนวณพื้นที่ภาพวิดีโอจริงผ่าน `ResizeObserver` เพื่อยกซับขึ้นมาอยู่ในกรอบภาพบนมือถือจอยาว (20:9) หรือวิดีโอที่ติดขอบดำด้านบน-ล่าง และรวมซับ 2 บรรทัดให้อยู่ในกล่องโค้งมนเดียวกันด้วย `lineHeight: 1.44` เพื่อลดช่องว่างห่างผิดส่วนระหว่างบรรทัด
- **จำกัดการแสดงภาพปกเนื้อหา 18+ เฉพาะผู้ที่เข้าสู่ระบบ (`SessionContext`, `VideoCard.jsx`, `PlayerEndScreen.jsx`, `/api/videos/[id]/poster`):** ซ่อนปุ่ม `"แสดงภาพปก"` และปิดสวิตช์ตั้งค่าภาพปก 18+ เมื่อยังไม่เข้าสู่ระบบ พร้อมตรวจสิทธิ์ `getSessionUserId()` ที่ฝั่งเซิร์ฟเวอร์ (`/api/videos/[id]/poster` และ `?previews=1` บน `/api/videos/[id]/source`)
- **แก้ไข `ReferenceError: vidNum is not defined` (`scripts/transcode-worker.js`):** ประกาศ `vidNum` ที่ขอบเขตระดับโมดูลพร้อมรักษาสถานะความคืบหน้าแบบเดินหน้าอย่างต่อเนื่องระหว่างการแปลง HLS
- **ปรับปรุงหน้าพรีวิวจัดเรตและความเสถียรโควตา AI (`StepRatingVision.jsx` & `scripts/sprite-rating-worker.js`):** ปรับการแสดงผลภาพตาราง 5x5 ของคลิปแนวตั้งให้เต็มกรอบ ปรับปรุงการตัดคำภาษาไทยบนหน้า UI และจัดลำดับความสำคัญโมเดล Gemini รุ่นโควตา 500 RPD ก่อนสลับใช้โมเดลสำรอง

---

## เวอร์ชัน 1.2.4 (Build 1.2.4.20261111 — 11 พฤศจิกายน 2026) — สิทธิ์การจัดการวิดีโอและความเสถียรของคิวอัปโหลด

### บัญชีและสิทธิ์การเข้าถึง

- เจ้าของวิดีโอและผู้ดูแลจัดการวิดีโอและงานอัปโหลดที่ตนมีสิทธิ์ได้ การซิงก์คลัง OneDrive การแก้ค่าตั้งส่วนกลาง และ API อัปโหลด HLS รุ่นเดิมต้องใช้บัญชีผู้ดูแล
- เพิ่มการตรวจคำขอเข้าสู่ระบบ Google และ LINE และจำกัดการส่งต่อหลังเข้าสู่ระบบให้อยู่บนเว็บไซต์เดียวกัน
- หน้ารับชมและ API สาธารณะกรองวิดีโอที่ยังไม่พร้อมเผยแพร่ และตัดอีเมลผู้ลงออกจากฟีดและข้อมูลวิดีโอสาธารณะ

### อัปโหลดและประมวลผล

- ป้องกันคำขอพร้อมกันเริ่มงานแปลงวิดีโอซ้ำ และแสดงสถานะล้มเหลวเมื่อส่งงานหลักไป GitHub Actions ไม่สำเร็จ
- ตรวจลำดับและขนาดรวมของไฟล์ HLS แบบแบ่งชิ้นก่อนระบุว่าอัปโหลดครบ
- หน้าตั้งค่าแสดงข้อผิดพลาดเมื่อเซิร์ฟเวอร์ปฏิเสธการบันทึกค่าตั้งส่วนกลาง

### สำหรับผู้ดูแลระบบ

ตั้งค่า `TUBELOCK_ADMIN_USER_IDS` ใน environment ของ deployment โดยใช้ `users.id` จาก Neon คั่นด้วยเครื่องหมายจุลภาค งานที่ต้องใช้สิทธิ์ผู้ดูแลจะตอบ `403` เมื่อยังไม่ได้กำหนดค่า

---

## เวอร์ชัน 1.2.3 (Build 1.2.3.20261110 — 10 พฤศจิกายน 2026) — Dual-Track AI Subtitle Translation, Specific Dialect Identification & 18+ Mature Thumbnail Blur Filter

แพตช์อัปเดตระบบถอดเสียงและแปลซับไตเติลภาษาต่างประเทศแบบ 2 แทร็กอัตโนมัติ (ภาษาไทย + ภาษาต้นฉบับระบุสำเนียงเฉพาะเจาะจง), ตัวสลับแทร็กซับไตเติลบน Player, ระบบเบลอภาพปกวิดีโอ 18+ / เนื้อหาเฉพาะผู้ใหญ่บนทุกหน้าฟีดพร้อมตัวเลือกปลดล็อกในหน้าตั้งค่า, การป้องกันข้อผิดพลาด Safety Filter ของ Gemini และระบบล็อกปุ่มป้องกันการส่งซ้ำขึ้น GitHub Actions

### 1. ระบบถอดเสียงและแปลซับไตเติล AI สองภาษา (Dual-Track Subtitles & Dialect Identification)
- **การระบุภาษาต้นฉบับและสำเนียงอย่างเจาะจง (`scripts/audio-subtitle-worker.js`):** ปรับคำสั่ง Gemini AI ให้วิเคราะห์เสียงพูดหลักอย่างละเอียด หากเป็นภาษาจีนจะระบุชัดเจน เช่น `จีนกลาง (ตัวย่อ)`, `จีนกลาง (ตัวเต็ม)`, `จีนกวางตุ้ง`, `จีนไต้หวัน` รวมถึงภาษาอื่นๆ เช่น `ญี่ปุ่น`, `อังกฤษ`, `เกาหลี`, `เวียดนาม`
- **สร้างคำบรรยาย 2 แทร็กพร้อมกัน (Synchronized Dual Tracks):**
  - **แทร็กที่ 1 — `ไทย (แปลอัตโนมัติ)`:** แปลบทสนทนาเป็นภาษาไทยอย่างเป็นธรรมชาติ สละสลวย ถูกต้องตามอารมณ์และบริบท
  - **แทร็กที่ 2 — `[ภาษาต้นฉบับ] (สร้างอัตโนมัติ)`:** ถอดเสียงภาษาต้นฉบับที่พูดจริงในวิดีโออย่างแม่นยำ
  - ทั้งสองแทร็กใช้ไทม์โค้ดเดียวกันตรงเป๊ะ ช่วยให้ผู้ชมสลับแทร็กไปมาบน Player ได้อย่างราบรื่น
  - หากเสียงต้นฉบับเป็นภาษาไทยอยู่แล้ว ระบบจะสร้างแทร็กเดียวคือ `ไทย (สร้างอัตโนมัติ)`
- **จัดเก็บโครงสร้าง Multi-Track ลงฐานข้อมูล (`videos.subtitle_tracks JSONB`):** เพิ่มคอลัมน์ `subtitle_tracks` ใน Neon DB เก็บแทร็กคำบรรยายทั้งหมด พร้อมบันทึกไฟล์ขึ้น OneDrive (`subtitles.srt`, `subtitles.vtt`, `subtitles_original.srt`, `subtitles_original.vtt`)
- **เมนูสลับภาษาซับไตเติลบน Player (`PlayerSettingsModal.jsx` & `VideoPlayer.jsx`):** รองรับการแสดงรายการแทร็กคำบรรยายที่มีทั้งหมดแบบไดนามิก ทั้งในโหมด Mobile Bottom Sheet และ Desktop เมนู ให้ผู้ใช้เลือกสลับระหว่าง `ปิด`, `ไทย (แปลอัตโนมัติ)` และ `[ภาษาต้นฉบับ] (สร้างอัตโนมัติ)` ได้ทันที

### 2. ระบบเบลอภาพปก 18+ / เนื้อหาเฉพาะผู้ใหญ่ & การตั้งค่าความปลอดภัย (Mature Thumbnail Blur)
- **เบลอภาพปกวิดีโอเรต 18+ และ Mature อัตโนมัติ (`VideoCard.jsx`):** วิดีโอที่มีเรตติ้ง `18+`, `mature`, `restricted` หรือหมวดหมู่ `adult` จะถูกเบลอภาพปกแบบนุ่มนวล (`blur-2xl`) บนทุกหน้าฟีด (หน้าแรก, แนะนำ, ค้นหา) เพื่อความปลอดภัยและความเป็นส่วนตัว
- **ป้ายเตือน 🔞 และตัวเลือกเปิดดูภาพชั่วคราว:** แสดง Overlay แจ้งเตือนเนื้อหา 18+ บนภาพปก พร้อมปุ่ม `แตะเพื่อแสดงภาพปก` เพื่อให้ผู้ใช้สามารถคลิกดูภาพปกเป็นรายคลิปได้ทันทีโดยไม่ต้องเปลี่ยนการตั้งค่าหลัก
- **สวิตช์เปิด/ปิดในหน้าตั้งค่า (`/settings?general`):** เพิ่มหัวข้อ **"ความปลอดภัยและการควบคุมเนื้อหา (Content Safety & Age Verification)"** พร้อมสวิตช์ **"แสดงภาพปกเนื้อหา 18+ และหมวดผู้ใหญ่ (Adult Content Display)"** บันทึกค่าลง `localStorage` และตาราง `app_settings` บน Neon DB ทันที

### 3. การดักจับความปลอดภัยของ Gemini & ระบบป้องกันการกดปุ่มซ้ำ
- **Safety Filter Fallback Interception (`scripts/sprite-rating-worker.js`):** หาก Gemini AI บล็อกการวิเคราะห์ภาพด้วยเหตุผล `SAFETY` หรือเนื้อหาทางเพศ (`HARM_CATEGORY_SEXUALLY_EXPLICIT`), ระบบจะตีความเป็นเรต `mature` (เนื้อหาจำกัดเฉพาะผู้ใหญ่) ทันที เพื่อป้องกันไม่ให้คลิปที่มีเนื้อหาทางเพศหลุดรอดไปเป็นเรต "ทั่วไป (All Ages)"
- **Synchronous Ref Locks & Button Debounce:** ล็อกการกดปุ่มสั่ง Action ซ้ำๆ พร้อมแสดง Spinner หมุน และป้องกันไม่ให้ส่ง Action ซ้ำไปยัง GitHub Actions หากมีงานค้างอยู่ไม่เกิน 45–60 วินาที
- **ปุ่มยกเลิกการอัปโหลด:** เพิ่มปุ่มยกเลิกข้ามหน้าอัปโหลด สามารถหยุดกระบวนการและลบไฟล์ออกจากระบบได้ทุกขั้นตอน

### 4. แก้ไขข้อผิดพลาดการรับชมวิดีโอ (Watch 404 Fix & Undefined Slug Sanitization)
- **แก้ไขปัญหาเปิดดูวิดีโอแล้วติดหน้า 404 (Watch SSR Schema Resilience):** ปรับปรุง `getVideoById` และ `relatedRows` ใน `src/app/watch/[id]/page.jsx` ให้มี Fallback Query (`SELECT v.*`) แบบอัตโนมัติ ป้องกันไม่ให้เกิดหน้า 404 เมื่อตารางฐานข้อมูลเกิดความไม่สอดคล้องของ Schema พร้อมรัน Migration คอลัมน์ `subtitle_tracks` และ `content_rating` บน Neon DB เรียบร้อย ทุกวิดีโอสามารถเปิดรับชมและเล่นได้ทันที
- **แก้ไขบั๊ก Base62 Alphabet ตกหล่นอักษร 'r' ที่ดัชนี 61 (`src/lib/videoUtils.js`):** ตรวจพบต้นตอที่แท้จริงของคำว่า `undefined` ในรหัสวิดีโอ เกิดจากชุดตัวอักษร `B62_ALPHABET` มีเพียง 61 ตัวอักษร (ขาดตัว `'r'`) เมื่อตัวเลขวิดีโอถูกแฮชจนเหลือเศษ `61` จะเกิด `undefined` เช่น วิดีโอ ID 826 กลายเป็น `v_vXJfHtundefined` ได้ทำการเติม `'r'` ให้ครบ 62 ตัวอักษรสมบูรณ์ 100% พร้อมระบบ Auto-Healing ใน `decodeVideoSlug` และการ Redirect อัตโนมัติไปยัง URL ที่ถูกต้อง (`/watch/v_vXJfHtr`) สามารถรับชมได้ทันทีโดยไม่ติด 404
- **ป้องกันและทำความสะอาดรหัสวิดีโอ (Undefined Slug Sanitization):** ปรับปรุง `VideoCard.jsx`, `ResultsClient.jsx`, `HistoryClient.jsx`, `WatchClient.jsx`, `StepPublish.jsx`, `PlayerStatsModal.jsx` และ `src/proxy.js` ให้ตรวจสอบความถูกต้องของ ID/Slug และหากมีการเข้าเส้นทาง `/watch/undefined` หรือ `/watch/null` จะถูก Redirect กลับหน้าแรกทันที ไม่ติดหน้า 404

### 5. ปรับปรุง UI แผงการตั้งค่า & ความคมชัดของปุ่มเปิด/ปิดคำบรรยาย (Settings Menu Spacing & CC Visibility)
- **ปรับปรุงความคมชัดของปุ่ม CC ไม่ให้จางมัว (`PlayerBottomBar.jsx` & `CcSubtitleIcon.jsx`):**
  - แก้ไขสีของปุ่ม CC ขณะปิดคำบรรยาย จากเดิมที่ใช้สีโปร่งแสงจางมาก (`text-zinc-400/50`) ให้เป็นสีสว่างคมชัด (`text-zinc-100` / `text-zinc-200`) มองเห็นได้ชัดเจนบนทุกพื้นผิววิดีโอทันทีโดยไม่ต้องนำเมาส์ไป Hover
  - เพิ่มแถบขีดสีส้ม (`#FF7A00`) ด้านล่างปุ่ม CC เมื่อเปิดใช้งานคำบรรยาย เหมือนมาตรฐาน YouTube
  - ปรับความหนาของเส้นไอคอนเป็น `strokeWidth="2.2"` เพื่อความคมชัดเป็นพิเศษ
  - ปรับรูปทรงปุ่ม CC ให้เป็นสี่เหลี่ยมโค้งมน (`rounded-xl`) เข้าชุดกับปุ่มการตั้งค่า (Settings), หน้าต่างลอย (PiP) และปุ่มเต็มจอ (Fullscreen)
- **ขยายความกว้างและแก้ปัญหาเมนูการตั้งค่าแออัด (`PlayerSettingsModal.jsx`):**
  - ขยายความกว้างของหน้าต่างป๊อปอัปบน Desktop เป็น `w-[330px] sm:w-[350px]` พร้อมเพิ่มช่องว่าง `gap-4` และระยะขอบ `px-5 py-3.5`
  - ป้องกันข้อความหัวข้อและค่าตัวเลือก (เช่น `คุณภาพ` กับ `อัตโนมัติ (2160p)`) ชิดติดกัน โดยเว้นระยะห่างหายใจอย่างสมดุล สวยงาม ไม่แออัด
  - ปรับชื่อหัวข้อในเมนูจาก `คำบรรยาย (CC)` ให้เหลือเพียง `คำบรรยาย` สั้นกระชับ และปรับไอคอนในเมนูให้เป็นโครงร่าง (Outlined) สม่ำเสมอทุกแถว

### 6. แก้ไขปัญหาคำบรรยายหลายบรรทัดและการซ้อนทับของส่วนควบคุม (Subtitle Line Spacing, Vertical Positioning & Player Overlay Fix)
- **แก้ไขปัญหากล่องข้อความคำบรรยายซ้อนทับกัน (Subtitle Line Overlap Fix — `playerUtils.js`):**
  - แก้ไขปัญหาขอบกล่องข้อความคำบรรยายชนหรือเกยทับกันเมื่อข้อความยาวจนตัดขึ้นบรรทัดใหม่ อันเกิดจากระยะเบียด Padding แนวตั้งที่มากเกินไป (`0.32em`) ชนกับระยะบรรทัด
  - ปรับค่า `lineHeight` จาก `1.75` เป็น `1.85` และลด Padding แนวตั้งลงเหลือ `0.12em 0.45em` (ความหนาแนวตั้งเพียง ~2.4px และแนวนอน ~9px) ทำให้กล่องพื้นหลังดำโปร่งแสงโอบรัดตัวหนังสือพอดี โดยไม่ชนหรือเบียดกับสระบน-ล่างและวรรณยุกต์ภาษาไทย
  - ปรับความโค้งมนของขอบกล่องเป็น `borderRadius: 4px` ให้โค้งเนียนตาตามมาตรฐาน YouTube
- **รองรับการแยกบรรทัดคำบรรยายอิสระ (`VideoPlayer.jsx`):**
  - ปรับปรุงคอมโพเนนต์แสดงคำบรรยายให้รองรับข้อความที่มีการขึ้นบรรทัดใหม่ (`\n`) โดยแยกแต่ละบรรทัดลงใน `<span>` อิสระภายใต้โครงสร้าง `flex flex-col items-center gap-1.5` ทำให้แต่ละบรรทัดมีกล่องพื้นหลังของตัวเองและมีช่องว่างคั่น 6px อย่างเป็นระเบียบ สวยงาม และไม่มีทางซ้อนทับกัน
- **ปรับระดับความสูงของคำบรรยายไม่ให้ลอยบังใบหน้า/กึ่งกลางจอ (`VideoPlayer.jsx`):**
  - ปรับตำแหน่งแนวตั้งของคำบรรยายขณะที่แถบควบคุมแสดงอยู่ จากเดิมที่ถูกดันขึ้นสูงผิดปกติถึง `bottom-20` (80px ซึ่งลอยขึ้นไปถึงกลางตัว/ใบหน้าตัวละครในวิดีโอ) ให้ลดลงมาอยู่ที่ `bottom-13 sm:bottom-14` (52–56px) ซึ่งลอยอยู่เหนือเส้นแถบเวลาสีส้มและปุ่มควบคุมเพียง 4–8px พอดี ไม่บดบังตัวละครในคลิป
  - เมื่อแถบควบคุมซ่อนตัวขณะกำลังเล่น จะเลื่อนระดับลงมาอย่างนุ่มนวลอยู่ที่ `bottom-3 sm:bottom-4` (12–16px) ชิดขอบล่างของหน้าจอ
- **แก้ไขปัญหาชื่อคลิปวิดีโอเลื่อนทะลุขึ้นมาซ้อนใต้แถบควบคุม (Sticky Header Bleed-Through Fix):**
  - แก้ไขคลาสของ `playerWrapperRef` ใน `WatchClient.jsx` โดยลบ `md:bg-transparent` ออก และกำหนดให้พื้นหลังเป็นสีดำทึบ `bg-black` ตลอดเวลาที่อยู่ในโหมด Sticky (`< lg`) ป้องกันไม่ให้ชื่อคลิปหรือข้อมูลด้านล่างเลื่อนทะลุผ่านขึ้นมาซ้อนหลังแถบควบคุม
  - กำหนดพื้นหลังของ Video Player Canvas ใน `VideoPlayer.jsx` ให้เป็นสีดำทึบ `bg-black` เพื่อป้องกันแสงหรือข้อความด้านหลังลอดเข้ามา
  - เพิ่มความทึบของแถบไล่เฉดสีดำด้านล่าง (`PlayerBottomBar.jsx`) เป็น `from-black/85 via-black/40` เพื่อให้ปุ่มควบคุมและแถบเลื่อนเวลาคมชัดโดดเด่น อ่านง่าย และป้องกันภาพพื้นหลังรบกวน 100%

### 7. แก้ไขข้อผิดพลาดการดึงข้อมูลเรตติ้ง 18+ และแคชของ Feed (18+ Content Rating & Realtime Cache Synchronization)
- **บังคับส่งข้อมูล `content_rating` บนทุก API ฟีด (`/api/videos` & `/api/history`):**
  - แก้ไขปัญหาฝั่งไคลเอนต์ไม่ได้รับฟิลด์ `content_rating` ทำให้ฟังก์ชัน `isMatureVideo` ตีความเป็น `false` เสมอ และไม่ทำการเบลอภาพปกแม้จะสั่งปิดการแสดงผลภาพ 18+ ในหน้าตั้งค่าแล้วก็ตาม
  - เพิ่ม `v.content_rating` ลงใน SQL Query ของ `/api/history` ทั้งโหมดค้นหาและโหมดปกติ เพื่อให้ภาพปกในหน้าประวัติการรับชมเบลอตามการตั้งค่าความปลอดภัยอย่างถูกต้อง
  - กำหนด Header `Cache-Control: no-cache, no-store, max-age=0, must-revalidate` ให้กับ `/api/videos` ป้องกันเบราว์เซอร์นำผลลัพธ์เก่าที่ไม่มีเรตติ้งมาแสดง
  - เพิ่มตัวเลือก `{ cache: 'no-store' }` ให้กับการเรียก `fetch('/api/videos')` ใน `src/app/page.jsx` และ `src/app/results/ResultsClient.jsx` เพื่อให้หน้าแรกและหน้าผลการค้นหาได้รับข้อมูลเรตติ้งล่าสุดจากเซิร์ฟเวอร์แบบเรียลไทม์เสมอ ไม่ค้างแคชในเบราว์เซอร์

---

## เวอร์ชัน 1.2.2 (Build 1.2.2.20261109 — 9 พฤศจิกายน 2026) — Fast Cold-Start Playback, 3-Workflow GitHub Actions Studio, YouTube-Style Subtitle (CC) Settings & Uniform HLS Audio

แพตช์อัปเดตยกระดับความเร็วในการเปิดดูวิดีโอครั้งแรก (Cold-Start), แยกสถาปัตยกรรม GitHub Actions ออกเป็น 3 ระบบอิสระ, ระบบตั้งค่าคำบรรยาย (Subtitle / CC Settings) แบบ YouTube ครบวงจรพร้อมบันทึกผูกกับบัญชีผู้ใช้ในตาราง `users`, อัปโหลดขึ้น OneDrive ทันทีเมื่อเลือกไฟล์พร้อมปุ่มยกเลิก และล็อกคุณภาพเสียง HLS ให้เท่ากันทุกความละเอียด

### ระบบคำบรรยาย (CC) & หน้าตั้งค่ารูปแบบซับไตเติลแบบ YouTube ครบวงจร
- **Direct Database Subtitle Engine (`parseSubtitleCues`):** รองรับการอ่านและแปลงซับไตเติลทั้งรูปแบบ `.srt` และ `.vtt` จากฐานข้อมูล (`subtitle_srt` / `subtitle_vtt`) โดยตรง รวมถึงกรณีที่ข้อความในฐานข้อมูลถูกยุบรวมเป็นบรรทัดเดียว (Single-line collapsed timestamps) พร้อมแสดงผลซิงค์ตามเวลาวิดีโอจริงและคีย์ลัดปุ่ม `C`
- **ปุ่มไอคอน CC มาตรฐาน YouTube 2 สถานะ (`CcSubtitleIcon.jsx`):** แสดงไอคอนกรอบสี่เหลี่ยมโปร่งเส้นประ 2 บรรทัดเมื่อปิดซับไตเติล และเปลี่ยนเป็นไอคอนสี่เหลี่ยมทึบสีขาวเจาะร่องเส้นประ (`fillRule="evenodd"`) พร้อมแถบขีดสีส้มด้านล่างเมื่อเปิดใช้งานคำบรรยาย
- **เมนูตั้งค่าคำบรรยายและหน้า `< ตัวเลือก` ปรับแต่งซับไตเติลครบ 9 หมวด (`PlayerSettingsModal.jsx`):**
  - **ชุดแบบอักษร (Font Family):** เพิ่มฟอนต์ระบบ **`Graphik Thai Loop (ฟอนต์ระบบ)`** เป็นค่าเริ่มต้น พร้อมตัวเลือกมาตรฐาน YouTube ครบชุด (`Sans-Serif แบบความกว้างคงที่`, `Sans-Serif แบบปรับไปตามเนื้อที่ที่มี`, `Serif แบบความกว้างคงที่`, `Serif แบบปรับไปตามเนื้อที่ที่มี`, `ตัวเขียนแบบเป็นกันเอง`, `ตัวเขียนติดกัน`, `ตัวพิมพ์เล็กขนาดเท่ากัน`)
  - **สีแบบอักษร, สีพื้นหลัง และสีหน้าต่าง:** เลือกปรับได้ 8 เฉดสี (สีขาว, สีเหลือง, สีเขียว, สีฟ้า, สีน้ำเงิน, สีม่วงแดง, สีแดง, สีดำ)
  - **ขนาดตัวอักษร & ความสูงกรอบพื้นหลัง:** ปรับขนาดได้ตั้งแต่ `50%`, `75%`, `100%`, `150%`, `200%`, `300%` ถึง `400%` พร้อมปรับความสูง (`padding: 0.32em 0.55em`, `lineHeight: 1.75`) ให้รองรับสระและวรรณยุกต์ภาษาไทยได้สวยงามไม่ชิดขอบ
  - **ความทึบแสง & รูปแบบขอบตัวอักษร:** ปรับความทึบแสงของพื้นหลัง หน้าต่าง และตัวอักษร (`0%` – `100%`) รวมถึงรูปแบบขอบตัวอักษร (`ไม่มี`, `เงาตกกระทบ`, `นูน`, `บุ๋ม`, `ขอบเส้น`) และปุ่ม `รีเซ็ต` คืนค่าเริ่มต้นพร้อมแสดงผลตัวอย่างแบบ Live Preview ทันทีขณะปรับแต่ง
- **บันทึกการตั้งค่าซับไตเติลรายบุคคลลงตาราง `users` (`/api/user/subtitle-settings`):** เพิ่มคอลัมน์ `subtitle_settings (JSONB)` ในตาราง `users` บนฐานข้อมูล Neon DB เพื่อจดจำรูปแบบฟอนต์ สี ขนาด และสถานะเปิด/ปิดซับไตเติลแยกตามบัญชีผู้ใช้งานแต่ละคนอย่างถาวร

### การเร่งความเร็วการเปิดดูวิดีโอ (Fast Cold-Start & Zero-Roundtrip HLS)
- **แก้ไขพารามิเตอร์ Microsoft Graph API (`select` vs `$select`):** แก้ไขบั๊กใน `src/lib/videoSourceService.js` จากการใช้ `&$select=name,@microsoft.graph.downloadUrl` (ซึ่งทำให้ Graph API ตัด `@microsoft.graph.downloadUrl` ทิ้งและต้องดึงข้อมูลซ้ำใหม่ทั้งหมด) เป็น `&select=id,name,@microsoft.graph.downloadUrl` ลดเวลาโหลดโฟลเดอร์ OneDrive ครั้งแรกจาก **15.7 วินาที (3.55 MB)** เหลือเพียง **~2.2 วินาที (1.2 MB)**
- **Server-Side `.m3u8` Content Preloading:** ดึงและแคชเนื้อหาไฟล์ `.m3u8` ทุกความละเอียดพร้อมกันตั้งแต่ฝั่งเซิร์ฟเวอร์ (`item.content`) และส่งต่อให้เบราว์เซอร์สร้าง Blob URL ได้ทันที (0ms) โดยไม่ต้องยิง HTTP Request เพิ่มไปยัง OneDrive อีก 6–8 รอบ
- **ลดขนาด JSON Payload ของ `/api/videos/[id]/source` ลง 50%:** ตัดฟิลด์ `source_cache` ซ้ำซ้อนออกจาก `resultData.video` ลดขนาดข้อมูลจาก 2.36 MB เหลือ 1.26 MB
- **SSR + Hover + Feed Pre-warming:** เพิ่มระบบเตรียมแคชล่วงหน้าทั้งตอนโหลดหน้าฟีด (`after()`), ตอนชี้เมาส์หรือแตะการ์ดวิดีโอ (`onMouseEnter` / `onTouchStart`), และระหว่างเรนเดอร์หน้า Watch บนเซิร์ฟเวอร์ ทำให้การเปิดดูวิดีโอตอบสนองในระดับ **23–58 มิลลิวินาที**

### สถาปัตยกรรม 3 GitHub Actions แยกอิสระ & ระบบ AI ผ่าน `.env`
- **Action ตัวที่ 1 — ถอดไฟล์เสียง & สร้างซับไตเติลด้วย AI (`extract-audio-subtitles.yml`):** ดึงวิดีโอจาก OneDrive มาสกัดแทร็กเสียงด้วย FFmpeg แล้วส่งให้โมเดล Gemini AI ถอดเสียงเป็นไฟล์ `.srt` และ `.vtt` อัปโหลดเก็บเข้า OneDrive และบันทึกลงฐานข้อมูล Neon DB
- **Action ตัวที่ 2 — Detailed Sprite Sheet Grid (5x5 • 25 เฟรม) & AI ตรวจเรตเนื้อหา (`sprite-content-rating.yml`):** สร้างตารางภาพ Sprite Sheet 25 เฟรมความละเอียดสูงพร้อม Timestamp ครอบคลุมทั้งวิดีโอ ส่งให้ Gemini Vision AI ประเมินความปลอดภัยและตรวจสอบเปรียบเทียบกับเรตเนื้อหาที่ผู้ใช้เลือก (`VERIFIED_MATCH` / `MISMATCH_WARNING`) หรือให้ AI เลือกเรตเนื้อหาให้อัตโนมัติ (`AI AUTO`)
- **Action ตัวที่ 3 — หั่น HLS Multi-bitrate คุณภาพเสียงเดียวกันทุกความชัด (`transcode.yml`):** ปรับการเข้ารหัสเสียงของทุกความละเอียด (`144p` ถึง `4K`) ให้ใช้สเปกเสียงเดียวกันทั้งหมดคือ **AAC 192kbps, 48kHz, Stereo (`-c:a aac -b:a 192k -ar 48000 -ac 2`)** แปลงเฉพาะความละเอียดภาพ เพื่อป้องกันปัญหาเสียงดรอปหรือสะดุดเมื่อสลับความชัดระหว่างรับชม
- **ตั้งค่า AI Key และชื่อรุ่นโมเดลผ่าน `.env` (`GEMINI_API_KEY` & `GEMINI_MODEL_NAME`):** รองรับการกำหนดคีย์และรุ่นโมเดล AI (เช่น `GEMINI_MODEL_NAME=gemini-3.5-flesh-lite`) จากไฟล์ `.env` โดยตรง ไม่ต้องกรอก API Key ในหน้าเว็บ

### ระบบอัปโหลดขึ้น OneDrive ทันทีเมื่อเลือกไฟล์ & ปุ่มยกเลิกการอัปโหลด
- **Immediate OneDrive Background Upload:** ทันทีที่เลือกไฟล์วิดีโอในหน้า `/upload` ระบบจะเริ่มอัปโหลดไฟล์ต้นฉบับขึ้น OneDrive (`/raw/`) ทันทีโดยอัตโนมัติ เพื่อให้ GitHub Actions สามารถดึงไฟล์ไปประมวลผลได้ทันที
- **ปุ่มยกเลิกการอัปโหลดและลบไฟล์จาก OneDrive (`handleCancelUpload`):** เพิ่มปุ่มยกเลิกการอัปโหลดที่สามารถหยุดการส่งไฟล์ (`XHR abort`), ยกเลิก Upload Session ของ Microsoft Graph และลบไฟล์ต้นฉบับรวมถึงข้อมูลออกจาก OneDrive และฐานข้อมูลได้ทันทีหากเลือกไฟล์ผิด

---

## เวอร์ชัน 1.2.1 (Build 1.2.1.20261022 — 22 ตุลาคม 2026) — Open Graph, Social Preview & Documentation

แพตช์อัปเดตปรับปรุงการแชร์ลิงก์โซเชียลมีเดีย ระบบศูนย์เอกสาร และการแสดงผลข้อมูลสถานะระบบ

### การแก้ไขระบบ Open Graph & Social Preview Cards
- **แก้ไข Proxy Crawler Bypass:** ปรับปรุง `src/proxy.js` ไม่ให้ Redirect Web Crawlers และ Social Bots (Facebook, Twitterbot, Discordbot, Googlebot ฯลฯ) ไปหน้า `/login` เมื่อเข้าถึงเส้นทาง `/watch/...`, `/images/...` และ `/api/og/...`
- **Dynamic Video Metadata & Image Optimization:** ปรับปรุง `generateMetadata` ในหน้า Watch ตัดความยาว Title ไม่เกิน 58 ตัวอักษรตามมาตรฐาน Google SERP และ Social Cards, บีบอัด `description` ให้กระชับ, และระบุ Canonical URL ชัดเจน
- **Dedicated 1200x630 OG Image Endpoint (/api/og/[id]):** พัฒนาระบบตัดย่อและปรับขนาดภาพโปสเตอร์เป็น 1200x630px JPEG ขนาด ~35 KB ผ่าน Sharp และ In-Memory Cache ความเร็วสูง แก้ไขปัญหารูปขนาด 4K และปัญหา WhatsApp บล็อกภาพขนาดเกิน 500 KB
- **Twitter Site & Creator Tags:** ระบุ `twitter:site` และ `twitter:creator` (`@tubelock`) ครบถ้วนตามมาตรฐาน Twitter Cards
- **ลดขนาด HTML Payload หน้ารับชม:** ปรับแต่ง Query รายการวิดีโอที่เกี่ยวข้องไม่ดึงฟิลด์ Description ขนาดใหญ่ และตัดการแนบ Data URI ในเซิร์ฟเวอร์เรนเดอร์ ช่วยลดขนาด HTML จาก ~408 KB เหลือต่ำกว่า 150 KB เพิ่มความเร็วในการประมวลผลบนมือถือและการดาวน์โหลดของบ็อตค้นหา

### ระบบศูนย์เอกสารไดนามิก & หน้ารวมประวัติการอัปเดต (/tubelock/*)
- **เพิ่มหน้าบันทึกการอัปเดต (Patch Notes):** เพิ่มหน้าเอกสารประวัติเวอร์ชันและการปรับปรุงระบบที่ `/tubelock/patchnote`
- **เพิ่มการแสดงผลเวลาอัปเดต (Updated at):** แสดงข้อมูล "อัปเดตเมื่อ: [วันที่]" ทั้งบริเวณ Breadcrumb ส่วนบน และส่วนท้ายของหน้าเอกสารถัดจาก `Source: docs/*.md`
- **ปรับแต่งไอคอนและสไตล์เอกสาร:** ลบอิโมจิและตกแต่งสไตล์ Release Notes ให้สะอาดตา เรียบง่าย เป็นทางการตามมาตรฐานวิศวกรรมซอฟต์แวร์

### การซิงค์เลขเวอร์ชันทั้งระบบ (Single Source of Truth)
- **รวมศูนย์เลขเวอร์ชัน:** สร้าง `src/lib/version.js` ซิงค์เลขเวอร์ชัน `v1.2.1.20261022` ตรงกันทุกจุด ทั้ง Sidebar หลัก, Mobile Drawer, หน้าการตั้งค่า และหน้า 404

---

## เวอร์ชัน 1.2.0 (ตุลาคม 2026) — YouTube-Style Live Search & Seek Feedback

การอัปเดตเพิ่มประสิทธิภาพระบบค้นหาและฟีดแบ็กการควบคุมเครื่องเล่น

### ระบบค้นหาอัจฉริยะ YouTube-Style Live Search
- **Instant Search Dropdown:** ค้นหาวิดีโอแบบเรียลไทม์ แสดงคำแนะนำและหมวดหมู่ทันทีขณะพิมพ์
- **Account Search History:** บันทึกประวัติการค้นหาผูกกับบัญชีผู้ใช้ สามารถลบรายการค้นหาทีละรายการหรือล้างทั้งหมดได้
- **Dedicated Results Page (/results):** หน้ารวมผลการค้นหาพร้อมตัวกรองหมวดหมู่และโครงร่าง Skeleton Loading ระหว่างรอโหลดข้อมูล

### เอฟเฟกต์คลื่นเสียง Seek Wave Feedback
- **Player Seek Feedback:** เพิ่มเอฟเฟกต์แอนิเมชันลูกคลื่น Visual Waveform เมื่อผู้ใช้งานกดปุ่มข้ามเวลา (เดินหน้า/ถอยหลัง 10 วินาที) ตอบสนองต่อการควบคุมได้ชัดเจนยิ่งขึ้น

---

## เวอร์ชัน 1.1.0 (ตุลาคม 2026) — Player Experience & Video Routing

ยกระดับประสิทธิภาพของเครื่องเล่นวิดีโอ การทำงานแบบไร้รอยต่อ และความปลอดภัยของ URL

### YouTube-Style 3-Card End Screen
- **แผงแนะนำท้ายคลิป:** แสดงการ์ดแนะนำวิดีโอที่เกี่ยวข้อง 3 รายการในช่วงท้ายของคลิป
- **Dynamic Ambient Glow:** ขอบการ์ดจะเรืองแสงตามเฉดสีหลักของภาพโปสเตอร์วิดีโอเมื่อนำเมาส์ไปชี้ (Hover)

### Continuous Fullscreen Mode
- **รักษาสถานะเต็มจอต่อเนื่อง:** เมื่อเปิดวิดีโอโหมดเต็มจอ (Fullscreen) แล้วกดเปลี่ยนไปดูวิดีโอถัดไป วิดีโอใหม่จะเล่นในโหมดเต็มจอต่อเนื่องทันที ไม่หลุดกลับเป็นหน้าต่างปกติ

### Instant Poster Backdrop & Auto-Replay
- **ปุ่มเล่นซ้ำกลางจอ (Replay):** ปรับปรุงปุ่มกลางจอให้แสดงไอคอนเล่นซ้ำอย่างชัดเจนเมื่อวิดีโอเล่นจบ
- **Instant Backdrop:** แสดงภาพ Poster ทันทีระหว่างการสลับวิดีโอ เพื่อลดอาการจอดำหรือหน้าจอกระพริบขณะดึงสตรีม HLS

### Cinematic Fade to Black
- **เฟดจอดำช่วงท้าย:** ค่อยๆ ปรับความสว่างของภาพให้มืดลงอย่างนุ่มนวลในช่วง 0.8 วินาทีสุดท้ายก่อนจบคลิป

### ระบบ Slug เข้ารหัส (v_[prefix][hash])
- **Unguessable Video URLs:** เปลี่ยน URL จากเลขอันดับวิดีโอแบบเปิดเผย (`/watch/837`) มาเป็น Slug เข้ารหัสฐาน 62 เช่น `/watch/v_mX1DGCh`
- **หมวดหมู่ในตัว (Category Prefix):** สัญลักษณ์อักษรนำหน้าบอกหมวดหมู่ เช่น `m` สำหรับเพลง, `g` สำหรับเกม, `c` สำหรับภาพยนตร์ และ `s` สำหรับคลิปสั้น
- **Backward Compatibility:** รองรับการเข้าถึงผ่านเลข ID เดิมโดยระบบจะทำการ Redirect มายัง Slug ใหม่อัตโนมัติ

---

## เวอร์ชัน 1.0.0 (ตุลาคม 2026) — Official Base Platform Release

การเปิดตัวอย่างเป็นทางการของแพลตฟอร์ม TubeLock พร้อมสถาปัตยกรรมสตรีมมิ่งไร้โฆษณา

### สถาปัตยกรรมตัวกลาง OneDrive (Storage Intermediary)
- **ไม่เก็บไฟล์คลิปเต็มต้นฉบับ:** ระบบทำหน้าที่เป็นเพียงตัวกลางในการสตรีมชิ้นส่วนไฟล์ (`.m3u8`, `.ts`) โดยไฟล์มาสเตอร์ดั้งเดิมจะอยู่กับเจ้าของผลงาน 100%
- **Signed URLs จำกัดเวลา:** การดึงชิ้นส่วนวิดีโอทำผ่านลิงก์ชั่วคราว ปลอดภัยจากการคัดลอกหรือ Hotlinking ภายนอก

### ฟีเจอร์หลักของเครื่องเล่น TubeLock
- **Client-Side HLS Engine:** ถอดรหัสและสตรีมวิดีโอระดับ Full HD ถึง 4K ได้ลื่นไหลผ่านเบราว์เซอร์
- **Ambient Mode (แสงไฟรอบจอ):** ระบบวิเคราะห์สีของวิดีโอแบบไดนามิก และฉายแสง Ambient เรืองรองรอบเฟรมเครื่องเล่น
- **Storyboard Scrub Preview:** เลื่อนเมาส์บนไทม์ไลน์เพื่อดูตัวอย่างเฟรมภาพวิดีโอล่วงหน้าแบบคมชัด
- **Stats for Nerds (แผงสถิติละเอียด):** ตรวจสอบ Codec (AV1, HEVC, H.264), ความละเอียด, เฟรมเรต, สัญญาณภาพ, และสถานะบัฟเฟอร์แบบเรียลไทม์

### การจัดการบัญชีและความเป็นส่วนตัว
- **OAuth 2.0 Integration:** เข้าสู่ระบบด้วยบัญชี Google หรือ LINE อย่างปลอดภัย
- **Watch History & Resume:** จดจำจุดเวลาที่รับชมค้างไว้ และบันทึกประวัติการรับชมเฉพาะบุคคล
- **Data Privacy Control:** ผู้ใช้สามารถลบประวัติ ล้างข้อมูลส่วนตัว หรือรีเซ็ตบัญชีได้ตลอดเวลาผ่านหน้าการตั้งค่า
