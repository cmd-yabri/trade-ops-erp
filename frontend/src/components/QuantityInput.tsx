import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

interface QuantityInputProps {
  value: number;
  onChange: (value: number) => void;
  allowDecimal?: boolean;
  className?: string;
}

/**
 * Keeps the text the user typed ("3." on the way to "3.5") instead of
 * re-formatting the number on every keystroke, and only reports valid numbers.
 */
export function QuantityInput({ value, onChange, allowDecimal = false, className }: QuantityInputProps) {
  const [text, setText] = useState(value ? String(value) : "");

  // Follow outside changes (switching product, loading an order) but not our own typing.
  useEffect(() => {
    if (parseFloat(text) !== value && !(text === "" && !value)) {
      setText(value ? String(value) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Input
      type="number"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      min="0"
      step={allowDecimal ? "0.001" : "1"}
      className={className}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const n = parseFloat(raw);
        onChange(Number.isFinite(n) && n >= 0 ? n : 0);
      }}
    />
  );
}
