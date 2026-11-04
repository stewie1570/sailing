export type SlideProps = {
  playing: boolean
  onHold: () => void
}

export function FigureCopy({
  reduced,
  caption,
  beats,
  rule,
}: {
  reduced: boolean
  caption: string
  beats: readonly string[]
  rule?: string
}) {
  return (
    <div className="theory-copy">
      {rule && (
        <p className="theory-rule">
          <strong>{rule}</strong>
        </p>
      )}
      <p className="theory-caption">{caption}</p>
      {reduced && (
        <ul className="theory-beats">
          {beats.map((beat) => (
            <li key={beat}>{beat}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SheetRange({
  value,
  sweet,
  status,
  onChange,
}: {
  value: number
  sweet?: number
  status: string
  onChange: (value: number) => void
}) {
  return (
    <label className="theory-slider">
      <span>Ease</span>
      <span className="theory-range">
        {sweet != null && (
          <span className="theory-sweet" style={{ left: `calc(${sweet * 100}% * 0.92 + 4%)` }} title="Quiet sail" />
        )}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value}
          aria-label="Main sheet"
          aria-valuetext={status}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </span>
      <span>Haul</span>
    </label>
  )
}
