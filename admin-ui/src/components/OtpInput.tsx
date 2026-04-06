import { Fragment, useRef, useState, useCallback } from "react";

interface OtpInputProps {
  length?: number;
  onComplete: (code: string) => void;
  disabled?: boolean;
}

export function OtpInput({ length = 6, onComplete, disabled }: OtpInputProps) {
  const [values, setValues] = useState<string[]>(Array(length).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const handleInput = useCallback(
    (index: number, raw: string) => {
      const char = raw.replace(/[^a-zA-Z0-9]/g, "").slice(-1).toUpperCase();
      const next = [...values];
      next[index] = char;
      setValues(next);

      if (char && index < length - 1) {
        refs.current[index + 1]?.focus();
      }

      if (next.join("").length === length) {
        onComplete(next.join(""));
      }
    },
    [values, length, onComplete],
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent) => {
      if (e.key === "Backspace" && !values[index] && index > 0) {
        refs.current[index - 1]?.focus();
        const next = [...values];
        next[index - 1] = "";
        setValues(next);
      }
      if (e.key === "ArrowLeft" && index > 0)
        refs.current[index - 1]?.focus();
      if (e.key === "ArrowRight" && index < length - 1)
        refs.current[index + 1]?.focus();
    },
    [values, length],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const pasted = (e.clipboardData.getData("text") || "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toUpperCase()
        .slice(0, length);
      const next = [...values];
      pasted.split("").forEach((ch, j) => {
        next[j] = ch;
      });
      setValues(next);
      const focusIdx = Math.min(pasted.length, length - 1);
      refs.current[focusIdx]?.focus();
      if (pasted.length === length) onComplete(pasted);
    },
    [values, length, onComplete],
  );

  const cellCls =
    "w-12 h-14 text-center text-xl font-mono font-semibold bg-slate-900 border border-slate-600 rounded-lg text-slate-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors uppercase disabled:opacity-50";

  return (
    <div className="flex gap-2" id="otp-boxes">
      {values.map((v, i) => (
        <Fragment key={i}>
          {i === 3 && (
            <span className="flex items-center text-slate-600 select-none">
              &mdash;
            </span>
          )}
          <input
            ref={(el) => {
              refs.current[i] = el;
            }}
            data-otp={i}
            type="text"
            maxLength={1}
            value={v}
            disabled={disabled}
            onChange={(e) => handleInput(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            className={cellCls}
          />
        </Fragment>
      ))}
    </div>
  );
}
