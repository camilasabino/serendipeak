"use strict";

// The chosen file is shown through an object URL: it stays in the browser until the form is
// saved, and the preview makes no request.
document.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.matches("[data-photograph-file]")) {
    return;
  }

  const preview = input
    .closest(".photograph-upload")
    ?.querySelector("img[data-photograph-preview]");
  if (!preview) {
    return;
  }

  if (preview.src.startsWith("blob:")) {
    URL.revokeObjectURL(preview.src);
  }

  const [file] = input.files;
  if (file) {
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
  } else {
    preview.removeAttribute("src");
    preview.hidden = true;
  }
});
