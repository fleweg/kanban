import { ISSUE_TYPES } from "../../lib/issueTypes";

// Bare <select> over the static issue type catalog. Shows the type label only;
// callers usually render a <TypeIcon> beside the field.
export function TypePicker({ value, onChange, disabled, includeEpic = true }) {
  const options = includeEpic ? ISSUE_TYPES : ISSUE_TYPES.filter((t) => t.id !== "epic");
  return (
    <select
      className="input"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      {options.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
        </option>
      ))}
    </select>
  );
}
