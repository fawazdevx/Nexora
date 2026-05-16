export const NAVIGATE_EVENT = "nexora:navigate";

export function currentPath() {
  return window.location.pathname.replace(/\/$/, "") || "/";
}

export function navigateTo(href: string) {
  if (currentPath() !== href) {
    window.history.pushState({}, "", href);
  }
  window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, {detail: {href}}));
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function readNavigationPath(event: Event) {
  if (event instanceof CustomEvent && typeof event.detail?.href === "string") {
    return event.detail.href;
  }
  return currentPath();
}
