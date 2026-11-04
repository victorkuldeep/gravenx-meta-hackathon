"use client";

import { InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = "", id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-ivory-700">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`w-full rounded border bg-white px-3 py-2 text-sm text-ivory-950 placeholder-ivory-500 transition-colors focus:outline-none focus:ring-1 ${
            error
              ? "border-red-400 focus:ring-red-400"
              : "border-ivory-400 focus:border-bronze-500 focus:ring-bronze-500"
          } ${className}`}
          {...props}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        {hint && !error && <p className="text-xs text-ivory-600">{hint}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";

export default Input;
