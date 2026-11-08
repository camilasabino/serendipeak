"use strict";

// Loaded blocking in <head> so the stored theme is applied before the first paint. Dark is the
// default and needs no attribute; only an explicit choice is stored.
const STORAGE_KEY = "studio-theme";
const THEMES = ["dark", "light"];

const readStored = () => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(value) ? value : null;
  } catch {
    return null;
  }
};

const store = (theme) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be blocked; the choice then lasts until the page is left.
  }
};

const apply = (theme) => {
  document.documentElement.dataset.theme = theme;
};

const current = () => document.documentElement.dataset.theme || "dark";

const reflect = () => {
  for (const button of document.querySelectorAll("[data-theme-option]")) {
    button.setAttribute("aria-pressed", String(button.dataset.themeOption === current()));
  }
};

apply(readStored() ?? "dark");

document.addEventListener("DOMContentLoaded", () => {
  for (const group of document.querySelectorAll("[data-theme-switch]")) {
    group.hidden = false;
  }
  for (const button of document.querySelectorAll("[data-theme-option]")) {
    button.addEventListener("click", () => {
      const theme = button.dataset.themeOption;
      apply(theme);
      store(theme);
      reflect();
    });
  }
  reflect();
});

window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY && THEMES.includes(event.newValue)) {
    apply(event.newValue);
    reflect();
  }
});
