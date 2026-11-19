import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { MAX_TRIES_PER_DAY, PREFETCH_DWELL_MS } from "../config";
import { STALLING_LINES, UI_COPY } from "../copy/global";
import { CaseFileStore } from "../game/case-file";
import {
  formatUtcCountdown,
  getMsUntilNextUtcDay,
  getUtcDayNumber,
  parseChallengeLink,
  selectDailyChallenge,
} from "../game/daily";
import { GameLoop, type LoopVerdict } from "../game/loop";
import { ACTIVE_CHALLENGES, getRosterForDay } from "../game/registry";
import { formatShareLine, formatTrySquare } from "../game/scoring";
import type { ChallengeManifest, TryRecord } from "../game/types";
import { initCopyHandlers } from "../lib/copy";
import { canvasToPngBlob, downloadBlob } from "../lib/export-png";
import { ComplianceSfx } from "../lib/sfx";
import { RoundClipRecorder, type RecordedClip } from "../output/clip";
import { renderEvidenceCard } from "../output/evidence-card";
import {
  buildChallengeLink,
  buildXIntentUrl,
  isNativeShareAvailable,
  shareEvidenceCard,
} from "../output/share";
import { requestCamera, stopCamera } from "../vision/camera";
import { createFaceLandmarker, prefetchFaceAssets } from "../vision/loader";
import { FaceTracker } from "../vision/tracker";
import { mountDevSwitcher } from "./dev-switcher";
import { hidePanel, showPanel } from "./transitions";

const MAX_SANDBOX_DISPLAY_TRIES = 6;

export function bootApp(): void {
  initCopyHandlers();

  const sfx = new ComplianceSfx();
  const store = new CaseFileStore();
  const todayDay = getUtcDayNumber();
  const linkInfo = parseChallengeLink(window.location.search, todayDay);
  const activeDay = linkInfo.dayOverride ?? todayDay;
  const isReplay = linkInfo.dayOverride !== null && linkInfo.dayOverride < todayDay;
  const dailyPick = selectDailyChallenge(activeDay, getRosterForDay(activeDay));
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
  const checkboxLabelEl = mustGet<HTMLElement>("verify-human-label");
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
  const downloadClipBtn = mustGet<HTMLButtonElement>("download-clip");
  const shareNativeBtn = mustGet<HTMLButtonElement>("share-native");
  const postXLink = mustGet<HTMLAnchorElement>("post-x-link");
  const retryTryBtn = mustGet<HTMLButtonElement>("retry-try");
  const nextCaseRow = mustGet<HTMLElement>("next-case-row");
  const nextCaseText = mustGet<HTMLElement>("next-case-text");
  const reloadNextCaseBtn = mustGet<HTMLButtonElement>("reload-next-case");

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
  checkboxLabelEl.textContent = UI_COPY.checkboxLabel;
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
  let sandboxDisplaySquares: TryRecord[] | null = null;
  let bestVerdict: Omit<LoopVerdict, "snapshot"> | null = null;
  let bestSnapshotCanvas: HTMLCanvasElement | null = null;
  let bestClip: RecordedClip | null = null;
  const clipRecorder = new RoundClipRecorder();
  let landmarkerPromise: Promise<FaceLandmarker> | null = null;
  let activeLoop: GameLoop | null = null;
  let activeStream: MediaStream | null = null;
  let activeVideo: HTMLVideoElement | null = null;
  let stallTimer = 0;
  let countdownTimer = 0;
  let sessionToken = 0;
  let panelToken = 0;
  let inspectionStarting = false;
  const nativeShareSupported = isNativeShareAvailable();
  shareNativeBtn.hidden = !nativeShareSupported;

  const panels = [panelIntro, panelLoading, panelStage, panelNoFlesh, panelVerdict];

  async function switchPanel(target: HTMLElement, focusEl?: HTMLElement | null): Promise<void> {
    const myPanelToken = ++panelToken;
    await Promise.all(panels.filter((p) => p !== target).map((p) => hidePanel(p)));
    if (myPanelToken !== panelToken) return;
    showPanel(target);
    if (focusEl && !focusEl.hidden) {
      focusEl.focus({ preventScroll: true });
    }
  }

  function setLaunchControlsDisabled(disabled: boolean): void {
    checkbox.disabled = disabled;
    retryTryBtn.disabled = disabled;
    retryCameraBtn.disabled = disabled;
  }

  function updateMuteUi(): void {
    const muted = sfx.isMuted();
    muteToggle.setAttribute("aria-pressed", String(muted));
    muteToggle.textContent = muted ? "Audio: Off" : "Audio: On";
  }

  function maxTriesForManifest(): number {
    return manifest.maxTries ?? MAX_TRIES_PER_DAY;
  }

  function currentTries(): TryRecord[] {
    return isReplay || isDevSandbox ? sandboxTries : store.getTodayTries(activeDay);
  }

  function currentDisplaySquares(): TryRecord[] {
    if (isReplay || isDevSandbox) {
      return sandboxDisplaySquares ?? sandboxTries.slice(-MAX_SANDBOX_DISPLAY_TRIES);
    }
    return store.getTodayDisplaySquares(activeDay);
  }

  function updateIntroMeta(): void {
    const tries = currentTries();
    const maxTries = maxTriesForManifest();
    const squares = currentDisplaySquares().map(formatTrySquare).join("");
    metaTries.textContent = isDevSandbox
      ? `Dev sandbox tries: ${squares || "None yet"}`
      : isReplay
        ? `Replay tries: ${squares || "None yet"}`
        : maxTries === 1
          ? `Annual audit: 1 attempt${squares ? ` (${squares})` : ""}`
          : `Today's tries: ${tries.length}/${maxTries}${squares ? ` (${squares})` : ""}`;
    metaStreak.textContent = `Streak: ${store.getEffectiveStreak(todayDay)}`;
  }

  function renderCaseFile(): void {
    const streak = store.getEffectiveStreak(todayDay);
    const totalTries = store.getTotalTries();
    caseStats.textContent = `Streak: ${streak} · Total inspections: ${totalTries}`;

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

  function stopCountdownTicker(): void {
    if (countdownTimer) {
      window.clearInterval(countdownTimer);
      countdownTimer = 0;
    }
  }

  function syncCountdownUi(): void {
    const liveDay = getUtcDayNumber();
    if (liveDay > todayDay) {
      stopCountdownTicker();
      nextCaseText.textContent = UI_COPY.newCaseReady(String(liveDay).padStart(2, "0"));
      reloadNextCaseBtn.hidden = false;
      nextCaseRow.hidden = false;
      return;
    }
    const remaining = formatUtcCountdown(getMsUntilNextUtcDay());
    nextCaseText.textContent = UI_COPY.nextCaseCountdown(remaining);
    reloadNextCaseBtn.hidden = true;
    nextCaseRow.hidden = false;
  }

  function startCountdownTicker(): void {
    stopCountdownTicker();
    syncCountdownUi();
    if (getUtcDayNumber() <= todayDay) {
      countdownTimer = window.setInterval(syncCountdownUi, 1_000);
    }
  }

  function cleanupSession(): void {
    sessionToken += 1;
    inspectionStarting = false;
    stopCountdownTicker();
    if (stallTimer) {
      window.clearInterval(stallTimer);
      stallTimer = 0;
    }
    clipRecorder.abort();
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
    // Pin CSS aspect ratio to active backing dimensions so mid-round resize/rotation never stretches video
    stageCanvas.style.aspectRatio = `${stageCanvas.width} / ${stageCanvas.height}`;
  }

  async function showFailurePanel(kind: "camera" | "engine", showWebViewHint: boolean): Promise<void> {
    noFleshTitle.textContent = kind === "camera" ? UI_COPY.noFleshTitle : UI_COPY.engineErrorTitle;
    noFleshBody.textContent = kind === "camera" ? UI_COPY.noFleshBody : UI_COPY.engineErrorBody;
    webviewNote.hidden = !showWebViewHint;
    checkbox.checked = false;
    setLaunchControlsDisabled(false);
    await switchPanel(panelNoFlesh, noFleshTitle);
  }

  async function startInspection(): Promise<void> {
    if (inspectionStarting) return;
    cleanupSession();
    const myToken = ++sessionToken;
    inspectionStarting = true;

    sfx.unlock();
    sfx.playTick();
    setLaunchControlsDisabled(true);

    await switchPanel(panelLoading);
    if (myToken !== sessionToken) return;
    startStallTicker();

    const videoEl = document.createElement("video");
    // Fire getUserMedia and model/WASM initialization simultaneously
    const [camRes, landmarkerResult] = await Promise.allSettled([
      requestCamera(videoEl),
      getLandmarker(),
    ]);

    if (myToken !== sessionToken) {
      if (camRes.status === "fulfilled" && camRes.value.ok) {
        stopCamera(camRes.value.stream, camRes.value.video);
      }
      return;
    }

    if (stallTimer) {
      window.clearInterval(stallTimer);
      stallTimer = 0;
    }
    inspectionStarting = false;

    if (camRes.status === "rejected" || !camRes.value.ok) {
      const errInfo = camRes.status === "fulfilled" && !camRes.value.ok ? camRes.value : null;
      const isWebViewBlock = Boolean(
        errInfo && (errInfo.inAppWebView || errInfo.reason === "webview-blocked"),
      );
      await showFailurePanel("camera", isWebViewBlock);
      return;
    }

    if (landmarkerResult.status === "rejected") {
      stopCamera(camRes.value.stream, camRes.value.video);
      await showFailurePanel("engine", false);
      return;
    }

    activeStream = camRes.value.stream;
    activeVideo = camRes.value.video;
    sizeStageCanvas();

    const tracker = new FaceTracker(landmarkerResult.value);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    await switchPanel(panelStage, abortBtn);
    if (myToken !== sessionToken) return;

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
          if (myToken !== sessionToken) return;
          if (phase === "ACTIVE") {
            stageStatusNote.textContent = manifest.prompt;
          } else if (phase === "PAUSED") {
            stageStatusNote.textContent = "Subject lost. Return to frame.";
          }
        },
        onRoundActive(canvas) {
          if (myToken !== sessionToken) return;
          clipRecorder.start(canvas);
        },
        onVerdict(verdict) {
          if (myToken !== sessionToken) return;
          void handleVerdict(verdict, myToken);
        },
        playAlertBeep: () => sfx.playAlertBeep(),
        playStampThud: () => sfx.playStampThud(),
        playPassChime: () => sfx.playPassChime(),
        playRoundAdvance: () => sfx.playRoundAdvance(),
        playMilestone: () => sfx.playMilestone(),
      },
      reducedMotion,
    );
    activeLoop.start();
  }

  async function handleVerdict(verdict: LoopVerdict, myToken: number): Promise<void> {
    const clipPromise = clipRecorder.stop();

    const record: TryRecord = {
      passed: verdict.passed,
      pct: verdict.pct,
      paused: verdict.paused,
    };

    const roundSquares =
      verdict.roundRecords && verdict.roundRecords.length > 0 ? verdict.roundRecords : undefined;

    // Evaluate against prior stored best BEFORE recording so post-reload tries
    // never overwrite a higher earlier try on the verdict card.
    const priorBest =
      isReplay || isDevSandbox
        ? bestVerdict
        : bestVerdict ?? store.getBestTodayTry(activeDay);

    if (isDevSandbox) {
      sandboxTries = [...sandboxTries, record];
      if (roundSquares) {
        sandboxDisplaySquares = roundSquares;
      }
    } else if (isReplay) {
      sandboxTries = [...sandboxTries, record];
      if (roundSquares) {
        sandboxDisplaySquares = roundSquares;
      }
      store.recordVerdict(
        manifest.id,
        activeDay,
        record,
        true,
        maxTriesForManifest(),
        roundSquares,
      );
    } else {
      store.recordVerdict(
        manifest.id,
        activeDay,
        record,
        false,
        maxTriesForManifest(),
        roundSquares,
      );
    }

    const shouldReplaceBest =
      !priorBest ||
      verdict.pct > priorBest.pct ||
      (verdict.pct === priorBest.pct && verdict.passed && !priorBest.passed);

    if (shouldReplaceBest) {
      bestVerdict = {
        passed: verdict.passed,
        pct: verdict.pct,
        paused: verdict.paused,
        callout: verdict.callout,
        elapsedMs: verdict.elapsedMs,
        durationMs: verdict.durationMs,
        ...(roundSquares ? { roundRecords: roundSquares } : {}),
      };
      // Clear any clip from an earlier try until this new best try's clip finishes finalizing
      bestClip = null;
      if (!bestSnapshotCanvas) {
        bestSnapshotCanvas = document.createElement("canvas");
      }
      bestSnapshotCanvas.width = verdict.snapshot.width;
      bestSnapshotCanvas.height = verdict.snapshot.height;
      bestSnapshotCanvas.getContext("2d")?.drawImage(verdict.snapshot, 0, 0);
    }

    // Stop active loop & camera immediately after grabbing clipPromise
    if (activeLoop) {
      activeLoop.stop();
      activeLoop.releaseSnapshot();
      activeLoop = null;
    }
    stopCamera(activeStream, activeVideo);
    activeStream = null;
    activeVideo = null;
    checkbox.checked = false;
    setLaunchControlsDisabled(false);

    showVerdictPanel(true);

    const clip = await clipPromise;
    if (myToken !== sessionToken) return;
    if (clip && shouldReplaceBest) {
      bestClip = clip;
      updateClipButtonUi();
    }
  }

  function updateClipButtonUi(): void {
    if (!bestClip) {
      downloadClipBtn.hidden = true;
      return;
    }
    const labelPrefix = bestVerdict?.passed ? "Save round clip" : "Save fail clip";
    downloadClipBtn.textContent = `${labelPrefix} (.${bestClip.ext})`;
    downloadClipBtn.hidden = false;
  }

  function showVerdictPanel(moveFocus = false): void {
    const tries = currentTries();
    const displaySquares = currentDisplaySquares();
    const bestStored = isReplay || isDevSandbox ? bestVerdict : store.getBestTodayTry(activeDay);

    const liveBest =
      bestVerdict !== null &&
      (!bestStored ||
        bestVerdict.pct > bestStored.pct ||
        (bestVerdict.pct === bestStored.pct && (bestVerdict.passed || !bestStored.passed)))
        ? bestVerdict
        : null;

    const bestPct = liveBest ? liveBest.pct : (bestStored?.pct ?? 0);
    const bestPassed = liveBest ? liveBest.passed : (bestStored?.passed ?? false);
    const callout = liveBest
      ? liveBest.callout
      : bestPassed
        ? "COMPLIANCE VERIFIED"
        : "SESSION RECORD ARCHIVED";
    const elapsedMs = liveBest
      ? liveBest.elapsedMs
      : bestPassed
        ? manifest.durationMs
        : Math.round((bestPct / 100) * manifest.durationMs);

    renderEvidenceCard(evidenceCanvas, {
      dayNumber: activeDay,
      title: manifest.title,
      department: manifest.department,
      pct: bestPct,
      passed: bestPassed,
      callout,
      tries: displaySquares,
      elapsedMs,
      durationMs: manifest.durationMs,
      seed,
      isReplay,
      snapshot: liveBest ? bestSnapshotCanvas : null,
    });

    const shareText = formatShareLine({
      dayNumber: activeDay,
      title: manifest.title,
      tries: displaySquares,
      bestPct,
      isReplay,
    });

    shareTextEl.textContent = shareText;
    postXLink.href = buildXIntentUrl(shareText);
    challengeLinkInput.value = buildChallengeLink(activeDay, bestPct);

    const maxTries = maxTriesForManifest();
    const dailyFinished =
      !isReplay && !isDevSandbox && store.isTodayFinished(activeDay, maxTries);
    const canRetry =
      isReplay ||
      isDevSandbox ||
      (!dailyFinished && tries.length < maxTries);
    retryTryBtn.hidden = !canRetry;
    shareNativeBtn.hidden = !nativeShareSupported;
    updateClipButtonUi();

    if (dailyFinished) {
      startCountdownTicker();
    } else {
      stopCountdownTicker();
      nextCaseRow.hidden = true;
    }

    updateIntroMeta();
    const focusTarget = moveFocus
      ? canRetry
        ? retryTryBtn
        : nativeShareSupported
          ? shareNativeBtn
          : downloadPngBtn
      : null;
    void switchPanel(panelVerdict, focusTarget);
  }

  // Prefetch triggers: mouseenter / focus / pointerdown + 3s dwell fallback (gated on fast networks)
  const triggerPrefetch = () => prefetchFaceAssets();
  captchaWidget.addEventListener("mouseenter", triggerPrefetch, { once: true });
  captchaWidget.addEventListener("pointerdown", triggerPrefetch, { once: true });
  checkbox.addEventListener("focus", triggerPrefetch, { once: true });
  window.setTimeout(() => prefetchFaceAssets({ autoDwell: true }), PREFETCH_DWELL_MS);

  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      void startInspection();
    }
  });

  abortBtn.addEventListener("click", () => {
    cleanupSession();
    checkbox.checked = false;
    setLaunchControlsDisabled(false);
    updateIntroMeta();
    void switchPanel(panelIntro, checkbox);
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

  shareNativeBtn.addEventListener("click", async () => {
    const text = shareTextEl.textContent?.trim() ?? "";
    if (!text) return;
    shareNativeBtn.disabled = true;
    try {
      await shareEvidenceCard(evidenceCanvas, text, `fleshcheck-${dayStr}.png`);
    } finally {
      shareNativeBtn.disabled = false;
    }
  });

  reloadNextCaseBtn.addEventListener("click", () => {
    window.location.assign(window.location.pathname);
  });

  downloadClipBtn.addEventListener("click", () => {
    if (!bestClip) return;
    downloadBlob(bestClip.blob, `fleshcheck-${dayStr}.${bestClip.ext}`);
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

  // Fallback for browsers without native <dialog closedby="any"> light-dismiss (e.g. Safari)
  if (!("closedBy" in HTMLDialogElement.prototype)) {
    const isOutsideDialog = (e: PointerEvent) => {
      const r = caseDialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    caseDialog.addEventListener("pointerdown", (e) => {
      pressedOutside = isOutsideDialog(e);
    });
    caseDialog.addEventListener("pointerup", (e) => {
      if (pressedOutside && isOutsideDialog(e)) {
        caseDialog.close();
      }
      pressedOutside = false;
    });
  }

  window.addEventListener("pagehide", () => {
    cleanupSession();
    sfx.close();
  });

  updateMuteUi();
  updateIntroMeta();

  if (import.meta.env.DEV) {
    const switcher = mountDevSwitcher(ACTIVE_CHALLENGES, manifest.id, (nextManifest) => {
      cleanupSession();
      checkbox.checked = false;
      setLaunchControlsDisabled(false);
      manifest = nextManifest;
      seed = dailyPick.seed ^ nextManifest.id.length;
      isDevSandbox = true;
      sandboxTries = [];
      sandboxDisplaySquares = null;
      bestVerdict = null;
      bestClip = null;
      updateClipButtonUi();
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
      void switchPanel(panelIntro, checkbox);
    });
  }

  // Returning player who already finished today lands straight on their daily record
  if (!isReplay && !isDevSandbox && store.isTodayFinished(activeDay, maxTriesForManifest())) {
    showVerdictPanel(false);
  }
}

function mustGet<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing required element #${id}`);
  }
  return el as T;
}
