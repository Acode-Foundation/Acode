import browser from "./browser"
import type {EditorView} from "./editorview"
import {controlledTouchScroll, type ResolvedControlledTouchScroll, type ViewUpdate} from "./extension"
import {AndroidMinimumFlingVelocity, createAndroidSplineFling, estimateCommittedVelocity,
        sampleAndroidSpline, type AndroidSplineFling, type CommittedScrollSample} from "./android-spline"

const GestureThreshold = 6
const AxisRatio = 1.25
const MaximumMomentumFrame = 32
const MaximumBlockedTime = 120
const ReleaseMovementFreshness = 100
const CoverageGuard = 2
const InitialPreparationScreens = .25
const MinimumPreparationScreens = .125
const MaximumPreparationScreens = .5
const PreparationBudget = 8
const SlowPreparation = 16

const hasPendingInput = typeof navigator != "undefined" && (navigator as any).scheduling?.isInputPending
  ? () => (navigator as any).scheduling.isInputPending() : () => false

export type ControlledTouchGestureClaim = "pending" | "vertical" | "horizontal"

/// @internal
export function claimControlledTouchGesture(deltaX: number, deltaY: number,
                                             threshold = GestureThreshold,
                                             axisRatio = AxisRatio): ControlledTouchGestureClaim {
  let x = Math.abs(deltaX), y = Math.abs(deltaY)
  if (Math.max(x, y) < threshold) return "pending"
  return y >= x * axisRatio ? "vertical" : "horizontal"
}

export type MomentumTermination = "completed" | "edge" | "render-limited" | "cancelled"

export interface ControlledTouchScrollDebug {
  readonly active: boolean
  readonly releaseVelocity: number
  readonly expectedDistance: number
  readonly expectedDuration: number
  readonly actualDuration: number
  readonly currentVelocity: number
  readonly committedDistance: number
  readonly termination: MomentumTermination | null
  readonly corridorFrom: number
  readonly corridorTo: number
  readonly idlePrewarmReady: boolean
  readonly preparationDuration: number
  readonly preparationChunkScreens: number
  readonly firstMovementDelay: number
  readonly remainingSafeDistance: number
}

/// @internal
export class ControlledTouchScroll {
  private config: ResolvedControlledTouchScroll | null = null
  private enabled = false
  private destroyed = false
  private previousTouchAction = ""
  private resizeWindow: Window | null = null

  private tracking = false
  private claimed = false
  private didScroll = false
  private endRequested = false
  private endRequestedAt = 0
  private startX = 0
  private startY = 0
  private lastX = 0
  private lastY = 0
  private lastScrollLeft = 0
  private controlledTop: number | null = null
  private lastTouchMovement = 0
  private pendingDelta = 0
  private direction = 0
  private movementFrame = -1

  private corridorFrom = 0
  private corridorTo = 0
  private corridorMode: "none" | "idle" | "active" = "none"
  private idleTargetFrom = 0
  private idleTargetTo = 0
  private idlePrewarmReady = false
  private prewarmTimer = -1
  private preparing = false
  private preparationStarted = 0
  private preparationDuration = 0
  private preparationChunkScreens = InitialPreparationScreens
  private fastPreparations = 0
  private generation = 0
  private highlightCoverageManaged = false
  private highlightCoverageReady = false
  private highlightFrom = 0
  private highlightTo = 0
  private highlightRefreshTimer = -1

  private gestureStarted = 0
  private firstMovementDelay = 0

  private momentum = false
  private momentumFrame = -1
  private fling: AndroidSplineFling | null = null
  private momentumStarted = 0
  private momentumElapsed = 0
  private momentumDistance = 0
  private momentumStartTop = 0
  private lastMomentumCommit = 0
  private releaseVelocity = 0
  private expectedMomentumDistance = 0
  private expectedMomentumDuration = 0
  private actualMomentumDuration = 0
  private currentMomentumVelocity = 0
  private committedMomentumDistance = 0
  private momentumRenderLimited = false
  private momentumTermination: MomentumTermination | null = null
  private settleTimer = -1
  private samples: CommittedScrollSample[] = []

  constructor(readonly view: EditorView,
              private supported = browser.android && browser.chrome) {
    this.syncConfig()
  }

  /// @internal
  get renderCritical() {
    return this.tracking || this.claimed || this.momentum ||
      (this.corridorMode == "active" && this.preparing) ||
      this.movementFrame > -1 || this.momentumFrame > -1
  }

  beforeUpdate(transactions: readonly {docChanged: boolean, reconfigured: boolean}[]) {
    if (transactions.some(tr => tr.docChanged || tr.reconfigured)) this.cancel()
  }

  update(update: ViewUpdate) {
    if (update.transactions.some(tr => tr.reconfigured)) this.syncConfig()
  }

  setState() {
    this.cancel()
    this.syncConfig()
  }

  setWindow() {
    if (!this.enabled) return
    this.unbindResize()
    this.bindResize()
  }

  onScrollChanged() {
    if (!this.enabled) return false
    if (!this.ownsScroll) {
      let top = this.view.scrollDOM.scrollTop
      if (this.corridorMode == "active" && this.didScroll && this.controlledTop != null &&
          Math.abs(top - this.controlledTop) <= 1 &&
          Math.abs(this.view.scrollDOM.scrollLeft - this.lastScrollLeft) <= 1)
        return true
      this.invalidateHighlightCoverage()
      this.scheduleHighlightCoverageRefresh()
      if (this.corridorMode != "none") {
        this.releaseCorridor(false)
        this.scheduleIdlePrewarm(this.config?.settleDelay ?? 0)
      }
      return false
    }
    let bounds = this.view.viewState.controlledScrollBounds()
    let top = this.view.scrollDOM.scrollTop
    if (top < bounds.from - CoverageGuard || top > bounds.to + CoverageGuard ||
        Math.abs(this.view.scrollDOM.scrollLeft - this.lastScrollLeft) > 1) {
      this.cancel()
      return false
    }
    return true
  }

  debugSnapshot(): ControlledTouchScrollDebug {
    return {
      active: this.momentum,
      releaseVelocity: this.releaseVelocity,
      expectedDistance: this.expectedMomentumDistance,
      expectedDuration: this.expectedMomentumDuration,
      actualDuration: this.actualMomentumDuration,
      currentVelocity: this.currentMomentumVelocity,
      committedDistance: this.committedMomentumDistance,
      termination: this.momentumTermination,
      corridorFrom: this.corridorFrom,
      corridorTo: this.corridorTo,
      idlePrewarmReady: this.idlePrewarmReady,
      preparationDuration: this.preparationDuration,
      preparationChunkScreens: this.preparationChunkScreens,
      firstMovementDelay: this.firstMovementDelay,
      remainingSafeDistance: this.remainingSafeDistance()
    }
  }

  /// Keep CodeMirror's height-map anchor corrections inside DOM that is
  /// already present. Wrapped-line measurement can otherwise turn a small
  /// controlled movement into a very large scrollTop correction.
  clampToRenderedOffset(target: number) {
    if (!this.enabled || !this.ownsScroll) return target
    let bounds = this.movementBounds()
    let pinned = this.controlledTop ?? target
    return Math.max(bounds.from, Math.min(bounds.to, pinned))
  }

  /// @internal Called by the language highlighter after a complete visual
  /// replacement has been published for the current rendered viewport.
  onHighlightCoverageReady() {
    if (!this.enabled || this.destroyed) return
    this.clearHighlightCoverageRefresh()
    let bounds = this.view.viewState.controlledScrollBounds()
    this.highlightCoverageManaged = this.highlightCoverageReady = true
    this.highlightFrom = bounds.from
    this.highlightTo = bounds.to
    if (this.corridorMode == "idle") this.scheduleIdleContinuation()
  }

  /// @internal Drop visual coverage on language/style/parser invalidation.
  onHighlightCoverageInvalidated() {
    if (!this.enabled || this.destroyed) return
    this.invalidateHighlightCoverage()
  }

  cancel() {
    if (this.destroyed) return
    this.clearHighlightCoverageRefresh()
    this.clearPrewarmTimer()
    this.stopMovementFrame()
    this.stopMomentum("cancelled")
    this.tracking = this.claimed = this.didScroll = this.endRequested = false
    this.pendingDelta = 0
    this.direction = 0
    this.samples = []
    this.releaseCorridor()
    if (this.enabled) this.scheduleIdlePrewarm(this.config?.settleDelay ?? 0)
  }

  destroy() {
    if (this.destroyed) return
    this.cancel()
    this.destroyed = true
    this.disable()
  }

  private get ownsScroll() {
    return this.tracking || this.claimed || this.momentum ||
      this.corridorMode == "active" && this.preparing
  }

  private now() {
    return this.view.win.performance?.now() ?? Date.now()
  }

  private syncConfig() {
    if (this.destroyed) return
    this.config = this.view.state.facet(controlledTouchScroll)
    let shouldEnable = !!this.config && this.supported
    if (shouldEnable == this.enabled) return
    if (shouldEnable) this.enable()
    else {
      this.cancel()
      this.disable()
    }
  }

  private enable() {
    if (this.enabled) return
    this.enabled = true
    this.previousTouchAction = this.view.scrollDOM.style.touchAction
    this.view.scrollDOM.style.touchAction = "pan-x"
    this.view.scrollDOM.addEventListener("touchstart", this.onTouchStart, {passive: false})
    this.view.scrollDOM.addEventListener("touchmove", this.onTouchMove, {passive: false})
    this.view.scrollDOM.addEventListener("touchend", this.onTouchEnd, {passive: false})
    this.view.scrollDOM.addEventListener("touchcancel", this.onTouchCancel)
    this.view.scrollDOM.addEventListener("scrollend", this.onScrollEnd)
    this.view.contentDOM.addEventListener("compositionstart", this.onCompositionStart)
    this.bindResize()
    this.scheduleIdlePrewarm(this.config?.settleDelay ?? 0)
  }

  private disable() {
    if (!this.enabled) return
    this.enabled = false
    this.view.scrollDOM.removeEventListener("touchstart", this.onTouchStart)
    this.view.scrollDOM.removeEventListener("touchmove", this.onTouchMove)
    this.view.scrollDOM.removeEventListener("touchend", this.onTouchEnd)
    this.view.scrollDOM.removeEventListener("touchcancel", this.onTouchCancel)
    this.view.scrollDOM.removeEventListener("scrollend", this.onScrollEnd)
    this.view.contentDOM.removeEventListener("compositionstart", this.onCompositionStart)
    this.unbindResize()
    this.clearPrewarmTimer()
    this.view.scrollDOM.style.touchAction = this.previousTouchAction
  }

  private bindResize() {
    this.resizeWindow = this.view.win
    this.resizeWindow.addEventListener("resize", this.onResize)
  }

  private unbindResize() {
    this.resizeWindow?.removeEventListener("resize", this.onResize)
    this.resizeWindow = null
  }

  private onTouchStart = (event: TouchEvent) => {
    if (!this.enabled || event.touches.length != 1) {
      this.cancel()
      return
    }
    this.stopMomentum("cancelled")
    this.clearHighlightCoverageRefresh()
    this.clearPrewarmTimer()
    let touch = event.touches[0]
    this.tracking = true
    this.claimed = this.didScroll = this.endRequested = false
    this.endRequestedAt = 0
    this.startX = this.lastX = touch.clientX
    this.startY = this.lastY = touch.clientY
    this.lastTouchMovement = this.now()
    this.gestureStarted = this.lastTouchMovement
    this.firstMovementDelay = 0
    this.lastScrollLeft = this.view.scrollDOM.scrollLeft
    this.controlledTop = this.view.scrollDOM.scrollTop
    this.pendingDelta = 0
    this.direction = 0
    this.samples = [{at: this.now(), top: this.view.scrollDOM.scrollTop}]
    this.releaseVelocity = 0
    this.expectedMomentumDistance = this.expectedMomentumDuration = 0
    this.actualMomentumDuration = 0
    this.currentMomentumVelocity = this.committedMomentumDistance = 0
    this.momentumTermination = null
    this.clearSettleTimer()
  }

  private onTouchMove = (event: TouchEvent) => {
    if (!this.tracking) return
    if (event.touches.length != 1) {
      this.cancel()
      return
    }
    let touch = event.touches[0], justClaimed = false
    if (!this.claimed) {
      let claim = claimControlledTouchGesture(touch.clientX - this.startX, touch.clientY - this.startY)
      if (claim == "pending") return
      if (claim == "horizontal") {
        this.tracking = false
        if (this.corridorMode != "idle") this.scheduleSettle(this.config!.settleDelay)
        return
      }
      this.claimed = justClaimed = true
      this.activateCorridor()
    }
    if (event.cancelable) event.preventDefault()
    let delta = (justClaimed ? this.startY : this.lastY) - touch.clientY
    if (Math.abs(delta) > .1) {
      this.lastTouchMovement = this.now()
      let direction = delta < 0 ? -1 : 1
      this.direction = direction
      this.pendingDelta += delta
      let bounds = this.view.viewState.controlledScrollBounds()
      let target = this.view.scrollDOM.scrollTop + this.pendingDelta
      if (justClaimed && target >= bounds.from && target <= bounds.to) this.applyMovement()
      else this.scheduleMovement()
    }
    this.lastX = touch.clientX
    this.lastY = touch.clientY
  }

  private onTouchEnd = (event: TouchEvent) => {
    if (!this.tracking) return
    if (!this.claimed) {
      this.tracking = false
      this.samples = []
      if (this.corridorMode != "idle") this.scheduleSettle(this.config?.settleDelay ?? 0)
      return
    }
    if (this.claimed && event.cancelable) event.preventDefault()
    this.tracking = false
    this.endRequested = true
    this.endRequestedAt = this.now()
    this.scheduleMovement()
  }

  private onTouchCancel = () => this.cancel()
  private onScrollEnd = () => {
    if (!this.tracking && !this.claimed && !this.momentum && !this.preparing &&
        this.view.viewState.controlledScrollActive)
      this.scheduleSettle(this.config?.settleDelay ?? 0)
  }
  private onCompositionStart = () => this.cancel()
  private onResize = () => this.cancel()

  private activateCorridor() {
    this.corridorMode = "active"
    this.idlePrewarmReady = false
    if (this.view.viewState.controlledScrollActive) return
    let top = this.view.scrollDOM.scrollTop, height = this.view.scrollDOM.clientHeight
    this.corridorFrom = top
    this.corridorTo = top + height
  }

  private setCorridor(prepare = true) {
    let scale = this.view.viewState.scaleY || 1
    let max = (this.view.scrollDOM.scrollHeight + this.view.scrollDOM.clientHeight) * scale
    let changed = this.view.viewState.setControlledScrollCorridor(
      Math.max(0, this.corridorFrom * scale), Math.min(max, this.corridorTo * scale))
    if (changed && prepare) this.requestPreparation()
  }

  private requestPreparation() {
    if (this.preparing || this.destroyed) return
    this.preparing = true
    this.preparationStarted = this.now()
    let generation = ++this.generation
    this.view.requestMeasure({
      key: this,
      read: () => generation,
      write: measuredGeneration => {
        if (this.destroyed || measuredGeneration != this.generation) return
        this.preparing = false
        this.recordPreparation(this.now() - this.preparationStarted)
        if (this.corridorMode == "idle") this.scheduleIdleContinuation()
        if (this.momentum) this.scheduleMomentum()
      }
    })
  }

  private scheduleMovement() {
    if (this.movementFrame > -1 || this.destroyed) return
    this.movementFrame = this.view.win.requestAnimationFrame(this.applyMovement)
  }

  private stopMovementFrame() {
    if (this.movementFrame > -1) this.view.win.cancelAnimationFrame(this.movementFrame)
    this.movementFrame = -1
  }

  private applyMovement = () => {
    this.movementFrame = -1
    if (!this.claimed) return
    let delta = this.pendingDelta
    this.pendingDelta = 0
    if (Math.abs(delta) > .1) {
      let scroller = this.view.scrollDOM, bounds = this.movementBounds()
      let target = Math.max(bounds.from, Math.min(bounds.to, scroller.scrollTop + delta))
      let previous = scroller.scrollTop
      if (Math.abs(target - previous) > .1) {
        scroller.scrollTop = target
        let committed = scroller.scrollTop
        if (Math.abs(committed - previous) > .1) {
          this.didScroll = true
          if (!this.firstMovementDelay)
            this.firstMovementDelay = Math.max(0, this.now() - this.gestureStarted)
          this.controlledTop = committed
          this.recordSample(committed)
        }
      }
    }
    if (this.endRequested) this.finishGesture()
  }

  private recordSample(top: number) {
    let now = this.now()
    this.samples.push({at: now, top})
    while (this.samples.length > 2 && this.samples[0].at < now - 80)
      this.samples.shift()
  }

  private remainingSafeDistance() {
    if (!this.enabled || !this.direction) return 0
    let bounds = this.movementBounds()
    let top = this.view.scrollDOM.scrollTop
    return Math.max(0, this.direction > 0 ? bounds.to - top : top - bounds.from)
  }

  private movementBounds() {
    let bounds = this.view.viewState.controlledScrollBounds()
    if (!this.highlightCoverageManaged) return bounds
    if (!this.highlightCoverageReady) {
      let top = this.view.scrollDOM.scrollTop
      return {from: top, to: top}
    }
    let from = Math.max(bounds.from, this.highlightFrom)
    let to = Math.min(bounds.to, this.highlightTo)
    if (to < from) {
      let top = this.view.scrollDOM.scrollTop
      return {from: top, to: top}
    }
    return {from, to}
  }

  private invalidateHighlightCoverage() {
    if (!this.highlightCoverageManaged) return
    let top = this.view.scrollDOM.scrollTop
    this.highlightCoverageReady = false
    this.highlightFrom = this.highlightTo = top
  }

  private scheduleHighlightCoverageRefresh() {
    if (!this.highlightCoverageManaged || this.destroyed) return
    this.clearHighlightCoverageRefresh()
    this.highlightRefreshTimer = setTimeout(() => {
      this.highlightRefreshTimer = -1
      if (!this.destroyed && !this.tracking && !this.claimed && !this.momentum)
        this.view.dispatch({})
    }, (this.config?.settleDelay ?? 0) + 1) as any
  }

  private clearHighlightCoverageRefresh() {
    if (this.highlightRefreshTimer > -1) clearTimeout(this.highlightRefreshTimer)
    this.highlightRefreshTimer = -1
  }

  private recordPreparation(duration: number) {
    this.preparationDuration = Math.max(0, duration)
    if (duration > SlowPreparation) {
      this.preparationChunkScreens = Math.max(
        MinimumPreparationScreens, this.preparationChunkScreens / 2)
      this.fastPreparations = 0
    } else if (duration <= PreparationBudget) {
      if (++this.fastPreparations >= 2) {
        this.preparationChunkScreens = Math.min(
          MaximumPreparationScreens, this.preparationChunkScreens * 1.5)
        this.fastPreparations = 0
      }
    } else {
      this.fastPreparations = 0
    }
  }

  private scheduleIdlePrewarm(delay: number) {
    if (!this.enabled || this.destroyed) return
    this.clearPrewarmTimer()
    this.prewarmTimer = setTimeout(this.startIdlePrewarm, Math.max(0, delay) + 1) as any
  }

  private clearPrewarmTimer() {
    if (this.prewarmTimer > -1) clearTimeout(this.prewarmTimer)
    this.prewarmTimer = -1
  }

  private scheduleIdleContinuation() {
    if (this.prewarmTimer > -1 || this.destroyed || this.corridorMode != "idle") return
    this.prewarmTimer = setTimeout(() => {
      this.clearPrewarmTimer()
      this.continueIdlePrewarm()
    }, 16) as any
  }

  private startIdlePrewarm = () => {
    this.clearPrewarmTimer()
    if (!this.enabled || this.destroyed || this.tracking || this.claimed || this.momentum || this.preparing)
      return
    if (hasPendingInput()) {
      this.scheduleIdlePrewarm(16)
      return
    }
    let scroller = this.view.scrollDOM, height = scroller.clientHeight
    if (height <= 0) {
      this.scheduleIdlePrewarm(this.config?.settleDelay ?? 0)
      return
    }
    let top = scroller.scrollTop
    let retainCurrent = this.corridorMode != "none" && this.view.viewState.controlledScrollActive
    this.corridorMode = "idle"
    this.idlePrewarmReady = false
    this.idleTargetFrom = Math.max(0, top - height)
    this.idleTargetTo = Math.min(scroller.scrollHeight, top + height * 2)
    if (!retainCurrent) {
      this.corridorFrom = top
      this.corridorTo = top + height
      this.setCorridor(false)
    }
    this.continueIdlePrewarm()
  }

  private continueIdlePrewarm() {
    if (this.corridorMode != "idle" || this.destroyed || this.tracking ||
        this.claimed || this.momentum || this.preparing) return
    if (this.corridorFrom <= this.idleTargetFrom + 1 &&
        this.corridorTo >= this.idleTargetTo - 1) {
      if (Math.abs(this.corridorFrom - this.idleTargetFrom) > 1 ||
          Math.abs(this.corridorTo - this.idleTargetTo) > 1) {
        this.corridorFrom = this.idleTargetFrom
        this.corridorTo = this.idleTargetTo
        this.setCorridor()
        return
      }
      let bounds = this.view.viewState.controlledScrollBounds()
      this.idlePrewarmReady = !this.highlightCoverageManaged ||
        this.highlightCoverageReady && this.highlightFrom <= bounds.from + CoverageGuard &&
        this.highlightTo >= bounds.to - CoverageGuard
      if (!this.idlePrewarmReady) return
      return
    }
    if (hasPendingInput()) {
      this.scheduleIdleContinuation()
      return
    }
    let chunk = this.view.scrollDOM.clientHeight * this.preparationChunkScreens
    this.corridorFrom = Math.max(this.idleTargetFrom, this.corridorFrom - chunk)
    this.corridorTo = Math.min(this.idleTargetTo, this.corridorTo + chunk)
    this.setCorridor()
  }

  private maybeExtendCorridor() {
    if (!this.config || this.preparing || this.tracking || hasPendingInput()) return
    let scroller = this.view.scrollDOM, height = scroller.clientHeight
    if (this.remainingSafeDistance() > height) return
    let chunk = height * this.preparationChunkScreens
    if (this.direction > 0) {
      let maximum = scroller.scrollTop + height * (this.config.maxAhead + 1)
      let next = Math.min(maximum, this.corridorTo + chunk)
      if (next <= this.corridorTo + 1) return
      this.corridorTo = next
      this.corridorFrom = Math.max(this.corridorFrom, scroller.scrollTop - height)
    } else {
      let minimum = Math.max(0, scroller.scrollTop - height * this.config.maxAhead)
      let next = Math.max(minimum, this.corridorFrom - chunk)
      if (next >= this.corridorFrom - 1) return
      this.corridorFrom = next
      this.corridorTo = Math.min(this.corridorTo, scroller.scrollTop + height * 2)
    }
    this.setCorridor()
  }

  private finishGesture() {
    this.endRequested = false
    this.claimed = false
    if (!this.didScroll || !this.config) {
      this.scheduleSettle(this.config?.settleDelay ?? 0)
      return
    }
    let scroller = this.view.scrollDOM, now = this.now()
    let latestSample = this.samples[this.samples.length - 1]
    let velocity = this.endRequestedAt - this.lastTouchMovement <= ReleaseMovementFreshness && latestSample
      ? estimateCommittedVelocity(this.samples, latestSample.at)
      : 0
    let fling = createAndroidSplineFling(velocity)
    if (!fling) {
      this.scheduleSettle(this.config.settleDelay)
      return
    }
    let direction = Math.sign(fling.distance)
    this.direction = direction
    this.activateCorridor()
    this.clearSettleTimer()
    this.momentum = true
    this.fling = fling
    this.momentumStarted = this.lastMomentumCommit = now
    this.momentumElapsed = this.momentumDistance = 0
    this.momentumStartTop = scroller.scrollTop
    this.releaseVelocity = fling.initialVelocity
    this.expectedMomentumDistance = fling.distance
    this.expectedMomentumDuration = fling.duration
    this.actualMomentumDuration = 0
    this.currentMomentumVelocity = fling.initialVelocity
    this.committedMomentumDistance = 0
    this.momentumRenderLimited = false
    this.momentumTermination = null
    this.scheduleMomentum()
  }

  private scheduleMomentum() {
    if (!this.momentum || this.momentumFrame > -1 || this.destroyed) return
    this.momentumFrame = this.view.win.requestAnimationFrame(this.applyMomentum)
  }

  private applyMomentum = () => {
    this.momentumFrame = -1
    let fling = this.fling
    if (!this.momentum || !fling) return
    let now = this.now(), elapsed = Math.max(0, now - this.momentumStarted)
    let previousSample = sampleAndroidSpline(fling, this.momentumElapsed)
    let sample = sampleAndroidSpline(fling, elapsed)
    let rawDelta = sample.distance - this.momentumDistance
    let frameTime = Math.max(0, elapsed - this.momentumElapsed)
    if (frameTime >= MaximumBlockedTime) {
      this.finishMomentum("render-limited")
      return
    }
    let maximumStep = Math.abs(previousSample.velocity) * Math.min(MaximumMomentumFrame, frameTime) / 1000
    let delta = Math.sign(rawDelta) * Math.min(Math.abs(rawDelta), maximumStep)
    if (frameTime > MaximumMomentumFrame + .5) this.momentumRenderLimited = true
    this.momentumElapsed = elapsed
    this.momentumDistance = sample.distance
    this.currentMomentumVelocity = sample.velocity

    let scroller = this.view.scrollDOM, bounds = this.movementBounds()
    let previous = scroller.scrollTop
    let target = Math.max(bounds.from, Math.min(bounds.to, previous + delta))
    let maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    if (Math.abs(target - previous) + .1 < Math.abs(delta) &&
        !(this.direction < 0 ? previous <= .5 : previous >= maximum - .5))
      this.momentumRenderLimited = true
    if (Math.abs(target - previous) > .1) {
      scroller.scrollTop = target
      let committed = scroller.scrollTop
      if (Math.abs(committed - previous) > .1) {
        this.lastMomentumCommit = now
        this.controlledTop = committed
        this.committedMomentumDistance = committed - this.momentumStartTop
      }
    }
    this.maybeExtendCorridor()

    let atDocumentEdge = this.direction < 0 ? scroller.scrollTop <= .5 : scroller.scrollTop >= maximum - .5
    if (atDocumentEdge) this.finishMomentum("edge")
    else if (sample.done || Math.abs(sample.velocity) < AndroidMinimumFlingVelocity)
      this.finishMomentum(this.momentumRenderLimited ? "render-limited" : "completed")
    else if (now - this.lastMomentumCommit >= MaximumBlockedTime)
      this.finishMomentum("render-limited")
    else
      this.scheduleMomentum()
  }

  private finishMomentum(reason: MomentumTermination) {
    this.stopMomentum(reason)
    this.scheduleSettle(this.config?.settleDelay ?? 0)
  }

  private stopMomentum(reason?: MomentumTermination) {
    if (this.momentumFrame > -1) this.view.win.cancelAnimationFrame(this.momentumFrame)
    this.momentumFrame = -1
    if (this.momentum && reason) {
      this.momentumTermination = reason
      this.actualMomentumDuration = Math.max(0, this.now() - this.momentumStarted)
    }
    this.momentum = false
    this.fling = null
    this.momentumElapsed = this.momentumDistance = 0
    this.currentMomentumVelocity = 0
    this.clearSettleTimer()
  }

  private scheduleSettle(delay: number) {
    this.clearSettleTimer()
    this.settleTimer = setTimeout(this.settle, delay + 1) as any
  }

  private clearSettleTimer() {
    if (this.settleTimer > -1) clearTimeout(this.settleTimer)
    this.settleTimer = -1
  }

  private settle = () => {
    this.clearSettleTimer()
    this.stopMomentum()
    this.didScroll = false
    this.samples = []
    this.scheduleIdlePrewarm(0)
  }

  private releaseCorridor(requestMeasure = true) {
    this.clearSettleTimer()
    this.preparing = false
    this.controlledTop = null
    this.corridorMode = "none"
    this.idlePrewarmReady = false
    this.idleTargetFrom = this.idleTargetTo = 0
    this.generation++
    if (this.view.viewState.clearControlledScrollCorridor() && requestMeasure) this.view.requestMeasure()
  }
}
