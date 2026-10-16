// Theme (DESIGN.md §3, §18): Light / Dark / System. A display preference only, so localStorage is fine; no finance data.
export type Theme = "light" | "dark" | "system";
const KEY = "kharcha.theme";

/** Runs inline in <head> before paint so a dark page never flashes light. Keep in sync with applyTheme. */
export const themeBoot = `(()=>{try{var t=localStorage.getItem("${KEY}")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export const getTheme = (): Theme => (localStorage.getItem(KEY) as Theme | null) ?? "system";

export function applyTheme(theme: Theme = getTheme()) {
  localStorage.setItem(KEY, theme);
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Follow the OS while on System. */
export function watchSystemTheme(): () => void {
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const on = () => getTheme() === "system" && applyTheme("system");
  mq.addEventListener("change", on);
  return () => mq.removeEventListener("change", on);
}
