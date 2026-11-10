/**
 * A small copy of the sailing panel, parked in the corner of a lesson that
 * talks about a sheet. The lit column is the control that sentence is using.
 * Knob travel matches the boat: eased at the top, tight at the bottom.
 */
export type SheetControl = 'port' | 'main' | 'starboard'

export function ControlCallout({
  highlight,
  port = 0.08,
  main = 0.35,
  starboard = 0.08,
  sail = 'main',
}: {
  highlight: readonly SheetControl[]
  /** 0 eased, 1 tight. */
  port?: number
  main?: number
  starboard?: number
  /** Which sail is set. The side sheets change name with it, as on the boat. */
  sail?: 'main' | 'jib' | 'spin'
}) {
  const spin = sail === 'spin'
  const portName = spin ? 'Port spin' : 'Port jib'
  const starboardName = spin ? 'Stbd spin' : 'Stbd jib'
  const names: Record<SheetControl, string> = { port: portName, main: 'Main', starboard: starboardName }
  const lit = highlight.map((id) => names[id])
  const which = lit.length === 1 ? `${lit[0]} is the sheet` : `${lit.join(' and ')} are the sheets`
  return (
    <div className="theory-controls" role="img" aria-label={`Sailing controls. ${which} this part is using.`}>
      <p className="theory-controls-kicker">Sailing</p>
      <Furler name="Jib" value={sail === 'jib' ? 1 : 0} />
      <Furler name="Spin" value={spin ? 1 : 0} tone="spin" />
      <Furler name="Main" value={1} />
      <div className="theory-controls-row">
        <Column name={portName} tightness={port} knob="port" on={highlight.includes('port')} />
        <Column name="Main" tightness={main} on={highlight.includes('main')} />
        <Column name={starboardName} tightness={starboard} knob="starboard" on={highlight.includes('starboard')} />
      </div>
    </div>
  )
}

function Furler({ name, value, tone }: { name: string; value: number; tone?: 'spin' }) {
  const at = `calc(4px + ${value} * (100% - 8px))`
  return (
    <div className={`theory-furler${tone ? ` is-${tone}` : ''}`}>
      <span>{name}</span>
      <div className="theory-furler-track">
        <div className="theory-furler-fill" style={{ width: value < 0.02 ? 0 : at }} />
        <div className="theory-furler-knob" style={{ left: at }} />
      </div>
    </div>
  )
}

function Column({
  name,
  tightness,
  knob,
  on,
}: {
  name: string
  tightness: number
  knob?: 'port' | 'starboard'
  on: boolean
}) {
  const place = `calc(5px + ${tightness} * (100% - 10px))`
  return (
    <div className={`theory-sheet${on ? ' is-on' : ''}`}>
      <span className="theory-sheet-name">{name}</span>
      <div className="theory-sheet-track">
        <div className={`theory-sheet-knob${knob ? ` ${knob}` : ''}`} style={{ top: place }} />
      </div>
    </div>
  )
}
