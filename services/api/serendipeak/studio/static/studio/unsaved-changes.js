"use strict";

// A form marked data-unsaved-guard warns before the page is left with edits the server does not
// have, and ignores a second submission while the first is on its way (a large photograph takes
// a while to upload, and the second request would be refused as a duplicate slug).
//
// A page that came back refused (data-unsaved-on-load) already holds edits the server refused,
// so it counts as unsaved until the editor submits it.
// An empty file input is reported as a new File on every read, with a new lastModified, so the
// timestamp only identifies a file that was really chosen.
const describe = (value) => {
  if (!(value instanceof File)) {
    return value;
  }
  return value.size > 0 ? [value.name, value.size, value.lastModified] : [];
};

const signature = (form) =>
  JSON.stringify(
    [...new FormData(form)]
      .filter(([name]) => name !== "csrfmiddlewaretoken")
      .map(([name, value]) => [name, describe(value)]),
  );

const guard = (form) => {
  const saved = signature(form);
  const unsavedOnLoad = form.hasAttribute("data-unsaved-on-load");
  let submitting = false;

  const hasUnsavedEdits = () => unsavedOnLoad || signature(form) !== saved;

  form.addEventListener("submit", (event) => {
    if (submitting) {
      event.preventDefault();
      return;
    }
    submitting = true;
    form.setAttribute("aria-busy", "true");
  });

  window.addEventListener("beforeunload", (event) => {
    if (submitting || !hasUnsavedEdits()) {
      return;
    }
    event.preventDefault();
    // Older browsers show their own text when a value is set.
    event.returnValue = "";
  });

  // Coming back through the history restores the page as it was left, submitted or not.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      submitting = false;
      form.removeAttribute("aria-busy");
    }
  });
};

document.querySelectorAll("form[data-unsaved-guard]").forEach(guard);
