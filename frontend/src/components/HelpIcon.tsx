import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface HelpIconProps {
  text: string
}

interface TooltipPosition {
  top: number
  left: number
}

// A small "(?)" affordance for options whose effect isn't obvious from their
// label alone. Deliberately its own visible icon rather than a bare `title`
// attribute on the label: a plain title isn't discoverable - nothing on
// screen signals that hovering it does anything.
//
// The tooltip itself is portaled to document.body and positioned from the
// icon's live bounding rect rather than pinned via CSS position:absolute,
// because several call sites sit inside a collapsible panel
// (.advanced-settings) that clips overflow for its own rounded corners - a
// CSS-anchored tooltip would get cut off there.
export function HelpIcon({ text }: HelpIconProps) {
  const iconRef = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState<TooltipPosition | null>(null)

  const show = () => {
    const rect = iconRef.current?.getBoundingClientRect()
    if (!rect) return
    setPosition({ top: rect.top - 6, left: rect.left + rect.width / 2 })
  }
  const hide = () => setPosition(null)

  return (
    <span
      ref={iconRef}
      className="help-icon"
      tabIndex={0}
      aria-label={text}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={event => {
        // Several call sites live inside a <label> wrapping a checkbox or
        // referencing an input via htmlFor - without this, clicking the icon
        // itself would forward the click to that control (e.g. toggling the
        // checkbox) instead of just being a no-op informational click.
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      ?
      {position &&
        createPortal(
          <span
            className="help-icon-tooltip"
            role="tooltip"
            style={{
              top: position.top,
              left: position.left,
            }}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  )
}
