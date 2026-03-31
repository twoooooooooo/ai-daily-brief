import { Moon, Sun, Zap, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const Header = () => {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  const location = useLocation();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  const now = new Date();
  const editionLabel = now.getHours() < 12 ? "Morning Edition" : now.getHours() < 18 ? "Afternoon Edition" : "Evening Edition";

  const navItems = [
    { path: "/", label: "오늘의 브리핑" },
    { path: "/archive", label: "아카이브" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 py-3.5 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          {/* Logo + edition */}
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-hero">
                <Zap className="h-4.5 w-4.5 text-primary-foreground" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                    AI Global Daily Brief
                  </h1>
                  <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-accent/10 border border-accent/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                    <Clock className="h-2.5 w-2.5" />
                    {editionLabel}
                  </span>
                </div>
              </div>
            </Link>
          </div>

          {/* Nav + controls */}
          <div className="flex items-center gap-1.5 sm:gap-4">
            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                    location.pathname === item.path
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="h-5 w-px bg-border hidden sm:block" />
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsDark(!isDark)}
              className="h-9 w-9 shrink-0"
              title="다크 모드 전환"
            >
              {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
