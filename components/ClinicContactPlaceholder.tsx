// Placeholder for the clinic's own contact details. The clinic fills this in.
// Do not put an invented phone number or helpline here.

export function ClinicContactPlaceholder() {
  return (
    <div className="placeholder">
      <span className="placeholder-tag">Placeholder</span>
      <p style={{ marginBottom: 0 }}>
        <strong>Your clinic&apos;s contact goes here</strong>
      </p>
      <p className="small muted" style={{ marginBottom: 0 }}>
        The clinic adds its phone number and opening hours before this is used.
      </p>
    </div>
  );
}
