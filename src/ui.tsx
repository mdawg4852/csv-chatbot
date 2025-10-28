import React from "react";

export function Card({ children }: React.PropsWithChildren) {
  return <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, background: "#fff" }}>{children}</div>;
}
export function CardContent({ children }: React.PropsWithChildren) {
  return <div style={{ padding: 24 }}>{children}</div>;
}
export function Button(
  { children, onClick, variant = "default", disabled }: React.PropsWithChildren<{
    onClick?: () => void; variant?: "default" | "secondary"; disabled?: boolean;
  }>
) {
  const style: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: variant === "secondary" ? "#f3f4f6" : "#111827",
    color: variant === "secondary" ? "#111827" : "#fff",
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? "not-allowed" : "pointer"
  };
  return <button style={style} onClick={onClick} disabled={disabled}>{children}</button>;
}
export function Input(
  props: React.InputHTMLAttributes<HTMLInputElement>
) {
  return <input {...props} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }} />;
}
export function Badge({ children, variant = "default" }: React.PropsWithChildren<{ variant?: "default" | "outline" | "secondary" }>) {
  const styles: Record<string, React.CSSProperties> = {
    default: { background: "#111827", color: "#fff", border: "1px solid #111827" },
    outline: { background: "#fff", color: "#111827", border: "1px solid #e5e7eb" },
    secondary: { background: "#e5e7eb", color: "#111827", border: "1px solid #e5e7eb" },
  };
  return <span style={{ ...styles[variant], padding: "3px 8px", borderRadius: 999, fontSize: 12 }}>{children}</span>;
}
