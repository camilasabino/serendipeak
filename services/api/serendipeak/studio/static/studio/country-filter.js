"use strict";

// Without this script the country checklist is the whole list of checkboxes. With it, a filter
// narrows the list by name or code; a country that is ticked stays in view so the selection is
// never hidden.
const fold = (text) =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

const enhance = (group) => {
  const controls = group.querySelector("[data-country-filter-controls]");
  const input = controls?.querySelector("input[type='search']");
  const status = controls?.querySelector("[data-country-filter-status]");
  const items = [...group.querySelectorAll(".checklist__item")];
  if (!controls || !input || !status) {
    return;
  }

  const summarize = (shown) => {
    const selected = items.filter((item) => item.querySelector("input").checked).length;
    status.textContent = `Showing ${shown} of ${items.length} countries. ${selected} selected.`;
  };

  const apply = () => {
    const needle = fold(input.value.trim());
    let shown = 0;
    items.forEach((item) => {
      const matches =
        !needle ||
        fold(item.textContent).includes(needle) ||
        item.querySelector("input").checked;
      item.hidden = !matches;
      shown += matches ? 1 : 0;
    });
    summarize(shown);
  };

  controls.hidden = false;
  input.addEventListener("input", apply);
  group.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === "checkbox") {
      apply();
    }
  });
  // Enter in the filter would otherwise submit the whole mountain form.
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
    }
  });
  apply();
};

document.querySelectorAll("[data-country-filter]").forEach(enhance);
