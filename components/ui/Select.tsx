"use client";

import { SelectHTMLAttributes, forwardRef } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, className = "", id, children, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={selectId} className="text-xs font-medium text-ivory-700">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={`w-full rounded border bg-white px-3 py-2 text-sm text-ivory-950 transition-colors focus:outline-none focus:ring-1 ${
            error
              ? "border-red-400 focus:ring-red-400"
              : "border-ivory-400 focus:border-bronze-500 focus:ring-bronze-500"
          } ${className}`}
          {...props}
        >
          {children}
        </select>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {hint && !error && <p className="text-xs text-ivory-600">{hint}</p>}
      </div>
    );
  }
);
Select.displayName = "Select";

export default Select;
