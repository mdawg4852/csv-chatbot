import React, { forwardRef } from "react";

type BaseProps = { className?: string; children?: React.ReactNode };

export function Card({ children, className }: BaseProps) {
  return (
    <div
      className={className}
      style={{ border: "1px solid #e5e7eb", borderRadius: 16, background: "#fff" }}
    >
      {children}
    </div>
  );
}

export function CardContent({ children, className }: BaseProps) {
  return <div className={className} style={{ padding: 24 }}>{children}</div>;
}

type ButtonProps = BaseProps & {
  onClick?: () => void;
  variant?: "default" | "secondary";
  disabled?: boolean;
  size?: "sm" | "md";
};

export function Button({ children, onClick, variant = "default", disabled, className, size = "md" }: ButtonProps) {
  const style: React.CSSProperties = {
    padding: size === "sm" ? "6px 10px" : "8px 12px",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: variant === "secondary" ? "#f3f4f6" : "#111827",
    color: variant === "secondary" ? "#111827" : "#fff",
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
  return (
    <button onClick={onClick} disabled={disabled} className={className} style={style}>
      {children}
    </button>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { className?: string };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...rest },
  ref
) {
  return (
    <input
      ref={ref}
      className={className}
      style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
      {...rest}
    />
  );
});

export function Badge({ children, className, variant = "default" }: BaseProps & { variant?: "default" | "outline" | "secondary" }) {
  const styles: Record<string, React.CSSProperties> = {
    default: { background: "#111827", color: "#fff", border: "1px solid #111827" },
    outline: { background: "#fff", color: "#111827", border: "1px solid #e5e7eb" },
    secondary: { background: "#e5e7eb", color: "#111827", border: "1px solid #e5e7eb" },
  };
  return (
    <span
      className={className}
      style={{ ...styles[variant], padding: "3px 8px", borderRadius: 999, fontSize: 12 }}
    >
      {children}
    </span>
  );
}
