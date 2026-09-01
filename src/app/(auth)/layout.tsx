import { ThemeToggle } from "@/components/ThemeToggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        padding: 16,
      }}
    >
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <ThemeToggle compact />
        </div>
        {children}
      </div>
    </div>
  );
}
