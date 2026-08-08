export interface ThemeConfig {
  accent?: string;
  accentActive?: string;
  accentContrast?: string;
  surface?: string;
  border?: string;
  text?: string;
  danger?: string;
  radius?: string;
  fontFamily?: string;
}

// Maps each config key to the public CSS custom property it controls: see
// the doc comment at the top of shadow.css for what each one styles.
const THEME_PROPERTY_MAP: Record<keyof ThemeConfig, string> = {
  accent: "--clicksplain-accent",
  accentActive: "--clicksplain-accent-active",
  accentContrast: "--clicksplain-accent-contrast",
  surface: "--clicksplain-surface",
  border: "--clicksplain-border",
  text: "--clicksplain-text",
  danger: "--clicksplain-danger",
  radius: "--clicksplain-radius",
  fontFamily: "--clicksplain-font-family",
};

/**
 * Sets (or clears) inline custom properties on the mount element for each
 * theme key. Inline style has the highest specificity, so a JS theme value
 * always wins over a host-page CSS override of the same property, which in
 * turn wins over the built-in default, the same layering you'd expect from
 * any config-over-convention system. Always touches every key (not just the
 * ones provided) so a later init() with a different or absent theme fully
 * resets rather than merging with a stale previous theme.
 */
export function applyTheme(mount: HTMLElement, theme: ThemeConfig | undefined): void {
  for (const key of Object.keys(THEME_PROPERTY_MAP) as (keyof ThemeConfig)[]) {
    const cssProperty = THEME_PROPERTY_MAP[key];
    const value = theme?.[key];
    if (value) {
      mount.style.setProperty(cssProperty, value);
    } else {
      mount.style.removeProperty(cssProperty);
    }
  }
}
