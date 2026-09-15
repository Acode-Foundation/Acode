/*
 * Portions derived from Android Open Source Project OverScroller.java.
 * Copyright (C) 2010 The Android Open Source Project
 * Licensed under the Apache License, Version 2.0.
 * Ported to TypeScript and modified for Acode's render-gated scrolling.
 */

const DecelerationRate = Math.log(.78) / Math.log(.9)
const Inflexion = .35
const StartTension = .5
const EndTension = 1
const P1 = StartTension * Inflexion
const P2 = 1 - EndTension * (1 - Inflexion)
const SampleCount = 100
const FlingFriction = .015
const PhysicalCoefficient = 9.80665 * 39.37 * 160 * .84

export const AndroidMinimumFlingVelocity = 50
export const AndroidMaximumFlingVelocity = 8000

const SplinePosition = (() => {
  let result = new Array<number>(SampleCount + 1), xMin = 0
  for (let i = 0; i < SampleCount; i++) {
    let alpha = i / SampleCount, xMax = 1, x = 0, coefficient = 0
    for (;;) {
      x = xMin + (xMax - xMin) / 2
      coefficient = 3 * x * (1 - x)
      let position = coefficient * ((1 - x) * P1 + x * P2) + x * x * x
      if (Math.abs(position - alpha) < 1e-5) break
      if (position > alpha) xMax = x
      else xMin = x
    }
    result[i] = coefficient * ((1 - x) * StartTension + x) + x * x * x
  }
  result[SampleCount] = 1
  return result
})()

export interface AndroidSplineFling {
  readonly initialVelocity: number
  readonly distance: number
  readonly duration: number
}

export interface AndroidSplineSample {
  readonly distance: number
  readonly velocity: number
  readonly done: boolean
}

export interface CommittedScrollSample {
  readonly at: number
  readonly top: number
}

/// Estimate velocity in CSS pixels per second from positions that were
/// actually committed to the scroller. Linear regression is less sensitive
/// to uneven touch-event delivery than using only the first and last sample.
export function estimateCommittedVelocity(samples: readonly CommittedScrollSample[], now: number,
                                          windowMs = 80, fallbackWindowMs = 160) {
  let recent = samples.filter(sample => sample.at >= now - windowMs)
  if (recent.length < 2)
    recent = samples.filter(sample => sample.at >= now - fallbackWindowMs)
  if (recent.length < 2) return 0
  let origin = recent[recent.length - 1].at, meanTime = 0, meanTop = 0
  for (let sample of recent) {
    meanTime += sample.at - origin
    meanTop += sample.top
  }
  meanTime /= recent.length
  meanTop /= recent.length
  let covariance = 0, variance = 0
  for (let sample of recent) {
    let time = sample.at - origin - meanTime
    covariance += time * (sample.top - meanTop)
    variance += time * time
  }
  return variance > 0 ? covariance / variance * 1000 : 0
}

export function createAndroidSplineFling(velocity: number): AndroidSplineFling | null {
  if (!Number.isFinite(velocity) || Math.abs(velocity) < AndroidMinimumFlingVelocity) return null
  let initialVelocity = Math.round(Math.max(-AndroidMaximumFlingVelocity,
                                            Math.min(AndroidMaximumFlingVelocity, velocity)))
  let deceleration = Math.log(Inflexion * Math.abs(initialVelocity) /
                              (FlingFriction * PhysicalCoefficient))
  let decelerationMinusOne = DecelerationRate - 1
  let duration = Math.trunc(1000 * Math.exp(deceleration / decelerationMinusOne))
  let unsignedDistance = FlingFriction * PhysicalCoefficient *
    Math.exp(DecelerationRate / decelerationMinusOne * deceleration)
  return {
    initialVelocity,
    distance: Math.trunc(unsignedDistance) * Math.sign(initialVelocity),
    duration
  }
}

export function sampleAndroidSpline(fling: AndroidSplineFling, elapsed: number): AndroidSplineSample {
  let time = Math.max(0, Math.min(fling.duration, elapsed))
  let progress = fling.duration ? time / fling.duration : 1
  let index = Math.floor(SampleCount * progress)
  let distanceCoefficient = 1, velocityCoefficient = 0
  if (index < SampleCount) {
    let lowerTime = index / SampleCount, upperTime = (index + 1) / SampleCount
    let lowerDistance = SplinePosition[index], upperDistance = SplinePosition[index + 1]
    velocityCoefficient = (upperDistance - lowerDistance) / (upperTime - lowerTime)
    distanceCoefficient = lowerDistance + (progress - lowerTime) * velocityCoefficient
  }
  return {
    distance: distanceCoefficient * fling.distance,
    velocity: fling.duration ? velocityCoefficient * fling.distance / fling.duration * 1000 : 0,
    done: elapsed >= fling.duration
  }
}
