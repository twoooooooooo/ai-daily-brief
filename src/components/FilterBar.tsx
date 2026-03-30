import { cn } from "@/lib/utils";
import { categoryFilters, importanceFilters, regionFilters } from "@/data/constants";

interface FilterBarProps {
  activeCategory: string;
  activeRegion: string;
  activeImportance: string;
  onCategoryChange: (cat: string) => void;
  onRegionChange: (region: string) => void;
  onImportanceChange: (imp: string) => void;
}

const FilterBar = ({
  activeCategory,
  activeRegion,
  activeImportance,
  onCategoryChange,
  onRegionChange,
  onImportanceChange,
}: FilterBarProps) => {
  const chipBase =
    "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 cursor-pointer select-none";
  const chipActive = "bg-foreground text-background shadow-sm";
  const chipInactive = "bg-card text-muted-foreground hover:text-foreground hover:bg-secondary border border-transparent hover:border-border";

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 border-b border-border">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <FilterGroup label="유형">
          {categoryFilters.map((cat) => (
            <button
              key={cat}
              onClick={() => onCategoryChange(cat)}
              className={cn(chipBase, activeCategory === cat ? chipActive : chipInactive)}
            >
              {cat}
            </button>
          ))}
        </FilterGroup>

        <div className="hidden sm:block h-5 w-px bg-border" />

        <FilterGroup label="지역">
          {regionFilters.map((r) => (
            <button
              key={r}
              onClick={() => onRegionChange(r)}
              className={cn(chipBase, activeRegion === r ? chipActive : chipInactive)}
            >
              {r}
            </button>
          ))}
        </FilterGroup>

        <div className="hidden sm:block h-5 w-px bg-border" />

        <FilterGroup label="중요도">
          {importanceFilters.map((imp) => (
            <button
              key={imp}
              onClick={() => onImportanceChange(imp)}
              className={cn(chipBase, activeImportance === imp ? chipActive : chipInactive)}
            >
              {imp}
            </button>
          ))}
        </FilterGroup>
      </div>
    </div>
  );
};

const FilterGroup = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center gap-1.5">
    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 mr-2 min-w-[28px]">
      {label}
    </span>
    {children}
  </div>
);

export default FilterBar;
