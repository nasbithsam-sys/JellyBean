import { useState, useEffect, useRef } from "react";
import { Paintbrush, X, RotateCcw, Check, Sparkles, Sliders, Layout, Info, ArrowUpRight, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export type ThemeSettings = {
  primary: string;
  sidebar: string;
  background: string;
  card: string;
  radius: string;
  shadow: "none" | "subtle" | "medium" | "glow";
  fontScale: string;
};

const DEFAULT_THEME: ThemeSettings = {
  primary: "#3b82f6",
  sidebar: "#0f1b3d",
  background: "#f8fafc",
  card: "#ffffff",
  radius: "1rem",
  shadow: "medium",
  fontScale: "100%",
};

const PRESETS = [
  {
    name: "Classic Navy & Blue",
    primary: "#3b82f6",
    sidebar: "#0f1b3d",
    background: "#f8fafc",
    card: "#ffffff",
    radius: "1rem",
    shadow: "medium" as const,
  },
  {
    name: "Forest Emerald",
    primary: "#059669",
    sidebar: "#062f21",
    background: "#f0fdf4",
    card: "#ffffff",
    radius: "0.75rem",
    shadow: "subtle" as const,
  },
  {
    name: "Sleek Dark Mode",
    primary: "#3b82f6",
    sidebar: "#0f172a",
    background: "#0b1120",
    card: "#111827",
    radius: "0.85rem",
    shadow: "glow" as const,
  },
  {
    name: "Warm Amber",
    primary: "#d97706",
    sidebar: "#451a03",
    background: "#fffbeb",
    card: "#ffffff",
    radius: "1rem",
    shadow: "medium" as const,
  },
  {
    name: "Minimalist Slate",
    primary: "#475569",
    sidebar: "#1e293b",
    background: "#f1f5f9",
    card: "#ffffff",
    radius: "0.25rem",
    shadow: "none" as const,
  },
];

export function applyThemeSettings(theme: Partial<ThemeSettings>) {
  if (typeof window === "undefined") return;
  const root = document.documentElement;

  if (theme.primary) {
    root.style.setProperty("--primary", theme.primary);
    root.style.setProperty("--ring", theme.primary);
    root.style.setProperty("--sidebar-primary", theme.primary);
    root.style.setProperty("--sidebar-ring", theme.primary);
  }
  if (theme.background) {
    root.style.setProperty("--background", theme.background);
  }
  if (theme.card) {
    root.style.setProperty("--card", theme.card);
  }
  if (theme.sidebar) {
    root.style.setProperty("--sidebar", theme.sidebar);
  }
  if (theme.radius) {
    root.style.setProperty("--radius", theme.radius);
  }
  if (theme.fontScale) {
    root.style.setProperty("font-size", theme.fontScale === "90%" ? "14px" : theme.fontScale === "110%" ? "18px" : "16px");
  }

  // Shadow settings mapping
  if (theme.shadow) {
    if (theme.shadow === "none") {
      root.style.setProperty("--shadow-sm", "none");
      root.style.setProperty("--shadow-md", "none");
      root.style.setProperty("--shadow-lg", "none");
      root.style.setProperty("--shadow-glow", "none");
    } else if (theme.shadow === "subtle") {
      root.style.setProperty("--shadow-sm", "0 1px 2px 0 rgba(0,0,0,0.02)");
      root.style.setProperty("--shadow-md", "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)");
      root.style.setProperty("--shadow-lg", "0 10px 15px -3px rgba(0,0,0,0.05), 0 4px 6px -2px rgba(0,0,0,0.03)");
      root.style.setProperty("--shadow-glow", "0 0 0 1px rgba(59,130,246,0.1)");
    } else if (theme.shadow === "medium") {
      root.style.setProperty("--shadow-sm", "0 1px 2px 0 rgba(0,0,0,0.05)");
      root.style.setProperty("--shadow-md", "0 8px 24px -4px rgba(0,0,0,0.08), 0 4px 12px -2px rgba(0,0,0,0.04)");
      root.style.setProperty("--shadow-lg", "0 20px 48px -8px rgba(0,0,0,0.12), 0 10px 24px -4px rgba(0,0,0,0.06)");
      root.style.setProperty("--shadow-glow", "0 0 0 1px rgba(59,130,246,0.2), 0 4px 12px -2px rgba(59,130,246,0.1)");
    } else if (theme.shadow === "glow") {
      root.style.setProperty("--shadow-sm", "0 1px 2px 0 rgba(0,0,0,0.05)");
      root.style.setProperty("--shadow-md", "0 8px 30px rgba(59,130,246,0.15)");
      root.style.setProperty("--shadow-lg", "0 20px 60px rgba(59,130,246,0.25)");
      root.style.setProperty("--shadow-glow", "0 0 0 2px rgba(59,130,246,0.35), 0 8px 32px rgba(59,130,246,0.2)");
    }
  }
}

// Function to generate a unique CSS selector for any DOM element (used for text content)
function getUniqueSelector(el: HTMLElement): string {
  if (el.id) {
    return `#${el.id}`;
  }
  const path: string[] = [];
  let parent: HTMLElement | null = el;
  while (parent && parent.nodeType === Node.ELEMENT_NODE) {
    let selector = parent.nodeName.toLowerCase();
    if (parent.id) {
      selector += `#${parent.id}`;
      path.unshift(selector);
      break;
    } else {
      const classes = Array.from(parent.classList)
        .filter(c => 
          !c.includes(":") && 
          !c.includes("crm-motion") &&
          !c.includes("translate-y") &&
          !c.includes("opacity-") &&
          !c.includes("duration-")
        )
        .join(".");
      if (classes) {
        selector += `.${classes}`;
      }
      let sibling = parent;
      let nth = 1;
      while (sibling = sibling.previousElementSibling as HTMLElement) {
        if (sibling.nodeName === parent.nodeName) nth++;
      }
      selector += `:nth-of-type(${nth})`;
    }
    path.unshift(selector);
    parent = parent.parentNode as HTMLElement | null;
  }
  return path.join(" > ");
}

// Function to generate a repeatable selector (targets all elements of the SAME TYPE, e.g. all lead cards)
function getRepeatableSelector(el: HTMLElement): string {
  // 1. If the element itself has a class starting with crm-
  const crmClass = Array.from(el.classList).find(c => c.startsWith("crm-"));
  if (crmClass) {
    return `.${crmClass}`;
  }

  // 2. If a parent has a class starting with crm-
  let parent = el.parentElement;
  while (parent) {
    const parentCrmClass = Array.from(parent.classList).find(c => c.startsWith("crm-"));
    if (parentCrmClass) {
      // Find own classes, filtering out layouts, spacings, and colors
      const ownClasses = Array.from(el.classList)
        .filter(c => 
          !c.includes(":") && 
          !c.includes("crm-motion") &&
          !c.startsWith("bg-") && 
          !c.startsWith("text-") && 
          !c.startsWith("border-") && 
          !c.startsWith("rounded-") && 
          !c.startsWith("p-") && 
          !c.startsWith("px-") && 
          !c.startsWith("py-") && 
          !c.startsWith("m-") && 
          !c.startsWith("mx-") && 
          !c.startsWith("my-") && 
          !c.startsWith("w-") && 
          !c.startsWith("h-") && 
          !c.startsWith("shadow-") && 
          !c.startsWith("ring-")
        )
        .join(".");

      const childSelector = ownClasses ? `.${ownClasses}` : el.tagName.toLowerCase();
      return `.${parentCrmClass} ${childSelector}`;
    }
    parent = parent.parentElement;
  }

  // 3. Fallback to general classes if no crm parent
  const ownClasses = Array.from(el.classList)
    .filter(c => 
      !c.includes(":") && 
      !c.includes("crm-motion") &&
      !c.startsWith("bg-") && 
      !c.startsWith("text-") && 
      !c.startsWith("border-") && 
      !c.startsWith("rounded-")
    )
    .join(".");

  if (ownClasses) {
    return `.${ownClasses}`;
  }

  return el.tagName.toLowerCase();
}

export function loadSavedTheme() {
  if (typeof window === "undefined") return;
  
  // Load root variables
  const saved = localStorage.getItem("leadgrid-custom-theme");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      applyThemeSettings(parsed);
    } catch {
      // ignore
    }
  }

  // Load inline element styles
  loadSavedElementStyles();
}

export function loadSavedElementStyles() {
  if (typeof window === "undefined") return;
  const saved = localStorage.getItem("leadgrid-element-styles");
  if (!saved) return;
  try {
    const styles = JSON.parse(saved);
    
    // Inject custom styles in head
    const styleEl = document.getElementById("leadgrid-custom-element-styles") || document.createElement("style");
    styleEl.id = "leadgrid-custom-element-styles";
    
    let css = "";
    Object.entries(styles).forEach(([selector, rules]: [string, any]) => {
      let ruleStr = "";
      Object.entries(rules).forEach(([prop, val]) => {
        if (prop !== "textContent" && val !== "") {
          ruleStr += `${prop}: ${val} !important; `;
        }
      });
      if (ruleStr) {
        css += `${selector} { ${ruleStr} }\n`;
      }
    });
    styleEl.innerHTML = css;
    document.head.appendChild(styleEl);

    // Apply text changes immediately
    Object.entries(styles).forEach(([selector, rules]: [string, any]) => {
      if (rules.textContent !== undefined && rules.textContent !== "") {
        const el = document.querySelector(selector);
        if (el && el.textContent !== rules.textContent) {
          el.textContent = rules.textContent;
        }
      }
    });
  } catch {
    // ignore
  }
}

// Background poller to make sure custom text content persists across React re-renders
if (typeof window !== "undefined") {
  setInterval(() => {
    const saved = localStorage.getItem("leadgrid-element-styles");
    if (!saved) return;
    try {
      const styles = JSON.parse(saved);
      Object.entries(styles).forEach(([selector, rules]: [string, any]) => {
        if (rules.textContent !== undefined && rules.textContent !== "") {
          const el = document.querySelector(selector);
          if (el && el.textContent !== rules.textContent) {
            el.textContent = rules.textContent;
          }
        }
      });
    } catch {
      // ignore
    }
  }, 1000);
}

export function ThemeCustomizer({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [theme, setTheme] = useState<ThemeSettings>(DEFAULT_THEME);
  const [isDesignMode, setIsDesignMode] = useState(false);
  const [hoveredRect, setHoveredRect] = useState<DOMRect | null>(null);
  const [selectedEl, setSelectedEl] = useState<HTMLElement | null>(null);
  const [inspectorPos, setInspectorPos] = useState({ top: 0, left: 0 });
  const [customText, setCustomText] = useState("");
  const [customBg, setCustomBg] = useState("");
  const [customTextColor, setCustomTextColor] = useState("");
  const [customFontSize, setCustomFontSize] = useState("");
  const [customPadding, setCustomPadding] = useState("");
  const [customRadius, setCustomRadius] = useState("");

  const designModeRef = useRef(isDesignMode);
  designModeRef.current = isDesignMode;

  useEffect(() => {
    const saved = localStorage.getItem("leadgrid-custom-theme");
    if (saved) {
      try {
        setTheme(JSON.parse(saved));
      } catch {
        // ignore
      }
    }
  }, [isOpen]);

  // Global listeners for hover and click logic during Design Mode
  useEffect(() => {
    if (!isDesignMode) {
      setHoveredRect(null);
      setSelectedEl(null);
      return;
    }

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        !target ||
        target.closest(".visual-designer-controls") ||
        target.closest(".visual-inspector-panel") ||
        target === document.body ||
        target === document.documentElement
      ) {
        setHoveredRect(null);
        return;
      }
      setHoveredRect(target.getBoundingClientRect());
    };

    const handleMouseOut = () => {
      setHoveredRect(null);
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        !target ||
        target.closest(".visual-designer-controls") ||
        target.closest(".visual-inspector-panel") ||
        target === document.body ||
        target === document.documentElement
      ) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      setSelectedEl(target);
      const rect = target.getBoundingClientRect();
      
      // Position the panel next to the clicked element (prefer right side, fallback to top)
      let left = rect.right + window.scrollX + 12;
      let top = rect.top + window.scrollY;
      if (left + 288 > window.innerWidth) {
        left = Math.max(16, rect.left + window.scrollX);
        top = Math.max(16, rect.bottom + window.scrollY + 12);
      }
      setInspectorPos({ top, left });

      // Populate current styles
      setCustomText(target.textContent?.trim() || "");
      
      const comp = window.getComputedStyle(target);
      
      // Convert RGB values to HEX for pickers
      const rgbToHex = (rgbStr: string) => {
        const matches = rgbStr.match(/\d+/g);
        if (!matches || matches.length < 3) return "#ffffff";
        return "#" + matches.slice(0,3).map(x => parseInt(x).toString(16).padStart(2,"0")).join("");
      };
      
      setCustomBg(comp.backgroundColor && comp.backgroundColor !== "rgba(0, 0, 0, 0)" ? rgbToHex(comp.backgroundColor) : "#ffffff");
      setCustomTextColor(rgbToHex(comp.color));
      setCustomFontSize(comp.fontSize || "14px");
      setCustomPadding(comp.padding || "0px");
      setCustomRadius(comp.borderRadius || "0px");
    };

    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("mouseout", handleMouseOut, true);
    document.addEventListener("click", handleClick, true);

    return () => {
      document.removeEventListener("mouseover", handleMouseOver, true);
      document.removeEventListener("mouseout", handleMouseOut, true);
      document.removeEventListener("click", handleClick, true);
    };
  }, [isDesignMode]);

  const updateSetting = (key: keyof ThemeSettings, value: string) => {
    const updated = { ...theme, [key]: value };
    setTheme(updated);
    applyThemeSettings(updated);
  };

  const applyPreset = (preset: typeof PRESETS[0]) => {
    const updated = { ...theme, ...preset };
    setTheme(updated);
    applyThemeSettings(updated);
    toast.success(`Theme preset applied: ${preset.name}`);
  };

  const handleSave = () => {
    localStorage.setItem("leadgrid-custom-theme", JSON.stringify(theme));
    toast.success("Theme settings saved successfully!");
    onClose();
  };

  const handleReset = () => {
    localStorage.removeItem("leadgrid-custom-theme");
    localStorage.removeItem("leadgrid-element-styles");
    setTheme(DEFAULT_THEME);
    
    // Remove all overrides from page
    const root = document.documentElement;
    root.style.removeProperty("--primary");
    root.style.removeProperty("--ring");
    root.style.removeProperty("--sidebar-primary");
    root.style.removeProperty("--sidebar-ring");
    root.style.removeProperty("--background");
    root.style.removeProperty("--card");
    root.style.removeProperty("--sidebar");
    root.style.removeProperty("--radius");
    root.style.removeProperty("font-size");
    root.style.removeProperty("--shadow-sm");
    root.style.removeProperty("--shadow-md");
    root.style.removeProperty("--shadow-lg");
    root.style.removeProperty("--shadow-glow");

    const styleEl = document.getElementById("leadgrid-custom-element-styles");
    if (styleEl) styleEl.remove();

    toast.success("Design reset completely to standard defaults.");
    onClose();
    window.location.reload(); // reload to clear overridden text contents
  };

  // Visual Designer change handlers for clicked element
  const handleElementStyleChange = (prop: string, val: string) => {
    if (!selectedEl) return;
    const selector = getRepeatableSelector(selectedEl);
    
    // Save to local element style store
    const stored = localStorage.getItem("leadgrid-element-styles");
    const styles = stored ? JSON.parse(stored) : {};
    
    if (!styles[selector]) styles[selector] = {};
    styles[selector][prop] = val;
    
    localStorage.setItem("leadgrid-element-styles", JSON.stringify(styles));
    loadSavedElementStyles(); // apply dynamically
  };

  const handleTextChange = (text: string) => {
    if (!selectedEl) return;
    const selector = getUniqueSelector(selectedEl); // renames ONLY this specific instance
    
    const stored = localStorage.getItem("leadgrid-element-styles");
    const styles = stored ? JSON.parse(stored) : {};
    
    if (!styles[selector]) styles[selector] = {};
    styles[selector]["textContent"] = text;
    
    localStorage.setItem("leadgrid-element-styles", JSON.stringify(styles));
    loadSavedElementStyles(); // apply dynamically
  };

  const resetSelectedElement = () => {
    if (!selectedEl) return;
    const repSelector = getRepeatableSelector(selectedEl);
    const uniqSelector = getUniqueSelector(selectedEl);
    
    const stored = localStorage.getItem("leadgrid-element-styles");
    if (stored) {
      const styles = JSON.parse(stored);
      delete styles[repSelector];
      delete styles[uniqSelector];
      localStorage.setItem("leadgrid-element-styles", JSON.stringify(styles));
    }
    
    loadSavedElementStyles();
    toast.success("Element styles reset. Refresh may be needed to revert text changes.");
    setSelectedEl(null);
  };

  if (isDesignMode) {
    return (
      <>
        {/* Designer Banner bar at the top */}
        <div className="visual-designer-controls fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-[#0f1b3d]/96 border border-primary/40 backdrop-blur-md px-6 py-3.5 rounded-3xl shadow-2xl flex items-center gap-5 text-white animate-in slide-in-from-top duration-300">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4.5 w-4.5 text-primary animate-pulse shrink-0" />
            <div className="flex flex-col">
              <span className="text-[12px] font-bold tracking-tight">Visual Design Mode Active</span>
              <span className="text-[9.5px] text-white/50 font-medium">Click on any card, button, or text to style all matching items</span>
            </div>
          </div>
          <div className="h-5 w-[1px] bg-white/20" />
          <button 
            onClick={() => {
              setIsDesignMode(false);
              toast.success("Visual design edits saved!");
            }} 
            className="h-8.5 px-4 rounded-xl bg-primary hover:bg-primary-glow text-white text-[12px] font-bold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <CheckCircle className="h-3.5 w-3.5" />
            Exit Designer
          </button>
        </div>

        {/* Hover Highlight frame */}
        {hoveredRect && (
          <div
            style={{
              position: "absolute",
              border: "2px dashed var(--primary)",
              backgroundColor: "rgba(59, 130, 246, 0.04)",
              borderRadius: "6px",
              pointerEvents: "none",
              zIndex: 9999,
              top: hoveredRect.top + window.scrollY,
              left: hoveredRect.left + window.scrollX,
              width: hoveredRect.width,
              height: hoveredRect.height,
              transition: "all 60ms ease-out",
            }}
          />
        )}

        {/* Floating element style inspector panel */}
        {selectedEl && (
          <div
            style={{
              position: "absolute",
              top: inspectorPos.top,
              left: inspectorPos.left,
            }}
            className="visual-inspector-panel w-72 bg-card border border-border p-4.5 rounded-2xl shadow-2xl space-y-4 animate-in zoom-in-95 duration-100"
          >
            <div className="flex items-center justify-between border-b border-border pb-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <ArrowUpRight className="h-3.5 w-3.5 text-primary" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground truncate">
                  Style {selectedEl.tagName.toLowerCase()}
                </span>
              </div>
              <button 
                onClick={() => setSelectedEl(null)} 
                className="text-muted-foreground hover:text-foreground h-6 w-6 rounded-full hover:bg-surface flex items-center justify-center transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="bg-primary/5 border border-primary/25 rounded-xl px-2.5 py-2 text-[10.5px] text-primary/90 font-medium">
              ✨ Styling changes apply to **all similar elements** globally.
            </div>

            {/* Custom Text Option (Single Element Only) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="el-text" className="text-[11px] font-bold text-foreground/80">Rename (This item only)</Label>
                <span className="text-[9.5px] text-muted-foreground font-semibold uppercase">Unique</span>
              </div>
              <textarea
                id="el-text"
                value={customText}
                onChange={(e) => {
                  setCustomText(e.target.value);
                  selectedEl.textContent = e.target.value;
                  handleTextChange(e.target.value);
                }}
                className="w-full h-14 bg-surface border border-border rounded-xl text-xs p-2 text-foreground focus:ring-1 focus:ring-primary focus:outline-none resize-none"
              />
            </div>

            {/* Background & Text Colors */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="el-bg" className="text-[10px] font-bold text-muted-foreground">Bg Color</Label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="el-bg"
                    type="color"
                    value={customBg}
                    onChange={(e) => {
                      setCustomBg(e.target.value);
                      selectedEl.style.backgroundColor = e.target.value;
                      handleElementStyleChange("background-color", e.target.value);
                    }}
                    className="h-7 w-8 border border-border rounded cursor-pointer p-0 bg-transparent"
                  />
                  <span className="text-[10px] font-mono uppercase text-muted-foreground">{customBg}</span>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="el-txt-color" className="text-[10px] font-bold text-muted-foreground">Text Color</Label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="el-txt-color"
                    type="color"
                    value={customTextColor}
                    onChange={(e) => {
                      setCustomTextColor(e.target.value);
                      selectedEl.style.color = e.target.value;
                      handleElementStyleChange("color", e.target.value);
                    }}
                    className="h-7 w-8 border border-border rounded cursor-pointer p-0 bg-transparent"
                  />
                  <span className="text-[10px] font-mono uppercase text-muted-foreground">{customTextColor}</span>
                </div>
              </div>
            </div>

            {/* Font Size & Padding & Radius Sliders */}
            <div className="space-y-3 pt-1">
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-bold text-muted-foreground">
                  <span>Font Size</span>
                  <span>{customFontSize}</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="36"
                  value={parseInt(customFontSize) || 14}
                  onChange={(e) => {
                    const val = `${e.target.value}px`;
                    setCustomFontSize(val);
                    selectedEl.style.fontSize = val;
                    handleElementStyleChange("font-size", val);
                  }}
                  className="w-full accent-primary h-1 bg-surface rounded-lg cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-bold text-muted-foreground">
                  <span>Padding (Space)</span>
                  <span>{customPadding}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="40"
                  value={parseInt(customPadding) || 0}
                  onChange={(e) => {
                    const val = `${e.target.value}px`;
                    setCustomPadding(val);
                    selectedEl.style.padding = val;
                    handleElementStyleChange("padding", val);
                  }}
                  className="w-full accent-primary h-1 bg-surface rounded-lg cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-bold text-muted-foreground">
                  <span>Corners (Radius)</span>
                  <span>{customRadius}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="32"
                  value={parseInt(customRadius) || 0}
                  onChange={(e) => {
                    const val = `${e.target.value}px`;
                    setCustomRadius(val);
                    selectedEl.style.borderRadius = val;
                    handleElementStyleChange("border-radius", val);
                  }}
                  className="w-full accent-primary h-1 bg-surface rounded-lg cursor-pointer"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-border flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={resetSelectedElement}
                className="flex-1 text-[11px] h-8 text-destructive"
              >
                Reset Styles
              </Button>
              <Button 
                size="sm" 
                onClick={() => setSelectedEl(null)}
                className="flex-1 text-[11px] h-8"
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </>
    );
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs">
      <div 
        className="w-full max-w-md h-full bg-card border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Paintbrush className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-base font-bold text-foreground">Customize CRM Design</h2>
              <p className="text-[11.5px] text-muted-foreground font-medium">Design your own layout in real-time</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="h-8 w-8 rounded-full hover:bg-surface flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          
          {/* Design Mode Feature Banner */}
          <div className="bg-primary/10 border border-primary/20 rounded-2xl p-4.5 space-y-3 shadow-xs">
            <div className="flex items-center gap-2 text-primary font-bold text-xs">
              <Sparkles className="h-4.5 w-4.5 animate-bounce shrink-0" />
              <span>Interactive Designer Mode</span>
            </div>
            <p className="text-[11.5px] text-muted-foreground leading-relaxed">
              Don't want to use settings sliders? Click below to enter <strong>Design Mode</strong>. You can then hover and click on **literally any element** on the screen to change its color, size, text, and corners directly!
            </p>
            <Button
              onClick={() => {
                setIsDesignMode(true);
                onClose();
              }}
              className="w-full h-9 text-[11.5px] font-bold mt-1"
            >
              <Sliders className="h-3.5 w-3.5 mr-1.5" /> Start Design Mode
            </Button>
          </div>

          {/* 1. Theme Presets */}
          <div className="space-y-3">
            <Label className="text-[11.5px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
              <Layout className="h-3.5 w-3.5" /> Quick Theme Presets
            </Label>
            <div className="grid grid-cols-1 gap-2">
              {PRESETS.map((preset) => {
                const isSelected = 
                  theme.primary === preset.primary && 
                  theme.sidebar === preset.sidebar && 
                  theme.background === preset.background;

                return (
                  <button
                    key={preset.name}
                    onClick={() => applyPreset(preset)}
                    className={`flex items-center justify-between p-3 rounded-2xl border text-left text-xs font-semibold transition-all ${
                      isSelected 
                        ? "border-primary bg-primary/5 text-primary" 
                        : "border-border hover:bg-surface text-foreground"
                    }`}
                  >
                    <span>{preset.name}</span>
                    <div className="flex gap-1">
                      <span className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: preset.primary }} />
                      <span className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: preset.sidebar }} />
                      <span className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: preset.background }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Custom Colors */}
          <div className="space-y-4 pt-2">
            <Label className="text-[11.5px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
              <Sliders className="h-3.5 w-3.5" /> Custom Colors
            </Label>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="primary-color" className="text-xs font-bold text-foreground/80">Primary Accent</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="primary-color"
                    type="color"
                    value={theme.primary}
                    onChange={(e) => updateSetting("primary", e.target.value)}
                    className="h-8 w-10 border border-border rounded cursor-pointer p-0 bg-transparent"
                  />
                  <span className="text-[11px] font-mono font-medium text-muted-foreground uppercase">{theme.primary}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sidebar-color" className="text-xs font-bold text-foreground/80">Sidebar BG</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="sidebar-color"
                    type="color"
                    value={theme.sidebar}
                    onChange={(e) => updateSetting("sidebar", e.target.value)}
                    className="h-8 w-10 border border-border rounded cursor-pointer p-0 bg-transparent"
                  />
                  <span className="text-[11px] font-mono font-medium text-muted-foreground uppercase">{theme.sidebar}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="background-color" className="text-xs font-bold text-foreground/80">Page Background</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="background-color"
                    type="color"
                    value={theme.background}
                    onChange={(e) => updateSetting("background", e.target.value)}
                    className="h-8 w-10 border border-border rounded cursor-pointer p-0 bg-transparent"
                  />
                  <span className="text-[11px] font-mono font-medium text-muted-foreground uppercase">{theme.background}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="card-color" className="text-xs font-bold text-foreground/80">Card Background</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="card-color"
                    type="color"
                    value={theme.card}
                    onChange={(e) => updateSetting("card", e.target.value)}
                    className="h-8 w-10 border border-border rounded cursor-pointer p-0 bg-transparent"
                  />
                  <span className="text-[11px] font-mono font-medium text-muted-foreground uppercase">{theme.card}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Card Corners & Radius */}
          <div className="space-y-3 pt-2">
            <Label className="text-[11.5px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
              <Layout className="h-3.5 w-3.5" /> Rounded Corners
            </Label>
            <div className="flex gap-1.5 bg-surface p-1 rounded-2xl border border-border">
              {[
                { label: "Sharp", value: "0px" },
                { label: "Subtle", value: "0.5rem" },
                { label: "Medium", value: "1rem" },
                { label: "Pill", value: "2rem" },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => updateSetting("radius", item.value)}
                  className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${
                    theme.radius === item.value 
                      ? "bg-card text-foreground shadow-xs border border-border" 
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* 4. Shadows / Glows */}
          <div className="space-y-3 pt-2">
            <Label className="text-[11.5px] uppercase tracking-wider text-muted-foreground font-semibold">
              Card Shadow Styles
            </Label>
            <div className="flex gap-1.5 bg-surface p-1 rounded-2xl border border-border">
              {[
                { label: "None", value: "none" },
                { label: "Subtle", value: "subtle" },
                { label: "Classic", value: "medium" },
                { label: "Glow", value: "glow" },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => updateSetting("shadow", item.value as any)}
                  className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${
                    theme.shadow === item.value 
                      ? "bg-card text-foreground shadow-xs border border-border" 
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* 5. Text Size Scaling */}
          <div className="space-y-3 pt-2">
            <Label className="text-[11.5px] uppercase tracking-wider text-muted-foreground font-semibold">
              Text Scaling
            </Label>
            <div className="flex gap-1.5 bg-surface p-1 rounded-2xl border border-border">
              {[
                { label: "Small", value: "90%" },
                { label: "Normal", value: "100%" },
                { label: "Large", value: "110%" },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => updateSetting("fontScale", item.value)}
                  className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${
                    theme.fontScale === item.value 
                      ? "bg-card text-foreground shadow-xs border border-border" 
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* Footer actions */}
        <div className="p-5 border-t border-border bg-surface/30 flex gap-3.5">
          <Button 
            variant="outline" 
            onClick={handleReset}
            className="flex-1 h-11 text-xs font-bold text-destructive hover:bg-destructive/10"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset Defaults
          </Button>
          <Button 
            onClick={handleSave}
            className="flex-1 h-11 text-xs font-bold"
          >
            <Check className="h-4 w-4 mr-2" />
            Apply & Save
          </Button>
        </div>
      </div>
    </div>
  );
}
