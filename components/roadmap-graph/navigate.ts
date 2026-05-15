/**
 * Navigate to an href (anchor or path).
 * Pure DOM util — guard for SSR.
 */
export function navigateToHref(href: string): void {
  if (typeof document === "undefined") return;

  if (href.startsWith("#")) {
    const id = href.slice(1);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", href);
    }
  } else {
    window.location.href = href;
  }
}
