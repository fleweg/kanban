import { useAppData } from "../../context/AppDataContext";

interface EpicPickerProps {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

// Native select listing every epic. Renders a leading "No epic" option so the
// user can clear an existing link.
export function EpicPicker({ value, onChange, disabled }: EpicPickerProps) {
  const { epics } = useAppData();
  return (
    <select
      className="input"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
    >
      <option value="">No epic</option>
      {epics.map((e) => (
        <option key={e.id} value={e.id}>
          {e.title}
        </option>
      ))}
    </select>
  );
}
