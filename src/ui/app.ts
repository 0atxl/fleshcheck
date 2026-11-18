import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { MAX_TRIES_PER_DAY, PREFETCH_DWELL_MS } from "../config";
import { STALLING_LINES, UI_COPY } from "../copy/global";
import { CaseFileStore } from "../game/case-file";
import { getUtcDayNumber, parseChallengeLink, selectDailyChallenge } from "../game/daily";
import { GameLoop, type LoopVerdict } from "../game/loop";
import { ACTIVE_CHALLENGES } from "../game/registry";
import { formatShareLine, formatTrySquare } from "../game/scoring";
import type { ChallengeManifest, TryRecord } from "../game/types";
import { initCopyHandlers } from "../lib/copy";
import { canvasToPngBlob, downloadBlob } from "../lib/export-png";
import { ComplianceSfx } from "../lib/sfx";
import { renderEvidenceCard } from "../output/evidence-card";
import { buildChallengeLink, buildXIntentUrl } from "../output/share";
import { requestCamera, stopCamera } from "../vision/camera";
import { createFaceLandmarker, prefetchFaceAssets } from "../vision/loader";
import { FaceTracker } from "../vision/tracker";
import { mountDevSwitcher } from "./dev-switcher";
import { hidePanel, showPanel } from "./transitions";

export function bootApp(): void {
  initCopyHandlers();

  const sfx = new ComplianceSfx();
  const store = new CaseFileStore();
  const todayDay = getUtcDayNumber();
  const linkInfo = parseChallengeLink(window.location.search, todayDay);
  const activeDay = linkInfo.dayOverride ?? todayDay;
  const isReplay = linkInfo.dayOverride !== null && linkInfo.dayOverride < todayDay;
  const dailyPick = selectDailyChallenge(activeDay, ACTIVE_CHALLENGES);
  let manifest: ChallengeManifest = dailyPick.challenge;
  let seed = dailyPick.seed;
  let isDevSandbox = false;

  if (import.meta.env.DEV) {
    const devParam = new URLSearchParams(window.location.search).get("challenge");
    const matched = devParam ? ACTIVE_CHALLENGES.find((c) => c.id === devParam) : undefined;
    if (matched) {
      manifest = matched;
      isDevSandbox = true;
    }
  }

  // DOM references
  const headerCode = mustGet<HTMLElement>("header-case-code");
  const deptKicker = mustGet<HTMLElement>("department-kicker");
  const mainHeading = mustGet<HTMLElement>("main-heading");
  const promptEl = mustGet<HTMLElement>("challenge-prompt");
  const challengeBanner = mustGet<HTMLElement>("challenge-banner");
  const replayBanner = mustGet<HTMLElement>("replay-banner");
  const privacyNotice = mustGet<HTMLElement>("privacy-notice");
  const checkbox = mustGet<HTMLInputElement>("verify-human");
  const captchaWidget = mustGet<HTMLElement>("captcha-widget");
  const metaTries = mustGet<HTMLElement>("meta-tries");
  const metaStreak = mustGet<HTMLElement>("meta-streak");

  const panelIntro = mustGet<HTMLElement>("panel-intro");
  const panelLoading = mustGet<HTMLElement>("panel-loading");
  const panelStage = mustGet<HTMLElement>("panel-stage");
  const panelNoFlesh = mustGet<HTMLElement>("panel-noflesh");
  const panelVerdict = mustGet<HTMLElement>("panel-verdict");

  const loadingStatus = mustGet<HTMLElement>("loading-status");
  const stageCanvas = mustGet<HTMLCanvasElement>("stage-canvas");
  const stageStatusNote = mustGet<HTMLElement>("stage-status-note");
  const abortBtn = mustGet<HTMLButtonElement>("abort-round");

  const noFleshTitle = mustGet<HTMLElement>("noflesh-title");
  const noFleshBody = mustGet<HTMLElement>("noflesh-body");
  const webviewNote = mustGet<HTMLElement>("webview-note");
  const retryCameraBtn = mustGet<HTMLButtonElement>("retry-camera");

  const evidenceCanvas = mustGet<HTMLCanvasElement>("evidence-canvas");
  const shareTextEl = mustGet<HTMLElement>("share-text-value");
  const challengeLinkInput = mustGet<HTMLInputElement>("challenge-link-value");
  const downloadPngBtn = mustGet<HTMLButtonElement>("download-png");
  const postXLink = mustGet<HTMLAnchorElement>("post-x-link");
  const retryTryBtn = mustGet<HTMLButtonElement>("retry-try");

  const openCaseBtn = mustGet<HTMLButtonElement>("open-case-file");
  const closeCaseBtn = mustGet<HTMLButtonElement>("close-case-file");
  const caseDialog = mustGet<HTMLDialogElement>("case-file-dialog");
  const caseStats = mustGet<HTMLElement>("case-file-stats");
  const caseGrid = mustGet<HTMLElement>("case-folder-grid");
  const muteToggle = mustGet<HTMLButtonElement>("mute-toggle");

  // Initial static copy population (safe textContent only)
  const dayStr = String(activeDay).padStart(2, "0");
  function syncHeaderCopy(): void {
    headerCode.textContent = `CASE #${dayStr} · ${UI_COPY.formCode}`;
    deptKicker.textContent = `${UI_COPY.agency.toUpperCase()} · ${manifest.department.toUpperCase()}`;
    mainHeading.textContent = manifest.title;
    promptEl.textContent = manifest.prompt;
  }

  syncHeaderCopy();
  privacyNotice.textContent = UI_COPY.privacyNotice;
  noFleshTitle.textContent = UI_COPY.noFleshTitle;
  noFleshBody.textContent = UI_COPY.noFleshBody;
  webviewNote.textContent = UI_COPY.webViewHint;

  if (linkInfo.vsPct !== null) {
    challengeBanner.textContent = UI_COPY.colleagueBanner(linkInfo.vsPct);
    challengeBanner.hidden = false;
  }
  if (isReplay) {
    replayBanner.textContent = `Archive replay: Case #${dayStr}. Daily try limits are suspended.`;
    replayBanner.hidden = false;
  }

  // Runtime state
  let sandboxTries: TryRecord[] = [];
  let bestVerdict: Omit<LoopVerdict, "snapshot"> | null = null;
  let bestSnapshotCanvas: HTMLCanvasElement | null = null;
  let landmarkerPromise: Promise<FaceLandmarker> | null = null;
  let activeLoop: GameLoop | null = null;
  let activeStream: MediaStream | null = null;
  let activeVideo: HTMLVideoElement | null = null;
  let stallTimer = 0;

  const panels = [panelIntro, panelLoading, panelStage, panelNoFlesh, panelVerdict];

  async function switchPanel(target: HTMLElement): Promise<void> {
    await Promise.all(panels.filter((p) => p !== target).map((p) => hidePanel(p)));
    showPanel(target);
  }

  function updateMuteUi(): void {
    const muted = sfx.isMuted();
    muteToggle.setAttribute("aria-pressed", String(muted));
    muteToggle.textContent = muted ? "Audio: Off" : "Audio: On";
  }

  function currentTries(): TryRecord[] {
    return isReplay || isDevSandbox ? sandboxTries : store.getTodayTries(activeDay);
  }

  function updateIntroMeta(): void {
    const tries = currentTries();
    const squares = tries.map(formatTrySquare).join("");
    metaTries.textContent = isDevSandbox
      ? `Dev sandbox tries: ${squares || "None yet"}`
      : isReplay
        ? `Replay tries: ${squares || "None yet"}`
        : `Today's tries: ${tries.length}/${MAX_TRIES_PER_DAY}${squares ? ` (${squares})` : ""}`;
    metaStreak.textContent = `Streak: ${store.getData().streak}`;
  }

  function renderCaseFile(): void {
    const data = store.getData();
    const totalTries = store.getTotalTries();
    caseStats.textContent = `Streak: ${data.streak} · Total inspections: ${totalTries}`;

    caseGrid.replaceChildren();
    for (const item of ACTIVE_CHALLENGES) {
      const status = store.getDepartmentStatus(item.id);
      const li = document.createElement("li");
      li.className = "folder-card";

      const dept = document.createElement("span");
      dept.className = "folder-dept";
      dept.textContent = item.department;

      const title = document.createElement("span");
      title.className = "folder-title";
      title.textContent = item.title;

      const stamp = document.createElement("span");
      stamp.className = "folder-stamp";
      stamp.setAttribute("data-verdict", status.verdict);
      stamp.textContent = status.verdict;

      const meta = document.createElement("span");
      meta.className = "folder-meta";
      meta.textContent =
        status.tries === 0
          ? UI_COPY.caseFileEmpty
          : `Tries: ${status.tries} · Best: ${status.bestPct}%`;

      li.append(dept, title, stamp, meta);
      caseGrid.append(li);
    }
  }

  function getLandmarker(): Promise<FaceLandmarker> {
    if (!landmarkerPromise) {
      landmarkerPromise = createFaceLandmarker().catch((err) => {
        landmarkerPromise = null;
        throw err;
      });
    }
    return landmarkerPromise;
  }

  function cleanupSession(): void {
    if (stallTimer) {
      window.clearInterval(stallTimer);
      stallTimer = 0;
    }
    if (activeLoop) {
      activeLoop.stop();
      activeLoop.releaseSnapshot();
      activeLoop = null;
    }
    stopCamera(activeStream, activeVideo);
    activeStream = null;
    activeVideo = null;
  }

  function startStallTicker(): void {
    let idx = 0;
    loadingStatus.textContent = STALLING_LINES[0] ?? "Preparing booth.";
    if (stallTimer) window.clearInterval(stallTimer);
    stallTimer = window.setInterval(() => {
      idx = (idx + 1) % STALLING_LINES.length;
      loadingStatus.textContent = STALLING_LINES[idx] ?? "Preparing booth.";
    }, 1100);
  }

  function sizeStageCanvas(): void {
    const portrait = window.innerWidth <= 560;
    stageCanvas.width = portrait ? 480 : 640;
    stageCanvas.height = portrait ? 640 : 480;
  }

  async function startInspection(): Promise<void> {
    sfx.unlock();
    sfx.playTick();
    checkbox.disabled = true;

    await switchPanel(panelLoading);
    startStallTicker();

    const videoEl = document.createElement("video");
    // Fire getUserMedia and model/WASM initialization simultaneously
    const [camRes, landmarkerResult] = await Promise.allSettled([
      requestCamera(videoEl),
      getLandmarker(),
    ]);

    if (stallTimer) {
      window.clearInterval(stallTimer);
      stallTimer = 0;
    }

    if (camRes.status === "rejected" || !camRes.value.ok) {
      cleanupSession();
      const errInfo = camRes.status === "fulfilled" && !camRes.value.ok ? camRes.value : null;
      webviewNote.hidden = !(errInfo && (errInfo.inAppWebView || errInfo.reason === "webview-blocked"));
      checkbox.checked = false;
      checkbox.disabled = false;
      await switchPanel(panelNoFlesh);
      return;
    }

    if (landmarkerResult.status === "rejected") {
      stopCamera(camRes.value.stream, camRes.value.video);
      checkbox.checked = false;
      checkbox.disabled = false;
      await switchPanel(panelNoFlesh);
      return;
    }

    activeStream = camRes.value.stream;
    activeVideo = camRes.value.video;
    sizeStageCanvas();

    const tracker = new FaceTracker(landmarkerResult.value);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    await switchPanel(panelStage);
    stageStatusNote.textContent = "Hold neutral during calibration.";
    sfx.playCalibrateHum();

    activeLoop = new GameLoop(
      stageCanvas,
      activeVideo,
      tracker,
      manifest,
      seed,
      {
        onPhaseChange(phase) {
          if (phase === "ACTIVE") {
            stageStatusNote.textContent = manifest.prompt;
          } else if (phase === "PAUSED") {
            stageStatusNote.textContent = "Subject lost. Return to frame.";
          }
        },
        onVerdict(verdict) {
          handleVerdict(verdict);
        },
        playAlertBeep: () => sfx.playAlertBeep(),
        playStampThud: () => sfx.playStampThud(),
        playPassChime: () => sfx.playPassChime(),
      },
      reducedMotion,
    );
    activeLoop.start();
  }

  function handleVerdict(verdict: LoopVerdict): void {
    const record: TryRecord = {
      passed: verdict.passed,
      pct: verdict.pct,
      paused: verdict.paused,
    };

    if (isReplay || isDevSandbox) {
      sandboxTries = [...sandboxTries, record];
    } else {
      store.recordVerdict(manifest.id, activeDay, record, false);
    }

    const shouldReplaceBest =
      !bestVerdict ||
      verdict.pct > bestVerdict.pct ||
      (verdict.pct === bestVerdict.pct && verdict.passed && !bestVerdict.passed);

    if (shouldReplaceBest) {
      bestVerdict = {
        passed: verdict.passed,
        pct: verdict.pct,
        paused: verdict.paused,
        callout: verdict.callout,
        elapsedMs: verdict.elapsedMs,
        durationMs: verdict.durationMs,
        landmarks: verdict.landmarks,
      };
      if (!bestSnapshotCanvas) {
        bestSnapshotCanvas = document.createElement("canvas");
      }
      bestSnapshotCanvas.width = verdict.snapshot.width;
      bestSnapshotCanvas.height = verdict.snapshot.height;
      bestSnapshotCanvas.getContext("2d")?.drawImage(verdict.snapshot, 0, 0);
    }

    cleanupSession();
    checkbox.checked = false;
    checkbox.disabled = false;

    showVerdictPanel();
  }

  function showVerdictPanel(): void {
    const tries = currentTries();
    const bestStored = isReplay || isDevSandbox ? bestVerdict : store.getBestTodayTry(activeDay);
    const bestPct = bestVerdict?.pct ?? bestStored?.pct ?? 0;
    const bestPassed = bestVerdict?.passed ?? bestStored?.passed ?? false;
    const callout =
      bestVerdict?.callout ?? (bestPassed ? "COMPLIANCE VERIFIED" : "SESSION RECORD ARCHIVED");

    renderEvidenceCard(evidenceCanvas, {
      dayNumber: activeDay,
      title: manifest.title,
      department: manifest.department,
      pct: bestPct,
      passed: bestPassed,
      callout,
      tries,
      elapsedMs: bestVerdict?.elapsedMs ?? (bestPassed ? manifest.durationMs : Math.round((bestPct / 100) * manifest.durationMs)),
      durationMs: manifest.durationMs,
      seed,
      isReplay,
      snapshot: bestSnapshotCanvas,
    });

    const shareText = formatShareLine({
      dayNumber: activeDay,
      title: manifest.title,
      tries,
      bestPct,
      isReplay,
    });

    shareTextEl.textContent = shareText;
    postXLink.href = buildXIntentUrl(shareText);
    challengeLinkInput.value = buildChallengeLink(activeDay, bestPct);

    const canRetry =
      isReplay || isDevSandbox || (!store.isTodayFinished(activeDay) && tries.length < MAX_TRIES_PER_DAY);
    retryTryBtn.hidden = !canRetry;

    updateIntroMeta();
    void switchPanel(panelVerdict);
  }

  // Prefetch triggers: mouseenter / focus / pointerdown + 3s dwell fallback
  const triggerPrefetch = () => prefetchFaceAssets();
  captchaWidget.addEventListener("mouseenter", triggerPrefetch, { once: true });
  captchaWidget.addEventListener("pointerdown", triggerPrefetch, { once: true });
  checkbox.addEventListener("focus", triggerPrefetch, { once: true });
  window.setTimeout(triggerPrefetch, PREFETCH_DWELL_MS);

  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      void startInspection();
    }
  });

  abortBtn.addEventListener("click", () => {
    cleanupSession();
    checkbox.checked = false;
    checkbox.disabled = false;
    updateIntroMeta();
    void switchPanel(panelIntro);
  });

  retryCameraBtn.addEventListener("click", () => {
    void startInspection();
  });

  retryTryBtn.addEventListener("click", () => {
    void startInspection();
  });

  downloadPngBtn.addEventListener("click", async () => {
    try {
      const blob = await canvasToPngBlob(evidenceCanvas);
      downloadBlob(blob, `fleshcheck-${dayStr}.png`);
    } catch {
      // Ignore blob errors on constrained browsers
    }
  });

  muteToggle.addEventListener("click", () => {
    sfx.setMuted(!sfx.isMuted());
    updateMuteUi();
    if (!sfx.isMuted()) {
      sfx.unlock();
      sfx.playTick();
    }
  });

  openCaseBtn.addEventListener("click", () => {
    renderCaseFile();
    caseDialog.showModal();
  });

  closeCaseBtn.addEventListener("click", () => {
    caseDialog.close();
  });

  caseDialog.addEventListener("click", (event) => {
    if (event.target === caseDialog) {
      caseDialog.close();
    }
  });

  window.addEventListener("pagehide", () => {
    cleanupSession();
  });

  updateMuteUi();
  updateIntroMeta();

  if (import.meta.env.DEV) {
    const switcher = mountDevSwitcher(ACTIVE_CHALLENGES, manifest.id, (nextManifest) => {
      cleanupSession();
      checkbox.checked = false;
      checkbox.disabled = false;
      manifest = nextManifest;
      seed = dailyPick.seed ^ nextManifest.id.length;
      isDevSandbox = true;
      sandboxTries = [];
      bestVerdict = null;
      if (bestSnapshotCanvas) {
        bestSnapshotCanvas.width = 0;
        bestSnapshotCanvas.height = 0;
        bestSnapshotCanvas = null;
      }
      switcher.updateActive(nextManifest.id);
      syncHeaderCopy();
      updateIntroMeta();
      const url = new URL(window.location.href);
      url.searchParams.set("challenge", nextManifest.id);
      window.history.replaceState({}, "", url.toString());
      void switchPanel(panelIntro);
    });
  }

  // Returning player who already finished today lands straight on their daily record
  if (!isReplay && !isDevSandbox && store.isTodayFinished(activeDay)) {
    showVerdictPanel();
  }
}

function mustGet<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing required element #${id}`);
  }
  return el as T;
}
