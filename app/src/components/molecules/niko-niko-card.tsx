import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { OptionsVault } from '@livestreak/options'
import { useVaultView } from '#/hooks/use-vault-views'
import { formatMultiplier } from '#/utils/format'

interface Props {
  vault: OptionsVault
  index: number
  onClickCard?: (vaultId: string) => void
}

const CARD_W = 340
const CARD_H = 42
const LANE_H = CARD_H + 14 // vertical pitch between lanes (fixed — NOT count-derived, so lanes are stable)
const DRIFT_SPEED = 0.3 // px per frame, left → right

// Batch tracking so cards present at first paint SPREAD across the pane, while a card ADDED later drifts
// in from the left edge. Module-level (shared by the sibling cards); reset once every card has unmounted
// so a fresh visit spreads again.
let mountCount = 0
let firstBatchUntil = 0

/**
 * NikoNiko-style read-only card that drifts across the video area.
 * Shows the question + multiplier. Hovering pauses drift and shows full title.
 * Clicking opens the vault detail in the right panel.
 */
export function NikoNikoCard({ vault, index, onClickCard }: Props) {
  const view = useVaultView(vault.vaultId)
  const yesTotal = view.poolYes ?? Number(vault.pools.yes)
  const noTotal = view.poolNo ?? Number(vault.pools.no)
  const multiplier = view.multiplier ?? (yesTotal > 0 ? (yesTotal + noTotal) / yesTotal : 1)
  const ref = useRef<HTMLDivElement>(null)
  // News-ticker drift, right → left. dx (per-card speed), laneY (home row), and a gentle vertical sway
  // (amp·sin(phase + t·freq)) give each card its own organic motion instead of one stagnant line.
  const posRef = useRef({ x: 0, y: 0, dx: -DRIFT_SPEED, laneY: 0, amp: 0, freq: 0, phase: 0, t: 0 })
  const rafRef = useRef<number>(0)
  const hoveredRef = useRef(false)
  const textRef = useRef<HTMLSpanElement>(null)
  const [ready, setReady] = useState(false)
  const [enterDelay, setEnterDelay] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [isTruncated, setIsTruncated] = useState(false)

  const isHot = vault.status === 'hot'

  // Position — initialized ONCE on mount, deliberately independent of the vault COUNT. The old
  // [index, total] init re-ran (and re-randomized) every card whenever a vault was added/removed, so the
  // whole field reset — a jarring CLS. Now an added vault only mounts ITS OWN card; the others keep
  // drifting untouched.
  useEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    const pw = parent.clientWidth
    const ph = parent.clientHeight

    if (mountCount === 0) firstBatchUntil = Date.now() + 1000
    mountCount += 1
    const isInitial = Date.now() < firstBatchUntil

    // Stable vertical lane: index × a FIXED pitch, wrapped over the lanes that fit. An appended vault
    // gets the next index/lane; the existing cards' lanes never move (they don't depend on the count).
    const numLanes = Math.max(1, Math.floor((ph - 24) / LANE_H))
    const laneY = Math.min(12 + (index % numLanes) * LANE_H + (Math.random() - 0.5) * 8, ph - CARD_H - 8)

    // Right → left (news flow). The first batch spreads across the pane; a later addition enters from off
    // the RIGHT edge and scrolls in — no disturbance to the others.
    const x = isInitial ? Math.random() * Math.max(0, pw - CARD_W) : pw + Math.random() * 80

    posRef.current = {
      x,
      y: laneY,
      laneY,
      dx: -(DRIFT_SPEED + Math.random() * 0.4),   // per-card speed → not one stagnant pace
      amp: 5 + Math.random() * 5,                  // vertical sway amplitude (px), bounded within the lane
      freq: 0.012 + Math.random() * 0.02,          // slow, ~4–9s per sway cycle
      phase: Math.random() * Math.PI * 2,          // desync the sway across cards
      t: 0,
    }
    setEnterDelay(isInitial ? Math.min(index * 0.05, 0.5) : 0)
    setReady(true)

    return () => {
      mountCount = Math.max(0, mountCount - 1)
      if (mountCount === 0) firstBatchUntil = 0
    }
    // Mount-once by design (position must NOT re-init on count changes). index is stable per vaultId key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Drift loop — depends only on `ready`, so a changing vault count never tears it down (which would
  // stutter every card). Scrolls right → left at the card's own speed with a gentle vertical sway; wraps
  // off the left edge back to the right, same lane. Sway continues while hovered (drift pauses).
  useEffect(() => {
    if (!ready) return
    function tick() {
      const el = ref.current
      const p = el?.parentElement
      if (!el || !p) return
      const pw = p.clientWidth
      const pos = posRef.current
      pos.t += 1
      if (!hoveredRef.current) {
        pos.x += pos.dx
        if (pos.x < -CARD_W - 10) {
          pos.x = pw + 10                          // re-enter from the right, same lane
          pos.phase = Math.random() * Math.PI * 2  // fresh sway phase each pass
        }
      }
      const y = pos.laneY + pos.amp * Math.sin(pos.phase + pos.t * pos.freq)
      el.style.transform = `translate3d(${pos.x}px, ${y}px, 0)`
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [ready])

  const accentColor = isHot ? 'rgba(255,45,120,0.55)' : 'rgba(0,255,135,0.4)'
  const textColor = isHot ? '#ff7a00' : '#00ff87'

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, filter: 'blur(4px)' }}
      animate={{ opacity: ready ? 1 : 0, filter: ready ? 'blur(0px)' : 'blur(4px)' }}
      exit={{ opacity: 0, filter: 'blur(4px)' }}
      transition={{ duration: 0.25, delay: enterDelay }}
      onClick={() => onClickCard?.(vault.vaultId)}
      onMouseEnter={() => { hoveredRef.current = true; setHovered(true); if (textRef.current) setIsTruncated(textRef.current.scrollWidth > textRef.current.clientWidth) }}
      onMouseLeave={() => { hoveredRef.current = false; setHovered(false) }}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: CARD_W,
        height: CARD_H,
        background: hovered ? 'rgba(13,13,28,0.85)' : 'rgba(13,13,28,0.55)',
        backdropFilter: 'blur(8px)',
        border: `1px solid ${hovered ? (isHot ? 'rgba(255,45,120,0.7)' : 'rgba(0,255,135,0.6)') : accentColor}`,
        borderRadius: 10,
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
        pointerEvents: 'auto',
        boxShadow: hovered
          ? `0 0 24px ${accentColor}, 0 4px 16px rgba(0,0,0,0.5)`
          : `0 0 12px ${accentColor}, 0 2px 8px rgba(0,0,0,0.4)`,
        willChange: 'transform',
        zIndex: hovered ? 100 : 15 + index,
        transition: 'background 0.15s, border-color 0.15s, box-shadow 0.2s',
      }}
    >
      <span ref={textRef} style={{
        fontFamily: 'var(--font-display)',
        fontSize: 12,
        fontWeight: 600,
        color: hovered ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.75)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        flex: 1,
        lineHeight: 1.2,
        letterSpacing: '0.01em',
        transition: 'color 0.15s',
      }}>
        {vault.question}
      </span>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        fontWeight: 700,
        color: textColor,
        flexShrink: 0,
        textShadow: `0 0 12px ${accentColor}`,
      }}>
        {formatMultiplier(multiplier)}
      </span>

      {/* Hover tooltip — small tooltip with arrow */}
      {hovered && isTruncated && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 8px)',
          left: 12,
          maxWidth: 260,
          background: 'rgba(20,20,35,0.96)',
          borderRadius: 6,
          padding: '6px 10px',
          pointerEvents: 'none',
          zIndex: 200,
          boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
        }}>
          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.85)',
            lineHeight: 1.4,
            margin: 0,
            whiteSpace: 'normal',
          }}>
            {vault.question}
          </p>
          {/* Arrow */}
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 16,
            width: 0, height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '5px solid rgba(20,20,35,0.96)',
          }} />
        </div>
      )}
    </motion.div>
  )
}
