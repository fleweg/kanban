import { useAppData } from "../../context/AppDataContext";

// A native <select> wrapping the active users list. `value` is a uid or null.
// Renders a leading "Unassigned" option so the user can clear an assignment.
export function UserPicker({ value, onChange, includeUnassigned = true, disabled }) {
  const { users } = useAppData();
  const active = users.filter((u) => !u.disabled);

  return (
    <select
      className="input"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
    >
      {includeUnassigned && <option value="">Unassigned</option>}
      {active.map((u) => (
        <option key={u.id} value={u.id}>
          {u.email}
        </option>
      ))}
    </select>
  );
}
