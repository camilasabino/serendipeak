"use strict";

// A textarea marked data-word-counter gets a visible count against its data-word-limit. The
// server judges the text whatever this script does: the count only saves a round trip.
//
// The visible count is not a live region, since announcing every keystroke would drown the
// editor. A hidden status announces only when the text crosses the limit, after a pause.
// The script shares its global scope with the other classic scripts of the page, so it keeps its
// names to itself.
(() => {
  const countWords = (text) => {
    const trimmed = text.trim();
    return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
  };

  const ANNOUNCE_AFTER_MS = 800;

  const enhance = (textarea) => {
    const limit = Number(textarea.dataset.wordLimit);
    if (!Number.isInteger(limit) || limit <= 0) {
      return;
    }

    const counter = document.createElement("p");
    counter.className = "field__counter";
    counter.id = `${textarea.id}_counter`;
    const status = document.createElement("p");
    status.className = "visually-hidden";
    status.setAttribute("role", "status");
    textarea.after(counter, status);

    const described = textarea.getAttribute("aria-describedby");
    textarea.setAttribute("aria-describedby", described ? `${described} ${counter.id}` : counter.id);

    let over = null;
    let announcing;
    const update = () => {
      const words = countWords(textarea.value);
      const isOver = words > limit;
      counter.classList.toggle("field__counter--over", isOver);
      counter.textContent = isOver
        ? `${words} of ${limit} words: ${words - limit} over the limit.`
        : `${words} of ${limit} words.`;

      if (over !== null && over !== isOver) {
        clearTimeout(announcing);
        announcing = setTimeout(() => {
          status.textContent = isOver
            ? `The description is over the ${limit} word limit.`
            : `The description is within the ${limit} word limit.`;
        }, ANNOUNCE_AFTER_MS);
      }
      over = isOver;
    };

    textarea.addEventListener("input", update);
    update();
  };

  document.querySelectorAll("textarea[data-word-counter]").forEach(enhance);
})();
